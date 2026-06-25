import React, { useEffect, useState, useCallback } from 'react';
import { Card, Typography, Button, Space, Table, Tag, Statistic, Row, Col, message } from 'antd';
import { ReloadOutlined, DownloadOutlined, CloudDownloadOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

interface PriceItem {
  item_hash_name: string;
  source: string;
  current_price: number | null;
  lowest_price: number | null;
  last_fetched_at: string | null;
}

const PricePage: React.FC = () => {
  const [prices, setPrices] = useState<PriceItem[]>([]);
  const [summary, setSummary] = useState<{ totalCached: number; lastUpdated: string | null; avgPriceAll: number | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cache, sum] = await Promise.all([
        window.electronAPI.price.getCache(),
        window.electronAPI.price.getSummary(),
      ]);
      setPrices((cache || []) as PriceItem[]);
      setSummary(sum as any);
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await window.electronAPI.price.refreshAll() as any;
      if (result.error) {
        message.error('刷新失败: ' + result.error);
      } else {
        message.success(result.note || `成功更新 ${result.fetched || 0} 个价格`);
        loadData();
      }
    } catch (err: any) {
      message.error('刷新失败: ' + err.message);
    }
    setRefreshing(false);
  };

  const handleFetchInventory = async () => {
    setInventoryLoading(true);
    try {
      const result = await window.electronAPI.price.fetchInventory() as any;
      if (result.error) {
        message.error('拉取失败: ' + result.error);
      } else {
        const parts = [result.note];
        if (result.failed > 0) parts.push(`失败 ${result.failed} 个`);
        message.success(parts.join('，'));
        loadData();
      }
    } catch (err: any) {
      message.error('拉取失败: ' + err.message);
    }
    setInventoryLoading(false);
  };

  const columns = [
    {
      title: '物品名称',
      dataIndex: 'item_hash_name',
      key: 'name',
      ellipsis: true,
      render: (v: string) => <Text copyable={{ text: v }}>{v}</Text>,
    },
    {
      title: '当前价',
      dataIndex: 'current_price',
      key: 'price',
      width: 120,
      align: 'right' as const,
      render: (v: number | null) => v != null ? <Text strong>${v.toFixed(2)}</Text> : <Text type="secondary">-</Text>,
    },
    {
      title: '市场价',
      dataIndex: 'lowest_price',
      key: 'lowest',
      width: 120,
      align: 'right' as const,
      render: (v: number | null) => v != null ? `$${v.toFixed(2)}` : '-',
    },
    {
      title: '数据源',
      dataIndex: 'source',
      key: 'source',
      width: 80,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '更新时间',
      dataIndex: 'last_fetched_at',
      key: 'updated',
      width: 160,
      render: (v: string | null) => v ? new Date(v + 'Z').toLocaleString('zh-CN') : '-',
    },
  ];

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>价格行情</Title>
        <Space>
          <Button icon={<CloudDownloadOutlined />} loading={inventoryLoading} onClick={handleFetchInventory}>
            从库存拉取价格
          </Button>
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={handleRefresh}>
            刷新全部
          </Button>
        </Space>
      </div>

      {summary && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={8}>
            <Card size="small">
              <Statistic
                title="已缓存"
                value={summary.totalCached}
                prefix={<DownloadOutlined />}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic
                title="平均价格"
                value={summary.avgPriceAll ?? 0}
                prefix="$"
                precision={2}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic
                title="最后更新"
                value={summary.lastUpdated
                  ? new Date(summary.lastUpdated + 'Z').toLocaleString('zh-CN')
                  : '从未更新'}
              />
            </Card>
          </Col>
        </Row>
      )}

      <Card>
        <Table
          dataSource={prices}
          columns={columns}
          rowKey="item_hash_name"
          loading={loading}
          size="small"
          pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `共 ${t} 条` }}
          locale={{ emptyText: '暂无价格数据，请先点击「刷新价格」拉取' }}
        />
      </Card>
    </div>
  );
};

export default PricePage;
