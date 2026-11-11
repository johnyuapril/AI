// 장면 단위로 이어 쓰기: 사건 여러 개를 장면 묶음으로 순서대로 나누고, 한 장면씩 쓴다.
// 장면을 하나 쓸 때마다 AI가 "장면이 끝났을 때 인물 상태(감정, 관계)"를 함께 돌려주고,
// 다음 장면은 그 상태에서 시작한다. 시나리오 글(.txt)은 예전 형식 그대로이고 상태는 글에 섞이지 않는다.
import type { Character, Reaction, StoryEvent, World } from './types';
import { CHECK_RULES, describeCharacter, describeWorld } from './prompts';
import { WRITER, cleanScript, eventBlock, FORMAT } from './screenplay';

/** 장면이 끝났을 때 인물 하나의 상태 */
export interface SceneCharState {
  charId: string;
  mood: string;                                   // 감정과 컨디션
  relations: { otherId: string; feeling: string }[]; // 이 인물 쪽에서 본 관계 감정 (바뀐 것만이 아니라 지금 상태)
  change: string;                                 // 이번 장면에서 달라진 것 한 줄
}

/** 장면 묶음 하나: 순서대로 쓸 사건들 */
export interface ScriptScene {
  id: string;
  eventIds: string[];
  note: string;            // 이 장면에 대한 작가 요청
  text?: string;           // 쓴 시나리오 글 (Book.script 에 이어 붙인 부분)
  after?: SceneCharState[]; // 장면이 끝났을 때 인물 상태
}

/** i 번째 장면을 시작할 때의 인물 상태: 앞 장면들의 상태를 차례로 덮어쓴 것 */
export function carriedStates(scenes: ScriptScene[], i: number): Map<string, SceneCharState> {
  const m = new Map<string, SceneCharState>();
  for (const s of scenes.slice(0, i)) for (const st of s.after ?? []) m.set(st.charId, st);
  return m;
}

/** 이어진 상태를 인물 설정에 덮어쓴 복사본 (감정, 관계 감정. 앞 장면에서 달라진 것은 기억에 더함) */
export function withCarried(c: Character, st: SceneCharState | undefined, all: Character[]): Character {
  if (!st) return c;
  const relations = c.relations.map(r => {
    const n = st.relations.find(x => x.otherId === r.otherId);
    return n?.feeling.trim() ? { ...r, feeling: n.feeling.trim() } : r;
  });
  for (const n of st.relations) {
    if (n.feeling.trim() && !relations.some(r => r.otherId === n.otherId) && all.some(o => o.id === n.otherId))
      relations.push({ otherId: n.otherId, label: '', feeling: n.feeling.trim() });
  }
  return {
    ...c, relations,
    state: { ...c.state, mood: st.mood.trim() || c.state.mood, memories: st.change.trim() ? [...c.state.memories, `(앞 장면) ${st.change.trim()}`] : c.state.memories },
  };
}

export interface SceneInput {
  world: World; chars: Character[]; events: StoryEvent[]; reactions: Reaction[];
  threshold: number; extraRules: string[];
  scenes: ScriptScene[]; index: number; // 지금 쓸 장면
  direction: string;                    // 전체 작가 요청
  startScene: number;                   // 이번 장면의 첫 S# 번호
}

const lastNo = (t: string) => { const m = [...t.matchAll(/^S\s*#\s*(\d+)/gm)].pop(); return m ? Number(m[1]) : 0; };
export const lastSceneNo = lastNo;

export function scenePrompt(x: SceneInput): string {
  const scene = x.scenes[x.index];
  const evs = scene.eventIds.map(id => x.events.find(e => e.id === id)).filter((e): e is StoryEvent => !!e);
  const carried = carriedStates(x.scenes, x.index);
  const name = (id: string) => x.chars.find(c => c.id === id)?.name ?? '?';
  const inScene = new Set(evs.flatMap(e => e.participants));
  const people = x.chars.filter(c => inScene.has(c.id)).map(c => withCarried(c, carried.get(c.id), x.chars));
  const others = x.chars.filter(c => !inScene.has(c.id)).map(c => c.name);

  const before = x.scenes.slice(0, x.index).filter(s => s.text?.trim());
  const prev = before[before.length - 1];
  const earlier = before.slice(0, -1).map(s => {
    const titles = s.eventIds.map(id => x.events.find(e => e.id === id)?.title).filter(Boolean).join(', ');
    const nums = [...(s.text ?? '').matchAll(/^S\s*#\s*(\d+)/gm)].map(m => m[1]);
    return `- ${nums.length ? `S#${nums[0]}${nums.length > 1 ? `~${nums[nums.length - 1]}` : ''}` : '장면'}: ${titles}${(s.after ?? []).filter(a => a.change.trim()).map(a => ` / ${name(a.charId)}: ${a.change.trim()}`).join('')}`;
  }).join('\n');
  const prevText = prev?.text ? (prev.text.length > 6000 ? '…(앞부분 생략)\n' + prev.text.slice(-6000) : prev.text) : '';
  const state = [...carried.values()].filter(s => x.chars.some(c => c.id === s.charId)).map(s => [
    `- ${name(s.charId)}: ${s.mood || '(적힌 것 없음)'}`,
    ...s.relations.filter(r => r.feeling.trim()).map(r => `  · ${name(r.otherId)}에게: ${r.feeling.trim()}`),
    s.change.trim() ? `  · 앞 장면에서 달라진 것: ${s.change.trim()}` : '',
  ].filter(Boolean).join('\n')).join('\n');

  const names = people.map(c => c.name).join(', ');
  return [
    describeWorld(x.world),
    `이번 장면에 나오는 인물 (현재 상태와 관계는 앞 장면이 끝났을 때 기준)\n\n${people.map(c => describeCharacter(c, x.chars, x.threshold)).join('\n\n---\n\n')}`,
    others.length ? `그 밖의 인물 (필요하면 짧게만 등장): ${others.join(', ')}` : '',
    earlier && `지금까지의 흐름 (앞 장면들)\n${earlier}`,
    prevText && `바로 앞 장면 (이 장면에 바로 이어진다. 다시 쓰지 말고 이어서 써라)\n${prevText}`,
    state && `앞 장면이 끝났을 때 인물 상태 (이 감정과 관계에서 시작한다. 갑자기 풀리거나 잊지 않는다. 시간이 흘렀으면 그만큼만 누그러진다)\n${state}`,
    `이번 장면에 담을 사건 (이 순서대로. 장소나 시간이 바뀌면 S#을 나눠도 되지만 새 사건을 만들지는 마라)\n\n${evs.map((e, i) => eventBlock(e, i, x.chars, x.reactions)).join('\n\n')}`,
    `피해야 할 것\n${[...CHECK_RULES, ...x.extraRules].map(r => `- ${r}`).join('\n')}`,
    x.direction.trim() ? `작가의 요청 (전체): ${x.direction.trim()}` : '',
    scene.note.trim() ? `작가의 요청 (이 장면): ${scene.note.trim()}` : '',
    FORMAT.replace('S#1부터', `S#${x.startScene}부터`).replace('S#1. 장소', `S#${x.startScene}. 장소`),
    `장면 끝의 인물 상태
시나리오를 다 쓴 뒤, 이 장면이 끝났을 때 이번 장면에 나온 인물(${names})의 상태를 JSON으로 따로 준다. 다음 장면은 이 상태에서 시작한다.
- mood: 장면이 끝난 순간의 감정과 컨디션 (한두 문장, 겉으로 드러난 것과 속을 함께)
- relations: 이 인물이 이번 장면에 나온 다른 인물에게 지금 느끼는 감정 (바뀌지 않았어도 지금 상태를 쓴다)
- change: 이번 장면에서 이 인물에게 달라진 것 한 줄 (달라진 게 없으면 빈 칸)
변화는 장면에서 실제로 일어난 일만큼만. 한 장면으로 관계가 뒤집히지 않는다.`,
  ].filter(Boolean).join('\n\n');
}

const STATE_FORMAT = `답은 두 부분으로 줘.
1) 시나리오 본문만 \`\`\`text 코드 블록 하나에
2) 그 뒤에 인물 상태를 \`\`\`json 코드 블록 하나에, 이 모양으로:
{"states":[{"name":"인물 이름","mood":"...","relations":[{"other":"다른 인물 이름","feeling":"..."}],"change":"..."}]}`;

export const sceneApiPrompt = (x: SceneInput) => `${scenePrompt(x)}\n\n${STATE_FORMAT}`;
export const sceneManualPrompt = (x: SceneInput) => `${WRITER}\n\n${sceneApiPrompt(x)}`;

/** AI 답에서 시나리오 글과 인물 상태를 나눈다. 상태 JSON은 글에 섞이지 않게 뺀다. */
export function parseSceneAnswer(answer: string, chars: Character[]): { text: string; after: SceneCharState[] } {
  const t = answer.replace(/\\([_*\[\]#>{}-])/g, '$1');
  const blocks = [...t.matchAll(/```([a-zA-Z]*)\s*\n?([\s\S]*?)```/g)];
  const isJson = (lang: string, body: string) => lang.toLowerCase() === 'json' || /^\s*[{[]/.test(body);
  let raw: any = null;
  const jb = blocks.find(b => isJson(b[1], b[2]));
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
  if (jb) raw = tryParse(jb[2]);
  let rest = t;
  if (jb) rest = rest.replace(jb[0], '');
  if (!raw) { // 코드 블록 없이 {"states": ...} 만 붙어 온 경우
    const i = rest.search(/\{\s*"states"/);
    if (i >= 0) { const j = rest.lastIndexOf('}'); raw = tryParse(rest.slice(i, j + 1)); if (raw) rest = rest.slice(0, i) + rest.slice(j + 1); }
  }
  const sb = [...rest.matchAll(/```([a-zA-Z]*)\s*\n?([\s\S]*?)```/g)].find(b => /S\s*#\s*\d/.test(b[2]));
  const text = cleanScript(sb ? sb[2] : rest.replace(/```[a-zA-Z]*/g, ''));
  const byName = (n: unknown) => { const s = String(n ?? '').trim(); return chars.find(c => c.name === s) ?? chars.find(c => s && (c.name.includes(s) || s.includes(c.name))); };
  const list: any[] = Array.isArray(raw?.states) ? raw.states : Array.isArray(raw) ? raw : [];
  const after: SceneCharState[] = [];
  for (const s of list) {
    const c = byName(s?.name);
    if (!c || after.some(a => a.charId === c.id)) continue;
    const relations = (Array.isArray(s?.relations) ? s.relations : []).map((r: any) => ({ o: byName(r?.other), f: String(r?.feeling ?? '').trim() }))
      .filter((r: any) => r.o && r.o.id !== c.id && r.f).map((r: any) => ({ otherId: r.o.id, feeling: r.f }));
    after.push({ charId: c.id, mood: String(s?.mood ?? '').trim(), relations, change: String(s?.change ?? '').trim() });
  }
  return { text, after };
}

/** 마지막 장면을 다시 쓸 때 Book.script 에서 그 장면 글을 뺀다. 글을 직접 고쳐서 찾을 수 없으면 null */
export function removeTail(script: string, part: string): string | null {
  const s = script.trimEnd(), p = part.trim();
  if (!p) return script;
  if (!s.endsWith(p)) return null;
  return s.slice(0, s.length - p.length).trimEnd();
}

/** 마지막 상태를 인물 설정(현재 감정, 관계 감정)에 반영 */
export function applyStatesToChars(chars: Character[], states: Map<string, SceneCharState>): Character[] {
  return chars.map(c => {
    const st = states.get(c.id);
    if (!st) return c;
    const n = withCarried(c, st, chars);
    return { ...c, relations: n.relations, state: { ...c.state, mood: n.state.mood, memories: st.change.trim() ? [...c.state.memories, st.change.trim()] : c.state.memories }, updatedAt: Date.now() };
  });
}
