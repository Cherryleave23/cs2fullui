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
    // Load recipe items into trade-up store and navigate
    const full: any = await window.electronAPI.recipe.get(recipe.id);
    if (full?.items) {
      const tradeUpStore = useTradeUpStore.getState();
      tradeUpStore.clearAll();
      for (let i = 0; i < Math.min(full.items.length, 10); i++) {
        const item = full.items[i];
        tradeUpStore.setSlot(i, {
          assetId: item.asset_id || '',
          name: item.paint_index + '|' + item.weapon_id,
          nameZh: item.paint_index + '|' + item.weapon_id,
          paintIndex: item.paint_index, weaponId: item.weapon_id,
          rarity: recipe.rarity, rarityColor: '#888',
          wearFloat: item.wear_float, minFloat: 0, maxFloat: 1,
          collection: '', isStatTrak: item.stattrak === 1, isSouvenir: item.souvenir === 1,
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
    const result: any = await (window.electronAPI as any).recipe.autoSub?.(parentId);
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
    const isExpanded = expandedId === r.id;

    return (
      <div key={r.id} style={{ marginLeft: isChild ? 32 : 0, marginBottom: isChild ? 4 : 12 }}>
        <Card size="small" style={{ background: isChild ? '#fafafa' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {/* Left: expand + name */}
            <Space>
              {!isChild && (
                <Button type="text" size="small"
                  icon={isExpanded ? <DownOutlined /> : <RightOutlined />}
                  onClick={() => setExpandedId(isExpanded ? null : r.id)} />
              )}
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

        {/* Expanded: show items + children */}
        {isExpanded && !isChild && (
          <div style={{ marginTop: 8, marginLeft: 16 }}>
            {/* Show parent items summary */}
            {r.items && r.items.length > 0 && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                物品: {r.items.map((i: any) => `#${i.paint_index || i.paintIndex}`).join(', ')}
              </Text>
            )}
            {/* Show children */}
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
