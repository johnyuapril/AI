// 저장: 서버 없이 기기 안(IndexedDB). 시나리오 작업실 store.ts 와 같은 idb-keyval 방식.
import { get, set } from 'idb-keyval';
import type { Character, Reaction, Settings, StoryEvent, World } from './engine/types';
import { DEFAULT_MODEL } from './engine/ai';
import { DEFAULT_THRESHOLD } from './engine/change';
import type { ScriptScene } from './engine/sequence';

export interface Book {
  chars: Character[]; world: World; events: StoryEvent[]; reactions: Reaction[];
  undo?: { eventId: string; chars: Character[]; reactionIds: string[] }; // 마지막으로 돌린 사건 되돌리기 (한 단계)
  script?: string; // 시나리오 탭에서 쓴 글 (.txt 로 저장하는 그 글)
  scenes?: ScriptScene[]; // 장면 단위로 이어 쓰기: 장면 묶음과 장면이 끝났을 때 인물 상태
}
export const EMPTY_WORLD: World = { era: '', rules: '', limits: '', groups: '' };
export const DEFAULT_SETTINGS: Settings = { mode: 'manual', apiKey: '', model: DEFAULT_MODEL, threshold: DEFAULT_THRESHOLD, extraRules: [] };

const K = 'ce:book', KS = 'ce:settings';
export async function loadBook(): Promise<Book> {
  const b = await get<Book>(K);
  return { ...b, chars: b?.chars ?? [], world: b?.world ?? EMPTY_WORLD, events: b?.events ?? [], reactions: b?.reactions ?? [] };
}
export const saveBook = (b: Book) => set(K, b);
export async function loadSettings(): Promise<Settings> { return { ...DEFAULT_SETTINGS, ...((await get<Settings>(KS)) ?? {}) }; }
export const saveSettings = (s: Settings) => set(KS, s);

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function newCharacter(name: string, basics = ''): Character {
  const now = Date.now();
  return {
    id: uid(), name,
    root: { basics, personality: '', values: '', wounds: '', desires: '', coping: '', speech: '' },
    relations: [], state: { mood: '', knows: [], memories: [] }, pressures: [], arc: [], arcGoal: '', createdAt: now, updatedAt: now,
  };
}

/** 백업 파일: 이 앱 전체를 JSON 하나로 (API 키는 빼고) */
export function exportBook(b: Book): Blob { return new Blob([JSON.stringify({ kind: 'character-engine', v: 1, ...b })], { type: 'application/json' }); }
