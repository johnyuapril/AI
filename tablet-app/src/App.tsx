import { useEffect, useState } from 'react';
import Home from './Home';
import Workspace from './Workspace';
import { ToastProvider } from './ui';
import { getSettings, saveSettings } from './store';
import type { Settings } from './types';

export default function App() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => { getSettings().then(setSettings); }, []);
  useEffect(() => {
    try { const last = localStorage.getItem('lastProject'); if (last) setOpenId(last); } catch { /* */ }
  }, []);
  const open = (id: string | null) => { setOpenId(id); try { id ? localStorage.setItem('lastProject', id) : localStorage.removeItem('lastProject'); } catch { /* */ } };
  const updSettings = (s: Settings) => { setSettings(s); saveSettings(s); };
  if (!settings) return null;
  return (
    <ToastProvider>
      {openId ? <Workspace id={openId} onClose={() => open(null)} settings={settings} setSettings={updSettings} />
        : <Home onOpen={open} settings={settings} setSettings={updSettings} />}
    </ToastProvider>
  );
}
