// Claude API 로 한 번에 돌리는 일(시나리오 쓰기, AI로 채우기, 사건 돌리기, 아크 점검)의 공통 상태:
// 로딩 표시(지금 하는 일, 걸린 시간, 받은 글자 수), 멈추기, 오류와 '다시 시도'.
import { useEffect, useRef, useState } from 'react';
import type { Settings } from './engine/types';
import { AiError, toAiError, type AskOpts } from './engine/ai';

export interface AiTask {
  busy: boolean; stage: string; elapsed: number; chars: number; err: AiError | null;
  /** fn 에 멈추기 신호와 진행 표시를 넘긴다. 오류는 잡아서 err 로. 성공하면 true */
  run: (fn: (o: AskOpts, stage: (t: string) => void) => Promise<unknown>) => Promise<boolean>;
  cancel: () => void;
  clear: () => void;
}

export function useAiTask(): AiTask {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [chars, setChars] = useState(0);
  const [err, setErr] = useState<AiError | null>(null);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [busy]);
  useEffect(() => () => ctl.current?.abort(), []); // 화면을 떠나면 멈춤

  const run: AiTask['run'] = async fn => {
    if (ctl.current) return false;
    const c = new AbortController();
    ctl.current = c;
    setBusy(true); setErr(null); setStage(''); setElapsed(0); setChars(0);
    try {
      await fn({ signal: c.signal, onText: setChars }, t => { setStage(t); setChars(0); });
      return true;
    } catch (e) {
      setErr(toAiError(e, c.signal));
      return false;
    } finally {
      ctl.current = null;
      setBusy(false); setStage('');
    }
  };
  return { busy, stage, elapsed, chars, err, run, cancel: () => ctl.current?.abort(), clear: () => setErr(null) };
}

export const keyMissing = (s: Settings) => s.mode === 'api' && !s.apiKey.trim();

const mmss = (s: number) => (s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`);

/** 로딩 줄과 오류 상자. onRetry 는 렌더마다 새로 받으므로 최신 내용으로 다시 돌린다. */
export function AiStatus({ task, onRetry, settings, idle }: { task: AiTask; onRetry: () => void; settings?: Settings; idle?: string }) {
  if (task.busy) {
    return (
      <div className="ai-status" role="status" aria-live="polite">
        <span className="spinner" aria-hidden />
        <span className="grow">{task.stage || idle || 'AI가 쓰는 중'} · {mmss(task.elapsed)}{task.chars > 0 ? ` · 받은 글 ${task.chars.toLocaleString()}자` : ''}</span>
        <button className="small ghost" onClick={task.cancel}>멈추기</button>
      </div>
    );
  }
  if (settings && keyMissing(settings)) return <div className="err">설정 탭에서 Claude API 키를 먼저 넣어 주세요.</div>;
  if (!task.err) return null;
  const e = task.err;
  if (e.kind === 'aborted') {
    return <div className="row small-t"><span className="muted">멈췄어요.</span><button className="small" onClick={onRetry}>다시 시작</button></div>;
  }
  return (
    <div className="ai-err" role="alert">
      <span className="grow">{e.message}</span>
      {!e.needsSettings && <button className="small" onClick={() => { task.clear(); onRetry(); }}>{e.retryable ? '다시 시도' : '그래도 다시 해 보기'}</button>}
      <button className="small ghost" onClick={task.clear}>닫기</button>
    </div>
  );
}

export { AiError };
