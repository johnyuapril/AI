import { useMemo, useRef, useState } from 'react';
import type { WsProps } from './Workspace';
import type { Project } from './types';
import { applyAiCuts, autoSummary, cutValues, estimatePages, getCuts, getScenes, isAiScene, knownNames, mergeCuts, resetBreaks, sceneStats, splitAt, type Cut, type Scene } from './script';
import { buildCharSheetRequest, buildDebateRequest, buildDebateSummaryRequest, DEBATE_NEXT, parseDebate, buildCutSplitRequest, buildFullCutSplitRequest, fullScriptText, buildNextRequest, parseBible, parseCutSplitAnswer, parseSetTables, resolveNumbers, scriptFileName } from './prompts';
import { copyText } from './util';
import type { AICut } from './types';
import { ANGLES, MOVES, SHOT_SIZES, termLabel } from './shots';
import { LazyText, Modal, useToast } from './ui';
import { toCSV } from './util';
import { openAiSide, pickFiles, preferredAi, saveFile } from './native';
import { cutRows, sceneRows } from './exports';

export default function SceneListTab({ p, update, go }: WsProps) {
  const toast = useToast();
  const scenes = useMemo(() => getScenes(p.lines), [p.lines]);
  const names = useMemo(() => knownNames(p), [p.lines, p.chars]);
  const allCuts = useMemo(() => new Map(scenes.map(s => [s.id, getCuts(p, s, names)])), [scenes, p.scenes, names]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [allAi, setAllAi] = useState(false);
  const [fromDebate, setFromDebate] = useState(false);
  const [debate, setDebate] = useState(false);
  const toggle = (id: string) => setOpen(o => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setMeta = (sid: string, k: 'summary' | 'notes', v: string) => update(x => ({ ...x, scenes: { ...x.scenes, [sid]: { ...x.scenes[sid], [k]: v } } }));

  const total = [...allCuts.values()].reduce((a, c) => a + c.length, 0);
  const exportScenes = async () => { toast('저장했어요: ' + await saveFile(new Blob([toCSV(sceneRows(p))], { type: 'text/csv' }), `${p.title}-신리스트.csv`)); };
  const exportCuts = async () => { toast('저장했어요: ' + await saveFile(new Blob([toCSV(cutRows(p))], { type: 'text/csv' }), `${p.title}-컷리스트.csv`)); };
  const shown = scenes.filter(s => !filter || (s.heading + ' ' + (p.scenes[s.id]?.summary || '')).includes(filter));
  return (
    <div className="page"><div className="page-inner">
      <div className="toolbar">
        <b>씬 {scenes.length}개 · 컷 {total}개</b>
        <input type="text" placeholder="씬 찾기" value={filter} onChange={e => setFilter(e.target.value)} />
        <button onClick={() => setOpen(new Set(scenes.map(s => s.id)))}>모두 펼치기</button>
        <button onClick={() => setOpen(new Set())}>모두 접기</button>
        <div className="grow" />
        <button className={p.debate ? '' : 'accent'} onClick={() => setDebate(true)} title="감독·작가·평론가가 먼저 시나리오를 토론하고, 그 결론으로 컷 나누기와 장면 묘사를 해요">① 3인 토론{p.debate ? ' ✓' : ''}</button>
        <button className="primary" onClick={() => setAllAi(true)}>② AI로 전체 컷 나누기</button>
        <button onClick={exportScenes}>신 리스트 CSV</button>
        <button onClick={exportCuts}>컷 리스트 CSV</button>
        <button className="primary" onClick={() => go('board')}>스토리보드로 →</button>
      </div>
      <p className="muted small-t" style={{ marginTop: 0 }}>▸를 누르면 컷이 펼쳐져요. 컷 왼쪽 ⠿를 끌어 다른 컷 위에 놓으면 합쳐지고, ✂로 원하는 문장에서 나눌 수 있어요. 회색 글자는 대본에서 자동으로 채운 값이에요.</p>
      <table className="grid">
        <thead><tr><th style={{ width: 40 }}></th><th style={{ width: 50 }}>S#</th><th>장소</th><th style={{ width: 70 }}>시간</th><th>등장인물</th><th style={{ width: '26%' }}>내용</th><th style={{ width: 50 }}>컷</th><th style={{ width: 80 }}>분량</th><th style={{ width: 50 }}>대사</th><th style={{ width: '14%' }}>비고</th></tr></thead>
        <tbody>
          {shown.map(s => {
            const st = sceneStats(s, names); const cuts = allCuts.get(s.id) || []; const m = p.scenes[s.id] || {};
            const isOpen = open.has(s.id);
            return [
              <tr key={s.id}>
                <td><button className="small ghost" onClick={() => toggle(s.id)}>{isOpen ? '▾' : '▸'}</button></td>
                <td><b>{s.num}</b></td>
                <td>{s.place}</td><td>{s.time}</td>
                <td className="small-t">{st.chars.join(', ')}</td>
                <td><input type="text" defaultValue={m.summary || ''} placeholder={autoSummary(s)} onBlur={e => setMeta(s.id, 'summary', e.target.value)} /></td>
                <td>{cuts.length}{(m.breaks?.length || m.noBreaks?.length) ? <span title="직접 고친 컷" style={{ color: 'var(--accent)' }}>●</span> : null}</td>
                <td className="small-t">{estimatePages(s.lines).toFixed(1)}쪽<br />{cuts.reduce((a, c) => a + c.seconds, 0)}초</td>
                <td>{st.dialogueCount}</td>
                <td><input type="text" defaultValue={m.notes || ''} placeholder="소품, 의상, 톤" onBlur={e => setMeta(s.id, 'notes', e.target.value)} /></td>
              </tr>,
              isOpen && <tr key={s.id + '-c'}><td colSpan={10} style={{ background: '#fafaf8' }}>
                <CutBoard p={p} update={update} scene={s} cuts={cuts} names={names} />
              </td></tr>,
            ];
          })}
        </tbody>
      </table>
      {debate && <DebateModal p={p} update={update} onClose={() => setDebate(false)} onNext={() => { setDebate(false); setFromDebate(true); setAllAi(true); }} />}
      {allAi && <AiSplitModal fromDebate={fromDebate} p={p} scenes={scenes} names={names} onBible={t => update(x => ({ ...x, bible: t }))} onClose={() => { setAllAi(false); setFromDebate(false); }} onApply={g => update(x => g.reduce((acc, [sc, list, st, keep]) => applyAiCuts(acc, sc, list, undefined, st, keep), x))} />}
    </div></div>
  );
}

function CutBoard({ p, update, scene, cuts, names }: { p: Project; update: WsProps['update']; scene: Scene; cuts: Cut[]; names: string[] }) {
  const [drag, setDrag] = useState<{ from: string; x: number; y: number; over?: string } | null>(null);
  const [split, setSplit] = useState<Cut | null>(null);
  const [charEdit, setCharEdit] = useState<Cut | null>(null);
  const sceneChars = useMemo(() => sceneStats(scene, names).chars, [scene, names]);
  const setCut = (key: string, patch: Record<string, unknown>) => update(x => ({ ...x, cuts: { ...x.cuts, [key]: { ...x.cuts[key], ...patch } } }));
  const manual = !!(p.scenes[scene.id]?.breaks?.length || p.scenes[scene.id]?.noBreaks?.length);
  const ai = isAiScene(p, scene);
  const [aiOpen, setAiOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const findOver = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest('[data-cut]') as HTMLElement | null;
    return el && box.current?.contains(el) ? el.dataset.cut : undefined;
  };
  return <div ref={box}>
    <div className="row" style={{ margin: '4px 0 10px' }}>
      <b>S#{scene.num} 컷 {cuts.length}개</b>
      {ai && <span className="chip on">AI가 나눈 컷</span>}
      {(manual || ai) && <button className="small" onClick={() => { if (!ai || confirm('AI가 나눈 컷을 버리고 앱이 자동으로 다시 나눌까요? (이 컷들에 넣은 그림·묘사는 연결이 끊겨요)')) update(x => resetBreaks(x, scene)); }}>자동으로 다시 나누기</button>}
      <div className="grow" />
      <button className="small primary" onClick={() => setAiOpen(true)}>AI로 컷 나누기</button>
    </div>
    {aiOpen && <AiSplitModal p={p} scene={scene} scenes={[scene]} names={names} onBible={t => update(x => ({ ...x, bible: t }))} onClose={() => setAiOpen(false)} onApply={g => update(x => g.reduce((acc, [sc, list, st, keep]) => applyAiCuts(acc, sc, list, undefined, st, keep), x))} />}
    <div className="cuts">
      {cuts.map((c, i) => {
        const v = cutValues(p, c); const m = p.cuts[c.key] || {};
        return <div key={c.key} data-cut={c.key} className={'cutcard' + (drag?.over === c.key && drag.from !== c.key ? ' drop' : '') + (drag?.from === c.key ? ' dragging' : '')}>
          <div className="row" style={{ gap: 6 }}>
            <span className="handle"
              onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDrag({ from: c.key, x: e.clientX, y: e.clientY }); }}
              onPointerMove={e => { if (drag) setDrag({ ...drag, x: e.clientX, y: e.clientY, over: findOver(e.clientX, e.clientY) }); }}
              onPointerUp={e => { if (drag) { const over = findOver(e.clientX, e.clientY); if (over && over !== drag.from) update(x => mergeCuts(x, scene, drag.from, over)); } setDrag(null); }}
              onPointerCancel={() => setDrag(null)}>⠿</span>
            <span className="no">{c.label}</span>
            <span className="muted small-t">{c.seconds}초</span>
            <div className="grow" />
            <button className={'small' + (m.chars ? ' tag-manual' : '')} onClick={() => setCharEdit(c)}>👥 {v.chars.length ? v.chars.join(', ') : '인물 없음'}</button>
            {!ai && <button className="small" onClick={() => setSplit(c)}>✂</button>}
          </div>
          <div className="row" style={{ gap: 4, marginTop: 6 }}>
            <TermSel list={SHOT_SIZES} value={m.shot} auto={c.auto.shot} src={c.auto.src} onChange={x => setCut(c.key, { shot: x })} short />
            <TermSel list={ANGLES} value={m.angle} auto={c.auto.angle} src={c.auto.src} onChange={x => setCut(c.key, { angle: x })} />
            <TermSel list={MOVES} value={m.move} auto={c.auto.move} src={c.auto.src} onChange={x => setCut(c.key, { move: x })} />
          </div>
          {c.units.some(u => u.kind === 'shot') && <div className="small-t" style={{ color: 'var(--blue)', fontWeight: 700, marginTop: 4 }}>{c.units.find(u => u.kind === 'shot')!.text}</div>}
          {ai && c.auto.note && <div className="small-t" style={{ color: 'var(--blue)', fontWeight: 700, marginTop: 4 }}>{c.auto.note}</div>}
          {ai && p.cuts[c.key]?.desc && <div className="txt"><b>화면</b> {p.cuts[c.key]!.desc}</div>}
          {c.action && <div className={ai ? 'txt muted small-t' : 'txt'}>{ai ? '대본: ' : ''}{c.action}</div>}
          {c.dialogues.map((d, k) => <div key={k} className="dl"><b>{d.speaker}{d.off ? '(소리)' : ''}</b> {d.text.length > 80 ? d.text.slice(0, 78) + '…' : d.text}</div>)}
          {i === 0 && cuts.length > 1 && <div className="muted small-t" style={{ marginTop: 4 }}>⠿를 끌어 다른 컷에 놓으면 합쳐져요</div>}
        </div>;
      })}
    </div>
    {drag && <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>{cuts.find(c => c.key === drag.from)?.label} 합치기{drag.over && drag.over !== drag.from ? ' → ' + cuts.find(c => c.key === drag.over)?.label : ''}</div>}
    {split && <SplitModal cut={split} cuts={cuts} onClose={() => setSplit(null)}
      onSplit={ids => { update(x => splitAt(x, scene, ids)); setSplit(null); }}
      onMerge={other => { update(x => mergeCuts(x, scene, split.key, other)); setSplit(null); }} />}
    {charEdit && <CharPick all={[...new Set([...sceneChars, ...(cutValues(p, charEdit).chars)])]} value={cutValues(p, charEdit).chars} manual={!!p.cuts[charEdit.key]?.chars}
      onClose={() => setCharEdit(null)} onSave={v => { setCut(charEdit.key, { chars: v }); }} label={charEdit.label} />}
  </div>;
}

export function TermSel({ list, value, auto, src, onChange, short }: { list: typeof SHOT_SIZES; value?: string; auto?: string; src?: string; onChange: (v: string | undefined) => void; short?: boolean }) {
  return <select className={value ? 'tag-manual' : ''} value={value || ''} onChange={e => onChange(e.target.value || undefined)} style={{ color: value ? undefined : 'var(--muted)' }}>
    <option value="">{auto ? `${short ? auto : termLabel(list, auto)} (${src || '자동'})` : '—'}</option>
    {list.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
  </select>;
}

function SplitModal({ cut, cuts, onClose, onSplit, onMerge }: { cut: Cut; cuts: Cut[]; onClose: () => void; onSplit: (ids: string[]) => void; onMerge: (k: string) => void }) {
  const i = cuts.indexOf(cut);
  return <Modal title={`${cut.label} 컷 나누기`} onClose={onClose}>
    <p className="muted small-t">문장 사이의 "여기서 나누기"를 누르면 그 문장부터 새 컷이 돼요.</p>
    {cut.units.map((u, k) => <div key={u.id}>
      {k > 0 && <div style={{ textAlign: 'center', margin: '4px 0' }}><button className="small" onClick={() => onSplit([u.id])}>✂ 여기서 나누기</button></div>}
      <div style={{ padding: '6px 10px', background: u.kind === 'dlg' ? '#f3f3ef' : '#fff', borderRadius: 6, border: '1px solid var(--soft)', marginLeft: u.sentStart === false || u.cont ? 24 : 0 }}>
        {u.kind === 'dlg' && <b>{u.speaker}: </b>}{u.text}
      </div>
    </div>)}
    <div className="row" style={{ marginTop: 14 }}>
      {cut.units.length > 1 && <button onClick={() => onSplit(cut.units.slice(1).map(u => u.id))}>문장마다 모두 나누기</button>}
      {i > 0 && <button onClick={() => onMerge(cuts[i - 1].key)}>앞 컷({cuts[i - 1].label})과 합치기</button>}
      {i < cuts.length - 1 && <button onClick={() => onMerge(cuts[i + 1].key)}>뒤 컷({cuts[i + 1].label})과 합치기</button>}
    </div>
  </Modal>;
}

export function CharPick({ all, value, manual, onClose, onSave, label }: { all: string[]; value: string[]; manual: boolean; onClose: () => void; onSave: (v: string[] | undefined) => void; label: string }) {
  const [sel, setSel] = useState<string[]>(value);
  const [extra, setExtra] = useState('');
  const list = [...new Set([...all, ...sel])];
  return <Modal title={`${label} 화면에 나오는 인물`} onClose={() => { onSave(sel); onClose(); }}>
    <div className="row">{list.map(n => <button key={n} className={'chip' + (sel.includes(n) ? ' on' : '')} style={{ minHeight: 40, fontSize: 15 }} onClick={() => setSel(s => s.includes(n) ? s.filter(x => x !== n) : [...s, n])}>{n}</button>)}</div>
    <div className="row" style={{ marginTop: 12 }}>
      <input type="text" placeholder="엑스트라 추가 (예: 관객 15명)" value={extra} onChange={e => setExtra(e.target.value)} />
      <button onClick={() => { if (extra.trim()) { setSel(s => [...s, extra.trim()]); setExtra(''); } }}>추가</button>
      <div className="grow" />
      {manual && <button onClick={() => { onSave(undefined); onClose(); }}>자동으로 되돌리기</button>}
      <button className="primary" onClick={() => { onSave(sel); onClose(); }}>저장</button>
    </div>
  </Modal>;
}

/** 감독·작가·평론가 3인 토론 → 결론을 모든 AI 요청에 */
function DebateModal({ p, update, onClose, onNext }: { p: Project; update: WsProps['update']; onClose: () => void; onNext: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const scenes = useMemo(() => getScenes(p.lines), [p.lines]);
  const rounds = (p.debateLog || '').split('\n\n━━━━━━━━\n\n').filter(Boolean).length;
  const copy = async (t: string) => toast(await copyText(t) ? '복사했어요. AI 대화창에 붙여 넣으세요.' : '복사하지 못했어요.');
  const [oneGo, setOneGoS] = useState(() => { try { return (localStorage.getItem('debate-onego') ?? (preferredAi() === 'claude' ? '1' : '')) === '1'; } catch { return false; } });
  const setOneGo = (v: boolean) => { setOneGoS(v); try { localStorage.setItem('debate-onego', v ? '1' : ''); } catch { /* */ } };
  const add = () => {
    const t = text.trim(); if (!t) return;
    const log = [p.debateLog, t].filter(Boolean).join('\n\n━━━━━━━━\n\n');
    const concl = parseDebate(log); const bible = parseBible(t);
    update(x => ({ ...x, debateLog: log, ...(concl ? { debate: concl } : {}), ...(bible ? { bible } : {}) }));
    setText('');
    toast(concl ? '토론 결론을 저장했어요. 이제 컷 나누기와 장면 묘사에 이 결론이 같이 가요.' : `토론 ${rounds + 1}번째 답을 모았어요. "다음" 요청을 복사해 이어 받으세요.`);
  };
  const paste = async () => { try { const t = await navigator.clipboard.readText(); if (t) setText(t); } catch { toast('아래 칸을 길게 눌러 붙여넣기 해 주세요.'); } };
  // 대사 많은 순서로 인물
  const people = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const l of p.lines) if (l.t === 'character') { const n = l.text.replace(/\s*\(.*?\)\s*/g, '').trim(); if (n) cnt.set(n, (cnt.get(n) || 0) + 1); }
    for (const c of p.chars) if (!cnt.has(c.name)) cnt.set(c.name, 0);
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  }, [p.lines, p.chars]);
  const [showAll, setShowAll] = useState(false);
  return <Modal wide title="① 3인 토론: 감독 · 작가 · 평론가" onClose={onClose}>
    <div style={{ display: 'grid', gap: 10 }}>
      <p className="muted small-t" style={{ margin: 0 }}>장면 묘사 전에 외부 AI가 <b>영화감독, 시나리오 작가, 평론가</b> 세 사람이 되어, 시나리오를 고치지 않고 <b>어떻게 이해하고 화면으로 그려 낼지</b> 깊이 토론해요(시나리오 읽기 → 인물 그려 내기 → 감정과 표정·행동 → 공간과 화면 → 씬별 핵심 순간과 분위기 → 씬별 컷과 앵글). 마지막 <b>[토론 결론]</b>이 저장되면 컷 나누기, 장면 묘사, 그림 프롬프트에 모두 같이 들어가요.</p>
      <div className="row">
        <b>1.</b> <button onClick={async () => { try { await saveFile(new Blob([fullScriptText(p, scenes)], { type: 'text/plain' }), scriptFileName(p)); } catch (e: any) { toast('파일 저장 실패: ' + (e?.message || e)); } }}>시나리오 파일 보내기</button>
        <span className="muted small-t">→ AI 대화창에 첨부해요</span>
      </div>
      <div className="row">
        <b>2.</b> <button className="primary" onClick={() => copy(buildDebateRequest(p, oneGo))}>토론 요청 복사</button>
        {!oneGo && <button onClick={() => copy(DEBATE_NEXT)}>"다음" 요청 복사</button>}
        {false && rounds > 0 && <button onClick={() => copy(buildDebateSummaryRequest())} title="토론은 끝났는데 결론이 짧을 때, 같은 대화창에 붙여 넣어요">결론 자세히 다시 받기</button>}
        <button onClick={() => openAiSide()}>AI 옆 화면에 열기 ◫</button>
        <span className="muted small-t">→ 한 번에 1~2부씩 답해요. 6부(씬별 컷과 앵글)는 몇 씬씩. 끝까지 "다음"으로 이어 가요</span>
      </div>
      <div className="row small-t">
        <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={oneGo} onChange={e => setOneGo(e.target.checked)} /> <b>한 번에 끝까지</b> (Claude 추천)</label>
        <span className="muted">{oneGo ? 'AI가 "다음"을 기다리지 않고 1~6부를 파일(토론.md)에 이어 써요. 결과 콘티도 파일(콘티.txt)로 받아 "답 파일 불러오기"로 넣어요.' : '한 번에 1~2부씩 쓰고, 대화창에 "ㄱ"이나 "다음"을 쳐서 이어 가요.'}</span>
      </div>
      <div className="row"><b>3.</b> <span className="small-t">토론 답은 앱에 붙여 넣지 않아도 돼요. ChatGPT에서 "다음"으로 6부 마지막 씬까지 이어 가다가 <b>"토론 끝"</b>이 나오면 아래 <b>②</b>를 눌러요.</span></div>
      {<div className="box-b" style={{ background: 'var(--soft)', borderRadius: 8, padding: 8 }}>
        <div className="row small-t"><b>캐릭터 시트</b><span className="muted">토론 2부(인물 그려 내기)가 끝나면, 같은 대화창에 붙여 넣어요. AI가 2부 내용을 정리한 뒤 그대로 마커펜 스토리보드풍 캐릭터 시트를 그려요. 한 번에 한 사람씩.</span></div>
        <div className="row" style={{ flexWrap: 'wrap', marginTop: 6 }}>
          {(showAll ? people : people.slice(0, 8)).map(n => <button key={n} className="small" onClick={() => copy(buildCharSheetRequest(n, p.chars.find(c => c.name === n)?.look))}>{n} 시트 요청 복사</button>)}
          {people.length > 8 && <button className="small ghost" onClick={() => setShowAll(!showAll)}>{showAll ? '주요 인물만' : `+${people.length - 8}명 더`}</button>}
        </div>
      </div>}
      <details><summary className="small-t">(선택) 토론 답을 앱에도 저장하기</summary><div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      <div className="row"><b>3.</b> <button onClick={paste}>AI 답 붙여넣기</button><span className="muted small-t">받은 답을 매번 붙여 넣고 "모으기"를 눌러요. 결론이 나오면 자동으로 저장돼요</span></div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={7} style={{ width: '100%', fontSize: 14 }} placeholder={'감독: …\n작가: …\n평론가: …'} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {rounds > 0 && <span className="muted small-t">모은 답 {rounds}개</span>}
        {rounds > 0 && <button className="small danger" onClick={() => { if (confirm('토론 기록과 결론을 지울까요?')) update(x => ({ ...x, debateLog: undefined, debate: undefined })); }}>처음부터 다시</button>}
        <button className="primary" disabled={!text.trim()} onClick={add}>모으기</button>
      </div>
      <div className="row small-t"><b>토론 결론</b><span className="muted">{p.debate ? `${p.debate.length.toLocaleString()}자 · 고칠 수 있어요. 씬마다 그 씬의 인물·장소·[씬] 항목을 골라 같이 보내요.` : '아직 없어요. 마지막 답의 [토론 결론]이 여기 들어와요.'}</span>
        {p.debate && p.debate.length < 1500 && <span style={{ color: 'var(--accent)' }}>결론이 짧아요. "결론 자세히 다시 받기"를 눌러 보세요.</span>}</div>
      <LazyText value={p.debate || ''} rows={10} placeholder={'이야기의 핵심: …\n톤앤무드: …\n색감·조명: …\n카메라 언어: …\n인물: 이름 - 생김새, 몸짓, 표정 …\n공간: …\n씬별 화면: S#1 - …'} onSave={v => update(x => ({ ...x, debate: v.trim() || undefined }))} />
      {p.debateLog && <details><summary className="small-t">토론 전체 기록 보기</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, maxHeight: 400, overflow: 'auto', background: 'var(--soft)', padding: 10, borderRadius: 8 }}>{p.debateLog}</pre></details>}
      </div></details>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="primary" onClick={onNext} title="토론하던 대화창에 붙여 넣으면, 토론을 근거로 씬마다 컷·앵글·장면 묘사를 받아요">② 토론 결과 받기 (컷 · 앵글 · 장면 묘사) →</button>
      </div>
    </div>
  </Modal>;
}

function AiSplitModal({ p, scene, scenes, names, onClose, onApply, onBible, fromDebate }: { fromDebate?: boolean; p: Project; scene?: Scene; scenes: Scene[]; names: string[]; onClose: () => void; onApply: (byScene: [Scene, AICut[], string?, number?][]) => void; onBible: (t: string) => void }) {
  const [bibleOpen, setBibleOpen] = useState(false);
  const allScenes = useMemo(() => getScenes(p.lines), [p.lines]);
  const toast = useToast();
  const [text, setText] = useState('');
  const [done, setDone] = useState<number[]>([]);
  const parsed = useMemo(() => text.trim() ? parseCutSplitAnswer(text, names) : [], [text, names]);
  const sets = useMemo(() => text.trim() ? parseSetTables(text) : {}, [text]);
  const groups = useMemo(() => {
    const out: [Scene, AICut[], string?, number?][] = [];
    const table = parsed.every(c => c.dlgNums === undefined);
    for (const s of scene ? [scene] : scenes) {
      const mine = parsed.filter(c => c.scene === s.num || (scene && !c.scene));
      if (!mine.length) continue;
      let list = mine.map(c => resolveNumbers(c, s));
      if (table && list.every(c => !c.dlg?.length)) {
        // 표처럼 대사 칸이 없는 답: 씬의 대사를 마지막 컷에 붙임
        const dl = sceneDialogues(s);
        if (dl.length) list[list.length - 1] = { ...list[list.length - 1], dlg: dl };
      }
      // 씬 중간부터 온 답([12-6]…)이면 앞 컷들을 살려서 이어 붙임
      const start = Math.min(...mine.map(c => c.idx || 1));
      const prev = p.scenes[s.id]?.aiCuts || [];
      const keep = start > 1 ? Math.min(start - 1, prev.length) : 0;
      if (keep) list = [...prev.slice(0, keep), ...list];
      out.push([s, list, sets[s.num] || (scene ? sets[-1] : undefined), keep]);
    }
    return out;
  }, [parsed, sets, scene, scenes, p.scenes]);
  const lastCut = useMemo(() => { const l = parsed[parsed.length - 1]; return l ? { scene: l.scene || scene?.num || 0, cut: l.idx || 0 } : null; }, [parsed, scene]);
  const [next, setNext] = useState<{ scene: number; cut: number } | null>(null);
  const total = groups.reduce((a, g) => a + g[1].length, 0);
  const paste = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { setText(t); return; } } catch { /* */ }
    toast('아래 칸을 길게 눌러 붙여넣기 해 주세요.');
  };
  const [per, setPer] = useState(() => { try { return Number(localStorage.getItem('ai-split-scenes')) || 3; } catch { return 3; } });
  const setPerSave = (n: number) => { setPer(n); try { localStorage.setItem('ai-split-scenes', String(n)); } catch { /* */ } };
  const firstNum = scenes[0]?.num || 1, lastNum = scenes[scenes.length - 1]?.num || 1;
  const [rFrom, setRFrom] = useState(firstNum);
  const [rTo, setRTo] = useState(lastNum);
  const range = { from: Math.min(rFrom, rTo), to: Math.max(rFrom, rTo) };
  const toFile = !!fromDebate && (() => { try { const v = localStorage.getItem('debate-onego'); return v === null ? preferredAi() === 'claude' : v === '1'; } catch { return false; } })();
  const request = () => scene ? buildCutSplitRequest(p, scene) : buildFullCutSplitRequest(p, scenes, per, range, fromDebate, toFile);
  const copyNext = async () => { if (!next) return; toast(await copyText(buildNextRequest(next.scene, next.cut, per, scene ? undefined : range.to)) ? '복사했어요. AI 대화창에 붙여 넣으세요.' : '복사하지 못했어요.'); };
  const loadFile = async () => { const fs = await pickFiles('.txt,.md,text/plain,text/markdown', true); if (!fs.length) return; fs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })); setText((await Promise.all(fs.map(f => f.text()))).join('\n\n')); };
  const bibleIn = useMemo(() => text.trim() ? parseBible(text) : undefined, [text]);
  const apply = () => {
    if (bibleIn && !p.bible?.trim()) { onBible(bibleIn); toast('작품 설정도 저장했어요. 다음 요청부터 같이 보내요.'); }
    onApply(groups);
    const nums = groups.map(g => g[0].num);
    toast(`S#${nums[0]}${nums.length > 1 ? '~' + nums[nums.length - 1] : ''}까지 넣었어요 (지금 답 ${parsed.length}컷).`);
    if (lastCut) setNext(lastCut);
    setDone(d => [...new Set([...d, ...nums])].sort((x, y) => x - y)); setText('');
  };
  return <Modal wide title={scene ? `S#${scene.num} AI로 컷 나누기` : fromDebate ? '② 토론 결과 받기: 씬별 컷 · 앵글 · 장면 묘사' : 'AI로 전체 컷 나누기 (영화감독 역할)'} onClose={onClose}>
    <div style={{ display: 'grid', gap: 10 }}>
      {!scene && <p className="muted small-t" style={{ margin: 0 }}>시나리오 전체를 파일로 주고 "영화감독"으로서 모든 씬을 컷으로 나누게 해요. <b>장면 묘사(설정표와 컷 화면 묘사)도 같이 받아서</b> 장면 묘사 탭에 바로 들어가요. <b>한 번에 씬 몇 개씩</b> 받아요(답이 씬 중간에서 끊겨도 이어 붙어요). 답을 붙여 넣고 "바꾸기" → <b>"다음" 요청 복사</b> → AI에 붙여 넣기 → 답 붙여넣기.</p>}
      {!scene && <div className="row"><span className="small-t">한 번에 받을 씬</span>
        {[1, 3, 5, 8].map(n => <button key={n} className={'small' + (per === n ? ' primary' : '')} onClick={() => setPerSave(n)}>{n}씬씩</button>)}
        <span className="muted small-t">많이 받을수록 빠르지만 AI가 묘사를 줄여 쓸 수 있어요</span></div>}
      {!scene && <div className="row"><span className="small-t">나눌 씬 범위</span>
        <select value={rFrom} onChange={e => setRFrom(Number(e.target.value))}>{scenes.map(s => <option key={s.id} value={s.num}>S#{s.num}</option>)}</select>
        <span>~</span>
        <select value={rTo} onChange={e => setRTo(Number(e.target.value))}>{scenes.map(s => <option key={s.id} value={s.num}>S#{s.num}</option>)}</select>
        {(range.from !== firstNum || range.to !== lastNum) && <button className="small" onClick={() => { setRFrom(firstNum); setRTo(lastNum); }}>전체로</button>}
        <span className="muted small-t">씬 {scenes.filter(s => s.num >= range.from && s.num <= range.to).length}개 · 범위를 바꾸면 "요청 문장 복사"를 다시 눌러 주세요</span></div>}
      <div className="row small-t" style={{ background: 'var(--soft)', padding: 8, borderRadius: 8 }}>
        <b>작품 설정</b>
        <span className="muted">{p.bible?.trim() ? `${p.bible.trim().split('\n').length}줄 · 모든 AI 요청에 같이 보내요 (뒤 씬 설정까지 반영)` : '아직 없어요. 전체 컷 나누기의 첫 답에서 AI가 정리해 주면 자동으로 저장돼요.'}</span>
        <button className="small" onClick={() => setBibleOpen(!bibleOpen)}>{bibleOpen ? '닫기' : p.bible?.trim() ? '보기·고치기' : '직접 쓰기'}</button>
        {bibleIn && p.bible?.trim() && <button className="small" onClick={() => { onBible(bibleIn); toast('작품 설정을 새 답으로 바꿨어요.'); }}>답의 작품 설정으로 바꾸기</button>}
      </div>
      {p.debateLog && <div className="row small-t"><span>3인 토론 기록이 있어요.</span>
        <button className="small" onClick={async () => { try { await saveFile(new Blob([p.debateLog!], { type: 'text/plain' }), '토론기록.txt'); } catch (e: any) { toast('파일 저장 실패: ' + (e?.message || e)); } }}>토론 기록 파일 보내기</button>
        <span className="muted">→ 시나리오 파일과 같이 첨부하면 토론의 세부까지 반영돼요</span></div>}
      {bibleOpen && <LazyText value={p.bible || ''} rows={8} placeholder={'인물: 지영 - 28세, 택시 회사 사장 딸, 갈색 웨이브 머리, 빨간 매니큐어\n장소: 망원역 앞 - 4차선 사거리, 언덕 위 주택가\n차량·소품: 지영의 진녹색 구형 재규어, 빨간 폴더폰\n시대·계절: 2000년대 초, 늦가을'} onSave={v => onBible(v)} />}
      {fromDebate && <div className="row small-t" style={{ background: 'var(--accent-soft)', padding: 8, borderRadius: 8 }}>토론이 끝난 <b>그 대화창</b>에 "요청 문장 복사"를 붙여 넣어요. 시나리오 파일은 이미 첨부돼 있으니 다시 보내지 않아도 돼요. {toFile ? 'AI가 만든 "콘티.txt"(여러 개면 모두)를 "답 파일 불러오기"로 넣으면' : '받은 답을 붙여 넣으면'} 씬마다 컷·앵글·장면 묘사(설정표, 화면)가 들어가요.</div>}
      {!fromDebate && <div className="row">
        <b>1.</b> <button className={scene ? '' : 'primary'} onClick={async () => { try { await saveFile(new Blob([fullScriptText(p, allScenes)], { type: 'text/plain' }), scriptFileName(p)); } catch (e: any) { toast('파일 저장 실패: ' + (e?.message || e)); } }}>시나리오 파일 보내기</button>
        <span className="muted small-t">→ {scene ? '(권장) 시나리오 전체를 같이 주면 뒤 씬 설정까지 반영돼요. ' : ''}공유 창에서 ChatGPT를 고르거나, 저장된 파일(문서/시나리오작업실)을 대화창에 첨부해요</span>
      </div>}
      <div className="row">
        <b>2.</b> <button className="primary" onClick={async () => toast(await copyText(request()) ? '복사했어요. 파일을 첨부한 대화창에 붙여 넣으세요.' : '복사하지 못했어요.')}>{scene ? '컷 나누기 요청 복사' : '요청 문장 복사'}</button>
        <button onClick={() => openAiSide()}>AI 옆 화면에 열기 ◫</button>
        <span className="muted small-t">→ {scene ? '외부 AI에 붙여 넣고 답을 받아요' : '파일과 함께 보내요'}</span>
      </div>
      <div className="row"><b>3.</b> <button onClick={paste}>AI 답 붙여넣기</button><button onClick={loadFile}>답 파일 불러오기</button><span className="muted small-t">또는 아래 칸에 직접 붙여넣기 (표로 답해도 돼요)</span></div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={10} style={{ width: '100%', fontSize: 14 }} placeholder={`[${scene?.num ?? 1}-1] EWS / 하이앵글 / 고정\n대본 번호: 1\n화면: …\n인물: 없음\n대사 번호: 없음`} />
      {text.trim() && <div className="small-t">{total ? <>읽은 결과: {groups.map(g => `S#${g[0].num} ${g[1].length}컷${g[2] ? '+설정표' : ''}`).join(', ').slice(0, 400)}</> : <span style={{ color: 'var(--accent)' }}>컷을 찾지 못했어요. [1-1] 같은 컷 번호가 있는지 확인해 주세요.</span>}</div>}
      {next && <div className="row small-t" style={{ background: 'var(--accent-soft)', padding: 8, borderRadius: 8 }}>
        <span>{!scene && `넣은 씬 ${done.length}개 / 전체 ${scenes.length}개 · `}마지막으로 넣은 컷: <b>{next.scene}-{next.cut}</b></span>
        <button className="small primary" onClick={copyNext}>"다음" 요청 복사</button>
        <span className="muted">→ AI에 붙여 넣고, 받은 답을 다시 위에 붙여넣기</span></div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="primary" disabled={!total} onClick={apply}>이 컷들로 바꾸기</button>
      </div>
    </div>
  </Modal>;
}

function sceneDialogues(s: Scene): { speaker: string; text: string; off: boolean }[] {
  const out: { speaker: string; text: string; off: boolean }[] = []; let sp = ''; let off = false;
  for (const l of s.lines) {
    if (l.t === 'character') { sp = l.text.replace(/\s*\(.*?\)\s*/g, '').trim(); off = /소리|V\.?O|O\.?S/i.test(l.text); }
    else if (l.t === 'dialogue') out.push({ speaker: sp, text: l.text, off });
    else if (l.t !== 'paren') sp = '';
  }
  return out;
}
