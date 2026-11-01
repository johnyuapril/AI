import { useMemo, useRef, useState } from 'react';
import type { WsProps } from './Workspace';
import type { Project } from './types';
import { autoSummary, cutValues, estimatePages, getCuts, getScenes, knownNames, mergeCuts, resetBreaks, sceneStats, splitAt, type Cut, type Scene } from './script';
import { ANGLES, MOVES, SHOT_SIZES, termLabel } from './shots';
import { Modal, useToast } from './ui';
import { toCSV } from './util';
import { saveFile } from './native';

export default function SceneListTab({ p, update, go }: WsProps) {
  const toast = useToast();
  const scenes = useMemo(() => getScenes(p.lines), [p.lines]);
  const names = useMemo(() => knownNames(p), [p.lines, p.chars]);
  const allCuts = useMemo(() => new Map(scenes.map(s => [s.id, getCuts(p, s, names)])), [scenes, p.scenes, names]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const toggle = (id: string) => setOpen(o => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setMeta = (sid: string, k: 'summary' | 'notes', v: string) => update(x => ({ ...x, scenes: { ...x.scenes, [sid]: { ...x.scenes[sid], [k]: v } } }));

  const total = [...allCuts.values()].reduce((a, c) => a + c.length, 0);
  const exportScenes = async () => {
    const rows: unknown[][] = [['S#', '장소', '시간', '등장인물', '내용', '컷수', '쪽', '예상 초', '대사 수', '비고']];
    for (const s of scenes) {
      const st = sceneStats(s, names); const cuts = allCuts.get(s.id) || [];
      rows.push([s.num, s.place, s.time, st.chars.join(', '), p.scenes[s.id]?.summary || autoSummary(s), cuts.length, estimatePages(s.lines).toFixed(1), cuts.reduce((a, c) => a + c.seconds, 0), st.dialogueCount, p.scenes[s.id]?.notes || '']);
    }
    toast('저장했어요: ' + await saveFile(new Blob([toCSV(rows)], { type: 'text/csv' }), `${p.title}-신리스트.csv`));
  };
  const exportCuts = async () => {
    const rows: unknown[][] = [['컷', 'S#', '장소', '시간', '샷 크기', '앵글', '움직임', '인물', '화면 내용', '대사', '초', '그림 칸']];
    for (const s of scenes) for (const c of allCuts.get(s.id) || []) {
      const v = cutValues(p, c);
      rows.push([c.label, s.num, s.place, s.time, v.shot || '', termLabel(ANGLES, v.angle), termLabel(MOVES, v.move), v.chars.join(', '), p.cuts[c.key]?.desc || c.action, c.dialogues.map(d => `${d.speaker}: ${d.text}`).join(' / '), c.seconds, '']);
    }
    toast('저장했어요: ' + await saveFile(new Blob([toCSV(rows)], { type: 'text/csv' }), `${p.title}-컷리스트.csv`));
  };
  const shown = scenes.filter(s => !filter || (s.heading + ' ' + (p.scenes[s.id]?.summary || '')).includes(filter));
  return (
    <div className="page"><div className="page-inner">
      <div className="toolbar">
        <b>씬 {scenes.length}개 · 컷 {total}개</b>
        <input type="text" placeholder="씬 찾기" value={filter} onChange={e => setFilter(e.target.value)} />
        <button onClick={() => setOpen(new Set(scenes.map(s => s.id)))}>모두 펼치기</button>
        <button onClick={() => setOpen(new Set())}>모두 접기</button>
        <div className="grow" />
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
  const box = useRef<HTMLDivElement>(null);
  const findOver = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest('[data-cut]') as HTMLElement | null;
    return el && box.current?.contains(el) ? el.dataset.cut : undefined;
  };
  return <div ref={box}>
    <div className="row" style={{ margin: '4px 0 10px' }}>
      <b>S#{scene.num} 컷 {cuts.length}개</b>
      {manual && <button className="small" onClick={() => update(x => resetBreaks(x, scene))}>자동으로 다시 나누기</button>}
    </div>
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
            <button className="small" onClick={() => setSplit(c)}>✂</button>
          </div>
          <div className="row" style={{ gap: 4, marginTop: 6 }}>
            <TermSel list={SHOT_SIZES} value={m.shot} auto={c.auto.shot} src={c.auto.src} onChange={x => setCut(c.key, { shot: x })} short />
            <TermSel list={ANGLES} value={m.angle} auto={c.auto.angle} src={c.auto.src} onChange={x => setCut(c.key, { angle: x })} />
            <TermSel list={MOVES} value={m.move} auto={c.auto.move} src={c.auto.src} onChange={x => setCut(c.key, { move: x })} />
          </div>
          {c.units.some(u => u.kind === 'shot') && <div className="small-t" style={{ color: 'var(--blue)', fontWeight: 700, marginTop: 4 }}>{c.units.find(u => u.kind === 'shot')!.text}</div>}
          {c.action && <div className="txt">{c.action}</div>}
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
