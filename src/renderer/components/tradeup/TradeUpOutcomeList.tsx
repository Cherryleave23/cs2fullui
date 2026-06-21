import React from 'react';
import { Card, Progress, Space, Typography, Tag, Empty, Divider } from 'antd';
import { useTradeUpStore, type SimOutcome } from '../../stores/useTradeUpStore';

const { Text, Title } = Typography;

// Color mapping for wear categories
const WEAR_COLORS: Record<string, string> = {
  '崭新出厂': '#5e98d9',
  '略有磨损': '#8847ff',
  '久经沙场': '#4b69ff',
  '破损不堪': '#d32ce6',
  '战痕累累': '#eb4b4b',
};

const TradeUpOutcomeList: React.FC = () => {
  const { outcomes, avgWearNorm, targetRarityZh, targetRarity, error } = useTradeUpStore();

  if (error) {
    return (
      <Card>
        <Empty description={error} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    );
  }

  if (outcomes.length === 0) {
    return (
      <Card>
        <Empty
          description="选择10件同稀有度物品后点击模拟，查看可能的汰换产出"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </Card>
    );
  }

  // Group outcomes by collection
  const grouped = new Map<string, SimOutcome[]>();
  for (const o of outcomes) {
    if (!grouped.has(o.collection)) grouped.set(o.collection, []);
    grouped.get(o.collection)!.push(o);
  }

  return (
    <Card
      title={
        <Space>
          <Text strong>汰换结果</Text>
          <Tag color="blue">{targetRarityZh || targetRarity}</Tag>
        </Space>
      }
    >
      {/* Summary */}
      <div style={{ marginBottom: 16, padding: 12, background: 'rgba(0,0,0,0.02)', borderRadius: 8 }}>
        <Space size={24} wrap>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>目标稀有度</Text>
            <br />
            <Text strong style={{ fontSize: 16 }}>{targetRarityZh || targetRarity}</Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>平均标准磨损</Text>
            <br />
            <Text strong style={{ fontSize: 16, fontFamily: 'monospace' }}>
              {(avgWearNorm * 100).toFixed(1)}%
            </Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>涉及收藏品</Text>
            <br />
            <Text strong style={{ fontSize: 16 }}>{grouped.size} 个</Text>
          </div>
        </Space>
      </div>

      {/* Outcome list grouped by collection */}
      {[...grouped.entries()].map(([collection, items], gIdx) => (
        <div key={collection} style={{ marginBottom: 16 }}>
          {gIdx > 0 && <Divider style={{ margin: '12px 0' }} />}
          <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
            {collection}
          </Text>

          {items.map((outcome, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '6px 0',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              {/* Item name */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13 }} ellipsis>
                  {outcome.nameZh || outcome.name}
                </Text>
                <br />
                <Space size={4}>
                  <Tag
                    color={WEAR_COLORS[outcome.estWearCategory] || '#888'}
                    style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}
                  >
                    {outcome.estWearCategory}
                  </Tag>
                  <Text style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                    ~{(outcome.estWearFloat).toFixed(6)}
                  </Text>
                </Space>
              </div>

              {/* Probability bar */}
              <div style={{ width: 160, minWidth: 120 }}>
                <Progress
                  percent={Math.round(outcome.probability * 100)}
                  size="small"
                  strokeColor={
                    outcome.probability > 0.2 ? '#52c41a' :
                    outcome.probability > 0.1 ? '#1890ff' :
                    outcome.probability > 0.05 ? '#faad14' : '#ff4d4f'
                  }
                  format={(p) => `${p}%`}
                />
              </div>
            </div>
          ))}
        </div>
      ))}
    </Card>
  );
};

export default TradeUpOutcomeList;
