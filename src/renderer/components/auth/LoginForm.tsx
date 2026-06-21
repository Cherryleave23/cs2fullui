/**
 * LoginForm — strictly follows the steam-cs2-bot tech reference flow:
 *
 *   User clicks "Login Steam"
 *     → ipc 'auth:login' {accountName, password, proxyUrl, nickname}
 *     → backend: token-first → password fallback → steam-user logOn()
 *     → if steamGuard: push event → guard_input step → user enters code
 *     → if loggedOn: login promise resolves → idle step
 *     → if error: login promise rejects → idle step with error
 */
import React, { useState, useEffect, useRef } from 'react';
import { Button, Input, Form, Alert, Space, Typography, Divider, Switch, Modal } from 'antd';
import { UserOutlined, LockOutlined, GlobalOutlined, KeyOutlined, EditOutlined } from '@ant-design/icons';
import { useAuthStore, type AccountInfo } from '../../stores/useAuthStore';

const { Text } = Typography;

type Step = 'idle' | 'connecting' | 'guard_input';

const LoginForm: React.FC = () => {
  const [form] = Form.useForm();
  const [step, setStep] = useState<Step>('idle');
  const [guardCode, setGuardCode] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastWrong, setLastWrong] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    accounts, setAccounts, setStatus, setSteamId, setAccountName,
    setNickname, setInventoryCount,
  } = useAuthStore();

  // Load accounts
  useEffect(() => { loadAccounts(); }, []);
  const loadAccounts = async () => {
    const list = await window.electronAPI.auth.getAccounts().catch(() => []);
    setAccounts(list as any);
  };

  // Listen for steamGuard push from main process
  useEffect(() => {
    const unsub = window.electronAPI?.onSteamStatus?.((s: any) => {
      if (s.steamGuardNeeded) {
        setStep('guard_input');
        setLastWrong(s.lastCodeWrong);
        if (s.lastCodeWrong || s.cooldown > 0) {
          setCooldown(s.cooldown || 30);
          cooldownTimer.current = setInterval(() => {
            setCooldown(c => { if (c <= 1) { clearInterval(cooldownTimer.current!); return 0; } return c - 1; });
          }, 1000);
        }
      } else if (s.inventorySynced) {
        setStatus('gc_ready');
        setInventoryCount(s.count);
      }
    });
    return () => { unsub?.(); if (cooldownTimer.current) clearInterval(cooldownTimer.current); };
  }, []);

  // ═══════════════════════════════════════
  //  LOGIN
  // ═══════════════════════════════════════
  const handleLogin = async () => {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;

    setStep('connecting');
    setErrorMsg(null);
    setStatus('connecting');
    setAccountName(v.accountName);
    setNickname(v.nickname || v.accountName);

    const result: any = await window.electronAPI.auth.login({
      accountName: v.accountName,
      password: v.password,
      proxyUrl: v.proxyUrl || undefined,
      nickname: v.nickname || undefined,
    }).catch((err: any) => ({ success: false, error: err.message }));

    if (result?.success && result.steamId) {
      setSteamId(result.steamId);
      setStatus('logged_in');
      setStep('idle');
      loadAccounts();
    } else if (!result?.alreadyLoggedIn) {
      setErrorMsg(result?.error || 'Login failed');
      setStatus('error');
      setStep('idle');
    }
  };

  // ═══════════════════════════════════════
  //  SUBMIT GUARD CODE
  // ═══════════════════════════════════════
  const handleSubmitGuard = async () => {
    if (!guardCode || cooldown > 0) return;
    const accountName = form.getFieldValue('accountName');
    setStep('connecting');
    const result: any = await window.electronAPI.auth.submitSteamGuard({
      accountName, code: guardCode,
    }).catch((err: any) => ({ success: false, error: err.message }));

    if (!result?.success) {
      setErrorMsg(result?.error);
      setStep('guard_input');
    }
    // success → login promise in handleLogin will resolve → step becomes idle
  };

  // ═══════════════════════════════════════
  //  QUICK SELECT
  // ═══════════════════════════════════════
  const selectAccount = (a: AccountInfo) => {
    form.setFieldsValue({ accountName: a.accountName, nickname: a.nickname });
    setAccountName(a.accountName);
    setNickname(a.nickname);
    setErrorMsg(null);
  };

  // ═══════════════════════════════════════
  //  RENDER: GUARD INPUT
  // ═══════════════════════════════════════
  if (step === 'guard_input') {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        <Alert
          type={lastWrong ? 'error' : 'info'}
          message={lastWrong
            ? `验证码错误 — 请在 ${cooldown} 秒后重试，否则 IP 将被临时封禁`
            : '需要 Steam Guard 验证'}
          description={!lastWrong ? '请输入 Steam 手机 App 或邮箱收到的验证码' : undefined}
          showIcon
        />
        <Input
          prefix={<KeyOutlined />}
          value={guardCode}
          onChange={e => setGuardCode(e.target.value.toUpperCase())}
          onPressEnter={handleSubmitGuard}
          size="large" maxLength={5} autoFocus
          disabled={cooldown > 0}
        />
        <Button type="primary" block size="large"
          disabled={guardCode.length < 5 || cooldown > 0}
          onClick={handleSubmitGuard}>
          {cooldown > 0 ? `等待 ${cooldown}s` : '提交验证码'}
        </Button>
        <Button type="link" onClick={() => { setStep('idle'); setErrorMsg('已取消'); setStatus('idle'); }}>
          取消登录
        </Button>
      </Space>
    );
  }

  // ═══════════════════════════════════════
  //  RENDER: LOGIN FORM
  // ═══════════════════════════════════════
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {errorMsg && <Alert type="error" message={errorMsg} closable onClose={() => setErrorMsg(null)} showIcon />}

      {accounts.length > 0 && (
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>已保存的账号 — 点击填入表单</Text>
          <Space wrap style={{ marginTop: 4 }}>
            {accounts.map(a => (
              <Button key={a.steamId} size="small"
                type={a.isActive ? 'primary' : 'default'}
                onClick={() => selectAccount(a)}
                disabled={step === 'connecting'}>
                {a.nickname || a.accountName}{a.isActive && ' ✓'}
                <EditOutlined style={{ marginLeft: 4, fontSize: 10 }}
                  onClick={e => { e.stopPropagation(); /* nickname modal */ }} />
              </Button>
            ))}
          </Space>
        </div>
      )}

      <Divider style={{ margin: '8px 0' }} />

      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="accountName" label="Steam 账号名" rules={[{ required: true }]}>
          <Input prefix={<UserOutlined />} placeholder="Steam 登录账号" size="large" autoFocus />
        </Form.Item>
        <Form.Item name="nickname" label="本地备注名 (可选)">
          <Input prefix={<EditOutlined />} placeholder="给这个账号起个名字" size="large" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="Steam 密码" size="large" />
        </Form.Item>
        <Form.Item name="proxyUrl" label="代理地址 (可选)">
          <Input prefix={<GlobalOutlined />} placeholder="socks5://127.0.0.1:10808" size="large" />
        </Form.Item>
        <Form.Item name="webCompatibilityMode" label="Web 兼容模式" valuePropName="checked">
          <Switch defaultChecked />
        </Form.Item>

        <Button type="primary" block size="large"
          loading={step === 'connecting'}
          onClick={handleLogin}
          disabled={step === 'connecting'}>
          {step === 'connecting' ? '登录中...' : '登录 Steam'}
        </Button>
      </Form>
    </Space>
  );
};

export default LoginForm;
