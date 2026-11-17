// AI 없이 엔진 계산을 확인하는 간단한 시험. `npm test`
import assert from 'node:assert/strict';
import type { Character, StoryEvent } from './types';
import { acceptProposal, addPressure, canTurn, pressureOf, stageOf } from './change';
import { commit, toReaction } from './pipeline';
import { extractJson } from './ai';
import { manualPrompt } from './prompts';

const base: Character = {
  id: 'a', name: '정훈', root: { basics: '42세 과장', personality: '침착', values: '체면이 정직보다 앞선다', wounds: '아버지의 사업 실패', desires: '인정받고 싶다', coping: '말이 없어지고 혼자 운전', speech: '미안하다는 말을 못 함' },
  relations: [], state: { mood: '', knows: [], memories: [] }, pressures: [], arc: [], arcGoal: '', createdAt: 0, updatedAt: 0,
};
const ev = (decisive = false): StoryEvent => ({ id: 'e', title: '구조조정', what: '명단에 올랐다', whenWhere: '', participants: ['a'], knowledge: {}, span: 'now', decisive, createdAt: 0 });

// 압력: 한 번에 최대 3, 0 아래로 안 내려감
let c = addPressure(base, [{ field: 'values', dir: 'fall', amount: 9, note: '거짓말' }]);
assert.equal(pressureOf(c, 'values', 'fall'), 3);
c = addPressure(c, [{ field: 'values', dir: 'fall', amount: -5, note: '되돌아감' }]);
assert.equal(pressureOf(c, 'values', 'fall'), 0);

// 균열 단계
assert.equal(stageOf(2, 6), 'none'); assert.equal(stageOf(3, 6), 'crack'); assert.equal(stageOf(6, 6), 'ready');

// 전환점: 문턱 + 결정적 사건, 또는 문턱의 1.5배
c = addPressure(base, [{ field: 'values', dir: 'fall', amount: 3, note: '' }]);
c = addPressure(c, [{ field: 'values', dir: 'fall', amount: 3, note: '' }]);
assert.equal(canTurn(c, 'values', 'fall', 6, ev(false)), false);
assert.equal(canTurn(c, 'values', 'fall', 6, ev(true)), true);
c = addPressure(c, [{ field: 'values', dir: 'fall', amount: 3, note: '' }]);
assert.equal(canTurn(c, 'values', 'fall', 6, ev(false)), true);

// 한 번의 사건으로는 전환점이 안 열림 (AI가 제안해도 버림)
const raw = { action: '주차장에 앉아 있다', dialogue: '오늘 좀 늦었지?', memory: '명단 소식을 숨김', learned: ['명단에 올랐다'],
  pressure: [{ field: 'values', dir: 'fall', amount: 2, note: '아내에게 숨김' }, { field: 'nope', dir: 'fall', amount: 1 }],
  proposal: { want: true, field: 'values', dir: 'fall', after: '살아남는 게 먼저다', reason: '' } };
const r = toReaction(raw, ev(true), 'a', 1);
assert.equal(r.pressure.length, 1);
const res = commit(base, r, ev(true), 6);
assert.equal(res.reaction.proposal, undefined);
assert.equal(pressureOf(res.char, 'values', 'fall'), 2);
assert.deepEqual(res.char.state.knows, ['명단에 올랐다']);
assert.equal(res.char.state.memories.length, 1);

// 압력이 쌓인 뒤 결정적 사건이면 제안이 남고, 승인하면 뿌리가 바뀌고 아크에 남는다
const ready = addPressure(addPressure(base, [{ field: 'values', dir: 'fall', amount: 3, note: '' }]), [{ field: 'values', dir: 'fall', amount: 2, note: '' }]);
const res2 = commit(ready, toReaction(raw, ev(true), 'a', 1), ev(true), 6);
assert.ok(res2.reaction.proposal);
const turned = acceptProposal(res2.char, res2.reaction.proposal!, 'e');
assert.equal(turned.root.values, '살아남는 게 먼저다');
assert.equal(turned.arc.length, 1);
assert.equal(pressureOf(turned, 'values', 'fall'), 0);

// 붙여넣기 답 읽기 (마크다운 이스케이프 포함)
const pasted = '좋아요.\n```json\n{"action":"문을 닫는다","check":{"pass":true,"issues":[]},"pressure":[]}\n```';
assert.equal((extractJson(pasted) as any).action, '문을 닫는다');
assert.equal((extractJson('{"a\\_b":1}') as any).a_b, 1);

// 아는 것만 알게: 인물별 정보가 있으면 사건 전체 사실은 프롬프트에 안 들어감
const e2 = { ...ev(), what: '아내가 암 진단을 받았다', knowledge: { a: '아내가 병원에 다녀왔다는 것만 안다' } };
const p = manualPrompt({ world: { era: '', rules: '', limits: '', groups: '' }, char: base, all: [base], event: e2, seen: [], threshold: 6, extraRules: [] });
assert.ok(!p.includes('암 진단'));
assert.ok(p.includes('병원에 다녀왔다'));

console.log('엔진 시험 통과');

// ---- 붙여넣은 글 정리 결과 합치기 ----
import { mergeChars, mergeEvents, mergeWorld, organizeManualPrompt } from './organize';
{
  let n = 0;
  const make = (name: string): Character => ({ ...base, id: 'n' + ++n, name, root: { ...base.root, values: '', basics: '' }, relations: [], state: { mood: '', knows: [], memories: [] } });
  const existing = [{ ...base, root: { ...base.root, values: '이미 적은 가치관' } }];
  const raw = { characters: [
    { name: '정훈', values: 'AI 가치관', wounds: '', basics: '', personality: '', desires: '', coping: '', speech: '', mood: '피곤', knows: ['명단 소문'], arcGoal: '', relations: [{ other: '미선', label: '아내', feeling: '미안함' }] },
    { name: '미선', values: '가족이 먼저', wounds: '', basics: '40세', personality: '', desires: '', coping: '', speech: '', mood: '', knows: [], arcGoal: '', relations: [] },
  ] };
  const keep = mergeChars(existing, raw, true, make);
  assert.equal(keep.added, 1); assert.equal(keep.updated, 1);
  assert.equal(keep.value[0].root.values, '이미 적은 가치관');   // 빈 칸만 채우기
  assert.equal(keep.value[0].root.wounds, '아버지의 사업 실패'); // AI가 빈 값이면 그대로
  assert.equal(keep.value[0].relations[0].otherId, keep.value[1].id);
  const over = mergeChars(existing, raw, false, make);
  assert.equal(over.value[0].root.values, 'AI 가치관');        // 덮어쓰기
  const w = mergeWorld({ era: '1997년', rules: '', limits: '', groups: '' }, { era: '현대', rules: '체면', limits: '', groups: '' }, true);
  assert.equal(w.value.era, '1997년'); assert.equal(w.value.rules, '체면');
  const ev = mergeEvents([], keep.value, { events: [{ title: '구조조정', what: '명단', whenWhere: '', participants: ['정훈', '처남'], knowledge: [{ name: '정훈', knows: '소문만' }], span: 'days', decisive: true }] }, true, make, () => 'e1');
  assert.equal(ev.added, 1); assert.deepEqual(ev.newChars, ['처남']);
  assert.equal(ev.value[0].participants.length, 2); assert.equal(ev.value[0].knowledge[keep.value[0].id], '소문만');
  assert.ok(organizeManualPrompt('chars', '메모', false, ['정훈']).includes('지어내지 말고'));
  console.log('정리 합치기 시험 통과');
}

// ---- 시나리오 쓰기 ----
import { cleanScript, screenplayManualPrompt } from './screenplay';
{
  const e1: StoryEvent = { id: 'e1', title: '구조조정', what: '명단에 올랐다', whenWhere: '금요일, 사무실', participants: ['a'], knowledge: {}, span: 'now', decisive: false, createdAt: 0 };
  const e2: StoryEvent = { ...e1, id: 'e2', title: '통장', what: '아내가 잔고를 본다' };
  const r1 = { ...toReaction({ action: '주차장에 앉아 있다', dialogue: '늦었지?', inner: '어떡하지' }, e1, 'a', 1) };
  const p = screenplayManualPrompt({ world: { era: '', rules: '', limits: '', groups: '' }, chars: [base], events: [e1, e2], reactions: [r1], threshold: 6, extraRules: ['쉽게 사과하지 않는다'], direction: '건조하게', startScene: 3 });
  assert.ok(p.includes('주차장에 앉아 있다') && p.includes('바꾸지 마라'));
  assert.ok(p.includes('아직 반응을 정하지 않은 사건'));
  assert.ok(p.includes('S#3') && p.includes('건조하게') && p.includes('쉽게 사과하지'));
  assert.equal(cleanScript('여기요\n```text\nS#1. 사무실 - 낮\n\\*\\*정훈\\*\\* : 응\n```'), 'S#1. 사무실 - 낮\n정훈 : 응');
  console.log('시나리오 쓰기 시험 통과');
}

// ---- 장면 단위로 이어 쓰기 ----
import { carriedStates, parseSceneAnswer, removeTail, sceneManualPrompt, applyStatesToChars, type ScriptScene } from './sequence';
{
  const mi: Character = { ...base, id: 'b', name: '미선', relations: [{ otherId: 'a', label: '아내', feeling: '믿는다' }] };
  const jh: Character = { ...base, relations: [{ otherId: 'b', label: '남편', feeling: '미안함' }] };
  const chars = [jh, mi];
  const e1: StoryEvent = { id: 'e1', title: '구조조정', what: '명단에 올랐다', whenWhere: '금요일, 사무실', participants: ['a'], knowledge: {}, span: 'now', decisive: false, createdAt: 0 };
  const e2: StoryEvent = { ...e1, id: 'e2', title: '통장', what: '아내가 잔고를 본다', participants: ['b', 'a'] };
  const e3: StoryEvent = { ...e1, id: 'e3', title: '저녁', what: '말없이 밥을 먹는다', participants: ['a', 'b'] };

  // 답 읽기: 시나리오와 상태 JSON 을 나누고, JSON 은 글에 남지 않음 (마크다운 이스케이프 포함)
  const ans = '네, 썼어요.\n```text\nS#4. 주차장 - 밤\n정훈이 차 안에 앉아 있다.\n정훈 : 늦었지?\n```\n```json\n{"states":[{"name":"정훈","mood":"불안, 숨기고 있다","relations":[{"other":"미선","feeling":"들킬까 봐 피한다"},{"other":"처남","feeling":"?"}],"change":"명단 소식을 숨김"},{"name":"없는사람","mood":"x"}]}\n```';
  const r = parseSceneAnswer(ans, chars);
  assert.equal(r.text, 'S#4. 주차장 - 밤\n정훈이 차 안에 앉아 있다.\n정훈 : 늦었지?');
  assert.ok(!r.text.includes('states'));
  assert.equal(r.after.length, 1);
  assert.deepEqual(r.after[0].relations, [{ otherId: 'b', feeling: '들킬까 봐 피한다' }]);
  // 코드 블록 없이 붙여넣어도
  const r2 = parseSceneAnswer('S#5. 부엌 - 아침\n미선 : 이게 뭐야?\n\n{"states":[{"name":"미선","mood":"화남","relations":[{"other":"정훈","feeling":"배신감"}],"change":"잔고를 봄"}]}', chars);
  assert.equal(r2.text, 'S#5. 부엌 - 아침\n미선 : 이게 뭐야?');
  assert.equal(r2.after[0].charId, 'b');

  // 상태가 다음 장면으로 넘어가고, 뒤 장면 상태가 앞 장면을 덮어씀
  const scenes: ScriptScene[] = [
    { id: 's1', eventIds: ['e1'], note: '', text: r.text, after: r.after },
    { id: 's2', eventIds: ['e2'], note: '', text: r2.text, after: r2.after },
    { id: 's3', eventIds: ['e3'], note: '대사 없이', },
  ];
  const c3 = carriedStates(scenes, 2);
  assert.equal(c3.get('a')?.mood, '불안, 숨기고 있다');
  assert.equal(c3.get('b')?.mood, '화남');
  assert.equal(carriedStates(scenes, 0).size, 0);

  const p = sceneManualPrompt({ world: { era: '', rules: '', limits: '', groups: '' }, chars, events: [e1, e2, e3], reactions: [], threshold: 6, extraRules: [], scenes, index: 2, direction: '건조하게', startScene: 6 });
  assert.ok(p.includes('S#6'));
  assert.ok(p.includes('배신감'));                    // 앞 장면에서 바뀐 관계 감정
  assert.ok(p.includes('감정과 컨디션: 화남'));       // 인물 설명의 현재 상태가 이어진 상태로
  assert.ok(!p.includes('(믿는다)'));                 // 옛 관계 감정은 덮어씀
  assert.ok(p.includes('부엌 - 아침'));               // 바로 앞 장면 글
  assert.ok(p.includes('대사 없이') && p.includes('건조하게'));
  assert.ok(p.includes('말없이 밥을 먹는다') && !p.includes('3. 저녁') && p.includes('1. 저녁')); // 이번 장면 사건만
  assert.ok(p.includes('"states"'));

  // 다시 쓰기: 끝에 붙은 장면 글만 뺀다. 직접 고쳐서 못 찾으면 null
  const script = `S#1. 집 - 낮\n지문\n\n${r.text}`;
  assert.equal(removeTail(script + '\n', r.text), 'S#1. 집 - 낮\n지문');
  assert.equal(removeTail(script + '\n고친 줄', r.text), null);

  // 인물 설정에 반영
  const applied = applyStatesToChars(chars, c3);
  assert.equal(applied[1].state.mood, '화남');
  assert.equal(applied[1].relations[0].feeling, '배신감');
  assert.equal(applied[1].relations[0].label, '아내');
  assert.ok(applied[1].state.memories.includes('잔고를 봄'));
  console.log('장면 이어 쓰기 시험 통과');
}
