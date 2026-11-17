// 시나리오 작업실 작품(.sbk 백업 = zip 안의 project.json)이나 project.json 에서 인물을 가져온다.
// 작업실 types.ts: Project.chars = { name, memo, look }[]
import JSZip from 'jszip';
import type { Character } from './engine/types';
import type { Book } from './store';
import { newCharacter } from './store';

interface StudioChar { name: string; memo?: string; look?: string }

async function readProjectJson(file: File): Promise<any> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 2));
  if (head[0] === 0x50 && head[1] === 0x4b) { // zip
    const zip = await JSZip.loadAsync(buf);
    const f = zip.file('project.json') ?? zip.file(/projects\/[^/]+\/project\.json$/)[0];
    if (!f) throw new Error('백업 파일 안에서 작품을 찾지 못했어요.');
    return JSON.parse(await f.async('string'));
  }
  return JSON.parse(new TextDecoder().decode(buf));
}

/** 반환: 새로 더할 인물들 (이미 같은 이름이 있으면 건너뜀), 또는 이 앱의 백업이면 Book */
export async function importFile(file: File, existing: Character[]): Promise<{ chars?: Character[]; book?: Book; title?: string }> {
  const j = await readProjectJson(file);
  if (j?.kind === 'character-engine') return { book: { chars: j.chars ?? [], world: j.world, events: j.events ?? [], reactions: j.reactions ?? [] } };
  const list: StudioChar[] = Array.isArray(j?.chars) ? j.chars : [];
  if (!list.length) throw new Error('이 작품에는 인물 정보가 없어요. 작업실에서 인물 메모를 먼저 적어 주세요.');
  const names = new Set(existing.map(c => c.name));
  const chars = list.filter(c => c.name?.trim() && !names.has(c.name.trim()))
    .map(c => newCharacter(c.name.trim(), [c.memo?.trim(), c.look?.trim() && `생김새: ${c.look.trim()}`].filter(Boolean).join('\n')));
  return { chars, title: j.title };
}
