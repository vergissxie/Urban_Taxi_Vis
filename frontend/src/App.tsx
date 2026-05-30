import React from 'react';
import { ArrowLeft } from 'lucide-react';
import GeoSpatialWorkbench from './pages/GeoSpatialWorkbench';
import UrbanTaxiLaunch from './pages/UrbanTaxiLaunch';

type RouteState = { view: 'landing' } | { view: 'console' };

const parseRoute = (): RouteState => {
  const cleanHash = window.location.hash.replace(/^#\/?/, '').replace(/\/$/, '');
  return cleanHash === 'console' ? { view: 'console' } : { view: 'landing' };
};

export default function App() {
  const [route, setRoute] = React.useState<RouteState>(() => parseRoute());

  React.useEffect(() => {
    const handleHashChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  React.useEffect(() => {
    document.title = route.view === 'console'
      ? '控制台 | Urban Taxi Vis'
      : 'Urban Taxi Vis | 北京出租车流动可视分析';
  }, [route.view]);

  if (route.view === 'console') {
    return (
      <div className="workbench-route-shell">
        <GeoSpatialWorkbench />
        <a className="workbench-back-link" href="#/" aria-label="返回总页">
          <ArrowLeft size={17} aria-hidden="true" />
          <span>总页</span>
        </a>
      </div>
    );
  }

  return <UrbanTaxiLaunch />;
}
