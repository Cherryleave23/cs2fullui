import React, { useState, useEffect, useCallback } from 'react';
import { Typography, Button, Space, message, Card } from 'antd';
import { ReloadOutlined, ExportOutlined, DollarOutlined } from '@ant-design/icons';
import InventoryTable from '../components/inventory/InventoryTable';
import ItemFilterBar from '../components/inventory/ItemFilterBar';
import ItemDetailDrawer from '../components/inventory/ItemDetailDrawer';
import { useInventoryStore } from '../stores/useInventoryStore';
import type { ResolvedItem } from '../../shared/types/item';

const { Title } = Typography;

const InventoryPage: React.FC = () => {
  const [refreshing, setRefreshing] = useState(false);
  const [detailItem, setDetailItem] = useState<ResolvedItem | null>(null);
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const [priceLoading, setPriceLoading] = useState(false);
  const { setItems, setLoading } = useInventoryStore();

  // Load items from backend on mount
  useEffect(() => {
    loadItems();
  }, []);

  const loadPrices = useCallback(async (items: ResolvedItem[]) => {
    setPriceLoading(true);
    try {
      const mhns = [...new Set(items.map(i => i.marketHashName).filter(Boolean))] as string[];
      if (mhns.length === 0) { setPriceMap({}); setPriceLoading(false); return; }
      const cached: any[] = await window.electronAPI.price.getCache({ itemHashNames: mhns });
      const map: Record<string, number> = {};
      for (const c of cached) {
        if (c.current_price != null) map[c.item_hash_name] = c.current_price;
      }
      setPriceMap(map);
    } catch { /* ignore */ }
    setPriceLoading(false);
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.inventory.getItems();
      if (result.items) {
        const items = result.items as ResolvedItem[];
        setItems(items, result.stats as any);
        loadPrices(items);
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
          <Button icon={<DollarOutlined />} loading={priceLoading} onClick={() => loadPrices(useInventoryStore.getState().items)}>
            刷新价格
          </Button>
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
        <InventoryTable onItemClick={setDetailItem} selectable priceMap={priceMap} />
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
