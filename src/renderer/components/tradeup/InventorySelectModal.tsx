/**
 * InventorySelectModal — 从库存选择物品填入汰换槽
 */
import React, { useState, useMemo } from 'react';
import { Modal, Input, List, Checkbox, Typography, Tag, Space, Button, Empty } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useInventoryStore } from '../../stores/useInventoryStore';
import { useTradeUpStore } from '../../stores/useTradeUpStore';
import type { ResolvedItem } from '../../../shared/types/item';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

const InventorySelectModal: React.FC<Props> = ({ open, onClose }) => {
  const items = useInventoryStore(s => s.items);
  const fillFromInventory = useTradeUpStore(s => s.fillFromInventory);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 搜索筛选
  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(i =>
      (i.resolvedName?.toLowerCase().includes(q)) ||
      (i.resolvedNameZh?.toLowerCase().includes(q)) ||
      (i.marketHashName?.toLowerCase().includes(q))
    );
  }, [items, search]);

  const handleToggle = (assetId: string) => {
    const next = new Set(selected);
    if (next.has(assetId)) {
      next.delete(assetId);
    } else if (next.size < 10) {
      next.add(assetId);
    }
    setSelected(next);
  };

  const handleConfirm = () => {
    const picked = items.filter(i => selected.has(i.assetId));
    fillFromInventory(picked.slice(0, 10));
    setSelected(new Set());
    setSearch('');
    onClose();
  };

  const handleCancel = () => {
    setSelected(new Set());
    setSearch('');
    onClose();
  };

  return (
    <Modal
      title="从库存选择物品"
      open={open}
      onCancel={handleCancel}
      footer={
        <Space>
          <Text type="secondary">已选 {selected.size}/10</Text>
          <Button onClick={handleCancel}>取消</Button>
          <Button type="primary" disabled={selected.size === 0} onClick={handleConfirm}>
            确认导入 ({selected.size})
          </Button>
        </Space>
      }
      width={520}
      bodyStyle={{ maxHeight: 500, overflow: 'auto', padding: '12px 0' }}
    >
      <Input
        prefix={<SearchOutlined />}
        placeholder="搜索物品名称..."
        value={search}
        onChange={e => { setSearch(e.target.value); setSelected(new Set()); }}
        allowClear
        style={{ marginBottom: 12 }}
      />

      {filtered.length === 0 ? (
        <Empty description="没有匹配的物品" />
      ) : (
        <List
          dataSource={filtered}
          renderItem={item => (
            <List.Item
              onClick={() => handleToggle(item.assetId)}
              style={{
                cursor: 'pointer',
                padding: '6px 12px',
                background: selected.has(item.assetId) ? '#e6f7ff' : undefined,
                borderRadius: 4,
              }}
              extra={
                <Checkbox checked={selected.has(item.assetId)} disabled={!selected.has(item.assetId) && selected.size >= 10} />
              }
            >
              <div style={{ flex: 1 }}>
                <div>
                  <Text style={{ fontSize: 13, color: item.rarityColor || '#888' }}>
                    {item.resolvedNameZh || item.resolvedName}
                  </Text>
                  <Tag style={{ marginLeft: 6, fontSize: 10 }}>{item.rarityNameZh || item.rarityName}</Tag>
                </div>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {item.wearCategoryZh} ({item.paintWear?.toFixed(4)})
                  {item.isStatTrak ? ' 🔫' : ''}
                  {item.isSouvenir ? ' 🏆' : ''}
                </Text>
              </div>
            </List.Item>
          )}
        />
      )}
    </Modal>
  );
};

export default InventorySelectModal;
