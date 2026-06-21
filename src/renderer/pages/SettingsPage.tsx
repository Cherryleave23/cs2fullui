import React, { useEffect, useState } from 'react';
import { Card, Tabs, Typography, Button, Input, Form, message, Descriptions, Tag, Space } from 'antd';
import {
  UserOutlined,
  GlobalOutlined,
  DatabaseOutlined,
  BgColorsOutlined,
  InfoCircleOutlined,
  LogoutOutlined,
  SaveOutlined,
  CheckCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import LoginForm from '../components/auth/LoginForm';
import { useAuthStore } from '../stores/useAuthStore';

const { Title, Paragraph, Text } = Typography;

const SettingsPage: React.FC = () => {
  const { status, steamId, accountName, reset } = useAuthStore();
  const [proxyForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [dataStatus, setDataStatus] = useState<{ csgoapiDownloaded: boolean; csgoapiLang: string }>({
    csgoapiDownloaded: false,
    csgoapiLang: '',
  });

  const isLoggedIn = status === 'logged_in' || status === 'gc_ready';

  useEffect(() => {
    window.electronAPI.auth.getProxyConfig().then((c: any) => {
      proxyForm.setFieldsValue({ proxyUrl: c.proxyUrl || '' });
    });
    window.electronAPI.data.getStatus().then((s: any) => {
      if (s) setDataStatus(s);
    });
  }, []);

  const handleLogout = async () => {
    await window.electronAPI.auth.logout();
    reset();
    message.success('已登出');
  };

  const handleSaveProxy = async () => {
    const values = await proxyForm.validateFields();
    setSaving(true);
    await window.electronAPI.auth.setProxyConfig({ proxyUrl: values.proxyUrl || '' });
    setSaving(false);
    message.success('代理配置已保存');
  };

  const accountTab = (
    <Card bordered={false}>
      {isLoggedIn ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="Steam ID">
              <Text code>{steamId}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="账号">{accountName}</Descriptions.Item>
            <Descriptions.Item label="CS2 GC 状态" span={2}>
              <Tag color={status === 'gc_ready' ? 'green' : 'orange'}>
                {status === 'gc_ready' ? '已连接' : '连接中...'}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
          <Button danger icon={<LogoutOutlined />} onClick={handleLogout}>登出</Button>
        </Space>
      ) : (
        <LoginForm />
      )}
    </Card>
  );

  const proxyTab = (
    <Card bordered={false}>
      <Form form={proxyForm} layout="vertical">
        <Form.Item name="proxyUrl" label="代理地址">
          <Input placeholder="socks5://127.0.0.1:10808" />
        </Form.Item>
        <Form.Item help="支持 socks5:// 和 http:// 格式。留空则直连。">
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSaveProxy}>
            保存代理配置
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );

  const dataTab = (
    <Card bordered={false}>
      <Title level={5}>数据管理</Title>
      <Paragraph>
        CSGO-API 数据状态：
        {dataStatus.csgoapiDownloaded ? (
          <Text type="success">
            <CheckCircleOutlined style={{ marginRight: 4 }} />
            已下载 ({dataStatus.csgoapiLang})
          </Text>
        ) : (
          <Text type="warning">
            <WarningOutlined style={{ marginRight: 4 }} />
            未下载
          </Text>
        )}
      </Paragraph>
      <Paragraph type="secondary">
        CSGO-API 提供物品名称、稀有度、图片等静态数据。
        将 all.json 放到项目 data/ 目录下即可自动加载。
      </Paragraph>
    </Card>
  );

  const appearanceTab = (
    <Card bordered={false}>
      <Title level={5}>界面设置</Title>
      <Paragraph>语言：简体中文 | 主题：浅色 (暗色主题开发中)</Paragraph>
    </Card>
  );

  const aboutTab = (
    <Card bordered={false}>
      <Title level={5}>关于 CS2炼金管理</Title>
      <Descriptions column={1} size="small" bordered style={{ maxWidth: 400 }}>
        <Descriptions.Item label="版本">1.0.0</Descriptions.Item>
        <Descriptions.Item label="技术栈">Electron + React 18 + Ant Design 5 + sql.js</Descriptions.Item>
        <Descriptions.Item label="核心依赖">steam-user v5 / globaloffensive v3.3</Descriptions.Item>
        <Descriptions.Item label="平台">Windows 10/11</Descriptions.Item>
      </Descriptions>
    </Card>
  );

  const items = [
    { key: 'account', label: <span><UserOutlined /> 账号</span>, children: accountTab },
    { key: 'proxy', label: <span><GlobalOutlined /> 代理</span>, children: proxyTab },
    { key: 'data', label: <span><DatabaseOutlined /> 数据</span>, children: dataTab },
    { key: 'appearance', label: <span><BgColorsOutlined /> 外观</span>, children: appearanceTab },
    { key: 'about', label: <span><InfoCircleOutlined /> 关于</span>, children: aboutTab },
  ];

  return (
    <div className="fade-in">
      <Title level={3} style={{ marginBottom: 24 }}>设置</Title>
      <Card>
        <Tabs tabPosition="left" items={items} style={{ minHeight: 400 }} />
      </Card>
    </div>
  );
};

export default SettingsPage;
