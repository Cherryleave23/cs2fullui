import React, { useMemo } from 'react';
import { Table, Image, Space, Checkbox, Typography, Tooltip, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import RarityTag from '../shared/RarityTag';
import WearTag from '../shared/WearTag';
import FloatBar from '../shared/FloatBar';
import { useInventoryStore } from '../../stores/useInventoryStore';
import type { ResolvedItem } from '../../../shared/types/item';

const { Text } = Typography;

interface InventoryTableProps {
  onItemClick?: (item: ResolvedItem) => void;
  selectable?: boolean;
  maxSelect?: number;
  /** marketHashName → current price map from price cache */
  priceMap?: Record<string, number>;
}

const STATTRAK_COLOR = '#cf6a32';
const SOUVENIR_COLOR = '#ffd700';

const InventoryTable: React.FC<InventoryTableProps> = ({
  onItemClick,
  selectable = false,
  maxSelect = 10,
  priceMap,
}) => {
  const {
    filteredItems,
    loading,
    selectedIds,
    toggleSelect,
    setSort,
    sortField,
    sortOrder,
  } = useInventoryStore();

  // Convert store sortOrder to antd SortOrder
  const toSortOrder = (field: string) =>
    sortField === field ? (sortOrder === 'asc' ? 'ascend' as const : 'descend' as const) : null;

  const columns: ColumnsType<ResolvedItem> = useMemo(() => {
    const cols: ColumnsType<ResolvedItem> = [];

    if (selectable) {
      cols.push({
        title: (
          <Checkbox
            checked={filteredItems.length > 0 && selectedIds.size === Math.min(filteredItems.length, maxSelect)}
            indeterminate={selectedIds.size > 0 && selectedIds.size < Math.min(filteredItems.length, maxSelect)}
            onChange={() => {
              if (selectedIds.size >= Math.min(filteredItems.length, maxSelect)) {
                useInventoryStore.getState().clearSelection();
              } else {
                useInventoryStore.getState().selectAll();
              }
            }}
          />
        ),
        dataIndex: 'select',
        key: 'select',
        width: 40,
        render: (_: any, record: ResolvedItem) => (
          <Checkbox
            checked={selectedIds.has(record.assetId)}
            disabled={!selectedIds.has(record.assetId) && selectedIds.size >= maxSelect}
            onChange={() => toggleSelect(record.assetId)}
          />
        ),
      });
    }

    cols.push(
      {
        title: '物品',
        dataIndex: 'resolvedNameZh',
        key: 'name',
        width: 280,
        sorter: true,
        sortOrder: toSortOrder('resolvedNameZh'),
        render: (_: any, record: ResolvedItem) => (
          <Space>
            {record.imageUrl && (
              <Image
                src={record.imageUrl}
                width={48}
                height={36}
                style={{ objectFit: 'contain', borderRadius: 4 }}
                preview={false}
                fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iMzYiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjM2IiBmaWxsPSIjMmEyYTJhIiByeD0iNCIvPjwvc3ZnPg=="
              />
            )}
            <Space direction="vertical" size={0}>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: onItemClick ? 'pointer' : 'default',
                  color: record.rarityColor || 'inherit',
                }}
                onClick={() => onItemClick?.(record)}
              >
                {record.isStatTrak && <span style={{ color: STATTRAK_COLOR }}>ST™ </span>}
                {record.isSouvenir && <span style={{ color: SOUVENIR_COLOR }}>★ </span>}
                {record.customName || record.resolvedNameZh || record.resolvedName}
              </Text>
              <Text style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {record.resolvedName || record.marketHashName}
              </Text>
            </Space>
          </Space>
        ),
      },
      {
        title: '稀有度',
        dataIndex: 'rarityNameZh',
        key: 'rarity',
        width: 100,
        sorter: true,
        sortOrder: toSortOrder('rarity'),
        render: (_: any, record: ResolvedItem) => (
          <RarityTag rarityName={record.rarityNameZh || record.rarityName} rarityColor={record.rarityColor} />
        ),
      },
      {
        title: '价格',
        dataIndex: 'price',
        key: 'price',
        width: 90,
        align: 'right' as const,
        render: (_: any, record: ResolvedItem) => {
          const price = priceMap?.[record.marketHashName];
          if (price == null) return <Text type="secondary" style={{ fontSize: 12 }}>-</Text>;
          return <Text strong style={{ fontSize: 12, color: '#52c41a' }}>¥{price.toFixed(2)}</Text>;
        },
      },
      {
        title: '磨损',
        dataIndex: 'paintWear',
        key: 'wear',
        width: 160,
        sorter: true,
        sortOrder: toSortOrder('paintWear'),
        render: (_: any, record: ResolvedItem) => (
          <Space direction="vertical" size={2}>
            <FloatBar
              floatValue={record.paintWear}
              minFloat={record.minFloat}
              maxFloat={record.maxFloat}
              width={100}
            />
            <Space size={4}>
              <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>
                {record.paintWear?.toFixed(6) || '-'}
              </Text>
              <WearTag wearCategory={record.wearCategoryZh || record.wearCategory} />
            </Space>
          </Space>
        ),
      },
      {
        title: '武器类型',
        dataIndex: 'weaponType',
        key: 'weaponType',
        width: 90,
        sorter: true,
        responsive: ['md' as const],
        sortOrder: toSortOrder('weaponType'),
        render: (val: string) => (
          <Text style={{ fontSize: 12 }}>{val || '-'}</Text>
        ),
      },
      {
        title: '收藏品',
        dataIndex: 'collectionName',
        key: 'collection',
        width: 140,
        ellipsis: true,
        responsive: ['lg' as const],
        render: (val: string) => (
          <Tooltip title={val}>
            <Text style={{ fontSize: 12 }}>{val || '-'}</Text>
          </Tooltip>
        ),
      }
    );

    return cols;
  }, [selectedIds, sortField, sortOrder, selectable, onItemClick, priceMap]);

  if (!loading && filteredItems.length === 0) {
    return (
      <Empty
        description="库存为空。请先登录 Steam 并刷新库存。"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  return (
    <Table<ResolvedItem>
      dataSource={filteredItems}
      columns={columns}
      rowKey="assetId"
      loading={loading}
      size="middle"
      virtual
      scroll={{ y: 600 }}
      pagination={{
        defaultPageSize: 50,
        showSizeChanger: true,
        pageSizeOptions: ['30', '50', '100', '200'],
        showTotal: (total) => `共 ${total} 件物品`,
      }}
      rowClassName={(record) => {
        const rarityMap: Record<string, string> = {
          '消费级': 'inventory-row-consumer',
          '军规级': 'inventory-row-milspec',
          '受限级': 'inventory-row-restricted',
          '保密级': 'inventory-row-classified',
          '隐秘级': 'inventory-row-covert',
        };
        return rarityMap[record.rarityNameZh || ''] || '';
      }}
      onChange={(_pagination, _filters, sorter: any) => {
        if (sorter.field) {
          setSort(sorter.field as keyof ResolvedItem, sorter.order === 'descend' ? 'desc' : 'asc');
        }
      }}
    />
  );
};

export default InventoryTable;
