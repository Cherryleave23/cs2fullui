import React, { useState, useEffect } from 'react';
import { Button, Input, Form, Alert, Space, Typography, Divider, Switch } from 'antd';
import { UserOutlined, LockOutlined, GlobalOutlined, KeyOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../stores/useAuthStore';

const { Text } = Typography;

const LoginForm: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [steamGuardCode, setSteamGuardCode] = useState('');

  const {
    status,
    needSteamGuard,
    lastCodeWrong,
    errorMessage,
    setStatus,
    setSteamId,
    setSteamGuard,
    setError,
  } = useAuthStore();

  // Listen for Steam status push events
  useEffect(() => {
    const unsub = window.electronAPI.onSteamStatus((s: any) => {
      if (s.state === 'steam_guard_required') {
        setSteamGuard(true, s.lastCodeWrong);
      } else if (s.state === 'logged_in') {
        setStatus('logged_in');
      } else if (s.state === 'idle') {
        setStatus('idle');
      }
    });
    return () => unsub?.();
  }, []);

  const handleLogin = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;

    setLoading(true);
    setError(null);
    setStatus('connecting');

    try {
      const result = await window.electronAPI.auth.login({
        accountName: values.accountName,
        password: values.password,
        proxyUrl: values.proxyUrl || undefined,
        webCompatibilityMode: values.webCompatibilityMode || false,
      });

      if (result.needSteamGuard) {
        setSteamGuard(true);
        setLoading(false);
        return;
      }

      if (result.success && result.steamId) {
        setSteamId(result.steamId);
        setStatus('logged_in');
      } else {
        setError(result.error || '登录失败');
      }
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    }
    setLoading(false);
  };

  const handleSubmitSteamGuard = async () => {
    if (!steamGuardCode) return;
    setLoading(true);
    try {
      await window.electronAPI.auth.submitSteamGuard(steamGuardCode);
      setSteamGuardCode('');
      setSteamGuard(false);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  // Steam Guard required? Show code input
  if (needSteamGuard) {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        {lastCodeWrong && (
          <Alert
            type="warning"
            message="上次验证码错误，请等待30秒后再提交新码，否则IP将被临时封禁"
            showIcon
          />
        )}
        <Alert
          type="info"
          message="需要 Steam Guard 验证码"
          description="请查看你的 Steam 手机应用或邮箱获取验证码"
          showIcon
        />
        <Input
          prefix={<KeyOutlined />}
          placeholder="输入 Steam Guard 验证码"
          value={steamGuardCode}
          onChange={(e) => setSteamGuardCode(e.target.value)}
          onPressEnter={handleSubmitSteamGuard}
          size="large"
          maxLength={6}
        />
        <Button
          type="primary"
          block
          size="large"
          loading={loading}
          disabled={steamGuardCode.length < 5}
          onClick={handleSubmitSteamGuard}
        >
          提交验证码
        </Button>
      </Space>
    );
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {errorMessage && (
        <Alert type="error" message={errorMessage} closable onClose={() => setError(null)} showIcon />
      )}

      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="accountName"
          label="Steam 账号名"
          rules={[{ required: true, message: '请输入 Steam 账号名' }]}
        >
          <Input
            prefix={<UserOutlined />}
            placeholder="Steam 登录账号"
            size="large"
            autoFocus
          />
        </Form.Item>

        <Form.Item
          name="password"
          label="密码"
          rules={[{ required: true, message: '请输入密码' }]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="Steam 密码"
            size="large"
          />
        </Form.Item>

        <Form.Item name="proxyUrl" label="代理地址 (可选)">
          <Input
            prefix={<GlobalOutlined />}
            placeholder="socks5://127.0.0.1:10808"
            size="large"
          />
        </Form.Item>

        <Form.Item name="webCompatibilityMode" label="Web 兼容模式" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Divider style={{ margin: '12px 0' }} />

        <Button
          type="primary"
          block
          size="large"
          loading={loading}
          onClick={handleLogin}
          disabled={status === 'connecting'}
        >
          {status === 'connecting' ? '登录中...' : '登录 Steam'}
        </Button>
      </Form>
    </Space>
  );
};

export default LoginForm;
