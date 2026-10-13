import { useEffect, useRef } from 'react';
import { useStore } from './store.js';
import { Viewport } from './engine/Viewport.js';
import TopBar from './ui/TopBar.jsx';
import LeftPanel, { ToolRail, ToolOptions } from './ui/LeftPanel.jsx';
import RightPanel from './ui/RightPanel.jsx';
import { Dialogs, Toasts, StatusBar } from './ui/Dialogs.jsx';
import Dashboard from './ui/Dashboard.jsx';
import Guide from './ui/Guide.jsx';
import { referenceProject } from './samples/reference.js';

export default function App() {
  const host = useRef(null);
  useEffect(() => {
    // First visit: open the reference plant so there is something to look at
    const st = useStore.getState();
    const fresh = !st.project.objects.length && !st.project.floor.source && !st.project.zones.length;
    if (fresh) st.setProject(referenceProject());
    // First visit: open the setup guide
    if (!st.guide.seen) st.setGuide({ open: true, step: 0 });
    const vp = new Viewport(host.current, useStore);
    vp.fit();
    window.simFactory = { vp, store: useStore };
    return () => vp.dispose();
  }, []);
  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <ToolRail />
        <LeftPanel />
        <div className="viewport" ref={host}>
          <ToolOptions />
        </div>
        <RightPanel />
        <Dashboard />
      </div>
      <StatusBar />
      <Dialogs />
      <Toasts />
      <Guide />
    </div>
  );
}
