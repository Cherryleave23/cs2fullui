import React, { useState, useEffect } from 'react';
import { Button, Input, Form, Alert, Space, Typography, Divider, Switch, Modal, Spin } from 'antd';
import { UserOutlined, LockOutlined, GlobalOutlined, KeyOutlined, EditOutlined } from '@ant-design/icons';
import { useAuthStore, type AccountInfo } from '../../stores/useAuthStore';

const { Text } = Typography;

/**
 * Login state machine:
 *   idle → connecting (await login Promise)
 *   connecting + steamGuard → guard_input
 *   guard_input → connecting (after code submit, wait login Promise)
 *   connecting → logged_in (Promise resolved) → idle
 *   any → error (show error, go back to idle)
 */
type LoginStep = 'idle' | 'connecting' | 'guard_input';

const LoginForm: React.FC = () => {
  const [form] = Form.useForm();
  const [step, setStep] = useState<LoginStep>('idle');
  const [steamGuardCode, setSteamGuardCode] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastCodeWrong, setLastCodeWrong] = useState(false);
  const [editNicknameId, setEditNicknameId] = useState<string | null>(null);
  const [newNickname, setNewNickname] = useState('');

  const { accounts, setAccounts, setStatus, setSteamId, setAccountName, setNickname, setInventoryCount } =
    useAuthStore();

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

  // ── Listen for Steam Guard push events from main process ──
  useEffect(() => {
    const unsub = window.electronAPI?.onSteamStatus?.((s: any) => {
      if (s.steamGuardNeeded) {
        // Main process is waiting for a guard code
        setStep('guard_input');
        setLastCodeWrong(s.lastCodeWrong);
      } else if (s.inventorySynced) {
        setStatus('gc_ready');
        setInventoryCount(s.count);
      }
    });
    return () => unsub?.();
  }, []);

  // ── Step 1: Start login (await doesn't resolve until guard done or fail) ──
  const handleLogin = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;

    setStep('connecting');
    setErrorMessage(null);
    setLastCodeWrong(false);
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

      if (result.success && result.steamId) {
        setSteamId(result.steamId);
        setStatus('logged_in');
        setStep('idle');
        await loadAccounts();
      } else if (!result.alreadyLoggedIn) {
        setErrorMessage(result.error || '登录失败');
        setStatus('error');
        setStep('idle');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Unknown error');
      setStatus('error');
      setStep('idle');
    }
  };

  // ── Step 2: Submit guard code (login continues in background) ──
  const handleSubmitSteamGuard = async () => {
    if (!steamGuardCode) return;
    const accountName = form.getFieldValue('accountName');
    setStep('connecting');

    try {
      const result: any = await window.electronAPI.auth.submitSteamGuard({
        accountName,
        code: steamGuardCode,
      });
      if (!result.success) {
        setErrorMessage(result.error);
        setStep('guard_input');
      }
      // If success, the login Promise in handleLogin will resolve and set status
    } catch (err: any) {
      setErrorMessage(err.message);
      setStep('guard_input');
    }
  };

  // ── Select saved account (fill form) ──
  const handleSelectAccount = (account: AccountInfo) => {
    form.setFieldsValue({
      accountName: account.accountName,
      nickname: account.nickname,
    });
    setAccountName(account.accountName);
    setNickname(account.nickname);
    setErrorMessage(null);
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

  // ── Render: Steam Guard input ──
  if (step === 'guard_input') {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        {lastCodeWrong && (
          <Alert
            type="error"
            message="验证码错误"
            description="请等待 30 秒后再输入新码，否则 Steam 会临时封禁你的 IP"
            showIcon
          />
        )}
        {!lastCodeWrong && (
          <Alert
            type="info"
            message="需要 Steam Guard 验证"
            description="请输入 Steam 手机 App 或邮箱收到的验证码"
            showIcon
          />
        )}
        <Input
          prefix={<KeyOutlined />}
          placeholder="输入 5 位验证码"
          value={steamGuardCode}
          onChange={(e) => setSteamGuardCode(e.target.value)}
          onPressEnter={handleSubmitSteamGuard}
          size="large"
          maxLength={6}
          autoFocus
        />
        <Button
          type="primary"
          block
          size="large"
          loading={false}
          disabled={steamGuardCode.length < 5}
          onClick={handleSubmitSteamGuard}
        >
          提交验证码
        </Button>
        <Button type="link" onClick={() => { setStep('idle'); setErrorMessage('已取消登录'); setStatus('idle'); }}>
          取消登录
        </Button>
      </Space>
    );
  }

  // ── Render: Login form (idle or connecting) ──
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {errorMessage && (
        <Alert
          type="error"
          message={errorMessage}
          closable
          onClose={() => setErrorMessage(null)}
          showIcon
        />
      )}

      {/* Saved accounts quick-select */}
      {accounts.length > 0 && (
        <div>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
            已保存的账号 — 点击填入表单
          </Text>
          <Space wrap>
            {accounts.map((acc) => (
              <Button
                key={acc.steamId}
                size="small"
                type={acc.isActive ? 'primary' : 'default'}
                onClick={() => handleSelectAccount(acc)}
                disabled={step === 'connecting'}
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
        <Form.Item
          name="accountName"
          label="Steam 账号名"
          rules={[{ required: true, message: '请输入 Steam 账号名' }]}
        >
          <Input prefix={<UserOutlined />} placeholder="Steam 登录账号" size="large" autoFocus />
        </Form.Item>

        <Form.Item name="nickname" label="本地备注名（可选）">
          <Input prefix={<EditOutlined />} placeholder="给这个账号起个名字，方便识别" size="large" />
        </Form.Item>

        <Form.Item
          name="password"
          label="密码"
          rules={[{ required: true, message: '请输入密码' }]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="Steam 密码" size="large" />
        </Form.Item>

        <Form.Item name="proxyUrl" label="代理地址（可选）">
          <Input prefix={<GlobalOutlined />} placeholder="socks5://127.0.0.1:10808" size="large" />
        </Form.Item>

        <Form.Item name="webCompatibilityMode" label="Web 兼容模式" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Button
          type="primary"
          block
          size="large"
          loading={step === 'connecting'}
          onClick={handleLogin}
          disabled={step === 'connecting'}
        >
          {step === 'connecting' ? '登录中...' : '登录 Steam'}
        </Button>
      </Form>

      {/* Nickname edit modal */}
      <Modal
        title="修改备注名"
        open={!!editNicknameId}
        onOk={handleSaveNickname}
        onCancel={() => setEditNicknameId(null)}
      >
        <Input value={newNickname} onChange={(e) => setNewNickname(e.target.value)} placeholder="输入备注名" />
      </Modal>
    </Space>
  );
};

export default LoginForm;
