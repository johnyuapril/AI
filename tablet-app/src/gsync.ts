import type { GSync, Project } from './types';
import { describeText, sceneTree, scriptParas } from './exports';
import code from './google-sync.gs.txt?raw';

export const CODE_VERSION = 3;
const OLD = '구글 쪽 코드가 예전 버전이에요. 앱의 "구글 연결" 창에서 코드를 다시 복사해 붙여넣고, 배포 → 배포 관리 → 연필 → 버전: 새 버전 → 배포를 눌러 주세요.';
export const scriptCode = (key: string) => code.replace('__KEY__', key);
export const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');

export interface SyncLinks { script: string; desc: string; sheet: string; at: number }
const LK = 'gsync-links';
export function getLinks(id: string): SyncLinks | undefined {
  try { return JSON.parse(localStorage.getItem(LK) || '{}')[id]; } catch { return undefined; }
}
function setLinks(id: string, l: SyncLinks) {
  try { const all = JSON.parse(localStorage.getItem(LK) || '{}'); all[id] = l; localStorage.setItem(LK, JSON.stringify(all)); } catch { /* */ }
}

async function post(g: GSync, body: object): Promise<any> {
  // text/plain 으로 보내야 구글 앱스 스크립트가 CORS 사전 요청 없이 받아요
  const r = await fetch(g.url.trim(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: g.key, ...body }), redirect: 'follow' });
  const text = await r.text();
  let j: any; try { j = JSON.parse(text); } catch { throw new Error(r.status === 200 ? '연결 주소가 맞는지 확인해 주세요 (웹 앱 주소, 액세스: 모든 사용자).' : `구글 응답 오류 ${r.status}`); }
  if (!j.ok) throw new Error(j.error || '구글 저장 실패');
  if (!j.version || j.version < CODE_VERSION) throw new Error(OLD);
  return j;
}

export async function testConnection(g: GSync) { await post(g, { ping: true }); }

export async function syncProject(g: GSync, p: Project): Promise<SyncLinks> {
  const j = await post(g, {
    id: p.id, title: p.title || '제목 없음',
    script: scriptParas(p), tree: sceneTree(p), describeText: describeText(p),
  });
  const l = { script: j.script, desc: j.desc, sheet: j.sheet, at: Date.now() };
  setLinks(p.id, l);
  return l;
}
