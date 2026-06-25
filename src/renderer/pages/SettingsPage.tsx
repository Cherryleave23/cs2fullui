import React, { useEffect, useState } from 'react';
import { Card, Tabs, Typography, Button, Input, Form, message, Descriptions, Tag, Space, Alert, Divider } from 'antd';
import { useAuthStore } from '../stores/useAuthStore';
import {
  UserOutlined, LockOutlined, GlobalOutlined, DatabaseOutlined,
  BgColorsOutlined, InfoCircleOutlined, SaveOutlined,
  CheckCircleOutlined, WarningOutlined, KeyOutlined,
  LoginOutlined, PlusOutlined, DeleteOutlined,
} from '@ant-design/icons';
const { Title, Paragraph, Text } = Typography;

// ── Minimal Steam login — token persistence per tech reference ──
const MinimalLogin: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'idle' | 'guard'>('idle');
  const [guardCode, setGuardCode] = useState('');
  const [guardCooldown, setGuardCooldown] = useState(0);
  const [steamId, setSteamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAccounts, setSavedAccounts] = useState<any[]>([]);
  const [gcReady, setGcReady] = useState(false);
  const [invCount, setInvCount] = useState(0);

  useEffect(() => {
    (window.electronAPI as any).steamListSaved?.().then((list: any[]) => {
      if (list) setSavedAccounts(list);
    }).catch(() => {});
    // Restore login state (survives page navigation — client lives in main process)
    (window.electronAPI as any).steamStatus?.().then((s: any) => {
      if (s?.steamId) { setSteamId(s.steamId); setGcReady(s.gcReady); setInvCount(s.itemCount); }
    }).catch(() => {});
    // Auto-relogin on startup if saved account has token
    (window.electronAPI as any).steamAutoLogin?.().catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = (window.electronAPI as any).onSteamLog?.((d: any) => {
      if (d.type === 'guard') {
        setStep('guard');
        if (d.lastWrong) {
          setGuardCooldown(d.cooldown || 30);
          const t = setInterval(() => setGuardCooldown(c => {
            if (c <= 1) { clearInterval(t); return 0; } return c - 1;
          }), 1000);
        }
      } else if (d.type === 'logged-in') {
        setSteamId(d.steamId);
        setStep('idle');
        setLoading(false);
      } else if (d.type === 'gc-ready' || d.type === 'inventory-synced') {
        setGcReady(true);
        if (d.count) setInvCount(d.count);
      } else if (d.type === 'error') {
        setError(d.message);
        setStep('idle');
        setLoading(false);
      } else if (d.type === 'inventory-synced') {
        console.log(`Inventory synced: ${d.count} items`);
      }
    });
    return () => unsub?.();
  }, []);

  // One-click token login (no password needed)
  const handleTokenLogin = (account: any) => {
    setLoading(true);
    setError(null);
    (window.electronAPI as any).steamLogin({
      accountName: account.accountName,
      password: '', // empty — token will be used (or guard needed)
    });
  };

  const handleLogin = async () => {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    setLoading(true);
    setError(null);
    // Fire-and-forget — push events handle state changes
    const result = await (window.electronAPI as any).steamLogin({
      accountName: v.accountName,
      password: v.password,
      proxyUrl: v.proxyUrl || undefined,
    }).catch((err: any) => ({ success: false, error: err.message || 'IPC error' }));
    // If result came back synchronously (error before events fired)
    if (result && !result.success) {
      setError(result.error || 'Login failed');
      setLoading(false);
    }
  };

  const handleGuard = () => {
    if (!guardCode || guardCooldown > 0) return;
    (window.electronAPI as any).steamGuard({ code: guardCode });
  };

  if (steamId) {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert type="success" message={`Steam 已登录 — ID: ${steamId}`} showIcon />
        <Alert type={gcReady ? 'success' : 'warning'}
          message={gcReady ? `CS2 GC 已连接 — 库存 ${invCount} 件` : 'CS2 GC 连接中...'}
          showIcon />
        <Button onClick={() => { setSteamId(null); setGcReady(false); setStep('idle'); }}>登出</Button>
      </Space>
    );
  }

  if (step === 'guard') {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type={guardCooldown > 0 ? 'error' : 'info'}
          message={guardCooldown > 0
            ? `验证码错误 — 等待 ${guardCooldown}s 后再试`
            : '需要 Steam Guard 验证'}
          showIcon
        />
        <Input
          prefix={<KeyOutlined />}
          value={guardCode}
          onChange={e => setGuardCode(e.target.value.toUpperCase())}
          onPressEnter={handleGuard}
          maxLength={5} autoFocus
          disabled={guardCooldown > 0}
        />
        <Button type="primary" block
          disabled={guardCode.length < 5 || guardCooldown > 0}
          onClick={handleGuard}>
          {guardCooldown > 0 ? `等待 ${guardCooldown}s` : '提交验证码'}
        </Button>
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {error && <Alert type="error" message={error} closable onClose={() => setError(null)} showIcon />}

      {savedAccounts.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>已保存账号 (Token免密免验证):</Text>
          {savedAccounts.map((a: any) => (
            <Button key={a.steamId} size="small" type={a.isActive ? 'primary' : 'default'}
              onClick={() => handleTokenLogin(a)} disabled={loading}
              style={{ margin: '2px 4px 2px 0' }}>
              {a.nickname || a.accountName}{a.hasToken ? ' 🔑' : ''}{a.isActive ? ' ✓' : ''}
            </Button>
          ))}
          <Divider style={{ margin: '8px 0' }} />
        </div>
      )}

      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="accountName" label="Steam 账号" rules={[{ required: true }]}>
          <Input prefix={<UserOutlined />} placeholder="Steam 登录账号" size="large" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="Steam 密码" size="large" />
        </Form.Item>
        <Form.Item name="proxyUrl" label="代理 (可选)">
          <Input prefix={<GlobalOutlined />} placeholder="socks5://127.0.0.1:10808" />
        </Form.Item>
        <Button type="primary" block size="large" loading={loading} onClick={handleLogin}>
          {loading ? '登录中...' : '登录 Steam'}
        </Button>
      </Form>
    </Space>
  );
};

// ── CSQAQ 账号配置（带备注） ──
const CsqaAccountConfig: React.FC = () => {
  const [accounts, setAccounts] = useState<Array<{ label: string; token: string }>>([{ label: '', token: '' }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.electronAPI.price.getCsqaAccounts().then((r: any) => {
      if (r?.accounts && Array.isArray(r.accounts) && r.accounts.length > 0) {
        setAccounts(r.accounts);
      }
    });
  }, []);

  const handleAdd = () => setAccounts([...accounts, { label: '', token: '' }]);
  const handleRemove = (idx: number) => setAccounts(accounts.filter((_, i) => i !== idx));
  const handleChange = (idx: number, field: 'label' | 'token', value: string) => {
    const next = [...accounts];
    next[idx] = { ...next[idx], [field]: value };
    setAccounts(next);
  };

  const handleSave = async () => {
    const clean = accounts
      .filter(a => a.token && a.token.trim())
      .map(a => ({ label: (a.label || '').trim() || '未命名账号', token: a.token.trim() }));
    setSaving(true);
    await window.electronAPI.price.setCsqaAccounts(clean);
    setSaving(false);
    setAccounts(clean.length > 0 ? clean : [{ label: '', token: '' }]);
    message.success(`已保存 ${clean.length} 个 CSQAQ 账号`);
  };

  const validCount = accounts.filter(a => a.token && a.token.trim()).length;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Title level={5}>CSQAQ API 配置</Title>
      <Paragraph type="secondary">
        CSQAQ 提供聚合市场价（Buff / 悠悠有品 / Steam），需要 ApiToken 才能使用。
        支持配置多个账号 Token，多账号时自动并行拉取以加速价格获取。
      </Paragraph>

      {accounts.map((acc, idx) => (
        <Space key={idx} style={{ width: '100%' }} align="center">
          <Tag color={acc.token.trim() ? 'green' : 'default'} style={{ minWidth: 72, textAlign: 'center' }}>
            账号 {idx + 1}
          </Tag>
          <Input
            value={acc.label}
            onChange={e => handleChange(idx, 'label', e.target.value)}
            placeholder="备注名"
            style={{ width: 120 }}
          />
          <Input.Password
            prefix={<KeyOutlined />}
            value={acc.token}
            onChange={e => handleChange(idx, 'token', e.target.value)}
            placeholder="CSQAQ ApiToken"
            size="large"
            style={{ flex: 1, maxWidth: 350 }}
          />
          {accounts.length > 1 && (
            <Button danger icon={<DeleteOutlined />} onClick={() => handleRemove(idx)} size="large" />
          )}
        </Space>
      ))}

      <Space>
        <Button icon={<PlusOutlined />} onClick={handleAdd}>添加账号</Button>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>保存全部</Button>
      </Space>

      {validCount > 1 && (
        <Alert type="info" showIcon message={`已配置 ${validCount} 个账号，拉取价格时将自动并行分配批次`} />
      )}
    </Space>
  );
};

// ── C5 账号配置 ──
const C5AccountConfig: React.FC = () => {
  const [accounts, setAccounts] = useState<Array<{ label: string; appKey: string }>>([{ label: '', appKey: '' }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.electronAPI.price.getC5Accounts().then((r: any) => {
      if (r?.accounts && Array.isArray(r.accounts) && r.accounts.length > 0) {
        setAccounts(r.accounts);
      }
    });
  }, []);

  const handleAdd = () => setAccounts([...accounts, { label: '', appKey: '' }]);
  const handleRemove = (idx: number) => setAccounts(accounts.filter((_, i) => i !== idx));
  const handleChange = (idx: number, field: 'label' | 'appKey', value: string) => {
    const next = [...accounts];
    next[idx] = { ...next[idx], [field]: value };
    setAccounts(next);
  };

  const handleSave = async () => {
    const clean = accounts
      .filter(a => a.appKey && a.appKey.trim())
      .map(a => ({ label: (a.label || '').trim() || '未命名账号', appKey: a.appKey.trim() }));
    setSaving(true);
    await window.electronAPI.price.setC5Accounts(clean);
    setSaving(false);
    setAccounts(clean.length > 0 ? clean : [{ label: '', appKey: '' }]);
    message.success(`已保存 ${clean.length} 个 C5 账号`);
  };

  const validCount = accounts.filter(a => a.appKey && a.appKey.trim()).length;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Title level={5}>C5GAME API 配置</Title>
      <Paragraph type="secondary">
        C5GAME 开放平台，提供饰品价格和在售数据。
        App-Key 可在 C5GAME 个人中心 - API 管理页面申请。限流 50qps，多账号可并行加速。
      </Paragraph>

      {accounts.map((acc, idx) => (
        <Space key={idx} style={{ width: '100%' }} align="center">
          <Tag color={acc.appKey.trim() ? 'green' : 'default'} style={{ minWidth: 72, textAlign: 'center' }}>
            账号 {idx + 1}
          </Tag>
          <Input
            value={acc.label}
            onChange={e => handleChange(idx, 'label', e.target.value)}
            placeholder="备注名"
            style={{ width: 120 }}
          />
          <Input.Password
            prefix={<KeyOutlined />}
            value={acc.appKey}
            onChange={e => handleChange(idx, 'appKey', e.target.value)}
            placeholder="C5GAME App-Key"
            size="large"
            style={{ flex: 1, maxWidth: 350 }}
          />
          {accounts.length > 1 && (
            <Button danger icon={<DeleteOutlined />} onClick={() => handleRemove(idx)} size="large" />
          )}
        </Space>
      ))}

      <Space>
        <Button icon={<PlusOutlined />} onClick={handleAdd}>添加账号</Button>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>保存全部</Button>
      </Space>

      {validCount > 1 && (
        <Alert type="info" showIcon message={`已配置 ${validCount} 个账号，拉取价格时将自动并行分配批次`} />
      )}
    </Space>
  );
};

// ── 占位组件：功能开发中 ──
const PlaceholderConfig: React.FC<{ name: string; desc: string }> = ({ name, desc }) => (
  <Space direction="vertical" size={16} style={{ width: '100%', alignItems: 'center', padding: '60px 0' }}>
    <div style={{ fontSize: 48, opacity: 0.3 }}>🔒</div>
    <Title level={4} style={{ color: 'var(--text-secondary, rgba(0,0,0,0.45))' }}>功能开发中</Title>
    <Paragraph type="secondary" style={{ textAlign: 'center' }}>
      {name} {desc}，敬请期待
    </Paragraph>
  </Space>
);

// ── 外部环境配置（价格平台） ──
const ExternalEnvConfig: React.FC = () => {
  const subItems = [
    { key: 'csqaq', label: 'CSQAQ', children: <CsqaAccountConfig /> },
    { key: 'c5', label: 'C5', children: <C5AccountConfig /> },
    { key: 'buff', label: 'Buff', children: <PlaceholderConfig name="Buff" desc="价格接口接入" /> },
    { key: 'eco', label: 'ECO', children: <PlaceholderConfig name="ECO" desc="价格接口接入" /> },
    { key: 'yyyp', label: '悠悠有品', children: <PlaceholderConfig name="悠悠有品" desc="价格接口接入" /> },
  ];

  return <Tabs items={subItems} style={{ width: '100%' }} />;
};

const SettingsPage: React.FC = () => {
  const [proxyForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [dataStatus, setDataStatus] = useState<{ csgoapiDownloaded: boolean; csgoapiLang: string }>({
    csgoapiDownloaded: false,
    csgoapiLang: '',
  });

  useEffect(() => {
    window.electronAPI.auth.getProxyConfig().then((c: any) => {
      proxyForm.setFieldsValue({ proxyUrl: c.proxyUrl || '' });
    });
    window.electronAPI.data.getStatus().then((s: any) => {
      if (s) setDataStatus(s);
    });
  }, []);

  const handleSaveProxy = async () => {
    const values = await proxyForm.validateFields();
    setSaving(true);
    await window.electronAPI.auth.setProxyConfig({ proxyUrl: values.proxyUrl || '' });
    setSaving(false);
    message.success('代理配置已保存');
  };

  const accountTab = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card bordered={false}>
        <Space>
          <Button type="primary" icon={<LoginOutlined />}
            onClick={async () => {
              message.loading({ content: '正在登录所有已保存的账号...', key: 'loginAll', duration: 0 });
              const res: any = await window.electronAPI.auth.loginAll();
              if (res?.success) {
                message.success({ content: `已登录 ${res.count} 个账号`, key: 'loginAll' });
                // Refresh account list in store so sidebar shows online status
                const list = await window.electronAPI.auth.getAccounts();
                useAuthStore.getState().setAccounts(list as any);
              } else {
                message.error({ content: res?.error || '登录失败', key: 'loginAll' });
              }
            }}>
            一键登录所有账号
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            使用保存的 Refresh Token 同时登录所有账号
          </Text>
        </Space>
      </Card>
      <Card bordered={false}>
        <MinimalLogin />
      </Card>
    </Space>
  );

  const proxyTab = (
    <Card bordered={false}>
      <Form form={proxyForm} layout="vertical">
        <Form.Item name="proxyUrl" label="代理地址">
          <Input placeholder="socks5://127.0.0.1:10808" />
        </Form.Item>
        <Form.Item help="支持 socks5:// 和 http:// 格式。留空则直连。">
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSaveProxy}>
            保存代理配置
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );

  const dataTab = (
    <Card bordered={false}>
      <Title level={5}>数据管理</Title>
      <Paragraph>
        CSGO-API 数据状态：
        {dataStatus.csgoapiDownloaded ? (
          <Text type="success">
            <CheckCircleOutlined style={{ marginRight: 4 }} />
            已下载 ({dataStatus.csgoapiLang})
          </Text>
        ) : (
          <Text type="warning">
            <WarningOutlined style={{ marginRight: 4 }} />
            未下载
          </Text>
        )}
      </Paragraph>
      <Paragraph type="secondary">
        CSGO-API 提供物品名称、稀有度、图片等静态数据。
        将 all.json 放到项目 data/ 目录下即可自动加载。
      </Paragraph>
    </Card>
  );

  const appearanceTab = (
    <Card bordered={false}>
      <Title level={5}>界面设置</Title>
      <Paragraph>语言：简体中文 | 主题：浅色 (暗色主题开发中)</Paragraph>
    </Card>
  );

  const aboutTab = (
    <Card bordered={false}>
      <Title level={5}>关于 CS2炼金管理</Title>
      <Descriptions column={1} size="small" bordered style={{ maxWidth: 400 }}>
        <Descriptions.Item label="版本">1.0.0</Descriptions.Item>
        <Descriptions.Item label="技术栈">Electron + React 18 + Ant Design 5 + sql.js</Descriptions.Item>
        <Descriptions.Item label="核心依赖">steam-user v5 / globaloffensive v3.3</Descriptions.Item>
        <Descriptions.Item label="平台">Windows 10/11</Descriptions.Item>
      </Descriptions>
    </Card>
  );

  const priceTab = (
    <Card bordered={false}>
      <ExternalEnvConfig />
    </Card>
  );

  const items = [
    { key: 'account', label: <span><UserOutlined /> 账号</span>, children: accountTab },
    { key: 'proxy', label: <span><GlobalOutlined /> 代理</span>, children: proxyTab },
    { key: 'price', label: <span><KeyOutlined /> 外部环境配置</span>, children: priceTab },
    { key: 'data', label: <span><DatabaseOutlined /> 数据</span>, children: dataTab },
    { key: 'appearance', label: <span><BgColorsOutlined /> 外观</span>, children: appearanceTab },
    { key: 'about', label: <span><InfoCircleOutlined /> 关于</span>, children: aboutTab },
  ];

  return (
    <div className="fade-in">
      <Title level={3} style={{ marginBottom: 24 }}>设置</Title>
      <Card>
        <Tabs tabPosition="left" items={items} style={{ minHeight: 400 }} />
      </Card>
    </div>
  );
};

export default SettingsPage;
