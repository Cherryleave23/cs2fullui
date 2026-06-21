import React, { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout, Menu, Typography, Tag, Space } from 'antd';
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

const statusTagMap: Record<string, { color: string; text: string }> = {
  idle: { color: 'default', text: '离线' },
  connecting: { color: 'processing', text: '连接中...' },
  logged_in: { color: 'orange', text: '已登录' },
  gc_connecting: { color: 'orange', text: 'CS2 连接中' },
  gc_ready: { color: 'green', text: 'CS2 已就绪' },
  error: { color: 'red', text: '错误' },
};

const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, steamId, setStatus } = useAuthStore();
  const statusInfo = statusTagMap[status] || statusTagMap.idle;

  // Listen for push events from main process
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
        <div style={{ position: 'absolute', bottom: 0, width: '100%', padding: 16 }}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Tag color={statusInfo.color} style={{ width: '100%', textAlign: 'center' }}>
              {status === 'gc_ready' ? '🟢 ' : status === 'logged_in' ? '🟡 ' : '⚪ '}
              {statusInfo.text}
            </Tag>
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
              Steam: <Tag color={status === 'idle' ? 'default' : 'green'} style={{ fontSize: 11 }}>{statusInfo.text}</Tag>
            </Text>
            <Text style={{ fontSize: 12 }}>
              GC: <Tag color={status === 'gc_ready' ? 'green' : 'default'} style={{ fontSize: 11 }}>
                {status === 'gc_ready' ? '已连接' : '未连接'}
              </Tag>
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
