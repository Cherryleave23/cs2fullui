import React, { useState } from 'react';
import { Card, Space, Button, Typography } from 'antd';
import { ClearOutlined, ExperimentOutlined, InboxOutlined } from '@ant-design/icons';
import TradeUpSlot from './TradeUpSlot';
import InventorySelectModal from './InventorySelectModal';
import { useTradeUpStore } from '../../stores/useTradeUpStore';
import { useInventoryStore } from '../../stores/useInventoryStore';

const { Text, Title } = Typography;

const TradeUpBuilder: React.FC = () => {
  const { slots, removeSlot, clearAll, simulating, setSimulationResult, setSimulating } =
    useTradeUpStore();
  const { selectedIds, items } = useInventoryStore();
  const [selectOpen, setSelectOpen] = useState(false);

  const filledCount = slots.filter(Boolean).length;
  const canSimulate = filledCount === 10;

  const handleFillSelected = () => {
    const selected = items.filter(i => selectedIds.has(i.assetId));
    if (selected.length > 10) {
      // Only take first 10
      useTradeUpStore.getState().fillFromInventory(selected.slice(0, 10));
    } else {
      useTradeUpStore.getState().fillFromInventory(selected);
    }
  };

  const handleSimulate = async () => {
    const filledItems = useTradeUpStore.getState().getFilledItems();
    if (filledItems.length !== 10) return;

    setSimulating(true);
    try {
      const result: any = await window.electronAPI.tradeup.simulate(
        filledItems.map(i => ({
          assetId: i.assetId || undefined,
          name: i.name,
          nameZh: i.nameZh,
          rarity: i.rarity,
          rarityZh: i.rarityZh,
          paintIndex: 0,
          defIndex: 0,
          wearFloat: i.wearFloat,
          minFloat: i.minFloat,
          maxFloat: i.maxFloat,
          collection: i.collection,
          isStatTrak: i.isStatTrak,
          isSouvenir: i.isSouvenir,
        }))
      );

      if (result.success) {
        setSimulationResult(result);
      } else {
        setSimulationResult({ ...result, outcomes: [] });
      }
    } catch (err: any) {
      setSimulationResult({
        outcomes: [],
        avgWearNorm: 0,
        targetRarity: '',
        targetRarityZh: '',
        error: err.message,
      });
    }
  };

  return (
    <Card
      title={
        <Space>
          <Text strong>汰换物品 ({filledCount}/10)</Text>
          {filledCount === 10 && (
            <Text type="success" style={{ fontSize: 12 }}>✓ 已满</Text>
          )}
        </Space>
      }
      extra={
        <Space>
          <Button
            size="small"
            onClick={() => setSelectOpen(true)}
            icon={<InboxOutlined />}
          >
            从库存选择
          </Button>
          <Button
            size="small"
            onClick={handleFillSelected}
            disabled={selectedIds.size === 0}
          >
            从库存填入 ({selectedIds.size} 已选)
          </Button>
          <Button
            size="small"
            icon={<ClearOutlined />}
            onClick={clearAll}
            disabled={filledCount === 0}
          >
            清空
          </Button>
        </Space>
      }
    >
      {/* 10-slot grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 8,
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        {slots.map((item, idx) => (
          <TradeUpSlot
            key={idx}
            index={idx}
            item={item}
            onRemove={removeSlot}
          />
        ))}
      </div>

      {/* Simulate button */}
      <div style={{ textAlign: 'center' }}>
        <Button
          type="primary"
          size="large"
          icon={<ExperimentOutlined />}
          loading={simulating}
          disabled={!canSimulate}
          onClick={handleSimulate}
          style={{ minWidth: 200 }}
        >
          {canSimulate ? '模拟汰换结果' : `还需 ${10 - filledCount} 件物品`}
        </Button>
        {!canSimulate && filledCount > 0 && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              从库存选择物品，或在库存页面勾选后点击"从库存填入"
            </Text>
          </div>
        )}
      </div>

      {/* 库存选择弹窗 */}
      <InventorySelectModal open={selectOpen} onClose={() => setSelectOpen(false)} />
    </Card>
  );
};

export default TradeUpBuilder;
