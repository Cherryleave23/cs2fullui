import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout, Menu, Typography, Tag, Space, Popover, Button, message } from 'antd';
import {
  PieChartOutlined,
  UnorderedListOutlined,
  ExperimentOutlined,
  BookOutlined,
  DollarOutlined,
  HistoryOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/useAuthStore';

const { Sider, Content, Footer } = Layout;
const { Text } = Typography;

// Lazy-loaded pages
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'));
const InventoryPage = React.lazy(() => import('./pages/InventoryPage'));
const TradeUpPage = React.lazy(() => import('./pages/TradeUpPage'));
const RecipePage = React.lazy(() => import('./pages/RecipePage'));
const PricePage = React.lazy(() => import('./pages/PricePage'));
const HistoryPage = React.lazy(() => import('./pages/HistoryPage'));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage'));

const menuItems: MenuProps['items'] = [
  { key: '/', icon: <PieChartOutlined />, label: '仪表盘' },
  { key: '/inventory', icon: <UnorderedListOutlined />, label: '库存管理' },
  { key: '/tradeup', icon: <ExperimentOutlined />, label: '汰换交易' },
  { key: '/recipes', icon: <BookOutlined />, label: '配方库' },
  { key: '/prices', icon: <DollarOutlined />, label: '价格行情' },
  { key: '/history', icon: <HistoryOutlined />, label: '交易历史' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
];

const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, steamId, setStatus, accounts, setAccounts, setAccountName } = useAuthStore();

  // Load accounts + listen for status
  useEffect(() => {
    const load = async () => {
      const list = await window.electronAPI?.auth.getAccounts?.() || [];
      setAccounts(list as any);
    };
    load();
  }, []);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    const unsub1 = window.electronAPI?.onSteamStatus?.((s: any) => {
      if (s.state === 'logged_in') setStatus('logged_in');
      else if (s.state === 'gc_ready') setStatus('gc_ready');
      else if (s.state === 'idle') setStatus('idle');
      else if (s.state === 'error') setStatus('error');
    });
    if (unsub1) unsubs.push(unsub1);
    const unsub2 = window.electronAPI?.onGcStatus?.((s: any) => {
      if (s === 0 || s === 'HAVE_SESSION') setStatus('gc_ready');
      else if (s === 1 || s === 'GC_GOING_DOWN') setStatus('logged_in');
    });
    if (unsub2) unsubs.push(unsub2);
    return () => unsubs.forEach(fn => fn?.());
  }, []);

  const [gcPopoverOpen, setGcPopoverOpen] = useState(false);
  const handleSwitchAccount = async (sid: string) => {
    await window.electronAPI?.auth.switchAccount?.(sid);
    setGcPopoverOpen(false);
    const list = await window.electronAPI?.auth.getAccounts?.() || [];
    setAccounts(list as any);
    message.success('GC 已切换');
  };
  const handleDisconnectGC = async () => {
    await window.electronAPI?.auth.disconnectGC?.();
    setStatus('logged_in');
    setGcPopoverOpen(false);
    message.info('GC 已断开');
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={220}
        style={{
          background: 'var(--sider-bg, #001529)',
          borderRight: '1px solid var(--border-color, #303030)',
        }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <Text strong style={{ color: '#fff', fontSize: 18, letterSpacing: 1 }}>
            🔧 CS2炼金管理
          </Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ marginTop: 8 }}
        />
        <div style={{ position: 'absolute', bottom: 0, width: '100%', padding: '12px 16px' }}>
          {/* Account list switcher */}
          {accounts.length > 1 && (
            <div style={{ marginBottom: 8, maxHeight: 80, overflowY: 'auto' }}>
              {accounts.map((a: any) => (
                <div key={a.steamId}
                  onClick={() => handleSwitchAccount(a.steamId)}
                  style={{
                    padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                    background: a.isActive ? 'rgba(24,144,255,0.15)' : 'transparent',
                    marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: a.gcReady ? '#52c41a' : a.isOnline ? '#faad14' : '#888',
                  }} />
                  <Text style={{
                    color: a.isActive ? '#1890ff' : 'rgba(255,255,255,0.65)',
                    fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {a.nickname || a.accountName}
                  </Text>
                </div>
              ))}
            </div>
          )}
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <Tag color={status === 'idle' ? 'default' : 'green'} style={{ flex: 1, textAlign: 'center', fontSize: 11 }}>
                Steam: {status === 'idle' ? '离线' : status === 'connecting' ? '连接中' : '已连接'}
              </Tag>
              <Popover
                open={gcPopoverOpen}
                onOpenChange={setGcPopoverOpen}
                trigger="click"
                placement="top"
                content={
                  <div style={{ minWidth: 160 }}>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                      选择 GC 连接账号 (仅一个)
                    </div>
                    {accounts.filter((a: any) => a.isOnline).map((a: any) => (
                      <div key={a.steamId}
                        onClick={() => handleSwitchAccount(a.steamId)}
                        style={{
                          padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
                          marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6,
                          background: a.isActive ? 'rgba(24,144,255,0.1)' : 'transparent',
                        }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: a.gcReady ? '#52c41a' : '#faad14',
                        }} />
                        <span style={{ fontSize: 12 }}>{a.nickname || a.accountName}</span>
                        {a.isActive && <Tag color="blue" style={{ fontSize: 10, marginLeft: 'auto' }}>当前</Tag>}
                      </div>
                    ))}
                    {accounts.filter((a: any) => a.isOnline).length === 0 && (
                      <Text type="secondary" style={{ fontSize: 12 }}>没有在线的账号</Text>
                    )}
                    <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 8, paddingTop: 8 }}>
                      <Button size="small" block danger onClick={handleDisconnectGC}>
                        断开 GC 连接
                      </Button>
                    </div>
                  </div>
                }>
                <Tag color={status === 'gc_ready' ? 'green' : 'default'}
                  style={{ flex: 1, textAlign: 'center', fontSize: 11, cursor: 'pointer' }}>
                  GC: {status === 'gc_ready' ? '已连接 ▼' : '未连接 ▼'}
                </Tag>
              </Popover>
            </div>
            {steamId && (
              <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, display: 'block', textAlign: 'center' }}>
                {steamId.substring(0, 10)}...
              </Text>
            )}
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, display: 'block', textAlign: 'center' }}>
              v1.0.0
            </Text>
          </Space>
        </div>
      </Sider>

      <Layout>
        <Content style={{ padding: 24, overflow: 'auto', background: 'var(--content-bg, #f5f5f5)' }}>
          <React.Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>加载中...</div>}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/tradeup" element={<TradeUpPage />} />
              <Route path="/recipes" element={<RecipePage />} />
              <Route path="/prices" element={<PricePage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </React.Suspense>
        </Content>

        <Footer
          style={{
            padding: '4px 24px',
            background: 'var(--footer-bg, #fafafa)',
            borderTop: '1px solid var(--border-color, #e8e8e8)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Space size={16}>
            <Text style={{ fontSize: 12 }}>
              Steam: <Tag color={status === 'idle' ? 'default' : 'green'} style={{ fontSize: 11 }}>{status === 'idle' ? '离线' : status === 'connecting' ? '连接中' : '已连接'}</Tag>
            </Text>
            <Text style={{ fontSize: 12 }}>
              GC: <Tag color={status === 'gc_ready' ? 'green' : 'default'} style={{ fontSize: 11 }}>{status === 'gc_ready' ? '已连接' : '未连接'}</Tag>
            </Text>
          </Space>
          <Space size={16}>
            <Text style={{ fontSize: 12 }}>版本 1.0.0</Text>
          </Space>
        </Footer>
      </Layout>
    </Layout>
  );
};

export default App;
