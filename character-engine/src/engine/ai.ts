// Claude API 호출. 개인용 도구라서 사용자가 설정에 넣은 자기 API 키로 브라우저(기기)에서 바로 부른다.
// 배포용으로 바꿀 때는 키를 서버로 옮겨야 한다 (dangerouslyAllowBrowser 를 끄고 서버를 거치게).
import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_MODEL = 'claude-opus-5-5';

/**
 * 사용자에게 보여 줄 AI 오류.
 * kind 로 화면이 '다시 시도' 버튼을 보일지(retryable), '설정 탭'으로 보낼지(settings) 정한다.
 */
export type AiErrorKind = 'nokey' | 'key' | 'model' | 'bad' | 'rate' | 'busy' | 'server' | 'network' | 'timeout' | 'refusal' | 'cut' | 'parse' | 'aborted';
const RETRYABLE: AiErrorKind[] = ['rate', 'busy', 'server', 'network', 'timeout', 'cut', 'parse'];
const SETTINGS: AiErrorKind[] = ['nokey', 'key', 'model'];

export class AiError extends Error {
  kind: AiErrorKind;
  constructor(message: string, kind: AiErrorKind = 'parse') { super(message); this.kind = kind; this.name = 'AiError'; }
  get retryable() { return RETRYABLE.includes(this.kind); }
  /** 설정 탭에서 키나 모델을 고쳐야 하는 오류 */
  get needsSettings() { return SETTINGS.includes(this.kind); }
}

/** 호출마다 넘기는 선택 사항: 멈추기, 받은 글자 수(진행 표시) */
export interface AskOpts { signal?: AbortSignal; onText?: (chars: number) => void }

/** 시험에서 가짜 클라이언트로 바꿀 수 있게 */
type Client = Pick<Anthropic, 'beta'>;
let makeClient = (apiKey: string): Client => new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 3 });
export function setClientFactory(f: ((apiKey: string) => Client) | null) {
  makeClient = f ?? ((apiKey: string) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 3 }));
}

export async function askJson<T>(apiKey: string, model: string, system: string, user: string, schema: Record<string, unknown>, opts: AskOpts = {}): Promise<T> {
  // 구조화된 출력이라 거의 없지만, 읽지 못하면 한 번만 조용히 다시 받는다
  for (let i = 0; ; i++) {
    const text = await ask(apiKey, model, system, user, schema, 16000, opts);
    try { return JSON.parse(text) as T; } catch {
      if (i >= 1) throw new AiError('AI 답을 읽지 못했어요. 다시 시도해 주세요.', 'parse');
    }
  }
}

/** 긴 글(시나리오) 받기 */
export function askText(apiKey: string, model: string, system: string, user: string, opts: AskOpts = {}): Promise<string> {
  return ask(apiKey, model, system, user, null, 64000, opts);
}

async function ask(apiKey: string, model: string, system: string, user: string, schema: Record<string, unknown> | null, maxTokens: number, opts: AskOpts): Promise<string> {
  if (!apiKey.trim()) throw new AiError('설정 탭에서 Claude API 키를 먼저 넣어 주세요.', 'nokey');
  if (opts.signal?.aborted) throw new AiError('멈췄어요.', 'aborted');
  const client = makeClient(apiKey.trim());
  let msg;
  try {
    const stream = client.beta.messages.stream({
      model: model.trim() || DEFAULT_MODEL,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // 안전 분류기가 거절하면 서버가 다른 모델로 다시 시도
      thinking: { type: 'adaptive' },
      output_config: schema ? { effort: 'high', format: { type: 'json_schema', schema } } : { effort: 'high' },
      system,
      messages: [{ role: 'user', content: user }],
    }, { signal: opts.signal });
    if (opts.onText) { let n = 0; stream.on('text', d => { n += d.length; opts.onText!(n); }); }
    msg = await stream.finalMessage();
  } catch (e) {
    throw toAiError(e, opts.signal);
  }
  if (msg.stop_reason === 'refusal') throw new AiError('AI가 이 요청에 답하지 않았어요. 사건이나 글의 표현을 조금 바꿔 다시 해 보세요.', 'refusal');
  if (msg.stop_reason === 'max_tokens') throw new AiError('답이 너무 길어서 끊겼어요. 다시 시도하거나, 한 번에 쓸 사건 수를 줄여 보세요.', 'cut');
  const text = msg.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  if (!text.trim()) throw new AiError('AI가 빈 답을 보냈어요. 다시 시도해 주세요.', 'parse');
  return text;
}

/** SDK 오류를 쉬운 말 오류로. 구체적인 것부터 따진다. */
export function toAiError(e: unknown, signal?: AbortSignal): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.APIUserAbortError || signal?.aborted) return new AiError('멈췄어요.', 'aborted');
  if (e instanceof Anthropic.AuthenticationError) return new AiError('API 키가 맞지 않아요. 설정 탭에서 키를 확인해 주세요.', 'key');
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError('이 API 키로는 이 모델을 쓸 수 없어요. 설정 탭에서 키나 모델을 확인해 주세요.', 'model');
  if (e instanceof Anthropic.NotFoundError) return new AiError(`모델 이름을 찾지 못했어요. 설정 탭의 모델을 ${DEFAULT_MODEL}로 바꿔 보세요.`, 'model');
  if (e instanceof Anthropic.RateLimitError) {
    const s = Number(e.headers?.get('retry-after'));
    return new AiError(`요청이 너무 많아요. ${s > 0 ? `${Math.ceil(s)}초쯤 ` : '잠시 '}뒤 다시 시도해 주세요.`, 'rate');
  }
  if (e instanceof Anthropic.BadRequestError) {
    if (/credit|billing|balance/i.test(e.message)) return new AiError('API 크레딧이 부족해요. Anthropic 콘솔에서 결제 상태를 확인해 주세요.', 'bad');
    return new AiError(`요청이 거절됐어요. 설정 탭의 모델 이름을 확인해 주세요. (${shortMsg(e)})`, 'bad');
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new AiError('AI 답이 너무 오래 걸려서 멈췄어요. 다시 시도해 주세요.', 'timeout');
  if (e instanceof Anthropic.APIConnectionError) return new AiError('AI 서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.', 'network');
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529 || e.type === 'overloaded_error' || /overloaded/i.test(e.message)) return new AiError('AI 서버가 지금 붐벼요. 잠시 뒤 다시 시도해 주세요.', 'busy');
    if ((e.status ?? 0) >= 500) return new AiError(`AI 서버에 문제가 생겼어요 (${e.status}). 잠시 뒤 다시 시도해 주세요.`, 'server');
    if (e.status === undefined) return new AiError('AI 답을 받다가 끊겼어요. 다시 시도해 주세요.', 'network'); // 스트림 중간 오류
    return new AiError(`AI 오류 (${e.status}): ${shortMsg(e)}`, 'bad');
  }
  if (e instanceof TypeError && /fetch|network/i.test(e.message)) return new AiError('AI 서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.', 'network');
  return new AiError(e instanceof Error ? e.message : String(e), 'server');
}

const shortMsg = (e: Error) => e.message.replace(/^\d{3}\s*/, '').slice(0, 160);

/** 외부 AI 답(붙여넣은 글)에서 JSON 꺼내기: ```json 블록 → 첫 { 부터 마지막 } 까지 */
export function extractJson(text: string): unknown {
  const t = text.replace(/\\([_*\[\]#>-])/g, '$1'); // 마크다운 이스케이프 지우기 (작업실 unescapeMd 와 같은 이유)
  const block = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = block ? block[1] : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
  try { return JSON.parse(body); } catch { throw new AiError('붙여넣은 답에서 JSON을 찾지 못했어요. AI 답 전체를 그대로 붙여넣어 주세요.'); }
}
