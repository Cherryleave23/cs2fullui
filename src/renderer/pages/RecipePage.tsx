import React, { useState, useEffect } from 'react';
import { Card, Typography, List, Button, Space, Tag, Modal, Input, message, Popconfirm, Divider } from 'antd';
import {
  PlusOutlined,
  ImportOutlined,
  ExportOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useTradeUpStore } from '../stores/useTradeUpStore';

const { Title, Text, Paragraph } = Typography;

interface Recipe {
  id: number;
  name: string;
  description: string | null;
  type: string;
  rarity: string;
  target_rarity: string;
  is_stattrak: number;
  avg_wear_norm: number | null;
  created_at: string;
  items?: any[];
}

const RecipePage: React.FC = () => {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const loadRecipes = async () => {
    setLoading(true);
    try {
      const list: any = await window.electronAPI.recipe.list();
      setRecipes(Array.isArray(list) ? list : []);
    } catch { setRecipes([]); }
    setLoading(false);
  };

  useEffect(() => { loadRecipes(); }, []);

  const handleSaveCurrent = async () => {
    const { slots, outcomes, avgWearNorm, targetRarity, targetRarityZh } = useTradeUpStore.getState();
    const filled = slots.filter(Boolean);
    if (filled.length === 0) { message.warning('请先在汰换页面配置物品'); return; }

    const name = `${filled[0]?.rarityZh || ''} → ${targetRarityZh || '未知'}`;
    try {
      await window.electronAPI.recipe.save({
        name,
        description: `${filled.length}件物品汰换配方`,
        type: 'virtual',
        rarity: filled[0]?.rarity || '',
        targetRarity: targetRarity || targetRarityZh || '',
        isStatTrak: filled.every(i => i?.isStatTrak) ?? false,
        avgWearNorm,
        outcomeSummary: JSON.stringify(outcomes),
        items: filled.map((item, idx) => ({
          paint_index: 0,
          weapon_id: 0,
          wear_float: item!.wearFloat,
          asset_id: item!.assetId || null,
          stattrak: item!.isStatTrak ? 1 : 0,
          souvenir: item!.isSouvenir ? 1 : 0,
          position: idx,
        })),
      });
      message.success('配方已保存');
      loadRecipes();
    } catch (err: any) {
      message.error('保存失败: ' + err.message);
    }
  };

  const handleDelete = async (id: number) => {
    await window.electronAPI.recipe.delete(id);
    message.success('已删除');
    loadRecipes();
  };

  const handleExport = async (id: number) => {
    const json: any = await window.electronAPI.recipe.export(id);
    if (json) {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `recipe-${id}.json`; a.click();
      URL.revokeObjectURL(url);
      message.success('配方已导出');
    }
  };

  const handleImport = async () => {
    try {
      JSON.parse(importJson, ); // validate
      const result: any = await window.electronAPI.recipe.import(importJson);
      if (result.error) { message.error(result.error); }
      else { message.success('配方已导入'); loadRecipes(); setImportOpen(false); setImportJson(''); }
    } catch { message.error('JSON 格式无效'); }
  };

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>配方库</Title>
        <Space>
          <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>导入配方</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleSaveCurrent}>
            保存当前配方
          </Button>
        </Space>
      </div>

      <Card>
        {recipes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <FileTextOutlined style={{ fontSize: 48, color: 'var(--text-secondary)' }} />
            <Paragraph type="secondary" style={{ marginTop: 16 }}>
              暂无配方。在汰换页面配置物品和模拟后，点击"保存当前配方"
            </Paragraph>
          </div>
        ) : (
          <List
            loading={loading}
            dataSource={recipes}
            renderItem={(r) => (
              <List.Item
                actions={[
                  <Button size="small" icon={<ExportOutlined />} onClick={() => handleExport(r.id)}>导出</Button>,
                  <Popconfirm title="确定删除?" onConfirm={() => handleDelete(r.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <Text strong>{r.name}</Text>
                      <Tag color="blue">{r.rarity}</Tag>
                      <Tag color="green">{r.target_rarity}</Tag>
                      {r.is_stattrak === 1 && <Tag color="#cf6a32">StatTrak</Tag>}
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={2}>
                      <Text style={{ fontSize: 12 }}>
                        类型: {r.type === 'virtual' ? '虚拟配方' : '真实配方'} |
                        平均磨损: {r.avg_wear_norm ? (r.avg_wear_norm * 100).toFixed(1) + '%' : 'N/A'}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        创建于 {new Date(r.created_at).toLocaleString('zh-CN')}
                      </Text>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      {/* Import Modal */}
      <Modal
        title="导入配方"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onOk={handleImport}
        okText="导入"
      >
        <Input.TextArea
          rows={8}
          value={importJson}
          onChange={(e) => setImportJson(e.target.value)}
          placeholder="粘贴配方 JSON..."
        />
      </Modal>
    </div>
  );
};

export default RecipePage;
