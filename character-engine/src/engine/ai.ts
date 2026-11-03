// Claude API 호출. 개인용 도구라서 사용자가 설정에 넣은 자기 API 키로 브라우저(기기)에서 바로 부른다.
// 배포용으로 바꿀 때는 키를 서버로 옮겨야 한다 (dangerouslyAllowBrowser 를 끄고 서버를 거치게).
import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_MODEL = 'claude-opus-5-5';

export class AiError extends Error {}

export async function askJson<T>(apiKey: string, model: string, system: string, user: string, schema: Record<string, unknown>): Promise<T> {
  if (!apiKey.trim()) throw new AiError('설정에서 Claude API 키를 먼저 넣어 주세요.');
  const client = new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true });
  let msg;
  try {
    msg = await client.beta.messages.stream({
      model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // 안전 분류기가 거절하면 서버가 다른 모델로 다시 시도
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    }).finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('API 키가 맞지 않아요. 설정에서 키를 확인해 주세요.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new AiError('이 API 키로는 이 모델을 쓸 수 없어요.');
    if (e instanceof Anthropic.RateLimitError) throw new AiError('요청이 너무 많아요. 잠시 뒤 다시 해 주세요.');
    if (e instanceof Anthropic.APIConnectionError) throw new AiError('인터넷 연결을 확인해 주세요.');
    if (e instanceof Anthropic.APIError) throw new AiError(`AI 오류 (${e.status ?? ''}): ${e.message}`);
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw new AiError('AI가 이 요청에 답하지 않았어요. 사건 내용을 조금 바꿔 다시 해 보세요.');
  if (msg.stop_reason === 'max_tokens') throw new AiError('답이 너무 길어서 끊겼어요. 다시 해 보세요.');
  const text = msg.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  try { return JSON.parse(text) as T; } catch { throw new AiError('AI 답을 읽지 못했어요. 다시 해 보세요.'); }
}

/** 외부 AI 답(붙여넣은 글)에서 JSON 꺼내기: ```json 블록 → 첫 { 부터 마지막 } 까지 */
export function extractJson(text: string): unknown {
  const t = text.replace(/\\([_*\[\]#>-])/g, '$1'); // 마크다운 이스케이프 지우기 (작업실 unescapeMd 와 같은 이유)
  const block = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = block ? block[1] : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
  try { return JSON.parse(body); } catch { throw new AiError('붙여넣은 답에서 JSON을 찾지 못했어요. AI 답 전체를 그대로 붙여넣어 주세요.'); }
}
