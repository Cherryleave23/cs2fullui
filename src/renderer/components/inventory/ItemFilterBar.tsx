import React from 'react';
import { Space, Select, Input, Button, Switch } from 'antd';
import { SearchOutlined, ClearOutlined } from '@ant-design/icons';
import { useInventoryStore, type ItemFilter } from '../../stores/useInventoryStore';

const RARITY_OPTIONS = [
  { value: 2, label: '军规级' },
  { value: 3, label: '受限级' },
  { value: 4, label: '保密级' },
  { value: 5, label: '隐秘级' },
  { value: 1, label: '工业级' },
  { value: 0, label: '消费级' },
];

const ItemFilterBar: React.FC = () => {
  const { filter, setFilter, clearFilters, filteredItems, total } = useInventoryStore();

  return (
    <Space wrap style={{ marginBottom: 16 }}>
      <Input
        prefix={<SearchOutlined />}
        placeholder="搜索物品名称..."
        value={filter.search || ''}
        onChange={(e) => setFilter({ search: e.target.value || undefined })}
        style={{ width: 200 }}
        allowClear
      />

      <Select
        placeholder="稀有度"
        value={filter.rarity}
        onChange={(v) => setFilter({ rarity: v })}
        allowClear
        style={{ width: 110 }}
        options={RARITY_OPTIONS}
      />

      <Select
        placeholder="武器类型"
        value={filter.weaponType}
        onChange={(v) => setFilter({ weaponType: v })}
        allowClear
        style={{ width: 110 }}
        options={[
          { value: 'Pistols', label: '手枪' },
          { value: 'SMGs', label: '冲锋枪' },
          { value: 'Rifles', label: '步枪' },
          { value: 'Shotguns', label: '霰弹枪' },
          { value: 'Snipers', label: '狙击枪' },
          { value: 'Machine Guns', label: '机枪' },
          { value: 'Gloves', label: '手套' },
          { value: 'Knives', label: '刀具' },
        ]}
      />

      <Space>
        StatTrak™{' '}
        <Switch
          size="small"
          checked={filter.isStatTrak || false}
          onChange={(v) => setFilter({ isStatTrak: v || undefined })}
        />
      </Space>

      <Space>
        Souvenir{' '}
        <Switch
          size="small"
          checked={filter.isSouvenir || false}
          onChange={(v) => setFilter({ isSouvenir: v || undefined })}
        />
      </Space>

      <Button icon={<ClearOutlined />} size="small" onClick={clearFilters}>
        清除筛选
      </Button>

      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        显示 {filteredItems.length} / {total}
      </span>
    </Space>
  );
};

export default ItemFilterBar;
