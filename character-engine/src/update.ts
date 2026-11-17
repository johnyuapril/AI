// 윈도우용 업데이트. 깃허브 릴리스 중 태그가 ce-v 로 시작하는 것이 인물 엔진 것이다.
// (같은 저장소의 v… 릴리스는 시나리오 작업실 것이라, 인물 엔진 릴리스는 'latest'로 표시하지 않는다)
const REPO = 'johnyuapril/AI';
const TAG = /^ce-v1\.0\.(\d+)$/;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
export const BUILD = Number(import.meta.env.VITE_BUILD || 0);
export const VERSION = BUILD ? `1.0.${BUILD}` : '개발판';

interface Desktop { info(): Promise<{ version: string }>; openExternal(url: string): Promise<void>; installUpdate(url: string): Promise<void> }
export const desktop: Desktop | undefined = (window as any).desktop;

export interface Latest { code: number; name: string; url: string; page: string }
export async function latestRelease(): Promise<Latest | null> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=50`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!r.ok) return null;
  let best: Latest | null = null;
  for (const j of (await r.json()) as any[]) {
    const m = TAG.exec(String(j.tag_name));
    if (!m || j.draft) continue;
    const code = Number(m[1]);
    const asset = (j.assets || []).find((a: any) => /^CharacterEngine-Setup-.*\.exe$/i.test(a.name));
    if (asset && (!best || code > best.code)) best = { code, name: `1.0.${code}`, url: asset.browser_download_url, page: j.html_url };
  }
  return best;
}

export async function openExternal(url: string) {
  if (desktop) await desktop.openExternal(url); else window.open(url, '_blank');
}
