import { desktop, isNative } from './native';
import { AppNative as Updater } from './plugin';

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
  // 안드로이드는 .apk, 윈도우는 설치 파일 .exe
  const want = desktop ? /\.exe$/i : /\.apk$/i;
  const asset = (j.assets || []).find((a: any) => want.test(a.name));
  const code = Number(String(j.tag_name).split('.').pop()) || 0;
  return asset ? { code, name: String(j.tag_name).replace(/^v/, ''), url: asset.browser_download_url, notes: j.body || '' } : null;
}

export async function installUpdate(url: string) {
  if (desktop) { await desktop.installUpdate(url); return; }
  await Updater.install({ url });
}
export async function openExternal(url: string) {
  if (desktop) { await desktop.openExternal(url); return; }
  if (isNative()) { try { await Updater.openUrl({ url }); return; } catch { /* */ } }
  window.open(url, '_blank');
}
