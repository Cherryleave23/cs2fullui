import React, { useState, useEffect } from 'react';
import { Card, Typography, Table, Tag, Space, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '待执行' },
  executing: { color: 'processing', text: '执行中' },
  completed: { color: 'green', text: '已完成' },
  failed: { color: 'red', text: '失败' },
};

const HistoryPage: React.FC = () => {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const result: any = await window.electronAPI.tradeup.getHistory(page);
      setRecords(result.items || []);
      setTotal(result.total || 0);
    } catch { setRecords([]); }
    setLoading(false);
  };

  useEffect(() => { loadHistory(); }, [page]);

  const columns: ColumnsType<any> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 60,
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'time',
      width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '稀有度',
      key: 'rarity',
      width: 120,
      render: (_: any, r: any) => (
        <Space>
          <Tag color="blue">{r.input_rarity}</Tag>
          <Text>→</Text>
          <Tag color="green">{r.target_rarity}</Tag>
        </Space>
      ),
    },
    {
      title: '平均磨损',
      dataIndex: 'avg_wear_norm',
      key: 'wear',
      width: 100,
      render: (v: number | null) =>
        v != null ? `${(v * 100).toFixed(1)}%` : '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (v: string) => {
        const info = STATUS_MAP[v] || { color: 'default', text: v };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    {
      title: '产出',
      dataIndex: 'outcome_json',
      key: 'outcome',
      ellipsis: true,
      render: (v: string | null) =>
        v ? (
          <Text style={{ fontSize: 12 }}>
            {(() => {
              try { return JSON.parse(v).join(', '); }
              catch { return v; }
            })()}
          </Text>
        ) : '-',
    },
    {
      title: '错误',
      dataIndex: 'error_message',
      key: 'error',
      ellipsis: true,
      width: 140,
      render: (v: string | null) =>
        v ? <Text type="danger" style={{ fontSize: 12 }}>{v}</Text> : '-',
    },
  ];

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>交易历史</Title>
        <Button icon={<ReloadOutlined />} onClick={loadHistory} loading={loading}>
          刷新
        </Button>
      </div>

      <Card>
        <Table
          dataSource={records}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="middle"
          pagination={{
            current: page,
            total,
            pageSize: 20,
            onChange: setPage,
            showTotal: (t) => `共 ${t} 条记录`,
          }}
          scroll={{ x: 800 }}
        />
      </Card>
    </div>
  );
};

export default HistoryPage;
