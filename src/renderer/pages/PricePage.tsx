import React from 'react';
import { Card, Typography, Empty, Button, Space } from 'antd';
import { ReloadOutlined, DownloadOutlined } from '@ant-design/icons';

const { Title } = Typography;

const PricePage: React.FC = () => {
  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>价格行情</Title>
        <Space>
          <Button icon={<DownloadOutlined />} disabled>下载数据源</Button>
          <Button type="primary" icon={<ReloadOutlined />} disabled>刷新价格</Button>
        </Space>
      </div>
      <Card>
        <Empty
          description="请先下载CSGO-API数据源，然后刷新价格获取最新市场行情"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </Card>
    </div>
  );
};

export default PricePage;
