// 시나리오 탭: 설정과 사건(반응)으로 시나리오 형식의 글을 쓴다.
import { useState } from 'react';
import type { Settings } from './engine/types';
import type { Book } from './store';
import { askText, AiError } from './engine/ai';
import { WRITER, cleanScript, screenplayManualPrompt, screenplayPrompt, scriptBlob, type ScriptInput } from './engine/screenplay';
import { ConfirmButton, copyText, download } from './ui';
import SceneFlow from './SceneFlow';

export default function ScriptTab({ book, setBook, settings }: { book: Book; setBook: (f: (b: Book) => Book) => void; settings: Settings }) {
  const ready = book.events.filter(e => e.what.trim() && e.participants.length);
  const [picked, setPicked] = useState<string[]>(() => ready.map(e => e.id));
  const [direction, setDirection] = useState('');
  const [mode, setMode] = useState<'once' | 'scenes'>(() => (book.scenes?.length ? 'scenes' : 'once'));
  const [append, setAppend] = useState(false);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [err, setErr] = useState('');
  const text = book.script ?? '';

  const lastScene = () => { const m = [...text.matchAll(/^S\s*#\s*(\d+)/gm)].pop(); return m ? Number(m[1]) : 0; };
  const input = (): ScriptInput => ({
    world: book.world, chars: book.chars, events: book.events.filter(e => picked.includes(e.id)), reactions: book.reactions,
    threshold: settings.threshold, extraRules: settings.extraRules, direction, startScene: append ? lastScene() + 1 : 1,
  });
  const put = (body: string) => {
    const b = cleanScript(body);
    if (!b) throw new AiError('AI 답에서 시나리오를 찾지 못했어요.');
    setBook(x => ({ ...x, script: append && x.script ? `${x.script.trim()}\n\n${b}` : b }));
  };
  const runApi = async () => {
    setBusy(true); setErr('');
    try { put(await askText(settings.apiKey, settings.model, WRITER, screenplayPrompt(input()))); } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); }
  };
  const flash = (k: string) => { setCopied(k); setTimeout(() => setCopied(''), 1500); };
  const noReact = book.events.filter(e => picked.includes(e.id) && !book.reactions.some(r => r.eventId === e.id)).length;

  return (
    <div className="body" style={{ margin: '0 auto' }}>
      <div className="row">
        <button className={'chip' + (mode === 'once' ? ' on' : '')} onClick={() => setMode('once')}>한 번에 쓰기</button>
        <button className={'chip' + (mode === 'scenes' ? ' on' : '')} onClick={() => setMode('scenes')}>장면 단위로 이어 쓰기</button>
      </div>
      {mode === 'scenes' && (
        <>
          {!ready.length && <div className="err">사건 탭에서 '일어난 일'과 '겪는 인물'을 적은 사건이 하나 이상 있어야 해요.</div>}
          <label className="field"><span>작가 요청 (전체, 선택)</span>
            <textarea rows={2} value={direction} placeholder="예: 대사는 적게, 건조한 톤으로." onChange={e => setDirection(e.target.value)} /></label>
          <SceneFlow book={book} setBook={setBook} settings={settings} ready={ready} direction={direction} />
        </>
      )}
      {mode === 'once' && <div className="panel">
        <h3>시나리오 쓰기</h3>
        <div className="muted small-t">고른 사건을 순서대로, 인물 설정과 사건 탭에서 돌린 반응을 바탕으로 시나리오 형식으로 써요. 반응을 아직 안 돌린 사건은 AI가 인물 설정에 맞춰 반응을 정해서 써요.</div>
        {!ready.length && <div className="err">사건 탭에서 '일어난 일'과 '겪는 인물'을 적은 사건이 하나 이상 있어야 해요.</div>}
        {ready.length > 0 && (
          <div className="field"><span>쓸 사건</span>
            <div className="row">
              {ready.map((e, i) => {
                const on = picked.includes(e.id);
                const done = book.reactions.some(r => r.eventId === e.id);
                return <button key={e.id} className={'chip' + (on ? ' on' : '')} onClick={() => setPicked(on ? picked.filter(x => x !== e.id) : ready.filter(x => x.id === e.id || picked.includes(x.id)).map(x => x.id))}>{i + 1}. {e.title}{done ? '' : ' (반응 없음)'}</button>;
              })}
            </div>
            {noReact > 0 && <span className="muted small-t">반응 없는 사건 {noReact}개는 AI가 반응을 정해요. 먼저 사건 탭에서 돌리면 더 정확해요.</span>}
          </div>
        )}
        <label className="field"><span>작가 요청 (선택)</span>
          <textarea rows={2} value={direction} placeholder="예: 대사는 적게, 건조한 톤으로. 마지막 씬은 아침 식탁." onChange={e => setDirection(e.target.value)} /></label>
        {text && <label className="row small-t"><input type="checkbox" checked={append} onChange={e => setAppend(e.target.checked)} /> 지금 글 뒤에 이어 붙이기 (S#{lastScene() + 1}부터)</label>}
        {settings.mode === 'api' ? (
          <div className="row"><button className="accent" disabled={!picked.length || busy} onClick={runApi}>{busy ? '쓰는 중… (몇 분 걸릴 수 있어요)' : '시나리오 쓰기'}</button></div>
        ) : (
          <>
            <div className="row">
              <button disabled={!picked.length} onClick={async () => { if (await copyText(screenplayManualPrompt(input()))) flash('req'); }}>{copied === 'req' ? '복사했어요' : '시나리오 요청 복사'}</button>
              <span className="muted small-t">외부 AI에 붙여넣고, 답을 아래에 붙여넣으세요.</span>
            </div>
            <textarea rows={4} value={answer} placeholder="AI 답 전체를 붙여넣기" onChange={e => setAnswer(e.target.value)} />
            <div className="row"><button className="primary" disabled={!answer.trim()} onClick={() => { setErr(''); try { put(answer); setAnswer(''); } catch (e: any) { setErr(e.message); } }}>넣기</button></div>
          </>
        )}
        {err && <div className="err">{err}</div>}
      </div>}

      {text && (
        <div className="panel">
          <div className="row">
            <h3 className="grow">시나리오</h3>
            <button className="small" onClick={async () => { if (await copyText(text)) flash('txt'); }}>{copied === 'txt' ? '복사했어요' : '복사'}</button>
            <button className="small" onClick={() => download(scriptBlob('인물 엔진 시나리오', text), `시나리오-${new Date().toISOString().slice(0, 10)}.txt`)}>.txt로 저장</button>
            <ConfirmButton onConfirm={() => setBook(b => ({ ...b, script: '', scenes: b.scenes?.map(x => ({ ...x, text: undefined, after: undefined })) }))}>지우기</ConfirmButton>
          </div>
          <div className="muted small-t">바로 고칠 수 있어요. .txt로 저장하면 시나리오 작업실의 '불러오기'로 열 수 있어요.</div>
          <textarea className="script" rows={24} value={text} onChange={e => setBook(b => ({ ...b, script: e.target.value }))} />
        </div>
      )}
    </div>
  );
}
