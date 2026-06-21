import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ConfigProvider, App as AntdApp, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './assets/styles/global.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <HashRouter>
      <ConfigProvider
        locale={zhCN}
        theme={{
          // Default to light; dark toggled via Settings
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: '#eb4b4b', // CS2 red accent
            borderRadius: 6,
            fontFamily: `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`,
          },
        }}
      >
        <AntdApp>
          <App />
        </AntdApp>
      </ConfigProvider>
    </HashRouter>
  </React.StrictMode>
);
