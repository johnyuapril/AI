import { registerPlugin } from '@capacitor/core';
import { isNative } from './native';

interface AppUpdater {
  info(): Promise<{ versionName: string; versionCode: number }>;
  install(o: { url: string }): Promise<void>;
  openUrl(o: { url: string }): Promise<void>;
}
const Updater = registerPlugin<AppUpdater>('AppUpdater');

const REPO = 'johnyuapril/AI';
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
export const BUILD = Number(import.meta.env.VITE_BUILD || 0);

export async function currentVersion(): Promise<{ name: string; code: number }> {
  if (isNative()) {
    try { const i = await Updater.info(); return { name: i.versionName, code: Number(i.versionCode) }; } catch { /* 옛 버전 */ }
  }
  return { name: BUILD ? `1.0.${BUILD}` : '개발판', code: BUILD };
}

export interface Latest { code: number; name: string; url: string; notes: string }
/** 깃허브 릴리스에서 최신 버전 확인. 저장소가 비공개면 null */
export async function latestRelease(): Promise<Latest | null> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!r.ok) return null;
  const j = await r.json();
  const asset = (j.assets || []).find((a: any) => /\.apk$/i.test(a.name));
  const code = Number(String(j.tag_name).split('.').pop()) || 0;
  return asset ? { code, name: String(j.tag_name).replace(/^v/, ''), url: asset.browser_download_url, notes: j.body || '' } : null;
}

export async function installUpdate(url: string) { await Updater.install({ url }); }
export async function openExternal(url: string) {
  if (isNative()) { try { await Updater.openUrl({ url }); return; } catch { /* */ } }
  window.open(url, '_blank');
}
