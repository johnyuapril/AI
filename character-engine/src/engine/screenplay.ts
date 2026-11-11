// 설정과 사건(그리고 이미 돌린 반응)을 바탕으로 시나리오 형식의 글을 쓰게 한다.
// 출력 형식은 시나리오 작업실이 .txt 로 읽을 수 있는 한국식: "S#1. 장소 - 낮", 지문, "인물 : 대사", "(괄호)".
import type { Character, Reaction, StoryEvent, World } from './types';
import { CHECK_RULES, PRINCIPLES, describeCharacter, describeWorld } from './prompts';

export const WRITER = `너는 한국 영화 시나리오 작가다. 아래 인물 설정과 사건, 그리고 "인물 엔진"이 정한 인물들의 반응을 바탕으로 시나리오를 쓴다.
가장 중요한 기준은 인물이 살아 있는 사람처럼 느껴지는 것이다. 극적인 효과를 위해 인물을 움직이지 않는다.

${PRINCIPLES.split('\n\n').slice(1).join('\n\n')}`;

export const FORMAT = `형식 (이 형식 그대로, 시나리오 본문만 써라. 앞뒤 설명, 제목, 마크다운 기호는 쓰지 마라)
S#1. 장소 - 낮
지문은 현재형으로, 카메라에 보이고 들리는 것만 쓴다. 인물의 속마음은 지문으로 설명하지 말고 행동, 표정, 머뭇거림, 말하지 않는 것으로 보여 준다.
정훈 : 대사
(작은 행동이나 말투는 대사 위 괄호 줄로)
미선 : 대사

- 씬 번호는 S#1부터 이어서 붙인다. 장소나 시간이 바뀌면 새 씬.
- 대사는 실제 사람이 하는 말처럼. 자기 감정을 설명하지 않고, 말끝을 흐리거나 딴소리를 하거나 침묵하는 것도 허용한다.
- 내레이션이나 독백(V.O.)은 작가가 원하지 않는 한 쓰지 않는다.`;

export interface ScriptInput {
  world: World; chars: Character[]; events: StoryEvent[]; reactions: Reaction[];
  threshold: number; extraRules: string[]; direction: string; startScene: number;
}

/** 사건 하나를 요청 글로 (돌린 반응이 있으면 그 선택을 붙임) */
export function eventBlock(e: StoryEvent, i: number, chars: Character[], reactions: Reaction[]): string {
  const rs = reactions.filter(r => r.eventId === e.id);
  const last = new Map<string, Reaction>();
  for (const r of rs) last.set(r.charId, r); // 같은 인물은 마지막 반응
  const name = (id: string) => chars.find(c => c.id === id)?.name ?? '?';
  const know = Object.entries(e.knowledge).filter(([, v]) => v.trim()).map(([id, v]) => `  - ${name(id)}가 아는 것: ${v}`).join('\n');
  const react = [...last.values()].map(r => [
    `  - ${name(r.charId)}`,
    `    행동: ${r.action}`,
    r.dialogue && `    대사(뼈대): ${r.dialogue}`,
    r.inner && `    속마음(대사로 말하지 말고 행동과 침묵으로): ${r.inner}`,
    r.later && `    며칠 뒤: ${r.later}`,
  ].filter(Boolean).join('\n')).join('\n');
  return [
    `${i + 1}. ${e.title}`,
    e.whenWhere && `  언제, 어디서: ${e.whenWhere}`,
    `  일어난 일: ${e.what}`,
    `  겪는 인물: ${e.participants.map(name).join(', ')}`,
    know,
    react ? `  인물 엔진이 정한 반응 (이 선택과 행동을 바꾸지 마라. 대사는 다듬고 늘려도 된다)\n${react}`
      : '  (아직 반응을 정하지 않은 사건이다. 위 인물 설정과 원칙에 따라 각 인물이 그 사람이라면 정말 할 법한 반응을 네가 정해서 써라)',
  ].filter(Boolean).join('\n');
}

export function screenplayPrompt(x: ScriptInput): string {
  const used = new Set(x.events.flatMap(e => e.participants));
  const people = x.chars.filter(c => used.has(c.id));
  const others = x.chars.filter(c => !used.has(c.id)).map(c => c.name);
  const evs = x.events.map((e, i) => eventBlock(e, i, x.chars, x.reactions)).join('\n\n');
  return [
    describeWorld(x.world),
    `등장인물\n\n${people.map(c => describeCharacter(c, x.chars, x.threshold)).join('\n\n---\n\n')}`,
    others.length ? `그 밖의 인물 (필요하면 짧게만 등장): ${others.join(', ')}` : '',
    `사건 (이 순서대로, 사이를 자연스럽게 잇는 짧은 씬은 더해도 되지만 새 사건을 만들지는 마라)\n\n${evs}`,
    `피해야 할 것\n${[...CHECK_RULES, ...x.extraRules].map(r => `- ${r}`).join('\n')}`,
    x.direction.trim() ? `작가의 요청: ${x.direction.trim()}` : '',
    FORMAT.replace('S#1부터', `S#${x.startScene}부터`).replace('S#1. 장소', `S#${x.startScene}. 장소`),
  ].filter(Boolean).join('\n\n');
}

export const screenplayManualPrompt = (x: ScriptInput) => `${WRITER}\n\n${screenplayPrompt(x)}\n\n답은 시나리오 본문만 \`\`\`text 코드 블록 하나에 넣어서 줘.`;

/** AI 답에서 시나리오 본문만: 코드 블록이 있으면 그 안, 마크다운 이스케이프와 굵게 표시 지우기 */
export function cleanScript(text: string): string {
  const block = text.match(/```(?:text|plaintext)?\s*([\s\S]*?)```/);
  let t = block ? block[1] : text;
  t = t.replace(/\\([_*\[\]#>-])/g, '$1').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/** 작업실에서 불러올 수 있게 .txt 로 */
export const scriptBlob = (title: string, body: string) => new Blob([`${title}\n\n${body}\n`], { type: 'text/plain;charset=utf-8' });
