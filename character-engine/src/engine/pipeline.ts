// 사건 하나를 돌리는 흐름: 인물마다 반응 → 검수 → (걸리면 한 번 다시) → 상태·압력 반영 → 전환점 제안 거르기
import type { Character, ChangeDir, PressureDelta, Reaction, RootChangeProposal, RootField, Settings, StoryEvent, World } from './types';
import { ROOT_FIELDS } from './types';
import { applyReaction, filterProposal } from './change';
import { PRINCIPLES, REACTION_SCHEMA, REVIEWER, REVIEW_SCHEMA, ARC_SCHEMA, arcPrompt, reactionPrompt, reviewPrompt, type Ctx, type SeenAction } from './prompts';
import { askJson } from './ai';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : str(v) ? [str(v)] : []);
const isField = (v: unknown): v is RootField => ROOT_FIELDS.includes(v as RootField);
const isDir = (v: unknown): v is ChangeDir => v === 'growth' || v === 'fall' || v === 'shift';

/** AI 답(API든 붙여넣기든)을 Reaction 으로. 모르는 값은 버린다. */
export function toReaction(raw: any, ev: StoryEvent, charId: string, tries: number): Reaction {
  const pressure: PressureDelta[] = (Array.isArray(raw?.pressure) ? raw.pressure : [])
    .filter((p: any) => isField(p?.field) && isDir(p?.dir) && Number.isFinite(Number(p?.amount)))
    .map((p: any) => ({ field: p.field, dir: p.dir, amount: Number(p.amount), note: str(p.note) }));
  const pr = raw?.proposal;
  const proposal: RootChangeProposal | undefined = pr?.want && isField(pr.field) && isDir(pr.dir) && str(pr.after).trim()
    ? { field: pr.field, dir: pr.dir, after: str(pr.after).trim(), reason: str(pr.reason), status: 'pending' } : undefined;
  const ck = raw?.check;
  return {
    id: uid(), eventId: ev.id, charId,
    perception: str(raw?.perception), emotion: str(raw?.emotion), options: strs(raw?.options), choiceWhy: str(raw?.choiceWhy),
    inner: str(raw?.inner), action: str(raw?.action), dialogue: str(raw?.dialogue), reasons: strs(raw?.reasons),
    later: str(raw?.later) || undefined, moodAfter: str(raw?.moodAfter), learned: strs(raw?.learned), memory: str(raw?.memory) || str(raw?.action).slice(0, 80),
    pressure, proposal,
    check: ck && typeof ck.pass === 'boolean' ? { pass: ck.pass, issues: strs(ck.issues) } : { pass: true, issues: [] },
    tries, createdAt: Date.now(),
  };
}

export interface StepResult { reaction: Reaction; char: Character }

/** 반응을 인물에 반영하고 전환점 제안을 거른다 (API, 붙여넣기 공통) */
export function commit(char: Character, r: Reaction, ev: StoryEvent, threshold: number): StepResult {
  const next = applyReaction(char, r, ev);
  return { reaction: { ...r, proposal: filterProposal(next, r.proposal, threshold, ev) }, char: next };
}

export const seenOf = (c: Character, r: Reaction): SeenAction => ({ name: c.name, action: r.action, dialogue: r.dialogue });

/** API 방식: 인물 하나 */
export async function runOne(s: Settings, x: Ctx, onStage?: (t: string) => void): Promise<StepResult> {
  let feedback: string[] | undefined;
  let r!: Reaction;
  for (let tries = 1; tries <= 2; tries++) {
    onStage?.(tries === 1 ? `${x.char.name}: 반응 만드는 중` : `${x.char.name}: 점검에 걸려 다시 만드는 중`);
    const raw = await askJson<any>(s.apiKey, s.model, PRINCIPLES, reactionPrompt(x, feedback), REACTION_SCHEMA as any);
    r = toReaction(raw, x.event, x.char.id, tries);
    onStage?.(`${x.char.name}: 작위성 점검 중`);
    const review = await askJson<{ pass: boolean; issues: string[] }>(s.apiKey, s.model, REVIEWER, reviewPrompt(x, r), REVIEW_SCHEMA as any);
    r.check = { pass: !!review.pass, issues: strs(review.issues) };
    if (r.check.pass) break;
    feedback = r.check.issues;
  }
  return commit(x.char, r, x.event, x.threshold);
}

/** API 방식: 사건에 나오는 인물을 순서대로. 앞 인물의 행동과 말은 뒤 인물이 본다. */
export async function runEvent(s: Settings, world: World, chars: Character[], ev: StoryEvent, onStage?: (t: string) => void, onEach?: (res: StepResult) => void): Promise<StepResult[]> {
  const out: StepResult[] = [];
  let all = chars;
  const seen: SeenAction[] = [];
  for (const id of ev.participants) {
    const char = all.find(c => c.id === id);
    if (!char) continue;
    const res = await runOne(s, { world, char, all, event: ev, seen: [...seen], threshold: s.threshold, extraRules: s.extraRules }, onStage);
    all = all.map(c => (c.id === id ? res.char : c));
    seen.push(seenOf(res.char, res.reaction));
    out.push(res);
    onEach?.(res);
  }
  return out;
}

export interface ArcCheck { justified: boolean; progress: string; missing: string[]; risk: string }
export async function checkArc(s: Settings, world: World, c: Character, all: Character[]): Promise<ArcCheck> {
  return askJson<ArcCheck>(s.apiKey, s.model, PRINCIPLES, arcPrompt(world, c, all, s.threshold), ARC_SCHEMA as any);
}
