import type { GSync, Project } from './types';
import { describeText, sceneTree, scriptParas } from './exports';
import code from './google-sync.gs.txt?raw';
import { CapacitorHttp } from '@capacitor/core';
import { isNative } from './native';

export const CODE_VERSION = 4;
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

function parse(status: number, raw: unknown): any {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw ?? '');
  try { return JSON.parse(text); } catch { /* 구글이 오류 웹페이지를 보냄 */ }
  const plain = text.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (/로그인|Sign in|accounts\.google/i.test(text)) throw new Error('구글 로그인 화면이 왔어요. 배포할 때 액세스 권한을 "모든 사용자"로 했는지 확인해 주세요.');
  throw new Error(`구글 응답 오류 ${status}: ${plain.slice(0, 200) || '(내용 없음)'}`);
}

async function post(g: GSync, body: object): Promise<any> {
  const data = JSON.stringify({ key: g.key, ...body });
  let j: any;
  if (isNative()) {
    // 앱에서는 브라우저 제한(CORS) 없이 직접 보내서, 구글 쪽 오류 내용까지 읽을 수 있게
    const r = await CapacitorHttp.request({
      method: 'POST', url: g.url.trim(), headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data, responseType: 'text', connectTimeout: 30000, readTimeout: 360000,
    });
    j = parse(r.status, r.data);
  } else {
    // text/plain 으로 보내야 구글 앱스 스크립트가 CORS 사전 요청 없이 받아요
    const r = await fetch(g.url.trim(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: data, redirect: 'follow' });
    j = parse(r.status, await r.text());
  }
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
