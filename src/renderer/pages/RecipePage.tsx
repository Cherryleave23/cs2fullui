import React, { useState, useEffect } from 'react';
import { Card, Typography, Button, Space, Modal, message, Tag, Popconfirm, Input, Image, Descriptions, Tooltip } from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ExperimentOutlined,
  ToolOutlined, DownOutlined, RightOutlined, ImportOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTradeUpStore } from '../stores/useTradeUpStore';

const { Title, Text } = Typography;

interface RecipeData {
  id: number; name: string; type: string; rarity: string; target_rarity: string;
  is_stattrak: number; avg_wear_norm: number | null;
  outcome_summary: string | null; profit_json: string | null;
  created_at: string; children: RecipeData[]; parent_id?: number;
  items?: any[];
}

const RecipePage: React.FC = () => {
  const navigate = useNavigate();
  const [recipes, setRecipes] = useState<RecipeData[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [expandedChildIds, setExpandedChildIds] = useState<Set<number>>(new Set());
  const [expandedDetails, setExpandedDetails] = useState<Record<number, any>>({});
  // Parents whose children list is visible (independent of parent detail expansion)
  const [childrenVisible, setChildrenVisible] = useState<Set<number>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [executeResult, setExecuteResult] = useState<{ success: boolean; items: any[]; error?: string } | null>(null);
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  // assetId → tradableAfter for checking recipe execute readiness
  const [tradableMap, setTradableMap] = useState<Record<string, string>>({});
  // recipeId → { ok, latest } for execute eligibility
  const [recipeTradable, setRecipeTradable] = useState<Record<number, { ok: boolean; latest: string | null }>>({});

  const load = async () => {
    setLoading(true);
    try {
      // Load inventory for tradable checks
      const invResult: any = await window.electronAPI.inventory.getItems();
      const tMap: Record<string, string> = {};
      if (invResult?.items) {
        for (const item of invResult.items) {
          if (item.assetId) tMap[item.assetId] = item.tradableAfter || '';
        }
      }
      console.log('[RecipePage] Inventory tradable map:', Object.keys(tMap).length, 'items, sample:', Object.entries(tMap).slice(0, 3));
      setTradableMap(tMap);

      const list: any = await window.electronAPI.recipe.list();
      const parents = Array.isArray(list) ? list.filter((r: any) => !r.parent_id) : [];
      setRecipes(parents);
      loadRecipePrices(parents);
      // Check tradable status for all recipes (parents + children)
      checkAllTradable(list, tMap);
    } catch { setRecipes([]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Check tradable status for all recipes (recursively)
  const checkAllTradable = async (list: RecipeData[], tMap: Record<string, string>) => {
    const status: Record<number, { ok: boolean; latest: string | null }> = {};
    const checkOne = async (r: RecipeData) => {
      if (r.type !== 'real') { status[r.id] = { ok: true, latest: null }; return; }
      try {
        const full: any = await window.electronAPI.recipe.get(r.id);
        const items = full?.items || [];
        let ok = true; let latest: string | null = null; let latestTime = 0;
        const now = Date.now();
        for (const item of items) {
          const aid = item.asset_id || item.assetId;
          if (!aid) continue;
          const ta = tMap[aid];
          if (ta) {
            const t = new Date(ta).getTime();
            if (t > now) { ok = false; if (t > latestTime) { latestTime = t; latest = ta; } }
          }
        }
        status[r.id] = { ok, latest };
        console.log(`[RecipePage] Tradable check: recipe ${r.name} (id=${r.id}) ok=${ok} latest=${latest} items=${items.length} foundIds=${items.filter((i: any) => tMap[i.asset_id || i.assetId]).length}/${items.length}`);
        // Also check children
        if (r.children) for (const child of r.children) await checkOne(child);
      } catch (err) { console.error(`[RecipePage] Tradable check failed for ${r.id}:`, err); status[r.id] = { ok: true, latest: null }; }
    };
    for (const r of list) await checkOne(r);
    console.log('[RecipePage] Tradable status:', status);
    setRecipeTradable(prev => ({ ...prev, ...status }));
  };

  // Load cached prices for a set of marketHashNames
  const loadPrices = async (mhns: string[]) => {
    if (mhns.length === 0) return;
    try {
      const cached: any[] = await window.electronAPI.price.getCache({ itemHashNames: [...new Set(mhns)] });
      const map = { ...priceMap };
      for (const c of cached) {
        if (c.current_price != null) map[c.item_hash_name] = c.current_price;
      }
      setPriceMap(map);
    } catch { /* ignore */ }
  };

  // Load prices for recipe items from given recipe list
  const loadRecipePrices = async (list: RecipeData[]) => {
    const mhns: string[] = [];
    for (const r of list) {
      const full = expandedDetails[r.id] || {};
      const items = full.items || r.items || [];
      for (const item of items) {
        if (item.marketHashName) mhns.push(item.marketHashName);
      }
    }
    if (mhns.length > 0) await loadPrices(mhns);
  };

  // ── Actions ──
  const handleEdit = async (recipe: RecipeData) => {
    const full: any = await window.electronAPI.recipe.get(recipe.id);
    if (full?.items) {
      const tradeUpStore = useTradeUpStore.getState();
      tradeUpStore.clearAll();
      for (let i = 0; i < Math.min(full.items.length, 10); i++) {
        const item = full.items[i];
        // Resolve real skin name from CsgoapiResolver
        const skin: any = await window.electronAPI.tradeup.resolveSkin({
          paintIndex: item.paint_index, weaponId: item.weapon_id
        });
        tradeUpStore.setSlot(i, {
          assetId: item.asset_id || '',
          name: skin?.name || `#${item.paint_index}`,
          nameZh: skin?.nameZh || `#${item.paint_index}`,
          paintIndex: item.paint_index, weaponId: item.weapon_id,
          rarity: skin?.rarity || recipe.rarity,
          rarityColor: skin?.rarityColor || '#888',
          wearFloat: item.wear_float,
          minFloat: skin?.minFloat ?? 0, maxFloat: skin?.maxFloat ?? 1,
          collection: skin?.collection || '',
          isStatTrak: item.stattrak === 1, isSouvenir: item.souvenir === 1,
        });
      }
      if (full.outcome_summary) {
        try {
          const outcomes = typeof full.outcome_summary === 'string'
            ? JSON.parse(full.outcome_summary) : full.outcome_summary;
          tradeUpStore.setSimulationResult({
            outcomes: outcomes || [],
            avgWearNorm: recipe.avg_wear_norm || 0,
            targetRarity: recipe.target_rarity,
            targetRarityZh: recipe.target_rarity,
          });
        } catch { /* ignore */ }
      }
      navigate('/tradeup');
    }
  };

  const handleDelete = async (id: number) => {
    await window.electronAPI.recipe.delete(id);
    message.success('已删除');
    load();
  };

  const handleAutoSub = async (parentId: number) => {
    message.loading({ content: '正在配置子配方...', key: 'autoSub' });
    const result: any = await window.electronAPI.recipe.autoSub(parentId);
    if (result?.success) {
      message.success({ content: `已生成 ${result.subRecipes?.length || 0} 个子配方`, key: 'autoSub' });
      load();
    } else {
      message.error({ content: result?.error || '配置失败', key: 'autoSub' });
    }
  };

  // ── Execute trade-up ──
  const RARITY_TO_RECIPE: Record<string, number> = {
    '消费级': 0, '工业级': 1, '军规级': 2, '受限级': 3, '保密级': 4,
  };

  const handleExecute = async (recipe: RecipeData) => {
    const full: any = await window.electronAPI.recipe.get(recipe.id);
    const items = full?.items || [];
    const assetIds = items.map((i: any) => i.asset_id || i.assetId).filter(Boolean);
    if (assetIds.length !== 10) {
      message.error(`只有 ${assetIds.length} 个有效ASSTID，需要10个`);
      return;
    }
    const recipeIdx = recipe.is_stattrak
      ? (RARITY_TO_RECIPE[recipe.rarity] ?? 2) + 10
      : (RARITY_TO_RECIPE[recipe.rarity] ?? 2);
    Modal.confirm({
      title: '确认执行汰换交易',
      content: `消耗10件物品 → ${recipe.target_rarity}。不可撤销！`,
      okText: '确认执行',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        message.loading({ content: '执行中...', key: 'exec' });
        try {
          const result: any = await (window.electronAPI as any).tradeupExecute({ assetIds, recipe: recipeIdx });
          if (result?.success) {
            setExecuteResult({ success: true, items: result.gainedItems || [] });
          } else {
            setExecuteResult({ success: false, error: result?.error || '汰换失败', items: [] });
          }
          message.destroy('exec');
        } catch (err: any) {
          message.destroy('exec');
          setExecuteResult({ success: false, error: err.message, items: [] });
        }
      },
    });
  };

  const handleImport = async () => {
    try {
      JSON.parse(importJson);
      const result: any = await window.electronAPI.recipe.import(importJson);
      if (result.error) message.error(result.error);
      else { message.success('已导入'); setImportOpen(false); setImportJson(''); load(); }
    } catch { message.error('JSON 格式无效'); }
  };

  // ── Render recipe row ──
  const renderRecipe = (r: RecipeData, isChild = false) => {
    const hasChildren = r.children && r.children.length > 0;
    const isExpanded = isChild ? expandedChildIds.has(r.id) : expandedIds.has(r.id);
    const showChildren = isChild ? false : (isExpanded || childrenVisible.has(r.id));

    const toggleExpand = async () => {
      const targetSet = isChild ? expandedChildIds : expandedIds;
      const setter = isChild ? setExpandedChildIds : setExpandedIds;
      setter(prev => { const next = new Set(prev); isExpanded ? next.delete(r.id) : next.add(r.id); return next; });
      // Load full recipe data (items + outcomes) if not already loaded
      if (!isExpanded && (!r.items || r.items.length === 0)) {
        const full: any = await window.electronAPI.recipe.get(r.id);
        if (full) {
          setExpandedDetails(prev => ({ ...prev, [r.id]: full }));
          // Load prices
          const mhns: string[] = [];
          for (const item of full.items || []) {
            if (item.marketHashName) mhns.push(item.marketHashName);
          }
          const outcomes = full.outcome_summary;
          if (outcomes) {
            try {
              const parsed = typeof outcomes === 'string' ? JSON.parse(outcomes) : outcomes;
              for (const o of (Array.isArray(parsed) ? parsed : [])) {
                if (o.marketHashName) mhns.push(o.marketHashName);
              }
            } catch { /* ignore */ }
          }
          await loadPrices(mhns);
        }
      }
    };

    const toggleChildren = () => {
      if (isExpanded) {
        // Parent is already expanded, children are visible — just collapse parent
        setExpandedIds(prev => { const next = new Set(prev); next.delete(r.id); return next; });
      } else {
        // Show children without expanding parent detail
        setChildrenVisible(prev => {
          const next = new Set(prev);
          showChildren ? next.delete(r.id) : next.add(r.id);
          return next;
        });
      }
    };

    return (
      <div key={r.id} style={{ marginLeft: isChild ? 32 : 0, marginBottom: isChild ? 4 : 12 }}>
        <Card size="small" style={{ background: isChild ? '#fafafa' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {/* Left: expand + name */}
            <Space>
              <Button type="text" size="small"
                icon={isExpanded ? <DownOutlined /> : <RightOutlined />}
                onClick={toggleExpand} />
              <Text strong={!isChild}>{r.name}</Text>
              <Tag color={r.type === 'real' ? 'green' : 'blue'}>
                {r.type === 'real' ? '真实' : '虚拟'}
              </Tag>
              <Tag>{r.rarity} → {r.target_rarity}</Tag>
              {r.is_stattrak === 1 && <Tag color="#cf6a32">ST</Tag>}
              {r.type === 'real' && (() => {
                const ts = recipeTradable[r.id];
                if (ts === undefined) return null;
                return ts.ok
                  ? <Tag color="green" style={{ fontSize: 10 }}>可执行</Tag>
                  : <Tooltip title={ts.latest ? `最晚: ${new Date(ts.latest).toLocaleString('zh-CN')}` : '部分物品不可交易'}>
                      <Tag color="orange" style={{ fontSize: 10 }}>不可交易</Tag>
                    </Tooltip>;
              })()}
              {r.avg_wear_norm != null && (
                <Text style={{ fontSize: 11 }}>磨损: {(r.avg_wear_norm * 100).toFixed(1)}%</Text>
              )}
              {/* Profit summary from stored data */}
              {(() => {
                try {
                  const p = r.profit_json ? (typeof r.profit_json === 'string' ? JSON.parse(r.profit_json) : r.profit_json) : null;
                  if (!p) return null;
                  const color = p.profit >= 0 ? '#52c41a' : '#ff4d4f';
                  return (
                    <Space size={6} style={{ marginLeft: 8 }}>
                      <Text style={{ fontSize: 10, color: '#888' }}>成本<Text style={{ color: '#333', fontWeight: 500 }}>¥{Number(p.totalCost).toFixed(2)}</Text></Text>
                      <Text style={{ fontSize: 10, color: '#888' }}>EV<Text style={{ color: '#333', fontWeight: 500 }}>¥{Number(p.expectedValue).toFixed(2)}</Text></Text>
                      <Text style={{ fontSize: 10, color }}>利润<Text style={{ fontWeight: 500 }}>¥{Number(p.profit).toFixed(2)}</Text></Text>
                      <Text style={{ fontSize: 10, color }}>ROI<Text style={{ fontWeight: 500 }}>{Number(p.roi).toFixed(2)}%</Text></Text>
                      <Text style={{ fontSize: 10, color: '#888' }}>保本<Text style={{ color: '#333' }}>{Number(p.breakEvenRate).toFixed(2)}%</Text></Text>
                    </Space>
                  );
                } catch { return null; }
              })()}
            </Space>

            {/* Right: actions */}
            <Space size={4}>
              <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
              {r.type === 'real' && (() => {
                const ts = recipeTradable[r.id];
                const canExec = ts?.ok ?? true;
                const btn = (
                  <Button size="small" type="primary" danger icon={<ThunderboltOutlined />}
                    disabled={!canExec}
                    onClick={() => {
                      if (!canExec) {
                        message.warning(ts?.latest
                          ? `配方中有物品暂不可交易，最晚可交易时间: ${new Date(ts.latest).toLocaleString('zh-CN')}`
                          : '部分物品不可交易');
                        return;
                      }
                      handleExecute(r);
                    }}>执行汰换</Button>
                );
                if (!canExec && ts?.latest) {
                  return (
                    <Tooltip title={`最晚可交易: ${new Date(ts.latest).toLocaleString('zh-CN')}`}>
                      {btn}
                    </Tooltip>
                  );
                }
                return btn;
              })()}
              {!isChild && (
                <Button size="small" icon={<ToolOutlined />}
                  onClick={() => handleAutoSub(r.id)}>自动配置子配方</Button>
              )}
              {!isChild && hasChildren && (
                <Button size="small" onClick={toggleChildren}>
                  {showChildren ? <DownOutlined /> : <RightOutlined />} 子配方 ({r.children.length})
                </Button>
              )}
              <Popconfirm title="确定删除？子配方也会被删除" onConfirm={() => handleDelete(r.id)}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          </div>
        </Card>

        {/* Expanded: show recipe items + outcomes */}
        {isExpanded && (() => {
          const detail = expandedDetails[r.id] || {};
          const items = detail.items || r.items || [];
          const outcomes = detail.outcome_summary || r.outcome_summary;
          return (
          <div style={{ marginTop: 8, marginLeft: 16, padding: 12, background: '#f9f9f9', borderRadius: 8 }}>
            {/* Recipe detail: 10 items */}
            {items.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <Text strong style={{ fontSize: 13 }}>配方物品 ({items.length} 件):</Text>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {items.map((item: any, idx: number) => {
                    const price = item.marketHashName ? priceMap[item.marketHashName] : undefined;
                    return (
                    <span key={idx} style={{
                      fontSize: 11, padding: '2px 6px', background: '#fff', borderRadius: 4,
                      border: '1px solid #e8e8e8',
                    }}>
                      <span style={{ color: item.skinColor || '#888' }}>
                        {item.skinName || `#${item.paint_index || item.paintIndex}|${item.weapon_id || item.weaponId}`}
                      </span>
                      <span style={{ color: '#888', marginLeft: 4 }}>
                        磨损：{(item.wearFloat || item.wear_float)?.toFixed(16)}
                      </span>
                      {price != null ? (
                        <span style={{ color: '#52c41a', marginLeft: 4 }}>¥{price.toFixed(2)}</span>
                      ) : null}
                      {item.assetId || item.asset_id ? <span style={{ color: 'green' }}> ✓</span> : ''}
                    </span>
                  )})}
                </div>
              </div>
            )}
            {/* Simulation outcomes */}
            {outcomes && (() => {
              try {
                const outcomes = typeof r.outcome_summary === 'string' ? JSON.parse(r.outcome_summary) : r.outcome_summary;
                const parsed = typeof outcomes === 'string' ? JSON.parse(outcomes) : outcomes;
                if (!Array.isArray(parsed) || parsed.length === 0) return null;
                const grouped = new Map<string, any[]>();
                for (const o of parsed) {
                  const c = o.collection || 'Other';
                  if (!grouped.has(c)) grouped.set(c, []);
                  grouped.get(c)!.push(o);
                }
                return (
                  <div style={{ marginTop: 8 }}>
                    <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>模拟产出结果:</Text>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {[...grouped.entries()].map(([coll, items]) => (
                      <div key={coll} style={{ flex: '1 1 260px', minWidth: 220, maxWidth: 380,
                        border: '1px solid #f0f0f0', borderRadius: 6, padding: 8 }}>
                        <Text strong style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>{coll}</Text>
                        {items.map((o: any, idx: number) => {
                          const oPrice = o.marketHashName ? priceMap[o.marketHashName] : undefined;
                          return (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 0', fontSize: 11 }}>
                            <Text style={{ flex: 1, fontSize: 11 }} ellipsis>{o.nameZh || o.name}</Text>
                            <Text style={{ fontSize: 10, color: '#52c41a', minWidth: 50, textAlign: 'right' }}>
                              {oPrice != null ? `¥${oPrice.toFixed(2)}` : '-'}
                            </Text>
                            <Text style={{ fontSize: 10, color: '#888' }}>{o.estWearCategory}</Text>
                            <Text style={{ fontSize: 10, color: '#888', width: 32, textAlign: 'right' }}>{(o.probability * 100).toFixed(1)}%</Text>
                          </div>
                        )})}
                      </div>
                    ))}
                    </div>
                    {(detail.avg_wear_norm ?? r.avg_wear_norm) != null && (
                      <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                        平均归一化磨损: {((detail.avg_wear_norm ?? r.avg_wear_norm) * 100).toFixed(1)}%
                      </Text>
                    )}
                  </div>
                );
              } catch { return null; }
            })()}
          </div>
        )})()}

        {/* Children sub-recipes — visible when parent is expanded OR childrenVisible is toggled */}
        {showChildren && hasChildren && (
          <div style={{ marginTop: 8, marginLeft: 16, padding: 12, background: '#f5f5f5', borderRadius: 8 }}>
            <Text strong style={{ fontSize: 12 }}>子配方 ({r.children.length}):</Text>
            {r.children.map(child => renderRecipe(child, true))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>配方库</Title>
        <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>导入配方</Button>
      </div>

      {recipes.length === 0 ? (
        <Card>
          <Text type="secondary">暂无配方。</Text>
        </Card>
      ) : (
        <div style={{ maxHeight: 'calc(100vh - 160px)', overflowY: 'auto', paddingRight: 8 }}>
          {recipes.map(r => renderRecipe(r))}
        </div>
      )}

      <Modal title="导入配方" open={importOpen} onCancel={() => setImportOpen(false)}
        onOk={handleImport} okText="导入">
        <Input.TextArea rows={8} value={importJson}
          onChange={e => setImportJson(e.target.value)} placeholder="粘贴配方 JSON..." />
      </Modal>

      {/* Execute Result Modal */}
      <Modal title={executeResult?.success ? '汰换成功！' : '汰换失败'}
        open={!!executeResult} onCancel={() => setExecuteResult(null)}
        footer={<Button onClick={() => setExecuteResult(null)}>关闭</Button>} width={500}>
        {executeResult?.success ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text type="success" strong>汰换交易完成！获得以下物品:</Text>
            {executeResult.items.map((item: any, idx: number) => (
              <Card key={idx} size="small">
                <Space>
                  {item.imageUrl && <Image src={item.imageUrl} width={64} preview={false} />}
                  <div>
                    <Text strong>{item.name}</Text>
                    <br />
                    <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>
                      磨损: {item.wearFloat?.toFixed(16) || '-'}
                    </Text>
                  </div>
                </Space>
              </Card>
            ))}
          </Space>
        ) : (
          <Text type="danger">{executeResult?.error || '未知错误'}</Text>
        )}
      </Modal>
    </div>
  );
};

export default RecipePage;
