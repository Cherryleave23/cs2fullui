import React from 'react';
import { Tag } from 'antd';

const WEAR_COLORS: Record<string, string> = {
  '崭新出厂': '#5e98d9',
  '略有磨损': '#8847ff',
  '久经沙场': '#4b69ff',
  '破损不堪': '#d32ce6',
  '战痕累累': '#eb4b4b',
  'Factory New': '#5e98d9',
  'Minimal Wear': '#8847ff',
  'Field-Tested': '#4b69ff',
  'Well-Worn': '#d32ce6',
  'Battle-Scarred': '#eb4b4b',
};

interface WearTagProps {
  wearCategory: string;
  style?: React.CSSProperties;
}

const WearTag: React.FC<WearTagProps> = ({ wearCategory, style }) => (
  <Tag
    color={WEAR_COLORS[wearCategory] || '#888'}
    style={{ borderRadius: 4, margin: 0, fontSize: 11, ...style }}
  >
    {wearCategory || '未知'}
  </Tag>
);

export default WearTag;
