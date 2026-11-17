// 작가가 붙여넣은 글(기획 메모, 인물 소개, 줄거리 등)을 AI가 항목별로 정리해 채워 넣는다.
// 탭마다 하나씩: 인물 / 배경 / 사건. 결과를 앱 데이터에 합치는 함수도 여기에 둔다(순수 함수).
import type { Character, StoryEvent, World } from './types';
import { ROOT_FIELDS, ROOT_LABEL } from './types';

export type OrganizeKind = 'chars' | 'world' | 'events';

const S = { type: 'string' } as const;
const SA = { type: 'array', items: S } as const;
const obj = (props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });

export const ORG_SCHEMA: Record<OrganizeKind, Record<string, unknown>> = {
  chars: obj({
    characters: {
      type: 'array', items: obj({
        name: S, ...Object.fromEntries(ROOT_FIELDS.map(f => [f, S])), mood: S, knows: SA, arcGoal: S,
        relations: { type: 'array', items: obj({ other: S, label: S, feeling: S }) },
      }),
    },
  }),
  world: obj({ era: S, rules: S, limits: S, groups: S }),
  events: obj({
    events: {
      type: 'array', items: obj({
        title: S, what: S, whenWhere: S, participants: SA,
        knowledge: { type: 'array', items: obj({ name: S, knows: S }) },
        span: { type: 'string', enum: ['now', 'days'] }, decisive: { type: 'boolean' },
      }),
    },
  }),
};

const FIELDS: Record<OrganizeKind, string> = {
  chars: `characters: 인물마다 하나씩
- name: 이름
${ROOT_FIELDS.map(f => `- ${f}: ${ROOT_LABEL[f]}`).join('\n')}
  (basics=나이·직업·사는 곳·경제 사정, personality=성격(모순되는 면 포함), values=갈등할 때 무엇을 우선하나, wounds=행동을 제한하는 과거, desires=자기도 모르는 것까지, coping=스트레스 때 하는 일, speech=어휘·버릇·피하는 말)
- mood: 이야기 시작 시점의 감정과 컨디션
- knows: 이야기 시작 시점에 이 인물이 아는 사실과 믿고 있는 오해 (문자열 배열)
- relations: [{other: 상대 인물 이름, label: 관계, feeling: 친밀도나 미해결 감정}]
- arcGoal: 글에 인물이 어떻게 변해 가는지(성장, 타락)가 있으면 한 문장, 없으면 빈 문자열`,
  world: `- era: 시대와 장소
- rules: 그 시대와 공동체에서 당연하거나 금기인 것 (사회적 규칙)
- limits: 거리, 교통, 통신, 돈, 시간 같은 물리적 제약
- groups: 주변 인물과 집단 (직장, 가족, 이웃 등)`,
  events: `events: 사건마다 하나씩, 이야기 순서대로
- title: 짧은 사건 이름
- what: 무슨 일이 일어났나 (작가 시점의 객관적 사실)
- whenWhere: 언제, 어디서
- participants: 이 사건을 겪고 반응할 인물 이름들 (반응하는 순서대로)
- knowledge: [{name: 인물 이름, knows: 그 인물이 실제로 보고 들은 것}] — 인물마다 아는 정도가 다를 때만. 다 아는 인물은 넣지 않음
- span: "now"(즉각 반응만) 또는 "days"(며칠 뒤 변화까지 볼 만한 사건)
- decisive: 인물의 성격을 바꿀 만한 결정적 사건이면 true`,
};

const WHAT: Record<OrganizeKind, string> = { chars: '인물 설정', world: '배경 설정', events: '사건 목록' };

export function organizePrompt(kind: OrganizeKind, notes: string, fillGaps: boolean, known: string[]): string {
  return [
    `너는 시나리오 작가의 기획 메모를 정리하는 조수다. 아래 작가의 글을 읽고 ${WHAT[kind]}을(를) 항목별로 정리해라.`,
    fillGaps
      ? '글에 없는 항목은 글의 내용과 어울리게 자연스럽게 채워라. 다만 글에 적힌 내용과 어긋나면 안 되고, 극적인 설정을 덧붙이지 마라.'
      : '글에 있는 내용만 옮기고, 글에 없는 항목은 지어내지 말고 빈 문자열(배열은 빈 배열)로 둬라.',
    '작가의 표현을 최대한 살리되, 각 항목에 맞는 내용만 골라 넣어라. 한 내용을 여러 항목에 중복해서 넣지 마라.',
    known.length ? `이미 앱에 있는 인물: ${known.join(', ')} (같은 사람이면 이 이름을 그대로 써라)` : '',
    `항목\n${FIELDS[kind]}`,
    `작가의 글\n"""\n${notes.trim()}\n"""`,
  ].filter(Boolean).join('\n\n');
}

export function organizeManualPrompt(kind: OrganizeKind, notes: string, fillGaps: boolean, known: string[]): string {
  return organizePrompt(kind, notes, fillGaps, known) + '\n\n답은 위 항목을 키로 쓰는 JSON 하나만 ```json 코드 블록에 넣어서 줘. 다른 말은 쓰지 마.';
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const same = (a: string, b: string) => a.replace(/\s/g, '') === b.replace(/\s/g, '');

/** keep: 이미 적힌 칸은 그대로 두고 빈 칸만 채움. 아니면 AI가 준 값(빈 값 제외)으로 바꿈 */
const pick = (old: string, nu: string, keep: boolean) => (!nu ? old : keep && old.trim() ? old : nu);

export interface MergeResult<T> { value: T; added: number; updated: number }

export function mergeWorld(w: World, raw: any, keep: boolean): MergeResult<World> {
  const r = raw?.world ?? raw;
  const value = { era: pick(w.era, str(r?.era), keep), rules: pick(w.rules, str(r?.rules), keep), limits: pick(w.limits, str(r?.limits), keep), groups: pick(w.groups, str(r?.groups), keep) };
  return { value, added: 0, updated: Object.keys(value).filter(k => (value as any)[k] !== (w as any)[k]).length };
}

export function mergeChars(chars: Character[], raw: any, keep: boolean, make: (name: string) => Character): MergeResult<Character[]> {
  const list: any[] = Array.isArray(raw?.characters) ? raw.characters : Array.isArray(raw) ? raw : [];
  let out = [...chars];
  let added = 0, updated = 0;
  // 1차: 인물 만들기/채우기
  for (const r of list) {
    const name = str(r?.name);
    if (!name) continue;
    let c = out.find(x => same(x.name, name));
    if (!c) { c = make(name); out.push(c); added++; } else updated++;
    const root = { ...c.root };
    for (const f of ROOT_FIELDS) root[f] = pick(root[f], str(r?.[f]), keep);
    const knows = [...c.state.knows];
    for (const k of strs(r?.knows)) if (!knows.includes(k)) knows.push(k);
    const next: Character = { ...c, root, arcGoal: pick(c.arcGoal, str(r?.arcGoal), keep), state: { ...c.state, mood: pick(c.state.mood, str(r?.mood), keep), knows }, updatedAt: Date.now() };
    out = out.map(x => (x.id === c!.id ? next : x));
  }
  // 2차: 관계 (상대가 앱에 있을 때만)
  for (const r of list) {
    const c = out.find(x => same(x.name, str(r?.name)));
    if (!c || !Array.isArray(r?.relations)) continue;
    const relations = [...c.relations];
    for (const rel of r.relations) {
      const o = out.find(x => same(x.name, str(rel?.other)));
      if (!o || o.id === c.id) continue;
      const i = relations.findIndex(x => x.otherId === o.id);
      const nu = { otherId: o.id, label: str(rel?.label), feeling: str(rel?.feeling) };
      if (i < 0) relations.push(nu);
      else relations[i] = { otherId: o.id, label: pick(relations[i].label, nu.label, keep), feeling: pick(relations[i].feeling, nu.feeling, keep) };
    }
    out = out.map(x => (x.id === c.id ? { ...c, relations } : x));
  }
  return { value: out, added, updated };
}

/** 사건은 늘 새로 더한다(같은 제목이 있으면 채우기). 모르는 인물 이름은 새 인물로 만든다. */
export function mergeEvents(events: StoryEvent[], chars: Character[], raw: any, keep: boolean, make: (name: string) => Character, newId: () => string): MergeResult<StoryEvent[]> & { chars: Character[]; newChars: string[] } {
  const list: any[] = Array.isArray(raw?.events) ? raw.events : Array.isArray(raw) ? raw : [];
  let out = [...events];
  let cs = [...chars];
  const newChars: string[] = [];
  let added = 0, updated = 0;
  const idOf = (name: string) => {
    if (!name) return '';
    let c = cs.find(x => same(x.name, name));
    if (!c) { c = make(name); cs.push(c); newChars.push(name); }
    return c.id;
  };
  for (const r of list) {
    const title = str(r?.title) || `사건 ${out.length + 1}`;
    const participants = [...new Set(strs(r?.participants).map(idOf).filter(Boolean))];
    const knowledge: Record<string, string> = {};
    for (const k of Array.isArray(r?.knowledge) ? r.knowledge : []) { const id = idOf(str(k?.name)); if (id && str(k?.knows)) knowledge[id] = str(k.knows); }
    const span = r?.span === 'days' ? 'days' : 'now';
    const i = out.findIndex(e => same(e.title, title));
    if (i < 0) {
      out.push({ id: newId(), title, what: str(r?.what), whenWhere: str(r?.whenWhere), participants, knowledge, span, decisive: !!r?.decisive, createdAt: Date.now() });
      added++;
    } else {
      const e = out[i];
      out[i] = {
        ...e, what: pick(e.what, str(r?.what), keep), whenWhere: pick(e.whenWhere, str(r?.whenWhere), keep),
        participants: keep && e.participants.length ? e.participants : participants.length ? participants : e.participants,
        knowledge: { ...knowledge, ...(keep ? e.knowledge : {}) }, span: keep ? e.span : span, decisive: keep ? e.decisive : !!r?.decisive,
      };
      updated++;
    }
  }
  return { value: out, added, updated, chars: cs, newChars };
}
