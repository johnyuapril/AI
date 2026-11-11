// 장면 단위로 이어 쓰기: 사건을 장면 묶음으로 나눠 한 장면씩 쓰고, 장면이 끝났을 때의 인물 상태를 다음 장면에 넘긴다.
import { useState } from 'react';
import type { Settings, StoryEvent } from './engine/types';
import type { Book } from './store';
import { uid } from './store';
import { askText, AiError } from './engine/ai';
import { WRITER } from './engine/screenplay';
import {
  applyStatesToChars, carriedStates, lastSceneNo, parseSceneAnswer, removeTail, sceneApiPrompt, sceneManualPrompt,
  type SceneCharState, type SceneInput, type ScriptScene,
} from './engine/sequence';
import { ConfirmButton, copyText } from './ui';

type SetBook = (f: (b: Book) => Book) => void;

export default function SceneFlow({ book, setBook, settings, ready, direction }: { book: Book; setBook: SetBook; settings: Settings; ready: StoryEvent[]; direction: string }) {
  const scenes = book.scenes ?? [];
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const name = (id: string) => book.chars.find(c => c.id === id)?.name ?? '?';
  const evTitle = (id: string) => book.events.find(e => e.id === id)?.title ?? '(지운 사건)';
  const next = scenes.findIndex(s => !s.text?.trim());
  const lastDone = next < 0 ? scenes.length - 1 : next - 1;
  const setScenes = (f: (s: ScriptScene[]) => ScriptScene[]) => setBook(b => ({ ...b, scenes: f(b.scenes ?? []) }));
  const patch = (id: string, p: Partial<ScriptScene>) => setScenes(ss => ss.map(s => (s.id === id ? { ...s, ...p } : s)));
  const flash = (k: string) => { setCopied(k); setTimeout(() => setCopied(''), 1500); };

  const oneEach = () => setScenes(ss => [...ss.filter(s => s.text?.trim()), ...ready.filter(e => !ss.some(s => s.text?.trim() && s.eventIds.includes(e.id))).map(e => ({ id: uid(), eventIds: [e.id], note: '' }))]);
  const input = (): SceneInput => ({
    world: book.world, chars: book.chars, events: book.events, reactions: book.reactions,
    threshold: settings.threshold, extraRules: settings.extraRules, scenes, index: next, direction,
    startScene: lastSceneNo(book.script ?? '') + 1,
  });
  const put = (ans: string) => {
    const r = parseSceneAnswer(ans, book.chars);
    if (!r.text || !/S\s*#\s*\d/.test(r.text)) throw new AiError('AI 답에서 시나리오(S#…)를 찾지 못했어요. 답 전체를 그대로 붙여넣어 주세요.');
    const id = scenes[next].id;
    setBook(b => ({
      ...b,
      script: b.script?.trim() ? `${b.script.trim()}\n\n${r.text}` : r.text,
      scenes: (b.scenes ?? []).map(s => (s.id === id ? { ...s, text: r.text, after: r.after } : s)),
    }));
    setMsg(r.after.length ? `장면 ${next + 1}을 넣었어요. 인물 ${r.after.length}명의 상태를 다음 장면에 넘겨요.` : `장면 ${next + 1}을 넣었어요. 답에 인물 상태가 없어서 앞 상태를 그대로 넘겨요.`);
  };
  const runApi = async () => {
    setBusy(true); setErr(''); setMsg('');
    try { put(await askText(settings.apiKey, settings.model, WRITER, sceneApiPrompt(input()))); } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); }
  };
  const rewrite = (s: ScriptScene) => {
    const cut = removeTail(book.script ?? '', s.text ?? '');
    setBook(b => ({ ...b, script: cut ?? b.script, scenes: (b.scenes ?? []).map(x => (x.id === s.id ? { ...x, text: undefined, after: undefined } : x)) }));
    setMsg(cut == null ? '시나리오 글을 직접 고쳐서 이 장면 글을 자동으로 빼지 못했어요. 아래 시나리오에서 이 장면 부분을 직접 지운 뒤 다시 쓰세요.' : `장면 ${scenes.indexOf(s) + 1}을 지웠어요. 다시 쓰면 돼요.`);
  };
  const move = (i: number, d: -1 | 1) => setScenes(ss => { const a = [...ss]; [a[i], a[i + d]] = [a[i + d], a[i]]; return a; });
  const setState = (sceneId: string, charId: string, p: Partial<SceneCharState>) =>
    setScenes(ss => ss.map(s => (s.id === sceneId ? { ...s, after: (s.after ?? []).map(a => (a.charId === charId ? { ...a, ...p } : a)) } : s)));

  const startStates = next >= 0 ? [...carriedStates(scenes, next).values()] : [];
  const nextEvs = next >= 0 ? scenes[next].eventIds : [];

  return (
    <div className="panel">
      <div className="row">
        <h3 className="grow">장면 단위로 이어 쓰기</h3>
        <button className="small" disabled={!ready.length} onClick={oneEach}>사건마다 장면 하나씩</button>
        <button className="small" onClick={() => setScenes(ss => [...ss, { id: uid(), eventIds: [], note: '' }])}>장면 추가</button>
      </div>
      <div className="muted small-t">사건을 장면으로 묶어 순서대로 한 장면씩 써요. 장면을 쓸 때마다 그 장면이 끝났을 때 인물의 감정과 관계를 함께 받아서, 다음 장면은 그 상태에서 시작해요. 쓴 글은 아래 시나리오에 S# 번호를 이어서 붙어요.</div>

      {scenes.map((s, i) => {
        const done = !!s.text?.trim();
        const nums = [...(s.text ?? '').matchAll(/^S\s*#\s*(\d+)/gm)].map(m => m[1]);
        return (
          <div key={s.id} className={'scene' + (i === next ? ' now' : '') + (done ? ' done' : '')}>
            <div className="row">
              <b className="grow">장면 {i + 1}{nums.length ? ` · S#${nums[0]}${nums.length > 1 ? `~${nums[nums.length - 1]}` : ''}` : ''}{done ? ' · 다 씀' : i === next ? ' · 다음 차례' : ''}</b>
              {!done && i > lastDone + 1 && <button className="small" onClick={() => move(i, -1)}>↑</button>}
              {!done && i < scenes.length - 1 && <button className="small" onClick={() => move(i, 1)}>↓</button>}
              {!done && <button className="small danger" onClick={() => setScenes(ss => ss.filter(x => x.id !== s.id))}>빼기</button>}
              {done && i === lastDone && <ConfirmButton className="small" onConfirm={() => rewrite(s)}>지우고 다시 쓰기</ConfirmButton>}
            </div>
            {done ? (
              <div className="small-t">{s.eventIds.map(evTitle).join(' → ')}</div>
            ) : (
              <>
                <div className="row">
                  {ready.map(e => {
                    const on = s.eventIds.includes(e.id);
                    const k = s.eventIds.indexOf(e.id);
                    return <button key={e.id} className={'chip' + (on ? ' on' : '')} onClick={() => patch(s.id, { eventIds: on ? s.eventIds.filter(x => x !== e.id) : [...s.eventIds, e.id] })}>{on ? `${k + 1}) ` : ''}{e.title}</button>;
                  })}
                </div>
                <input type="text" value={s.note} placeholder="이 장면에 대한 요청 (선택). 예: 다음 날 아침, 둘은 말이 없다" onChange={e => patch(s.id, { note: e.target.value })} />
              </>
            )}
            {done && (s.after ?? []).length > 0 && (
              <details>
                <summary>장면이 끝났을 때 인물 상태 (다음 장면에 넘어가요. 고칠 수 있어요)</summary>
                {(s.after ?? []).map(a => (
                  <div key={a.charId} className="state">
                    <b>{name(a.charId)}</b>
                    <label className="field"><span>감정과 컨디션</span><input type="text" value={a.mood} onChange={e => setState(s.id, a.charId, { mood: e.target.value })} /></label>
                    {a.relations.map((r, k) => (
                      <label key={r.otherId} className="field"><span>{name(r.otherId)}에게</span>
                        <input type="text" value={r.feeling} onChange={e => setState(s.id, a.charId, { relations: a.relations.map((x, j) => (j === k ? { ...x, feeling: e.target.value } : x)) })} /></label>
                    ))}
                    <label className="field"><span>이번 장면에서 달라진 것</span><input type="text" value={a.change} onChange={e => setState(s.id, a.charId, { change: e.target.value })} /></label>
                  </div>
                ))}
              </details>
            )}
          </div>
        );
      })}

      {!scenes.length && <div className="muted small-t">'사건마다 장면 하나씩'을 누르거나 '장면 추가'로 장면을 만들고, 장면마다 담을 사건을 고르세요.</div>}

      {next >= 0 && (
        <div className="scene now">
          <b>장면 {next + 1} 쓰기 (S#{lastSceneNo(book.script ?? '') + 1}부터)</b>
          {startStates.length > 0 ? (
            <div className="small-t">
              <div className="muted">이 상태에서 시작해요</div>
              {startStates.map(a => <div key={a.charId}>· {name(a.charId)}: {a.mood || '(적힌 것 없음)'}{a.relations.map(r => ` / ${name(r.otherId)}에게 ${r.feeling}`).join('')}</div>)}
            </div>
          ) : <div className="muted small-t">첫 장면이에요. 인물 탭의 현재 상태에서 시작해요.</div>}
          {!nextEvs.length && <div className="err">이 장면에 담을 사건을 하나 이상 고르세요.</div>}
          {settings.mode === 'api' ? (
            <div className="row"><button className="accent" disabled={!nextEvs.length || busy} onClick={runApi}>{busy ? '쓰는 중… (몇 분 걸릴 수 있어요)' : `장면 ${next + 1} 쓰기`}</button></div>
          ) : (
            <>
              <div className="row">
                <button disabled={!nextEvs.length} onClick={async () => { if (await copyText(sceneManualPrompt(input()))) flash('scene'); }}>{copied === 'scene' ? '복사했어요' : `장면 ${next + 1} 요청 복사`}</button>
                <span className="muted small-t">외부 AI에 붙여넣고, 답(시나리오와 인물 상태) 전체를 아래에 붙여넣으세요.</span>
              </div>
              <textarea rows={4} value={answer} placeholder="AI 답 전체를 붙여넣기" onChange={e => setAnswer(e.target.value)} />
              <div className="row"><button className="primary" disabled={!answer.trim()} onClick={() => { setErr(''); setMsg(''); try { put(answer); setAnswer(''); } catch (e: any) { setErr(e.message); } }}>넣기</button></div>
            </>
          )}
        </div>
      )}
      {scenes.length > 0 && next < 0 && <div className="ok small-t">모든 장면을 다 썼어요. 장면을 더 추가하면 이어서 쓸 수 있어요.</div>}
      {lastDone >= 0 && (
        <div className="row">
          <ConfirmButton className="small" onConfirm={() => { setBook(b => ({ ...b, chars: applyStatesToChars(b.chars, carriedStates(b.scenes ?? [], lastDone + 1)) })); setMsg('마지막 장면의 감정과 관계를 인물 설정(현재 상태)에 반영했어요.'); }}>마지막 상태를 인물 설정에 반영</ConfirmButton>
          <span className="muted small-t">사건 탭에서 다음 사건을 돌릴 때 이 상태를 쓰고 싶을 때만 누르세요.</span>
        </div>
      )}
      {msg && <div className="ok small-t">{msg}</div>}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
