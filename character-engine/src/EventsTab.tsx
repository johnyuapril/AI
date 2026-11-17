import { useState } from 'react';
import type { Character, Reaction, Settings, StoryEvent } from './engine/types';
import type { Book } from './store';
import { newCharacter, uid } from './store';
import OrganizePanel from './OrganizePanel';
import { mergeEvents } from './engine/organize';
import { acceptProposal } from './engine/change';
import { commit, runEvent, seenOf, toReaction } from './engine/pipeline';
import { manualPrompt } from './engine/prompts';
import { extractJson } from './engine/ai';
import ReactionCard from './ReactionCard';
import { ConfirmButton, Field, copyText } from './ui';

const newEvent = (n: number): StoryEvent => ({ id: uid(), title: `사건 ${n}`, what: '', whenWhere: '', participants: [], knowledge: {}, span: 'now', decisive: false, createdAt: Date.now() });

export default function EventsTab({ book, setBook, settings, setSettings }: { book: Book; setBook: (f: (b: Book) => Book) => void; settings: Settings; setSettings: (s: Settings) => void }) {
  const [sel, setSel] = useState<string | null>(() => (window.innerWidth > 760 ? book.events[0]?.id ?? null : null));
  const ev = book.events.find(e => e.id === sel) ?? null;
  const put = (e: StoryEvent) => setBook(b => ({ ...b, events: b.events.map(x => (x.id === e.id ? e : x)) }));
  const add = () => { const e = newEvent(book.events.length + 1); setBook(b => ({ ...b, events: [...b.events, e] })); setSel(e.id); };

  return (
    <>
    <OrganizePanel kind="events" settings={settings} known={book.chars.map(c => c.name)} onApply={(raw, keep) => {
      const r = mergeEvents(book.events, book.chars, raw, keep, newCharacter, uid);
      if (!r.added && !r.updated) return 'AI 답에서 사건을 찾지 못했어요.';
      setBook(b => ({ ...b, events: r.value, chars: r.chars }));
      if (!sel && r.value[0] && window.innerWidth > 760) setSel(r.value[0].id);
      return `새 사건 ${r.added}개, 채운 사건 ${r.updated}개.` + (r.newChars.length ? ` 없던 인물 ${r.newChars.join(', ')}은(는) 인물 탭에 새로 만들었어요.` : '');
    }} />
    <div className={'split' + (ev ? ' has-sel' : '')}>
      <div className="list">
        <button className="primary" onClick={add}>+ 사건 추가</button>
        {book.events.map(x => {
          const n = book.reactions.filter(r => r.eventId === x.id).length;
          return (
            <button key={x.id} className={'item' + (x.id === sel ? ' on' : '')} onClick={() => setSel(x.id)}>
              <b>{x.title}</b><small>{x.participants.map(id => book.chars.find(c => c.id === id)?.name).filter(Boolean).join(', ') || '인물을 고르세요'}{n ? ` · 반응 ${n}` : ''}</small>
            </button>
          );
        })}
        {!book.events.length && <div className="empty small-t">사건을 추가하고, 겪을 인물을 고른 뒤 돌려 보세요.</div>}
      </div>
      <div className="body">
        {ev ? <EventEditor key={ev.id} ev={ev} book={book} setBook={setBook} put={put} settings={settings} setSettings={setSettings} onBack={() => setSel(null)}
          onDelete={() => { setBook(b => ({ ...b, events: b.events.filter(x => x.id !== ev.id), reactions: b.reactions.filter(r => r.eventId !== ev.id), undo: b.undo?.eventId === ev.id ? undefined : b.undo })); setSel(null); }} />
          : <div className="empty">왼쪽에서 사건을 고르세요.</div>}
      </div>
    </div>
    </>
  );
}

function EventEditor({ ev, book, setBook, put, settings, setSettings, onBack, onDelete }: {
  ev: StoryEvent; book: Book; setBook: (f: (b: Book) => Book) => void; put: (e: StoryEvent) => void; settings: Settings; setSettings: (s: Settings) => void; onBack: () => void; onDelete: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  // 붙여넣기 방식 진행 상태: 이번에 돌린 반응 id 들, 지금 차례
  const [manual, setManual] = useState<{ step: number; ids: string[] } | null>(null);
  const [paste, setPaste] = useState('');
  const [copied, setCopied] = useState(false);

  const reactions = book.reactions.filter(r => r.eventId === ev.id);
  const charOf = (id: string) => book.chars.find(c => c.id === id);
  const toggle = (id: string) => put({ ...ev, participants: ev.participants.includes(id) ? ev.participants.filter(x => x !== id) : [...ev.participants, id] });
  const canRun = ev.what.trim() && ev.participants.length > 0;

  const startSnapshot = (b: Book): Book => ({ ...b, undo: { eventId: ev.id, chars: b.chars, reactionIds: [] } });
  const record = (b: Book, char: Character, r: Reaction): Book => ({
    ...b, chars: b.chars.map(c => (c.id === char.id ? char : c)), reactions: [...b.reactions, r],
    undo: b.undo ? { ...b.undo, reactionIds: [...b.undo.reactionIds, r.id] } : b.undo,
  });

  const runApi = async () => {
    setErr(''); setBusy('시작하는 중');
    setBook(startSnapshot);
    try {
      await runEvent(settings, book.world, book.chars, ev, setBusy, res => setBook(b => record(b, res.char, res.reaction)));
    } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(''); }
  };

  const manualCtx = (step: number) => {
    const char = charOf(ev.participants[step])!;
    const seen = (manual?.ids ?? []).map(id => book.reactions.find(r => r.id === id)).filter(Boolean)
      .map(r => seenOf(charOf(r!.charId)!, r!));
    return { world: book.world, char, all: book.chars, event: ev, seen, threshold: settings.threshold, extraRules: settings.extraRules };
  };
  const manualIn = () => {
    if (!manual) return;
    setErr('');
    try {
      const raw = extractJson(paste);
      const ctx = manualCtx(manual.step);
      const res = commit(ctx.char, toReaction(raw, ev, ctx.char.id, 1), ev, settings.threshold);
      setBook(b => record(b, res.char, res.reaction));
      setPaste(''); setCopied(false);
      const next = manual.step + 1;
      setManual(next < ev.participants.filter(charOf).length ? { step: next, ids: [...manual.ids, res.reaction.id] } : null);
    } catch (e: any) { setErr(e.message ?? String(e)); }
  };

  const undo = () => setBook(b => b.undo && b.undo.eventId === ev.id
    ? { ...b, chars: b.undo.chars, reactions: b.reactions.filter(r => !b.undo!.reactionIds.includes(r.id)), undo: undefined } : b);

  const setReaction = (id: string, f: (r: Reaction) => Reaction) => setBook(b => ({ ...b, reactions: b.reactions.map(r => (r.id === id ? f(r) : r)) }));

  return (
    <>
      <button className="small backbtn" onClick={onBack}>← 사건 목록</button>
      <div className="panel">
        <div className="row">
          <input type="text" className="grow" style={{ fontWeight: 700, fontSize: 18 }} value={ev.title} onChange={e => put({ ...ev, title: e.target.value })} />
          <ConfirmButton onConfirm={onDelete}>사건 삭제</ConfirmButton>
        </div>
        <Field label="무슨 일이 일어났나 (작가 시점의 사실)" rows={3} value={ev.what} placeholder="예: 회사가 구조조정 대상자 명단을 돌렸고, 정훈의 이름이 있다" onChange={v => put({ ...ev, what: v })} />
        <Field label="언제, 어디서" rows={1} value={ev.whenWhere} placeholder="예: 금요일 오후, 사무실" onChange={v => put({ ...ev, whenWhere: v })} />
        <div className="field"><span>겪는 인물 (누른 순서대로 반응해요. 뒤 인물은 앞 인물의 행동과 말을 봐요)</span>
          <div className="row">
            {book.chars.map(c => {
              const i = ev.participants.indexOf(c.id);
              return <button key={c.id} className={'chip' + (i >= 0 ? ' on' : '')} onClick={() => toggle(c.id)}>{i >= 0 ? `${i + 1}. ` : ''}{c.name}</button>;
            })}
            {!book.chars.length && <span className="muted small-t">인물 탭에서 인물을 먼저 추가하세요.</span>}
          </div>
        </div>
        {ev.participants.map(id => charOf(id) && (
          <Field key={id} label={`${charOf(id)!.name}가 보고 들은 것 (비워 두면 위 사실을 다 안다고 봐요)`} rows={2} value={ev.knowledge[id] ?? ''}
            placeholder="예: 명단이 돈다는 소문만 들었다" onChange={v => put({ ...ev, knowledge: { ...ev.knowledge, [id]: v } })} />
        ))}
        <div className="row">
          <label className="row small-t"><input type="checkbox" checked={ev.span === 'days'} onChange={e => put({ ...ev, span: e.target.checked ? 'days' : 'now' })} /> 며칠 뒤 변화까지</label>
          <label className="row small-t"><input type="checkbox" checked={ev.decisive} onChange={e => put({ ...ev, decisive: e.target.checked })} /> 결정적 사건 (압력이 쌓였으면 전환점이 열려요)</label>
        </div>
        <div className="row">
          {settings.mode === 'api'
            ? <button className="accent" disabled={!canRun || !!busy} onClick={runApi}>{busy ? '돌리는 중…' : '사건 돌리기'}</button>
            : <button className="accent" disabled={!canRun || !!manual} onClick={() => { setBook(startSnapshot); setManual({ step: 0, ids: [] }); setErr(''); }}>사건 돌리기 (복사 → 붙여넣기)</button>}
          {book.undo?.eventId === ev.id && book.undo.reactionIds.length > 0 && !busy && !manual && <button className="small" onClick={undo}>마지막으로 돌린 것 되돌리기</button>}
          {!canRun && <span className="muted small-t">사실과 겪는 인물을 정하면 돌릴 수 있어요.</span>}
        </div>
        {err && <div className="err">{err}</div>}
      </div>

      {manual && charOf(ev.participants[manual.step]) && (
        <div className="panel">
          <h3>{manual.step + 1}/{ev.participants.length} · {charOf(ev.participants[manual.step])!.name}</h3>
          <div className="row">
            <button onClick={async () => setCopied(await copyText(manualPrompt(manualCtx(manual.step))))}>{copied ? '복사했어요' : '요청 복사'}</button>
            <span className="muted small-t">ChatGPT, Claude 같은 외부 AI에 붙여넣고, 답을 아래에 그대로 붙여넣으세요.</span>
          </div>
          <textarea rows={6} value={paste} placeholder="AI 답 전체를 붙여넣기" onChange={e => setPaste(e.target.value)} />
          <div className="row"><button className="primary" disabled={!paste.trim()} onClick={manualIn}>넣기</button><button className="small ghost" onClick={() => setManual(null)}>그만하기</button></div>
        </div>
      )}

      {reactions.length > 0 && <h3 style={{ margin: '6px 0 0' }}>반응</h3>}
      {[...reactions].reverse().map(r => (
        <ReactionCard key={r.id} r={r} char={charOf(r.charId)}
          onAccept={() => setBook(b => {
            const c = b.chars.find(x => x.id === r.charId);
            if (!c || !r.proposal) return b;
            return { ...b, chars: b.chars.map(x => (x.id === c.id ? acceptProposal(c, r.proposal!, ev.id) : x)), reactions: b.reactions.map(x => (x.id === r.id ? { ...x, proposal: { ...x.proposal!, status: 'accepted' } } : x)), undo: undefined };
          })}
          onReject={() => setReaction(r.id, x => ({ ...x, proposal: x.proposal && { ...x.proposal, status: 'rejected' } }))}
          onAwkward={why => { setReaction(r.id, x => ({ ...x, flaggedAwkward: why })); setSettings({ ...settings, extraRules: [...settings.extraRules, why] }); }} />
      ))}
      {busy && <div className="status">{busy}</div>}
    </>
  );
}
