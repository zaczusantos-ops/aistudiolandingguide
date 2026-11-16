import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './fonts.css';
import './style.css';
import './startup.css';
import { prefetchRealNasaLunarAtlas } from './landing-guide/lunarTerrainEngine';

const App = lazy(() => import('./LegacyApp').then(module => ({ default: module.LegacyApp })));
function Startup({ failed = false }: { failed?: boolean }) {
  return <main className="boot-view"><img className="boot-image" src="/assets/lunar/moon-poster.jpg" alt="NASA LRO photographic Moon mosaic" width="1024" height="1024" fetchPriority="high" /><div><p>Lunar / landing guide</p><p role="status">{failed ? 'The guide could not load. Please reload to try again.' : 'Opening the guide…'}</p>{failed && <button type="button" onClick={() => window.location.reload()}>Reload guide</button>}</div></main>;
}
class StartupBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Startup failed /> : this.props.children; }
}
prefetchRealNasaLunarAtlas();
createRoot(document.getElementById('root')!).render(<React.StrictMode><StartupBoundary><Suspense fallback={<Startup />}><App /></Suspense></StartupBoundary></React.StrictMode>);
