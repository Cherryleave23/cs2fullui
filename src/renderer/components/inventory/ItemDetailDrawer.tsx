import React from 'react';
import { Drawer, Descriptions, Tag, Space, Divider, Typography, Tooltip } from 'antd';
import RarityTag from '../shared/RarityTag';
import WearTag from '../shared/WearTag';
import FloatBar from '../shared/FloatBar';
import type { ResolvedItem } from '../../../shared/types/item';

const { Text, Title } = Typography;

interface ItemDetailDrawerProps {
  item: ResolvedItem | null;
  open: boolean;
  onClose: () => void;
}

const ItemDetailDrawer: React.FC<ItemDetailDrawerProps> = ({ item, open, onClose }) => {
  if (!item) return null;

  const stickers: any[] = item.extraJson ? JSON.parse(item.extraJson).stickers || [] : [];

  return (
    <Drawer
      title={
        <Space>
          <Text strong style={{ fontSize: 16, color: item.rarityColor }}>
            {item.isStatTrak && 'ST™ '}
            {item.isSouvenir && '★ '}
            {item.customName || item.resolvedNameZh || item.resolvedName}
          </Text>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={420}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* Rarity & Wear */}
        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label="稀有度">
            <RarityTag rarityName={item.rarityNameZh || item.rarityName} rarityColor={item.rarityColor} />
          </Descriptions.Item>
          <Descriptions.Item label="品质">
            {item.isStatTrak && <Tag color="#cf6a32">StatTrak™</Tag>}
            {item.isSouvenir && <Tag color="#ffd700">Souvenir</Tag>}
            {!item.isStatTrak && !item.isSouvenir && <Tag>普通</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="磨损值" span={2}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Text style={{ fontFamily: 'monospace', fontSize: 13 }}>
                {item.paintWear?.toFixed(10) || 'N/A'}
              </Text>
              <FloatBar
                floatValue={item.paintWear}
                minFloat={item.minFloat}
                maxFloat={item.maxFloat}
                width={200}
              />
              <Space size={4}>
                <WearTag wearCategory={item.wearCategoryZh || item.wearCategory} />
                <Text style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  范围: {item.minFloat?.toFixed(2)} — {item.maxFloat?.toFixed(2)}
                </Text>
              </Space>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="涂装编号">
            <Text code>{item.paintIndex?.toFixed(0) || '0'}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="涂装种子">
            <Text code>{item.paintSeed || '—'}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="武器类型">
            {item.weaponType || '—'}
          </Descriptions.Item>
          <Descriptions.Item label="收藏品">
            {item.collectionName || '—'}
          </Descriptions.Item>
          <Descriptions.Item label="物品ID" span={2}>
            <Text code style={{ fontSize: 11 }}>{item.assetId}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="def_index">
            {item.defIndex}
          </Descriptions.Item>
          <Descriptions.Item label="origin">
            {item.origin}
          </Descriptions.Item>
          {item.marketHashName && (
            <Descriptions.Item label="市场名" span={2}>
              <Text style={{ fontSize: 12 }}>{item.marketHashName}</Text>
            </Descriptions.Item>
          )}
          {item.tradableAfter && (
            <Descriptions.Item label="可交易时间" span={2}>
              {new Date(item.tradableAfter).toLocaleString('zh-CN')}
            </Descriptions.Item>
          )}
          {item.casketId && (
            <Descriptions.Item label="存储单元" span={2}>
              <Text code>{item.casketId}</Text>
            </Descriptions.Item>
          )}
        </Descriptions>

        {/* Stickers */}
        {stickers.length > 0 && (
          <>
            <Divider style={{ margin: '8px 0' }} />
            <Title level={5} style={{ margin: 0 }}>贴纸 ({stickers.length})</Title>
            {stickers.map((sticker: any, idx: number) => (
              <Descriptions key={idx} column={2} size="small" bordered>
                <Descriptions.Item label="槽位">{sticker.slot}</Descriptions.Item>
                <Descriptions.Item label="贴纸ID">
                  <Text code>{sticker.sticker_id}</Text>
                </Descriptions.Item>
                {sticker.wear != null && (
                  <Descriptions.Item label="磨损">{sticker.wear?.toFixed(6)}</Descriptions.Item>
                )}
                {sticker.scale != null && (
                  <Descriptions.Item label="缩放">{sticker.scale?.toFixed(2)}</Descriptions.Item>
                )}
              </Descriptions>
            ))}
          </>
        )}
      </Space>
    </Drawer>
  );
};

export default ItemDetailDrawer;
