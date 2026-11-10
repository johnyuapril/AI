import { useEffect, useState } from 'react';
import Home from './Home';
import Workspace from './Workspace';
import { ToastProvider } from './ui';
import { getSettings, saveSettings } from './store';
import type { Settings } from './types';
import { isDesktop } from './native';
import { comfyAutoSetup, comfyAutoStart, DEFAULT_COMFY } from './comfy';

export default function App() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    getSettings().then(s => {
      setSettings(s);
      // 윈도우 앱: ComfyUI를 같이 켜기 (끄려면 그림 탭 ComfyUI 설정에서)
      if (isDesktop() && s.comfy?.autoStart !== false) {
        const c = { ...DEFAULT_COMFY, ...(s.comfy || {}) };
        comfyAutoStart(c).then(async r => {
          const patch: Record<string, unknown> = {};
          if (r.launched && r.launched !== c.exe) patch.exe = r.launched;
          if (!r.notFound) Object.assign(patch, await comfyAutoSetup(c, r.running ? 5000 : 180_000) || {});
          if (Object.keys(patch).length) setSettings(cur => { const base = cur || s; const n = { ...base, comfy: { ...c, ...(base.comfy || {}), ...patch } }; saveSettings(n); return n; });
        }).catch(() => { /* */ });
      }
    });
  }, []);
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
