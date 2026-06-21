import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, Typography, List, Tag, Space, Progress } from 'antd';
import {
  InboxOutlined,
  ExperimentOutlined,
  BookOutlined,
  HistoryOutlined,
  FireOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Title, Text: TypoText } = Typography;

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalItems: 0,
    byRarity: {} as Record<string, number>,
    byType: {} as Record<string, number>,
  });
  const [historyStats, setHistoryStats] = useState({ total: 0, completed: 0, failed: 0 });

  useEffect(() => {
    // Load inventory stats
    window.electronAPI.inventory.getStats().then((s: any) => {
      if (s) setStats(prev => ({ ...prev, ...s }));
    });
    // Load recent trade-up history
    window.electronAPI.tradeup.getHistory(1).then((r: any) => {
      if (r?.items) {
        const completed = r.items.filter((i: any) => i.status === 'completed').length;
        const failed = r.items.filter((i: any) => i.status === 'failed').length;
        setHistoryStats({ total: r.total, completed, failed });
      }
    });
  }, []);

  return (
    <div className="fade-in">
      <Title level={3} style={{ marginBottom: 24 }}>仪表盘</Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => navigate('/inventory')}>
            <Statistic title="库存物品" value={stats.totalItems} prefix={<InboxOutlined />} suffix="件" />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => navigate('/history')}>
            <Statistic title="汰换记录" value={historyStats.total} prefix={<ExperimentOutlined />} suffix="次" />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => navigate('/recipes')}>
            <Statistic title="保存配方" value={0} prefix={<BookOutlined />} suffix="个" />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="成功率"
              value={historyStats.total > 0
                ? Math.round((historyStats.completed / historyStats.total) * 100)
                : 0}
              prefix={<FireOutlined />}
              suffix="%"
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card title="按稀有度分布">
            {Object.keys(stats.byRarity).length > 0 ? (
              Object.entries(stats.byRarity).map(([name, count]) => (
                <div key={name} style={{ marginBottom: 8 }}>
                  <Space style={{ width: 80, display: 'inline-block' }}>
                    <TypoText>{name}</TypoText>
                  </Space>
                  <Progress
                    percent={Math.round((count / stats.totalItems) * 100)}
                    size="small"
                    style={{ width: 'calc(100% - 90px)' }}
                    format={() => `${count}`}
                  />
                </div>
              ))
            ) : (
              <TypoText type="secondary">登录并刷新库存后显示</TypoText>
            )}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="快速指引">
            <List size="small">
              <List.Item>1. 前往 <a onClick={() => navigate('/settings')}>设置</a> 登录 Steam 并配置代理</List.Item>
              <List.Item>2. 在 <a onClick={() => navigate('/inventory')}>库存管理</a> 刷新并浏览 CS2 物品</List.Item>
              <List.Item>3. 在 <a onClick={() => navigate('/tradeup')}>汰换交易</a> 模拟和执行汰换</List.Item>
              <List.Item>4. 将成功配方保存到 <a onClick={() => navigate('/recipes')}>配方库</a></List.Item>
              <List.Item>5. 查看 <a onClick={() => navigate('/prices')}>价格行情</a> 获取市场数据</List.Item>
            </List>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default DashboardPage;
