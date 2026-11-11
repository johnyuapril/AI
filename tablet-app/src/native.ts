import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { downloadBlob } from './util';
import { AppNative } from './plugin';

/** 윈도우용(desktop/preload.cjs)이 넣어 주는 기능. 안드로이드·브라우저에서는 없음 */
export interface DesktopBridge {
  info(): Promise<{ version: string; platform: string; saveDir: string }>;
  saveFile(name: string, data: Uint8Array, reveal?: boolean): Promise<string>;
  saveAs(name: string, data: Uint8Array): Promise<string>;
  copyImage(data: Uint8Array): Promise<boolean>;
  openAiSide(url: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  showItem(path: string): Promise<void>;
  http(o: { url: string; method: string; headers: Record<string, string>; body: string }): Promise<{ status: number; text: string }>;
  installUpdate(url: string): Promise<void>;
  comfyLaunch?(exe?: string): Promise<{ ok: boolean; path: string }>;
  pickFile?(title: string, filters: { name: string; extensions: string[] }[]): Promise<string>;
  comfyGetModel?(exe: string | undefined, url: string, name: string): Promise<string>;
  onComfyDl?(cb: (p: { got: number; total: number; done?: boolean }) => void): void;
  /** 예전 윈도우 앱에는 없을 수 있음 */
  fetchBin?(o: { url: string; method?: string; headers?: Record<string, string>; body?: Uint8Array | string }): Promise<{ status: number; type: string; data: Uint8Array }>;
  onAiDownloaded(cb: (path: string) => void): void;
  readText?(path: string): Promise<string>;
}
export const desktop: DesktopBridge | undefined = (globalThis as any).desktop;
/** 윈도우 AI 옆 창에서 이번에 받은 글 파일들 (콘티_S1-3.txt 등) */
export const aiDownloads: string[] = [];
const dlListeners = new Set<(p: string) => void>();
export function onAiDownload(cb: (p: string) => void) { dlListeners.add(cb); return () => { dlListeners.delete(cb); }; }
try { desktop?.onAiDownloaded(p => { if (/\.(txt|md|markdown|json|csv|fountain)$/i.test(p)) aiDownloads.push(p); dlListeners.forEach(f => f(p)); }); } catch { /* */ }
/** 윈도우용 앱에서 실행 중인지 */
export const isDesktop = () => !!desktop;
/** 지금 플랫폼: 'android' | 'windows' | 'web' */
export const platform = (): 'android' | 'windows' | 'web' => isNative() ? 'android' : isDesktop() ? 'windows' : 'web';
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

const mimeOf = (name: string) => /\.pdf$/i.test(name) ? 'application/pdf' : /\.(png)$/i.test(name) ? 'image/png' : /\.(jpe?g)$/i.test(name) ? 'image/jpeg' : /\.(txt|fountain|csv)$/i.test(name) ? 'text/plain' : 'application/octet-stream';
/** 받는 앱을 옆 화면(분할 화면)에 열고, 안 되면 보통 공유 창 */
async function shareSide(uri: string, name: string, title: string) {
  try { await AppNative.shareFile({ uri, mime: mimeOf(name), title }); }
  catch { try { await Share.share({ title: name, url: uri, dialogTitle: title }); } catch { /* 취소 */ } }
}

export interface AiApp { id: string; name: string; pkg: string; url: string }
export const AI_APPS: AiApp[] = [
  { id: 'chatgpt', name: 'ChatGPT', pkg: 'com.openai.chatgpt', url: 'https://chatgpt.com' },
  { id: 'gemini', name: 'Gemini', pkg: 'com.google.android.apps.bard', url: 'https://gemini.google.com' },
  { id: 'claude', name: 'Claude', pkg: 'com.anthropic.claude', url: 'https://claude.ai' },
];
/** 내가 주로 쓰는 AI (기본 Claude) */
export function preferredAi(): string { try { return localStorage.getItem('ai-app') || 'claude'; } catch { return 'claude'; } }
export function setPreferredAi(id: string) { try { localStorage.setItem('ai-app', id); } catch { /* */ } }
/** AI를 옆 화면에 열기 (앱이 없으면 웹) */
export async function openAiSide(id = preferredAi()) {
  const a = AI_APPS.find(x => x.id === id) || AI_APPS[0];
  if (desktop) { await desktop.openAiSide(a.url); return; }
  if (!isNative()) { window.open(a.url, '_blank'); return; }
  try { await AppNative.openSide({ pkg: a.pkg, url: a.url }); } catch { window.open(a.url, '_blank'); }
}

export const isNative = () => Capacitor.isNativePlatform();

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej; r.readAsDataURL(b);
  });
}

/** 파일 저장: 태블릿에서는 Documents/시나리오작업실 에 저장하고 공유 창을 띄움.
 *  윈도우에서는 문서\시나리오작업실 에 저장하고 탐색기로 보여 줌(AI 창에 끌어다 놓으면 됨) */
export async function saveFile(blob: Blob, name: string, share = true): Promise<string> {
  if (desktop) return desktop.saveFile(name, await bytes(blob), share);
  if (!isNative()) { downloadBlob(blob, name); return name; }
  const data = await blobToBase64(blob);
  const path = '시나리오작업실/' + name;
  let r: { uri: string }; let saved = '문서/' + path;
  try { r = await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true }); }
  catch { r = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache }); saved = '공유 창에서 저장할 곳을 골라 주세요'; share = true; }
  if (share) await shareSide(r.uri, name, '파일 보내기');
  return saved;
}

/** 이미지 공유(외부 AI 앱에 화풍 그림 보내기) */
export async function shareImage(blob: Blob, name: string): Promise<string | void> {
  if (desktop) {
    // 윈도우: 그림을 클립보드에 넣어 AI 창에 Ctrl+V 로 붙여넣게 하고, 파일로도 저장
    const data = await bytes(blob);
    const ok = await desktop.copyImage(data).catch(() => false);
    await desktop.saveFile(name, data, !ok);
    return ok ? '그림을 복사했어요. AI 창에서 Ctrl+V 로 붙여넣으세요.' : '그림 파일을 저장했어요. AI 창에 끌어다 놓으세요.';
  }
  if (!isNative()) { downloadBlob(blob, name); return; }
  const data = await blobToBase64(blob);
  const r = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
  await shareSide(r.uri, name, '그림 보내기');
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.onchange = () => res(Array.from(inp.files || []));
    inp.click();
  });
}
