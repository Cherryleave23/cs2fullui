import React, { useState, useEffect } from 'react';
import { Typography, Row, Col, Button, Space, Modal, Input, message, Alert, Card, Progress } from 'antd';
import { ThunderboltOutlined, SaveOutlined, ImportOutlined, ClearOutlined } from '@ant-design/icons';
import AutocompleteSlot from '../components/tradeup/AutocompleteSlot';
import { useTradeUpStore } from '../stores/useTradeUpStore';
import { useInventoryStore } from '../stores/useInventoryStore';

const { Title, Text } = Typography;

const TradeUpPage: React.FC = () => {
  const { slots, outcomes, avgWearNorm, targetRarityZh, targetRarity, setSimulationResult,
    setSimulating, simulating, error, clearAll, fillFromInventory, profit, inputPrices } = useTradeUpStore();
  const { items: invItems } = useInventoryStore();

  const [saveOpen, setSaveOpen] = useState(false);
  const [recipeName, setRecipeName] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const filledCount = slots.filter(Boolean).length;
  const canSimulate = filledCount === 10;

  // ── Simulate ──
  const handleSimulate = async () => {
    const filled = slots.filter(Boolean);
    if (filled.length !== 10) return;
    setSimulating(true);
    try {
      const simItems = filled.map(item => ({
        name: item!.name,
        nameZh: item!.nameZh,
        rarity: item!.rarity,
        rarityZh: item!.rarityZh,
        paintIndex: item!.paintIndex,
        defIndex: item!.weaponId,
        wearFloat: item!.wearFloat,
        minFloat: item!.minFloat,
        maxFloat: item!.maxFloat,
        collection: item!.collection,
        isStatTrak: item!.isStatTrak,
        isSouvenir: item!.isSouvenir,
      }));
      const result: any = await window.electronAPI.tradeup.simulate(simItems);
      setSimulationResult(result);
    } catch (err: any) {
      setSimulationResult({ outcomes: [], avgWearNorm: 0, targetRarity: '', targetRarityZh: '', error: err.message });
    }
  };

  // ── Save recipe ──
  const handleSave = async () => {
    if (!recipeName.trim()) return;
    const filled = slots.filter(Boolean);
    const result: any = await window.electronAPI.recipe.save({
      name: recipeName.trim(),
      type: filled.some(i => i?.assetId) ? 'real' : 'virtual',
      rarity: filled[0]?.rarity || '',
      targetRarity: targetRarity || targetRarityZh,
      avgWearNorm,
      outcomeSummary: outcomes,
      profitJson: profit ? JSON.stringify(profit) : null,
      items: filled.map((item, idx) => ({
        paintIndex: item!.paintIndex,
        weaponId: item!.weaponId,
        wearFloat: item!.wearFloat,
        assetId: item!.assetId || null,
        stattrak: item!.isStatTrak,
        souvenir: item!.isSouvenir,
        position: idx,
      })),
    });

    if (result?.duplicate) {
      Modal.confirm({
        title: '配方已存在',
        content: result.message,
        onOk: async () => {
          await window.electronAPI.recipe.replace({ id: result.id, recipe: {
            profitJson: profit ? JSON.stringify(profit) : null,
            items: filled.map((item, idx) => ({
              paintIndex: item!.paintIndex, weaponId: item!.weaponId,
              wearFloat: item!.wearFloat, assetId: item!.assetId || null,
              stattrak: item!.isStatTrak, souvenir: item!.isSouvenir, position: idx,
            })),
          }});
          message.success('配方已替换');
          setSaveOpen(false); setRecipeName('');
        },
      });
    } else if (result?.error) {
      message.error(result.error);
    } else {
      message.success('配方已保存');
      setSaveOpen(false); setRecipeName('');
    }
  };

  // ── Import from inventory ──
  const handleImportFromInv = () => {
    const skins = invItems.filter(i => i.resolvedType === 'skin');
    if (skins.length === 0) { message.warning('库存为空，请先刷新库存'); return; }
    setImportOpen(true);
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>汰换交易</Title>
        <Space>
          <Button icon={<ImportOutlined />} onClick={handleImportFromInv}>从库存导入</Button>
          <Button icon={<SaveOutlined />} disabled={!canSimulate || outcomes.length === 0}
            onClick={() => setSaveOpen(true)}>保存配方</Button>
          <Button icon={<ClearOutlined />} onClick={clearAll} disabled={filledCount === 0}>清空</Button>
        </Space>
      </div>

      {/* 10-slot grid */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 8,
          justifyContent: 'center',
          maxWidth: 900,
          margin: '0 auto',
        }}>
          {slots.map((_, idx) => (
            <AutocompleteSlot key={idx} index={idx} />
          ))}
        </div>

        {/* Simulate button */}
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Button type="primary" size="large" icon={<ThunderboltOutlined />}
            loading={simulating} disabled={!canSimulate} onClick={handleSimulate}>
            {canSimulate ? '🔬 开始汰换模拟' : `还需 ${10 - filledCount} 件`}
          </Button>
        </div>
      </Card>

      {/* Error */}
      {error && <Alert type="error" message={error} closable style={{ marginBottom: 16 }} />}

      {/* Simulation Results */}
      {outcomes.length > 0 && (
        <Card title={
          <Space>
            <Text strong>模拟结果</Text>
            <Text type="secondary">目标: {targetRarityZh || targetRarity}</Text>
            <Text type="secondary">归一化磨损: {(avgWearNorm * 100).toFixed(1)}%</Text>
          </Space>
        }>
          {/* Group by collection — horizontal flex-wrap layout */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {(() => {
            const grouped = new Map<string, typeof outcomes>();
            for (const o of outcomes) {
              const c = o.collection || '未知';
              if (!grouped.has(c)) grouped.set(c, []);
              grouped.get(c)!.push(o);
            }
            return [...grouped.entries()].map(([coll, items]) => {
              const totalProb = items.reduce((s, o) => s + o.probability, 0);
              return (
                <div key={coll} style={{ flex: '1 1 280px', minWidth: 240, maxWidth: 420, marginBottom: 8,
                  border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}>
                  <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                    {coll} ({(totalProb * 100).toFixed(0)}%)
                  </Text>
                  {items.map((o, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                      <Text style={{ flex: 1, fontSize: 12 }} ellipsis>{o.nameZh || o.name}</Text>
                      <Text style={{ fontSize: 10, color: '#52c41a', minWidth: 55, textAlign: 'right' }}>
                        {o.price != null ? `¥${o.price.toFixed(2)}` : '-'}
                      </Text>
                      <Text style={{ fontSize: 10, color: '#888' }}>{o.estWearCategory}</Text>
                      <Text style={{ fontSize: 10, fontFamily: 'monospace', color: '#888' }}>
                        ~{o.estWearFloat.toFixed(4)}
                      </Text>
                      <Progress percent={Math.round(o.probability * 100)} size="small"
                        style={{ width: 50, minWidth: 40 }} strokeWidth={6} showInfo={false} />
                      <Text style={{ fontSize: 10, width: 32, textAlign: 'right' }}>{(o.probability * 100).toFixed(1)}%</Text>
                    </div>
                  ))}
                </div>
              );
            });
          })()}
          </div>

          {/* Profit Summary */}
          {profit && (
            <Card size="small" style={{ marginTop: 12, background: profit.profit >= 0 ? '#f6ffed' : '#fff2f0' }}>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>总成本</Text>
                  <br /><Text strong>¥{profit.totalCost.toFixed(2)}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>期望收益 (EV)</Text>
                  <br /><Text strong>¥{profit.expectedValue.toFixed(2)}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>预期利润</Text>
                  <br /><Text strong style={{ color: profit.profit >= 0 ? '#52c41a' : '#ff4d4f' }}>
                    ¥{profit.profit.toFixed(2)}
                  </Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>ROI</Text>
                  <br /><Text strong style={{ color: profit.profit >= 0 ? '#52c41a' : '#ff4d4f' }}>
                    {profit.roi.toFixed(1)}%
                  </Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>保本率</Text>
                  <br /><Text strong>{profit.breakEvenRate.toFixed(1)}%</Text>
                </div>
              </div>
            </Card>
          )}
        </Card>
      )}

      {/* Save Recipe Modal */}
      <Modal title="保存配方" open={saveOpen} onCancel={() => setSaveOpen(false)}
        onOk={handleSave} okText="保存">
        <Input value={recipeName} onChange={e => setRecipeName(e.target.value)}
          placeholder="输入配方名称" />
      </Modal>

      {/* Import from Inventory Modal */}
      <Modal title="从库存选择物品" open={importOpen} width={800}
        onCancel={() => setImportOpen(false)} footer={null}>
        <InventoryImportTable onClose={() => setImportOpen(false)} />
      </Modal>
    </div>
  );
};

// ── Inventory import sub-component ──
const InventoryImportTable: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { items } = useInventoryStore();
  const { fillFromInventory } = useTradeUpStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const skins = items.filter(i => i.resolvedType === 'skin');

  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <Button size="small" onClick={() => {
          const first10 = skins.slice(0, 10).map(s => s.assetId);
          setSelected(new Set(first10));
        }}>选前10件</Button>
        <Text type="secondary">{skins.length} 件皮肤</Text>
      </Space>
      <div style={{ maxHeight: 400, overflow: 'auto' }}>
        {skins.slice(0, 100).map(item => (
          <div key={item.assetId} style={{
            padding: '4px 8px', cursor: 'pointer',
            background: selected.has(item.assetId) ? '#e6f7ff' : undefined,
            borderBottom: '1px solid #f0f0f0',
          }} onClick={() => {
            const s = new Set(selected);
            if (s.has(item.assetId)) s.delete(item.assetId);
            else if (s.size < 10) s.add(item.assetId);
            setSelected(s);
          }}>
            <Text style={{ color: item.rarityColor }}>
              {selected.has(item.assetId) ? '✓ ' : ''}
              {item.resolvedNameZh || item.resolvedName}
            </Text>
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
              {item.wearCategoryZh} {item.paintWear?.toFixed(4)}
              {item.isStatTrak ? ' ST' : ''}{item.isSouvenir ? ' SV' : ''}
            </Text>
          </div>
        ))}
      </div>
      <Button type="primary" block style={{ marginTop: 12 }}
        disabled={selected.size === 0}
        onClick={() => {
          const selectedItems = skins.filter(s => selected.has(s.assetId));
          fillFromInventory(selectedItems.slice(0, 10));
          onClose();
        }}>
        填入 {Math.min(selected.size, 10)} 件物品
      </Button>
    </div>
  );
};

export default TradeUpPage;
