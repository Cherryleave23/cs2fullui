import React, { useState, useEffect, useCallback } from 'react';
import { Typography, Button, Space, message, Card } from 'antd';
import { ReloadOutlined, ExportOutlined } from '@ant-design/icons';
import InventoryTable from '../components/inventory/InventoryTable';
import ItemFilterBar from '../components/inventory/ItemFilterBar';
import ItemDetailDrawer from '../components/inventory/ItemDetailDrawer';
import { useInventoryStore } from '../stores/useInventoryStore';
import type { ResolvedItem } from '../../shared/types/item';

const { Title } = Typography;

const InventoryPage: React.FC = () => {
  const [refreshing, setRefreshing] = useState(false);
  const [detailItem, setDetailItem] = useState<ResolvedItem | null>(null);
  const { setItems, setLoading } = useInventoryStore();

  // Load items from backend on mount
  useEffect(() => {
    loadItems();
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.inventory.getItems();
      if (result.items) {
        setItems(result.items as ResolvedItem[], result.stats as any);
      }
    } catch (err: any) {
      console.error('Failed to load inventory:', err);
    }
    setLoading(false);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result: any = await window.electronAPI.inventory.refresh();
      if (result.success) {
        message.success(`库存刷新完成: ${result.count} 件物品`);
        await loadItems();
      } else {
        message.error(result.error || '刷新失败 - 请先登录 Steam');
      }
    } catch (err: any) {
      message.error(err.message);
    }
    setRefreshing(false);
  };

  const handleExport = async () => {
    try {
      const json: any = await window.electronAPI.inventory.export();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cs2-inventory-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('库存已导出');
    } catch (err: any) {
      message.error('导出失败');
    }
  };

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>库存管理</Title>
        <Space>
          <Button icon={<ExportOutlined />} onClick={handleExport} disabled={refreshing}>
            导出
          </Button>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            loading={refreshing}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            刷新库存
          </Button>
        </Space>
      </div>

      <Card>
        <ItemFilterBar />
        <InventoryTable onItemClick={setDetailItem} selectable />
      </Card>

      <ItemDetailDrawer
        item={detailItem}
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
      />
    </div>
  );
};

export default InventoryPage;
