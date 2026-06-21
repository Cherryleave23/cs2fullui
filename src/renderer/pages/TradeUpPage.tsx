import React, { useState } from 'react';
import { Typography, Row, Col, Button, Space } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import TradeUpBuilder from '../components/tradeup/TradeUpBuilder';
import TradeUpOutcomeList from '../components/tradeup/TradeUpOutcomeList';
import TradeUpExecuteModal from '../components/tradeup/TradeUpExecuteModal';
import { useTradeUpStore } from '../stores/useTradeUpStore';
import { useAuthStore } from '../stores/useAuthStore';

const { Title } = Typography;

const TradeUpPage: React.FC = () => {
  const [executeOpen, setExecuteOpen] = useState(false);
  const { outcomes, slots } = useTradeUpStore();
  const { status } = useAuthStore();

  const filledCount = slots.filter(Boolean).length;
  const canExecute = filledCount === 10 && outcomes.length > 0 && status === 'gc_ready';

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>汰换交易</Title>
        <Button
          type="primary"
          danger
          size="large"
          icon={<ThunderboltOutlined />}
          disabled={!canExecute}
          onClick={() => setExecuteOpen(true)}
        >
          {!canExecute && status !== 'gc_ready'
            ? '需连接 CS2'
            : `执行汰换 (${filledCount}/10)`}
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <TradeUpBuilder />
        </Col>
        <Col xs={24} lg={10}>
          <TradeUpOutcomeList />
        </Col>
      </Row>

      <TradeUpExecuteModal
        open={executeOpen}
        onClose={() => setExecuteOpen(false)}
      />
    </div>
  );
};

export default TradeUpPage;
