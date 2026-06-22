import React, { useState, useEffect } from 'react';
import { Card, Typography, Button, Space, Modal, message, Tag, Popconfirm, Input } from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ExperimentOutlined,
  ToolOutlined, DownOutlined, RightOutlined, ImportOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTradeUpStore } from '../stores/useTradeUpStore';

const { Title, Text } = Typography;

interface RecipeData {
  id: number; name: string; type: string; rarity: string; target_rarity: string;
  is_stattrak: number; avg_wear_norm: number | null; outcome_summary: string | null;
  created_at: string; children: RecipeData[]; parent_id?: number;
  items?: any[];
}

const RecipePage: React.FC = () => {
  const navigate = useNavigate();
  const [recipes, setRecipes] = useState<RecipeData[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedChildId, setExpandedChildId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const list: any = await window.electronAPI.recipe.list();
      setRecipes(Array.isArray(list) ? list.filter((r: any) => !r.parent_id) : []);
    } catch { setRecipes([]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

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
    const isExpanded = isChild ? (expandedChildId === r.id) : (expandedId === r.id);
    const [expandedDetails, setExpandedDetails] = useState<Record<number, any>>({});

  const toggleExpand = async () => {
      if (isChild) {
        setExpandedChildId(isExpanded ? null : r.id);
      } else {
        setExpandedId(isExpanded ? null : r.id);
      }
      // Load full recipe data (items + outcomes) if not already loaded
      if (!isExpanded && (!r.items || r.items.length === 0)) {
        const full: any = await window.electronAPI.recipe.get(r.id);
        if (full) {
          setExpandedDetails(prev => ({ ...prev, [r.id]: full }));
        }
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
              {r.avg_wear_norm != null && (
                <Text style={{ fontSize: 11 }}>磨损: {(r.avg_wear_norm * 100).toFixed(1)}%</Text>
              )}
            </Space>

            {/* Right: actions */}
            <Space size={4}>
              <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
              {!isChild && (
                <Button size="small" icon={<ToolOutlined />}
                  onClick={() => handleAutoSub(r.id)}>自动配置子配方</Button>
              )}
              {!isChild && hasChildren && (
                <Button size="small"
                  onClick={() => setExpandedId(isExpanded ? null : r.id)}>
                  查看子配方 ({r.children.length})
                </Button>
              )}
              <Popconfirm title="确定删除？子配方也会被删除" onConfirm={() => handleDelete(r.id)}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          </div>
        </Card>

        {/* Expanded: show items + outcomes + children */}
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
                  {items.map((item: any, idx: number) => (
                    <span key={idx} style={{
                      fontSize: 11, padding: '2px 6px', background: '#fff', borderRadius: 4,
                      border: '1px solid #e8e8e8',
                    }}>
                      #{idx + 1}: {item.paintIndex || item.paint_index}|{item.weaponId || item.weapon_id}
                      <span style={{ color: '#888' }}> @{(item.wearFloat || item.wear_float)?.toFixed(4)}</span>
                      {item.assetId || item.asset_id ? <span style={{ color: 'green' }}> ✓</span> : ''}
                    </span>
                  ))}
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
                    <Text strong style={{ fontSize: 13 }}>模拟产出结果:</Text>
                    {[...grouped.entries()].map(([coll, items]) => (
                      <div key={coll} style={{ marginTop: 4 }}>
                        <Text style={{ fontSize: 11, color: '#666' }}>{coll}:</Text>
                        <table style={{ fontSize: 11, marginLeft: 16, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid #e8e8e8' }}>
                              <th style={{ textAlign: 'left', padding: '2px 8px' }}>物品</th>
                              <th style={{ textAlign: 'right', padding: '2px 8px' }}>概率</th>
                              <th style={{ textAlign: 'right', padding: '2px 8px' }}>预估磨损</th>
                              <th style={{ textAlign: 'left', padding: '2px 8px' }}>磨损类别</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((o: any, idx: number) => (
                              <tr key={idx} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                <td style={{ padding: '2px 8px' }}>{o.nameZh || o.name}</td>
                                <td style={{ textAlign: 'right', padding: '2px 8px' }}>{(o.probability * 100).toFixed(1)}%</td>
                                <td style={{ textAlign: 'right', padding: '2px 8px', fontFamily: 'monospace' }}>
                                  ~{o.estWearFloat?.toFixed(6) || '-'}
                                </td>
                                <td style={{ padding: '2px 8px' }}>{o.estWearCategory || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                    {(detail.avg_wear_norm ?? r.avg_wear_norm) != null && (
                      <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                        平均归一化磨损: {((detail.avg_wear_norm ?? r.avg_wear_norm) * 100).toFixed(1)}%
                      </Text>
                    )}
                  </div>
                );
              } catch { return null; }
            })()}
            {/* Children sub-recipes */}
            {r.children && r.children.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Text strong style={{ fontSize: 12 }}>子配方 ({r.children.length}):</Text>
                {r.children.map(child => renderRecipe(child, true))}
              </div>
            )}
          </div>
        )})()}
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
          <Text type="secondary">
            暂无配方。在汰换交易页面配置10件物品并模拟后，点击"保存配方"。
          </Text>
        </Card>
      ) : (
        recipes.map(r => renderRecipe(r))
      )}

      <Modal title="导入配方" open={importOpen} onCancel={() => setImportOpen(false)}
        onOk={handleImport} okText="导入">
        <Input.TextArea rows={8} value={importJson}
          onChange={e => setImportJson(e.target.value)} placeholder="粘贴配方 JSON..." />
      </Modal>
    </div>
  );
};

export default RecipePage;
