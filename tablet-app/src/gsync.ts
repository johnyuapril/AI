import type { GSync, Project } from './types';
import { cutRows, describeRows, describeText, sceneRows, scriptParas } from './exports';
import code from './google-sync.gs.txt?raw';

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
  return j;
}

export async function testConnection(g: GSync) { await post(g, { ping: true }); }

export async function syncProject(g: GSync, p: Project): Promise<SyncLinks> {
  const j = await post(g, {
    id: p.id, title: p.title || '제목 없음',
    script: scriptParas(p), scenes: sceneRows(p), cuts: cutRows(p), describe: describeRows(p), describeText: describeText(p),
  });
  const l = { script: j.script, desc: j.desc, sheet: j.sheet, at: Date.now() };
  setLinks(p.id, l);
  return l;
}
