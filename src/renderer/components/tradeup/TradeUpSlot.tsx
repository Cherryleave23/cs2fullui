import React from 'react';
import { Card, Typography, Space, Tooltip, Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import RarityTag from '../shared/RarityTag';
import FloatBar from '../shared/FloatBar';
import type { TradeUpSlotItem } from '../../stores/useTradeUpStore';

const { Text } = Typography;

interface TradeUpSlotProps {
  index: number;
  item: TradeUpSlotItem | null;
  onRemove: (index: number) => void;
  onDrop?: (index: number, item: TradeUpSlotItem) => void;
}

const TradeUpSlot: React.FC<TradeUpSlotProps> = ({ index, item, onRemove }) => {
  if (!item) {
    return (
      <Card
        size="small"
        style={{
          width: 140,
          height: 170,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px dashed var(--border-color)',
          background: 'rgba(0,0,0,0.02)',
          cursor: 'default',
        }}
        bodyStyle={{ padding: 8, textAlign: 'center', width: '100%' }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          #{index + 1}<br />空位
        </Text>
      </Card>
    );
  }

  return (
    <Card
      size="small"
      style={{
        width: 140,
        height: 170,
        border: `1px solid ${item.rarityColor || '#888'}44`,
        position: 'relative',
      }}
      bodyStyle={{ padding: 8 }}
    >
      <Button
        size="small"
        type="text"
        danger
        icon={<CloseOutlined />}
        onClick={() => onRemove(index)}
        style={{ position: 'absolute', top: 0, right: 0, zIndex: 2 }}
      />

      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {/* Name */}
        <Tooltip title={item.name}>
          <Text
            ellipsis
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: item.rarityColor,
              maxWidth: 110,
              display: 'block',
            }}
          >
            {item.nameZh || item.name}
          </Text>
        </Tooltip>

        {/* Rarity tag */}
        <RarityTag
          rarityName={item.rarityZh || item.rarity}
          rarityColor={item.rarityColor}
        />

        {/* Float bar */}
        <FloatBar floatValue={item.wearFloat} minFloat={item.minFloat} maxFloat={item.maxFloat} width={110} />

        <Text style={{ fontSize: 10, fontFamily: 'monospace' }}>
          {item.wearFloat.toFixed(6)}
        </Text>

        {/* Collection */}
        <Text type="secondary" style={{ fontSize: 10 }} ellipsis>
          {item.collection}
        </Text>

        {/* Badges */}
        <Space size={2}>
          {item.isStatTrak && <Text style={{ fontSize: 10, color: '#cf6a32' }}>ST™</Text>}
          {item.isSouvenir && <Text style={{ fontSize: 10, color: '#ffd700' }}>★ SV</Text>}
        </Space>
      </Space>
    </Card>
  );
};

export default TradeUpSlot;
