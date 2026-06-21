import React, { useState, useEffect } from 'react';
import { Button, Input, Form, Alert, Space, Typography, Divider, Switch, Select, Modal } from 'antd';
import { UserOutlined, LockOutlined, GlobalOutlined, KeyOutlined, EditOutlined } from '@ant-design/icons';
import { useAuthStore, type AccountInfo } from '../../stores/useAuthStore';

const { Text } = Typography;

const LoginForm: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [steamGuardCode, setSteamGuardCode] = useState('');
  const [editNicknameId, setEditNicknameId] = useState<string | null>(null);
  const [newNickname, setNewNickname] = useState('');

  const {
    status, needSteamGuard, lastCodeWrong, errorMessage,
    accounts, setAccounts, setStatus, setSteamId, setAccountName,
    setNickname, setSteamGuard, setError, setInventoryCount,
  } = useAuthStore();

  // Load saved accounts on mount
  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const list: any = await window.electronAPI.auth.getAccounts();
      setAccounts(Array.isArray(list) ? list : []);
    } catch { /* ignore */ }
  };

  // Listen for push events
  useEffect(() => {
    const unsub = window.electronAPI?.onSteamStatus?.((s: any) => {
      if (s.steamGuardNeeded) {
        setSteamGuard(true, s.lastCodeWrong);
      } else if (s.inventorySynced) {
        setStatus('gc_ready');
        setInventoryCount(s.count);
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
    setAccountName(values.accountName);
    setNickname(values.nickname || values.accountName);

    try {
      const result: any = await window.electronAPI.auth.login({
        accountName: values.accountName,
        password: values.password,
        proxyUrl: values.proxyUrl || undefined,
        nickname: values.nickname || undefined,
      });

      if (result.needSteamGuard) {
        setSteamGuard(true);
        setLoading(false);
        return;
      }

      if (result.success && result.steamId) {
        setSteamId(result.steamId);
        setStatus('logged_in');
        await loadAccounts();
      } else if (!result.alreadyLoggedIn) {
        setError(result.error || '登录失败');
      }
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    }
    setLoading(false);
  };

  // ── Quick login with saved account ──
  const handleQuickLogin = async (account: AccountInfo) => {
    form.setFieldsValue({ accountName: account.accountName });
    setAccountName(account.accountName);
    setNickname(account.nickname);
    setStatus('connecting');
    setError(null);

    try {
      // Just attempt to connect — token will be used automatically
      const result: any = await window.electronAPI.auth.login({
        accountName: account.accountName,
        password: '', // Empty password → will trigger "need password" if no token
        proxyUrl: undefined,
        nickname: account.nickname,
      });

      if (result.success) {
        setSteamId(result.steamId);
        setStatus('logged_in');
      } else if (!result.alreadyLoggedIn) {
        // Token expired, need password
        setError('Token 已失效，请手动输入密码');
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSubmitSteamGuard = async () => {
    if (!steamGuardCode) return;
    setLoading(true);
    try {
      const values = form.getFieldsValue();
      await (window.electronAPI as any).auth.submitSteamGuard({
        accountName: values.accountName,
        code: steamGuardCode,
      });
      setSteamGuardCode('');
      setSteamGuard(false);
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Handle nickname edit
  const handleSaveNickname = async () => {
    if (!editNicknameId || !newNickname) return;
    await (window.electronAPI as any).auth.updateNickname?.({
      steamId: editNicknameId,
      nickname: newNickname,
    });
    setEditNicknameId(null);
    setNewNickname('');
    await loadAccounts();
  };

  // ── Steam Guard input ──
  if (needSteamGuard) {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        {lastCodeWrong && (
          <Alert type="warning" message="上次验证码错误，请等待30秒后再提交新码" showIcon />
        )}
        <Alert type="info" message="需要 Steam Guard 验证码" showIcon />
        <Input
          prefix={<KeyOutlined />}
          placeholder="输入验证码"
          value={steamGuardCode}
          onChange={(e) => setSteamGuardCode(e.target.value)}
          onPressEnter={handleSubmitSteamGuard}
          size="large" maxLength={6}
        />
        <Button type="primary" block size="large" loading={loading}
          disabled={steamGuardCode.length < 5} onClick={handleSubmitSteamGuard}>
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

      {/* Saved accounts quick login */}
      {accounts.length > 0 && (
        <div>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
            已保存的账号
          </Text>
          <Space wrap>
            {accounts.map((acc) => (
              <Button
                key={acc.steamId}
                size="small"
                type={acc.isActive ? 'primary' : 'default'}
                onClick={() => handleQuickLogin(acc)}
              >
                {acc.nickname || acc.accountName}
                {acc.isActive && ' ✓'}
                <EditOutlined
                  style={{ marginLeft: 4, fontSize: 10 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditNicknameId(acc.steamId);
                    setNewNickname(acc.nickname);
                  }}
                />
              </Button>
            ))}
          </Space>
        </div>
      )}

      <Divider style={{ margin: '8px 0' }} />

      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="accountName" label="Steam 账号名"
          rules={[{ required: true, message: '请输入 Steam 账号名' }]}>
          <Input prefix={<UserOutlined />} placeholder="Steam 登录账号" size="large" autoFocus />
        </Form.Item>

        <Form.Item name="nickname" label="本地备注名（可选）">
          <Input prefix={<EditOutlined />} placeholder="给这个账号起个名字" size="large" />
        </Form.Item>

        <Form.Item name="password" label="密码"
          rules={[{ required: true, message: '请输入密码' }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="Steam 密码" size="large" />
        </Form.Item>

        <Form.Item name="proxyUrl" label="代理地址（可选）">
          <Input prefix={<GlobalOutlined />} placeholder="socks5://127.0.0.1:10808" size="large" />
        </Form.Item>

        <Form.Item name="webCompatibilityMode" label="Web 兼容模式" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Button type="primary" block size="large" loading={loading}
          onClick={handleLogin} disabled={status === 'connecting'}>
          {status === 'connecting' ? '登录中...' : '登录 Steam'}
        </Button>
      </Form>

      {/* Nickname edit modal */}
      <Modal title="修改备注名" open={!!editNicknameId}
        onOk={handleSaveNickname} onCancel={() => setEditNicknameId(null)}>
        <Input value={newNickname}
          onChange={(e) => setNewNickname(e.target.value)}
          placeholder="输入备注名" />
      </Modal>
    </Space>
  );
};

export default LoginForm;
