// Claude API 바로 부르기 시험: 가짜 클라이언트로 실제 요금 없이 확인한다. `npm test`
// 오류를 쉬운 말로 바꾸기, 다시 시도 가능 여부, 멈추기, 받은 글자 수, 끊긴 답, 사건 돌리기를 걸린 인물부터 이어 하기.
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import type { Character, Settings, StoryEvent } from './types';
import { AiError, DEFAULT_MODEL, askJson, askText, setClientFactory, toAiError } from './ai';
import { REVIEWER } from './prompts';
import { resumeOf, runEvent } from './pipeline';

type Reply = { text?: string; stop?: string; throws?: unknown };
interface Call { model: string; system: string; user: string; signal?: AbortSignal }

/** 정해 둔 답을 차례로 돌려주는 가짜 클라이언트. reply 가 함수면 요청을 보고 답을 정한다. */
function fake(reply: Reply[] | ((c: Call) => Reply)) {
  const calls: Call[] = [];
  const queue = Array.isArray(reply) ? [...reply] : null;
  setClientFactory(() => ({
    beta: {
      messages: {
        stream: (body: any, opts?: { signal?: AbortSignal }) => {
          const call: Call = { model: body.model, system: body.system, user: body.messages[0].content, signal: opts?.signal };
          calls.push(call);
          const r = queue ? queue.shift()! : (reply as (c: Call) => Reply)(call);
          const listeners: ((d: string) => void)[] = [];
          return {
            on(ev: string, fn: (d: string) => void) { if (ev === 'text') listeners.push(fn); return this; },
            async finalMessage() {
              if (opts?.signal?.aborted) throw new Anthropic.APIUserAbortError();
              if (r.throws) throw r.throws;
              const t = r.text ?? '';
              for (let i = 0; i < t.length; i += 10) listeners.forEach(f => f(t.slice(i, i + 10)));
              return { stop_reason: r.stop ?? 'end_turn', content: [{ type: 'text', text: t }] };
            },
          };
        },
      },
    },
  }) as any);
  return calls;
}

const apiErr = (status: number, message = 'x', headers: Record<string, string> = {}) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type: status === 529 ? 'overloaded_error' : 'api_error', message } }, message, new Headers(headers));

const fails = async (p: Promise<unknown>, kind: string, retryable?: boolean) => {
  try { await p; } catch (e) {
    assert.ok(e instanceof AiError, `AiError 가 아님: ${e}`);
    assert.equal(e.kind, kind, e.message);
    if (retryable !== undefined) assert.equal(e.retryable, retryable, kind);
    return e;
  }
  assert.fail(`${kind} 오류가 나야 함`);
};

// ---- SDK 오류 → 쉬운 말 ----
{
  const k = (e: unknown) => toAiError(e).kind;
  assert.equal(k(apiErr(401)), 'key');
  assert.equal(k(apiErr(403)), 'model');
  assert.equal(k(apiErr(404)), 'model');
  assert.equal(k(apiErr(429)), 'rate');
  assert.equal(k(apiErr(529)), 'busy');
  assert.equal(k(apiErr(500)), 'server');
  assert.equal(k(apiErr(400, 'Your credit balance is too low')), 'bad');
  assert.ok(toAiError(apiErr(400, 'Your credit balance is too low')).message.includes('크레딧'));
  assert.equal(k(new Anthropic.APIConnectionError({ message: 'down' })), 'network');
  assert.equal(k(new Anthropic.APIConnectionTimeoutError()), 'timeout');
  assert.equal(k(new Anthropic.APIUserAbortError()), 'aborted');
  assert.equal(k(new TypeError('Failed to fetch')), 'network');
  assert.ok(toAiError(apiErr(429, 'slow', { 'retry-after': '20' })).message.includes('20초'));
  // 다시 시도 버튼: 잠깐의 문제만. 키·모델은 설정으로 보냄
  assert.equal(toAiError(apiErr(529)).retryable, true);
  assert.equal(toAiError(apiErr(401)).retryable, false);
  assert.equal(toAiError(apiErr(401)).needsSettings, true);
  assert.equal(toAiError(apiErr(400)).needsSettings, false);
  console.log('API 오류 문구 시험 통과');
}

const run = async () => {
  // ---- 한 번 부르기 ----
  {
    await fails(askText('  ', DEFAULT_MODEL, 's', 'u'), 'nokey', false);

    let calls = fake([{ text: '{"a":1}' }]);
    let seen = 0;
    assert.deepEqual(await askJson('k', '', 's', 'u', {}, { onText: n => { seen = n; } }), { a: 1 });
    assert.equal(calls[0].model, DEFAULT_MODEL, '모델 칸이 비면 기본 모델');
    assert.equal(seen, 7, '받은 글자 수');

    calls = fake([{ text: '{"a":' }, { text: '{"a":2}' }]);
    assert.deepEqual(await askJson('k', 'm', 's', 'u', {}), { a: 2 }, '읽지 못한 JSON 은 한 번 조용히 다시');
    assert.equal(calls.length, 2);
    fake([{ text: 'x' }, { text: 'y' }]);
    await fails(askJson('k', 'm', 's', 'u', {}), 'parse', true);

    fake([{ text: '', stop: 'refusal' }]);
    await fails(askText('k', 'm', 's', 'u'), 'refusal', false);
    fake([{ text: 'S#1. 길', stop: 'max_tokens' }]);
    await fails(askText('k', 'm', 's', 'u'), 'cut', true);
    fake([{ text: '  ' }]);
    await fails(askText('k', 'm', 's', 'u'), 'parse', true);
    fake([{ throws: apiErr(529) }]);
    await fails(askText('k', 'm', 's', 'u'), 'busy', true);

    const c = new AbortController(); c.abort();
    calls = fake([{ text: 'S#1' }]);
    await fails(askText('k', 'm', 's', 'u', { signal: c.signal }), 'aborted', false);
    assert.equal(calls.length, 0, '이미 멈췄으면 부르지 않음');
    const c2 = new AbortController();
    calls = fake(call => { c2.abort(); return { text: 'S#1' }; });
    await fails(askText('k', 'm', 's', 'u', { signal: c2.signal }), 'aborted');
    assert.equal(calls[0].signal, c2.signal, '멈추기 신호를 SDK에 넘김');
    console.log('API 한 번 부르기 시험 통과');
  }

  // ---- 사건 돌리기: 두 번째 인물에서 실패 → 다시 시도는 두 번째 인물부터 ----
  {
    const mk = (id: string, name: string): Character => ({
      id, name, root: { basics: '', personality: '', values: '', wounds: '', desires: '', coping: '', speech: '' },
      relations: [], state: { mood: '', knows: [], memories: [] }, pressures: [], arc: [], arcGoal: '', createdAt: 0, updatedAt: 0,
    });
    const chars = [mk('a', '정훈'), mk('b', '미선')];
    const ev: StoryEvent = { id: 'e', title: '통장', what: '잔고가 비었다', whenWhere: '', participants: ['a', 'b'], knowledge: {}, span: 'now', decisive: false, createdAt: 0 };
    const s: Settings = { mode: 'api', apiKey: 'k', model: 'm', threshold: 6, extraRules: [] };
    const reaction = (who: string) => ({ text: JSON.stringify({ perception: '', emotion: '', options: [], choiceWhy: '', inner: '', action: `${who}이 통장을 덮는다`, dialogue: '', reasons: [], moodAfter: '', learned: [], memory: '', pressure: [], proposal: { want: false } }) });
    const pass = { text: '{"pass":true,"issues":[]}' };

    let n = 0; // 반응 요청 차례: 1번째 정훈 성공, 2번째 미선은 서버가 붐빔
    let calls = fake(c => (c.system === REVIEWER ? pass : ++n === 2 ? { throws: apiErr(529) } : reaction('정훈')));
    const done: any[] = [];
    const stages: string[] = [];
    await fails(runEvent(s, { era: '', rules: '', limits: '', groups: '' }, chars, ev, t => stages.push(t), r => done.push(r)), 'busy', true);
    assert.equal(done.length, 1, '첫 인물 반응은 남음');
    assert.equal(done[0].reaction.charId, 'a');
    assert.ok(stages[0].startsWith('1/2 · 정훈'), stages[0]);

    const resume = resumeOf(ev, chars, [done[0].reaction]);
    assert.deepEqual(resume.doneIds, ['a']);
    calls = fake(c => (c.system === REVIEWER ? pass : reaction('미선')));
    const again = await runEvent(s, { era: '', rules: '', limits: '', groups: '' }, chars, ev, undefined, undefined, {}, resume);
    assert.equal(again.length, 1, '끝난 인물은 다시 부르지 않음');
    assert.equal(again[0].reaction.charId, 'b');
    assert.ok(calls[0].user.includes('정훈이 통장을 덮는다'), '뒤 인물은 앞 인물의 행동을 그대로 봄');
    console.log('사건 이어서 다시 하기 시험 통과');
  }
  setClientFactory(null);
};

run().catch(e => { console.error(e); process.exit(1); });
