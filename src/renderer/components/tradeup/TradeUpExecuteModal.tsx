import React, { useState } from 'react';
import { Modal, Button, Space, Typography, Alert, List, Tag, Descriptions, message } from 'antd';
import { ThunderboltOutlined, WarningOutlined } from '@ant-design/icons';
import { useTradeUpStore } from '../../stores/useTradeUpStore';
import RarityTag from '../shared/RarityTag';

const { Text, Title } = Typography;

interface TradeUpExecuteModalProps {
  open: boolean;
  onClose: () => void;
}

const TradeUpExecuteModal: React.FC<TradeUpExecuteModalProps> = ({ open, onClose }) => {
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const { slots, clearAll, targetRarityZh, avgWearNorm } = useTradeUpStore();
  const filledItems = slots.filter(Boolean);

  const handleExecute = async () => {
    const assetIds = filledItems.map(i => i!.assetId).filter(Boolean);
    if (assetIds.length !== 10) {
      message.error('需要 10 个有效的物品 ID');
      return;
    }

    setExecuting(true);
    try {
      const res: any = await window.electronAPI.tradeup.execute(assetIds);
      setResult(res);
      if (res.success) {
        message.success('汰换交易完成！');
        setTimeout(() => {
          clearAll();
          onClose();
          setResult(null);
        }, 3000);
      } else {
        message.error(res.error || '汰换失败');
      }
    } catch (err: any) {
      setResult({ success: false, error: err.message });
    }
    setExecuting(false);
  };

  return (
    <Modal
      title={
        <Space>
          <ThunderboltOutlined style={{ color: '#eb4b4b' }} />
          <span>确认执行汰换交易</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose} disabled={executing}>
            取消
          </Button>
          <Button
            type="primary"
            danger
            loading={executing}
            disabled={!!result?.success}
            onClick={handleExecute}
            icon={<ThunderboltOutlined />}
          >
            {executing ? '执行中...' : '确认执行汰换'}
          </Button>
        </Space>
      }
      width={520}
    >
      {result ? (
        <Alert
          type={result.success ? 'success' : 'error'}
          message={result.success ? '汰换成功!' : '汰换失败'}
          description={
            result.success
              ? `获得物品: ${result.gainedItems?.map((i: any) => i.resolvedNameZh || i.resolvedName).join(', ') || result.gainedItemIds?.join(', ')}`
              : result.error
          }
          showIcon
          style={{ marginBottom: 16 }}
        />
      ) : (
        <Alert
          type="warning"
          message="此操作不可撤销"
          description="汰换交易将在 CS2 游戏协调器(GC)上执行。执行后10件输入物品将被消耗，并获得一件高一级稀有度的物品。"
          icon={<WarningOutlined />}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Descriptions size="small" bordered column={2} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="消耗物品">{filledItems.length} 件</Descriptions.Item>
        <Descriptions.Item label="目标稀有度">
          <RarityTag rarityName={targetRarityZh || '未知'} />
        </Descriptions.Item>
        <Descriptions.Item label="平均标准磨损" span={2}>
          {(avgWearNorm * 100).toFixed(1)}%
        </Descriptions.Item>
      </Descriptions>

      <Text strong style={{ fontSize: 13 }}>将要消耗的物品:</Text>
      <List
        size="small"
        dataSource={filledItems}
        renderItem={(item) => (
          <List.Item>
            <Space>
              <RarityTag rarityName={item!.rarityZh || item!.rarity || ''} rarityColor={item!.rarityColor} />
              <Text>{item!.nameZh || item!.name}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                磨损: {item!.wearFloat.toFixed(6)}
              </Text>
            </Space>
          </List.Item>
        )}
        style={{ maxHeight: 200, overflow: 'auto' }}
      />
    </Modal>
  );
};

export default TradeUpExecuteModal;
