// 성격 변화(성장과 타락) 계산. AI 없이 동작하는 순수 함수만 둔다.
// 설계서 "성격 변화" 작동 방식: 압력 기록 → 균열 신호 → 전환점(작가 승인) → 되돌아감은 프롬프트에서 다룸.
import type { Character, ChangeDir, PressureDelta, Reaction, RootChangeProposal, RootField, StoryEvent } from './types';

export const MAX_STEP = 3;      // 사건 하나가 한 항목에 줄 수 있는 최대 압력
export const DEFAULT_THRESHOLD = 6;

const clampStep = (n: number) => Math.max(-MAX_STEP, Math.min(MAX_STEP, Math.round(n)));

export function pressureOf(c: Character, field: RootField, dir: ChangeDir): number {
  return c.pressures.find(p => p.field === field && p.dir === dir)?.amount ?? 0;
}

/** 균열 단계: 압력이 문턱의 절반을 넘으면 작은 균열이 겉으로 보이기 시작한다 */
export type Stage = 'none' | 'crack' | 'ready';
export function stageOf(amount: number, threshold: number): Stage {
  if (amount >= threshold) return 'ready';
  if (amount >= threshold / 2) return 'crack';
  return 'none';
}

/** 압력을 더한다. 음수는 그 방향을 거스르는 선택(되돌아감)이라 압력이 줄어든다. 0 아래로는 내려가지 않는다. */
export function addPressure(c: Character, deltas: PressureDelta[]): Character {
  const pressures = c.pressures.map(p => ({ ...p, notes: [...p.notes] }));
  for (const d of deltas) {
    const step = clampStep(d.amount);
    if (!step) continue;
    let p = pressures.find(x => x.field === d.field && x.dir === d.dir);
    if (!p) { p = { field: d.field, dir: d.dir, amount: 0, notes: [] }; pressures.push(p); }
    p.amount = Math.max(0, p.amount + step);
    if (d.note) p.notes = [...p.notes, `${step > 0 ? '+' : ''}${step} ${d.note}`].slice(-6);
  }
  return { ...c, pressures: pressures.filter(p => p.amount > 0 || p.notes.length) };
}

/**
 * 전환점을 열어도 되는가.
 * 압력이 문턱 이상이고, 작가가 결정적 사건으로 표시했거나 압력이 문턱의 1.5배를 넘었을 때만.
 * 한 번의 사건으로 개과천선하거나 타락하는 일을 코드에서 막는다.
 */
export function canTurn(c: Character, field: RootField, dir: ChangeDir, threshold: number, ev: Pick<StoryEvent, 'decisive'>): boolean {
  const a = pressureOf(c, field, dir);
  return a >= threshold && (ev.decisive || a >= threshold * 1.5);
}

/** AI가 낸 제안 중 조건을 못 채운 것은 버린다. (압력은 이번 사건 몫까지 더한 뒤 판단) */
export function filterProposal(after: Character, p: RootChangeProposal | undefined, threshold: number, ev: StoryEvent): RootChangeProposal | undefined {
  if (!p || !p.after?.trim()) return undefined;
  return canTurn(after, p.field, p.dir, threshold, ev) ? p : undefined;
}

/** 반응을 인물의 현재 상태와 압력에 반영 (뿌리는 건드리지 않음) */
export function applyReaction(c: Character, r: Reaction, ev: StoryEvent): Character {
  const knows = [...c.state.knows];
  for (const k of r.learned) if (k.trim() && !knows.includes(k.trim())) knows.push(k.trim());
  const memories = [...c.state.memories, `[${ev.title}] ${r.memory}`].slice(-40);
  const next = addPressure({ ...c, state: { mood: r.moodAfter || c.state.mood, knows: knows.slice(-60), memories } }, r.pressure);
  return { ...next, updatedAt: Date.now() };
}

/** 작가가 승인한 전환점을 뿌리에 반영하고 아크에 남긴다. 그 방향의 압력은 새 뿌리의 출발점이 되므로 0으로. */
export function acceptProposal(c: Character, p: RootChangeProposal, eventId: string): Character {
  const before = c.root[p.field];
  return {
    ...c,
    root: { ...c.root, [p.field]: p.after },
    arc: [...c.arc, { at: Date.now(), eventId, field: p.field, dir: p.dir, before, after: p.after, reason: p.reason }],
    pressures: c.pressures.filter(x => !(x.field === p.field && x.dir === p.dir)),
    updatedAt: Date.now(),
  };
}
