// AI에게 보내는 글. 설계서의 원칙, 반응 생성 흐름, 작위성 점검 규칙을 문장으로 옮김.
import type { Character, Reaction, StoryEvent, World } from './types';
import { DIR_LABEL, ROOT_FIELDS, ROOT_LABEL } from './types';
import { pressureOf, stageOf } from './change';

export const PRINCIPLES = `너는 시나리오 작가를 돕는 "인물 엔진"이다. 사건이 닥쳤을 때 이 인물이 "그 사람이라면 정말 그렇게 할 것 같은" 반응을 만든다. 기준은 묘사의 화려함이 아니라 행동의 당위성과 자연스러움이다.

원칙
1. 인물이 이야기보다 먼저다. 이야기를 극적으로 만들 필요는 판단 근거가 아니다.
2. 사람은 대개 덜 극적으로 반응한다. 회피, 미루기, 얼버무림, 엉뚱한 일에 화풀이하기처럼 평범하고 비효율적인 반응을 허용하고 오히려 우선한다.
3. 모든 행동에는 근거가 붙는다. 어떤 설정(성격, 가치관, 상처, 욕망, 습관, 관계, 현재 상태, 배경의 제약)이 이 행동을 만들었는지 밝힌다.
4. 인물은 자기가 아는 것만 안다. "인물이 아는 것"과 "이번 사건에서 보고 들은 것" 밖의 정보는 쓰지 않는다.
5. 사람은 변하지만 천천히 변한다. 한 번의 사건으로 성격이 뒤집히지 않는다. 변화는 쌓인 압력으로만 일어나고, 변한 뒤에도 스트레스가 크면 옛 방식이 가끔 나온다.
6. 말은 사람의 말이어야 한다. 자기 감정을 상담사처럼 분석해서 말하지 않는다. 속마음과 겉으로 드러나는 말과 행동은 다를 수 있다.

반응은 이 순서로 생각한다.
- 인지: 인물이 아는 정보만으로 이 사건을 어떻게 받아들이는가. 오해와 놓친 점도 여기서 생긴다.
- 감정: 상처, 욕망, 현재 컨디션에 비추어 처음 올라오는 감정과 그것을 누르는 감정.
- 판단: 가치관, 관계, 배경의 제약 안에서 떠올리는 선택지 2~3개와 그중 하나를 고르는 이유.
- 행동과 말: 습관과 말투에 맞는 실제 행동과 대사.`;

export const CHECK_RULES = [
  '이 행동의 근거가 인물 설정에 있는가? (근거 없이 갑자기 용기를 내면 안 됨)',
  '인물이 모르는 정보를 쓰고 있지 않은가?',
  '이야기를 위해 편하게 움직이고 있지 않은가? (갈등을 만들려고 필요 없는 거짓말을 하는 등)',
  '감정의 세기가 사건의 무게와 맞는가? (사소한 일에 오열, 큰 일에 너무 담담함)',
  '변화가 너무 빠르지 않은가? (한 번의 대화로 오래된 상처가 치유됨)',
  '말이 너무 정확하지 않은가? (자기 감정을 분석해서 말함)',
  '배경의 제약을 지키는가? (그 시대에 없는 수단이나 사고방식)',
];

export const PRESSURE_GUIDE = `성격 변화 압력
- 이번 반응의 선택이 뿌리(가치관, 상처, 대처 방식 등)를 따랐으면 압력은 거의 없다. 뿌리를 거슬렀거나, 뿌리를 흔드는 일을 겪었을 때만 압력이 생긴다.
- 방향: growth(성장: 상처를 마주함, 욕망이 성숙함, 닫힌 관계가 열림, 대가가 따름), fall(타락: 선을 넘음, 합리화, 고립), shift(방향 없는 변화).
- amount는 -3~3. 대부분의 사건은 0~1이다. 2~3은 큰 사건에만. 쌓인 방향을 거스르는 선택(옛 방식으로 돌아감)은 음수.
- 타락은 첫 번째엔 죄책감이 크고, 두 번째엔 합리화하고, 세 번째엔 당연해진다. 성장에는 반드시 대가가 따른다. 인물 자신은 변화를 늦게 알아차리거나 부정한다.
- "균열" 단계인 항목은 아직 뿌리가 바뀌지 않았지만 말투나 행동에 작은 균열이 보이기 시작한다. 반응에 그 균열을 조금 드러내라.
- "전환점 가능" 항목이 있을 때만, 그리고 이번 사건이 정말 그 변화를 결정짓는다고 판단될 때만 proposal.want를 true로 하고 바뀐 뒤의 뿌리 문장(after)을 쓴다. 아니면 want는 false.`;

const line = (label: string, v: string) => (v?.trim() ? `- ${label}: ${v.trim()}` : '');

export function describeWorld(w: World): string {
  const s = [line('시대와 장소', w.era), line('사회적 규칙', w.rules), line('물리적 제약', w.limits), line('주변 인물과 집단', w.groups)].filter(Boolean);
  return s.length ? `배경\n${s.join('\n')}` : '배경: (따로 정하지 않음. 현대 한국으로 본다)';
}

export function describeCharacter(c: Character, all: Character[], threshold: number): string {
  const root = ROOT_FIELDS.map(f => line(ROOT_LABEL[f], c.root[f])).filter(Boolean).join('\n');
  const rel = c.relations.map(r => {
    const o = all.find(x => x.id === r.otherId);
    return o ? `- ${o.name}: ${r.label}${r.feeling ? ` (${r.feeling})` : ''}` : '';
  }).filter(Boolean).join('\n');
  const press = c.pressures.filter(p => p.amount > 0).map(p => {
    const st = stageOf(p.amount, threshold);
    const tag = st === 'ready' ? '전환점 가능' : st === 'crack' ? '균열' : '쌓이는 중';
    return `- ${ROOT_LABEL[p.field]} / ${DIR_LABEL[p.dir]}(${p.dir}): ${p.amount}/${threshold} [${tag}] ${p.notes.slice(-3).join(' · ')}`;
  }).join('\n');
  const arc = c.arc.map(a => `- ${ROOT_LABEL[a.field]} ${DIR_LABEL[a.dir]}: "${a.before}" → "${a.after}" (${a.reason})`).join('\n');
  return [
    `인물: ${c.name}`,
    `뿌리\n${root || '- (적힌 것 없음)'}`,
    rel && `관계\n${rel}`,
    `현재 상태\n- 감정과 컨디션: ${c.state.mood || '(보통)'}`,
    c.state.knows.length ? `인물이 아는 것과 믿고 있는 것\n${c.state.knows.map(k => `- ${k}`).join('\n')}` : '',
    c.state.memories.length ? `지금까지 겪은 일 (오래된 것부터)\n${c.state.memories.slice(-15).map(k => `- ${k}`).join('\n')}` : '',
    press && `쌓인 변화 압력\n${press}`,
    arc && `지금까지의 성격 변화 (변한 뒤에도 스트레스가 크면 옛 방식이 가끔 나온다)\n${arc}`,
    c.arcGoal.trim() ? `작가가 생각하는 목표 변화: ${c.arcGoal.trim()} (참고만 하고, 근거가 모자라면 억지로 따르지 않는다)` : '',
  ].filter(Boolean).join('\n\n');
}

export interface SeenAction { name: string; action: string; dialogue: string }

export function describeEvent(ev: StoryEvent, c: Character, seen: SeenAction[]): string {
  const knows = ev.knowledge[c.id]?.trim();
  return [
    `사건: ${ev.title}`,
    line('언제, 어디서', ev.whenWhere),
    knows ? `${c.name}가 이번에 보고 들은 것 (이것만 안다)\n${knows}` : `무슨 일이 일어났나 (${c.name}도 이것을 다 안다)\n${ev.what}`,
    seen.length ? `이번 사건에서 ${c.name} 앞에서 다른 인물이 한 행동과 말 (속마음은 모른다)\n${seen.map(s => `- ${s.name}: ${s.action}${s.dialogue ? ` "${s.dialogue}"` : ''}`).join('\n')}` : '',
    ev.span === 'days' ? '즉각 반응에 더해, 며칠 뒤 이 인물에게 남는 변화(later)도 써라.' : '즉각 반응만 쓴다. later는 빈 문자열.',
    ev.decisive ? '작가가 이 사건을 "결정적 사건"으로 표시했다.' : '',
  ].filter(Boolean).join('\n\n');
}

export function rulesBlock(extra: string[]): string {
  const all = [...CHECK_RULES, ...extra.map(e => `${e} (작가가 어색하다고 표시한 사례에서 나온 규칙)`)];
  return `작위성 점검 질문\n${all.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
}

const enumFields = [...ROOT_FIELDS];
const deltaSchema = {
  type: 'object', additionalProperties: false, required: ['field', 'dir', 'amount', 'note'],
  properties: {
    field: { type: 'string', enum: enumFields },
    dir: { type: 'string', enum: ['growth', 'fall', 'shift'] },
    amount: { type: 'integer' },
    note: { type: 'string' },
  },
};

/** 반응 JSON 스키마 (구조화된 출력) */
export const REACTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['perception', 'emotion', 'options', 'choiceWhy', 'inner', 'action', 'dialogue', 'reasons', 'later', 'moodAfter', 'learned', 'memory', 'pressure', 'proposal'],
  properties: {
    perception: { type: 'string', description: '인지: 인물이 이 사건을 어떻게 받아들였나' },
    emotion: { type: 'string', description: '처음 올라온 감정과 그것을 누르는 감정' },
    options: { type: 'array', items: { type: 'string' }, description: '떠올린 선택지 2~3개' },
    choiceWhy: { type: 'string', description: '그중 하나를 고른 이유' },
    inner: { type: 'string', description: '속마음 (인물의 말투로, 1인칭 독백)' },
    action: { type: 'string', description: '실제 행동' },
    dialogue: { type: 'string', description: '대사 (말이 없으면 빈 문자열)' },
    reasons: { type: 'array', items: { type: 'string' }, description: '이 행동을 만든 설정들' },
    later: { type: 'string' },
    moodAfter: { type: 'string', description: '사건 뒤의 감정과 컨디션' },
    learned: { type: 'array', items: { type: 'string' }, description: '새로 알게 된 사실이나 새로 생긴 오해' },
    memory: { type: 'string', description: '기억으로 남길 한 줄' },
    pressure: { type: 'array', items: deltaSchema },
    proposal: {
      type: 'object', additionalProperties: false, required: ['want', 'field', 'dir', 'after', 'reason'],
      properties: {
        want: { type: 'boolean' },
        field: { type: 'string', enum: enumFields },
        dir: { type: 'string', enum: ['growth', 'fall', 'shift'] },
        after: { type: 'string' },
        reason: { type: 'string' },
      },
    },
  },
} as const;

export const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['pass', 'issues'],
  properties: { pass: { type: 'boolean' }, issues: { type: 'array', items: { type: 'string' } } },
} as const;

export interface Ctx { world: World; char: Character; all: Character[]; event: StoryEvent; seen: SeenAction[]; threshold: number; extraRules: string[] }

export function reactionPrompt(x: Ctx, feedback?: string[]): string {
  return [
    describeWorld(x.world),
    describeCharacter(x.char, x.all, x.threshold),
    describeEvent(x.event, x.char, x.seen),
    PRESSURE_GUIDE,
    rulesBlock(x.extraRules),
    feedback?.length ? `앞서 만든 반응이 점검에서 걸렸다. 아래 문제를 고쳐서 처음부터 다시 판단해라.\n${feedback.map(f => `- ${f}`).join('\n')}` : '',
    `${x.char.name}의 반응을 만들어라. 위 점검 질문을 스스로 통과하는 반응이어야 한다.`,
  ].filter(Boolean).join('\n\n');
}

export const REVIEWER = `너는 시나리오 인물 반응의 "검수자"다. 작가 입장에서, 이 반응이 작위적으로 느껴지는지 엄격하게 본다. 극적이라서 좋은 게 아니라 그 사람이라면 정말 그렇게 할 것 같은지가 기준이다. 하나라도 분명히 걸리면 pass는 false이고, issues에 무엇이 왜 걸렸는지 짧게 쓴다. 사소한 취향 차이는 문제로 삼지 않는다.`;

export function reviewPrompt(x: Ctx, r: Pick<Reaction, 'perception' | 'emotion' | 'choiceWhy' | 'inner' | 'action' | 'dialogue' | 'reasons' | 'later'>): string {
  return [
    describeWorld(x.world),
    describeCharacter(x.char, x.all, x.threshold),
    describeEvent(x.event, x.char, x.seen),
    rulesBlock(x.extraRules),
    `검수할 반응\n${JSON.stringify(r, null, 2)}`,
    '위 점검 질문으로 이 반응을 검수해라.',
  ].join('\n\n');
}

/** 복사 → 외부 AI → 붙여넣기 방식. 한 번에 반응과 자체 점검까지 받는다. */
export function manualPrompt(x: Ctx): string {
  const keys = Object.keys(REACTION_SCHEMA.properties).join(', ');
  return [
    PRINCIPLES,
    reactionPrompt(x),
    `답은 아래 형식의 JSON 하나만 \`\`\`json 코드 블록에 넣어서 줘. 다른 말은 쓰지 마.
키: ${keys}, check
- options, reasons, learned: 문자열 배열
- pressure: [{"field": 뿌리 항목, "dir": "growth"|"fall"|"shift", "amount": -3~3 정수, "note": 이유}]
- field 값: ${ROOT_FIELDS.map(f => `${f}(${ROOT_LABEL[f]})`).join(', ')}
- proposal: {"want": true|false, "field", "dir", "after": 바뀐 뒤 뿌리 문장, "reason"}
- check: {"pass": true|false, "issues": [점검 질문에 걸린 것]} — 스스로 점검한 결과. 걸리면 고친 반응을 내고 pass는 true로.`,
  ].join('\n\n');
}

export function arcPrompt(world: World, c: Character, all: Character[], threshold: number): string {
  return [
    describeWorld(world),
    describeCharacter(c, all, threshold),
    `작가가 정한 목표 변화: ${c.arcGoal}`,
    `지금까지의 사건과 반응, 쌓인 압력이 이 목표 변화를 충분히 정당화하는지 판단해라.
- justified: 지금 바로 그 변화가 일어나도 자연스러운가
- progress: 지금 어디쯤 와 있는지 한두 문장
- missing: 부족하다면 어떤 사건이나 만남이 더 필요한지 구체적인 제안 2~4개 (이미 충분하면 빈 배열)
- risk: 목표대로 억지로 바꾸면 어디가 작위적으로 보일지 한 문장
근거가 모자라면 솔직하게 "아직 이 사람은 안 바뀐다"고 말해라.`,
  ].join('\n\n');
}

export const ARC_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['justified', 'progress', 'missing', 'risk'],
  properties: { justified: { type: 'boolean' }, progress: { type: 'string' }, missing: { type: 'array', items: { type: 'string' } }, risk: { type: 'string' } },
} as const;
