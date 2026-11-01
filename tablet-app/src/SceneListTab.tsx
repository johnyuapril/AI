import { useMemo, useRef, useState } from 'react';
import type { WsProps } from './Workspace';
import type { Project } from './types';
import { applyAiCuts, autoSummary, cutValues, estimatePages, getCuts, getScenes, isAiScene, knownNames, mergeCuts, resetBreaks, sceneStats, splitAt, type Cut, type Scene } from './script';
import { buildCutSplitRequest, buildFullCutSplitRequest, fullScriptText, parseCutSplitAnswer, resolveNumbers, scriptFileName } from './prompts';
import { copyText } from './util';
import type { AICut } from './types';
import { ANGLES, MOVES, SHOT_SIZES, termLabel } from './shots';
import { Modal, useToast } from './ui';
import { toCSV } from './util';
import { openAiSide, pickFiles, saveFile } from './native';
import { cutRows, sceneRows } from './exports';

export default function SceneListTab({ p, update, go }: WsProps) {
  const toast = useToast();
  const scenes = useMemo(() => getScenes(p.lines), [p.lines]);
  const names = useMemo(() => knownNames(p), [p.lines, p.chars]);
  const allCuts = useMemo(() => new Map(scenes.map(s => [s.id, getCuts(p, s, names)])), [scenes, p.scenes, names]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [allAi, setAllAi] = useState(false);
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
        <button className="primary" onClick={() => setAllAi(true)}>AI로 전체 컷 나누기</button>
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
      {allAi && <AiSplitModal p={p} scenes={scenes} names={names} onClose={() => setAllAi(false)} onApply={g => update(x => g.reduce((acc, [sc, list]) => applyAiCuts(acc, sc, list), x))} />}
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
    {aiOpen && <AiSplitModal p={p} scene={scene} scenes={[scene]} names={names} onClose={() => setAiOpen(false)} onApply={g => update(x => g.reduce((acc, [sc, list]) => applyAiCuts(acc, sc, list), x))} />}
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

function AiSplitModal({ p, scene, scenes, names, onClose, onApply }: { p: Project; scene?: Scene; scenes: Scene[]; names: string[]; onClose: () => void; onApply: (byScene: [Scene, AICut[]][]) => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [done, setDone] = useState<number[]>([]);
  const parsed = useMemo(() => text.trim() ? parseCutSplitAnswer(text, names) : [], [text, names]);
  const groups = useMemo(() => {
    const out: [Scene, AICut[]][] = [];
    for (const s of scene ? [scene] : scenes) {
      const list = parsed.filter(c => c.scene === s.num || (scene && !c.scene)).map(c => resolveNumbers(c, s));
      if (list.length && list.every(c => !c.dlg?.length)) {
        // 표처럼 대사 칸이 없는 답: 씬의 대사를 마지막 컷에 붙임
        const dl = sceneDialogues(s);
        if (dl.length) list[list.length - 1] = { ...list[list.length - 1], dlg: dl };
      }
      if (list.length) out.push([s, list]);
    }
    return out;
  }, [parsed, scene, scenes]);
  const total = groups.reduce((a, g) => a + g[1].length, 0);
  const paste = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { setText(t); return; } } catch { /* */ }
    toast('아래 칸을 길게 눌러 붙여넣기 해 주세요.');
  };
  const [per, setPer] = useState(() => { try { return Number(localStorage.getItem('ai-split-per')) || 8; } catch { return 8; } });
  const setPerSave = (n: number) => { setPer(n); try { localStorage.setItem('ai-split-per', String(n)); } catch { /* */ } };
  const request = () => scene ? buildCutSplitRequest(p, scene) : buildFullCutSplitRequest(p, scenes, per);
  const loadFile = async () => { const [f] = await pickFiles('.txt,.md,text/plain,text/markdown'); if (f) setText(await f.text()); };
  const apply = () => {
    onApply(groups);
    const nums = groups.map(g => g[0].num);
    toast(`S#${nums[0]}${nums.length > 1 ? '~' + nums[nums.length - 1] : ''} 씬 ${nums.length}개를 ${total}컷으로 나눴어요.`);
    if (scene) { onClose(); return; }
    setDone(d => [...new Set([...d, ...nums])].sort((x, y) => x - y)); setText('');
  };
  const left = scenes.filter(s => !done.includes(s.num));
  return <Modal wide title={scene ? `S#${scene.num} AI로 컷 나누기` : 'AI로 전체 컷 나누기 (영화감독 역할)'} onClose={onClose}>
    <div style={{ display: 'grid', gap: 10 }}>
      {!scene && <p className="muted small-t" style={{ margin: 0 }}>시나리오 전체를 파일로 주고 "영화감독"으로서 모든 씬을 컷으로 나누게 해요. AI가 <b>한 번에 쓸 수 있는 답의 길이</b>에 한계가 있어서(씬 100개면 컷이 600~700개) 나눠 받는 게 안전해요. 나눠 받을 때는 답을 붙여 넣고 "바꾸기" → AI에게 <b>"다음"</b> → 또 붙여넣기.</p>}
      {!scene && <div className="row"><span className="small-t">한 번에 받을 씬</span>
        {[8, 15, 30].map(n => <button key={n} className={'small' + (per === n ? ' primary' : '')} onClick={() => setPerSave(n)}>{n}개씩</button>)}
        <button className={'small' + (per >= 9999 ? ' primary' : '')} onClick={() => setPerSave(9999)}>전체 (파일로 받기)</button>
        <span className="muted small-t">{per >= 9999 ? 'AI가 만든 "컷나누기.txt"를 받아서 아래 "답 파일 불러오기"로 넣어요' : '많이 받을수록 AI가 중간에 끊거나 줄여 쓸 수 있어요'}</span></div>}
      {!scene && <div className="row">
        <b>1.</b> <button className="primary" onClick={async () => { try { await saveFile(new Blob([fullScriptText(p, scenes)], { type: 'text/plain' }), scriptFileName(p)); } catch (e: any) { toast('파일 저장 실패: ' + (e?.message || e)); } }}>시나리오 파일 보내기</button>
        <span className="muted small-t">→ 공유 창에서 ChatGPT를 고르거나, 저장된 파일(문서/시나리오작업실)을 대화창에 첨부해요</span>
      </div>}
      <div className="row">
        <b>{scene ? '1.' : '2.'}</b> <button className="primary" onClick={async () => toast(await copyText(request()) ? '복사했어요. 파일을 첨부한 대화창에 붙여 넣으세요.' : '복사하지 못했어요.')}>{scene ? '컷 나누기 요청 복사' : '요청 문장 복사'}</button>
        <button onClick={() => openAiSide()}>AI 옆 화면에 열기 ◫</button>
        <span className="muted small-t">→ {scene ? '외부 AI에 붙여 넣고 답을 받아요' : '파일과 함께 보내요'}</span>
      </div>
      <div className="row"><b>{scene ? '2.' : '3.'}</b> <button onClick={paste}>AI 답 붙여넣기</button><button onClick={loadFile}>답 파일 불러오기</button><span className="muted small-t">또는 아래 칸에 직접 붙여넣기 (표로 답해도 돼요)</span></div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={10} style={{ width: '100%', fontSize: 14 }} placeholder={`[${scene?.num ?? 1}-1] EWS / 하이앵글 / 고정\n대본 번호: 1\n화면: …\n인물: 없음\n대사 번호: 없음`} />
      {text.trim() && <div className="small-t">{total ? <>읽은 결과: {groups.map(g => `S#${g[0].num} ${g[1].length}컷`).join(', ').slice(0, 400)}</> : <span style={{ color: 'var(--accent)' }}>컷을 찾지 못했어요. [1-1] 같은 컷 번호가 있는지 확인해 주세요.</span>}</div>}
      {!scene && done.length > 0 && <div className="small-t">바꾼 씬 {done.length}개 / 전체 {scenes.length}개{left.length ? ` · 다음은 S#${left[0].num}부터예요. AI에게 "다음"이라고 보내 주세요.` : ' · 모두 끝났어요!'}</div>}
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
