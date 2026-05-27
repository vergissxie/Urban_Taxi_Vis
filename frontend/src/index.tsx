import React from 'react';
import ReactDOM from 'react-dom/client';
import 'antd/dist/reset.css';
import './styles/global.css';
import GeoSpatialWorkbench from './pages/GeoSpatialWorkbench';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <GeoSpatialWorkbench />
  </React.StrictMode>,
);
