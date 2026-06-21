import React from 'react';
import { Tag } from 'antd';

const RARITY_COLORS: Record<string, string> = {
  '消费级': '#b0c4d8',
  '工业级': '#5e98d9',
  '军规级': '#4b69ff',
  '受限级': '#8847ff',
  '保密级': '#d32ce6',
  '隐秘级': '#eb4b4b',
  '稀有特殊': '#ffd700',
  '违禁品': '#ffae39',
  'Consumer': '#b0c4d8',
  'Industrial': '#5e98d9',
  'Mil-Spec': '#4b69ff',
  'Restricted': '#8847ff',
  'Classified': '#d32ce6',
  'Covert': '#eb4b4b',
  'Rare Special': '#ffd700',
  'Contraband': '#ffae39',
};

interface RarityTagProps {
  rarityName: string;
  rarityColor?: string;
  style?: React.CSSProperties;
}

const RarityTag: React.FC<RarityTagProps> = ({ rarityName, rarityColor, style }) => {
  const color = rarityColor || RARITY_COLORS[rarityName] || '#888';
  return (
    <Tag
      color={color}
      style={{
        borderRadius: 4,
        margin: 0,
        fontWeight: 500,
        border: `1px solid ${color}44`,
        ...style,
      }}
    >
      {rarityName || '未知'}
    </Tag>
  );
};

export default RarityTag;
