import React, { useState, useEffect } from 'react';
import { Button, Input, Form, Alert, Space, Typography, Divider, Switch, Modal } from 'antd';
import { UserOutlined, LockOutlined, GlobalOutlined, KeyOutlined, EditOutlined } from '@ant-design/icons';
import { useAuthStore, type AccountInfo } from '../../stores/useAuthStore';

const { Text } = Typography;

type LoginStep = 'idle' | 'connecting' | 'guard_input';

const LoginForm: React.FC = () => {
  const [form] = Form.useForm();
  const [step, setStep] = useState<LoginStep>('idle');
  const [steamGuardCode, setSteamGuardCode] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastCodeWrong, setLastCodeWrong] = useState(false);
  const [guardCooldown, setGuardCooldown] = useState(0);
  const [editNicknameId, setEditNicknameId] = useState<string | null>(null);
  const [newNickname, setNewNickname] = useState('');

  const { accounts, setAccounts, setStatus, setSteamId, setAccountName, setNickname, setInventoryCount } =
    useAuthStore();

  useEffect(() => { loadAccounts(); }, []);

  const loadAccounts = async () => {
    try {
      const list: any = await window.electronAPI.auth.getAccounts();
      setAccounts(Array.isArray(list) ? list : []);
    } catch { /* ignore */ }
  };

  // Listen for Steam Guard push events
  useEffect(() => {
    const unsub = window.electronAPI?.onSteamStatus?.((s: any) => {
      if (s.steamGuardNeeded) {
        setStep('guard_input');
        setLastCodeWrong(s.lastCodeWrong);
        // 30s cooldown on wrong code (steam-user requirement to avoid IP ban)
        if (s.lastCodeWrong) {
          setGuardCooldown(30);
          const timer = setInterval(() => {
            setGuardCooldown(prev => {
              if (prev <= 1) { clearInterval(timer); return 0; }
              return prev - 1;
            });
          }, 1000);
        }
      } else if (s.inventorySynced) {
        setStatus('gc_ready');
        setInventoryCount(s.count);
      }
    });
    return () => unsub?.();
  }, []);

  // Step 1: Start login
  const handleLogin = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;

    setStep('connecting');
    setErrorMessage(null);
    setLastCodeWrong(false);
    setGuardCooldown(0);
    setStatus('connecting');
    setAccountName(values.accountName);
    setNickname(values.nickname || values.accountName);

    try {
      const result: any = await window.electronAPI.auth.login({
        accountName: values.accountName,
        password: values.password,
        proxyUrl: values.proxyUrl || undefined,
        nickname: values.nickname || undefined,
        webCompatibilityMode: values.webCompatibilityMode || false,
      });

      if (result.success && result.steamId) {
        setSteamId(result.steamId);
        setStatus('logged_in');
        setStep('idle');
        await loadAccounts();
      } else if (!result.alreadyLoggedIn) {
        setErrorMessage(result.error || 'Login failed');
        setStatus('error');
        setStep('idle');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Unknown error');
      setStatus('error');
      setStep('idle');
    }
  };

  // Step 2: Submit guard code
  const handleSubmitSteamGuard = async () => {
    if (!steamGuardCode || guardCooldown > 0) return;
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
    } catch (err: any) {
      setErrorMessage(err.message);
      setStep('guard_input');
    }
  };

  const handleSelectAccount = (account: AccountInfo) => {
    form.setFieldsValue({ accountName: account.accountName, nickname: account.nickname });
    setAccountName(account.accountName);
    setNickname(account.nickname);
    setErrorMessage(null);
  };

  const handleSaveNickname = async () => {
    if (!editNicknameId || !newNickname) return;
    await (window.electronAPI as any).auth.updateNickname?.({ steamId: editNicknameId, nickname: newNickname });
    setEditNicknameId(null);
    setNewNickname('');
    await loadAccounts();
  };

  // ── Render: Guard input ──
  if (step === 'guard_input') {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        {lastCodeWrong ? (
          <Alert
            type="error"
            message={`验证码错误 — 请在 ${guardCooldown} 秒后重试`}
            description="立即重试会导致 Steam 临时封禁你的 IP 地址"
            showIcon
          />
        ) : (
          <Alert
            type="info"
            message="需要 Steam Guard 验证"
            description="请输入 Steam 手机 App 或邮箱收到的验证码"
            showIcon
          />
        )}
        <Input
          prefix={<KeyOutlined />}
          placeholder="输入验证码"
          value={steamGuardCode}
          onChange={(e) => setSteamGuardCode(e.target.value)}
          onPressEnter={handleSubmitSteamGuard}
          size="large"
          maxLength={6}
          autoFocus
          disabled={guardCooldown > 0}
        />
        <Button
          type="primary"
          block
          size="large"
          disabled={steamGuardCode.length < 5 || guardCooldown > 0}
          onClick={handleSubmitSteamGuard}
        >
          {guardCooldown > 0 ? `等待 ${guardCooldown}s...` : '提交验证码'}
        </Button>
        <Button type="link" onClick={() => { setStep('idle'); setErrorMessage('Login cancelled'); setStatus('idle'); }}>
          取消登录
        </Button>
      </Space>
    );
  }

  // ── Render: Login form ──
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {errorMessage && (
        <Alert type="error" message={errorMessage} closable onClose={() => setErrorMessage(null)} showIcon />
      )}

      {accounts.length > 0 && (
        <div>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
            Saved accounts — click to fill form
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
                {acc.isActive && ' *'}
                <EditOutlined style={{ marginLeft: 4, fontSize: 10 }}
                  onClick={(e) => { e.stopPropagation(); setEditNicknameId(acc.steamId); setNewNickname(acc.nickname); }}
                />
              </Button>
            ))}
          </Space>
        </div>
      )}

      <Divider style={{ margin: '8px 0' }} />

      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="accountName" label="Steam Account" rules={[{ required: true }]}>
          <Input prefix={<UserOutlined />} placeholder="Steam login name" size="large" autoFocus />
        </Form.Item>
        <Form.Item name="nickname" label="Nickname (optional)">
          <Input prefix={<EditOutlined />} placeholder="A name to identify this account" size="large" />
        </Form.Item>
        <Form.Item name="password" label="Password" rules={[{ required: true }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="Steam password" size="large" />
        </Form.Item>
        <Form.Item name="proxyUrl" label="Proxy (optional)">
          <Input prefix={<GlobalOutlined />} placeholder="socks5://127.0.0.1:10808" size="large" />
        </Form.Item>
        <Form.Item name="webCompatibilityMode" label="Web Compat Mode" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Button type="primary" block size="large"
          loading={step === 'connecting'}
          onClick={handleLogin}
          disabled={step === 'connecting'}
        >
          {step === 'connecting' ? 'Logging in...' : 'Login to Steam'}
        </Button>
      </Form>

      <Modal title="Edit Nickname" open={!!editNicknameId}
        onOk={handleSaveNickname} onCancel={() => setEditNicknameId(null)}>
        <Input value={newNickname} onChange={(e) => setNewNickname(e.target.value)} placeholder="Enter nickname" />
      </Modal>
    </Space>
  );
};

export default LoginForm;
