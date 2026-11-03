import React, { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import type { WsProps } from './Workspace';
import type { Bubble, BubbleKind, CutMeta, FxKind, Sfx, WebtoonPanel } from './types';
import { getCuts, getScenes, knownNames, type Cut, type Scene } from './script';
import { Img, useToast } from './ui';
import { saveFile } from './native';
import { drawFx, FX_LABEL, KIND_LABEL, panelOf, wid } from './webtoon';

const W = 720; // 웹툰 칸 너비(px)
const ASPECTS: Record<string, number> = { '16:9': 16 / 9, '2.39:1': 2.39, '1.85:1': 1.85, '4:3': 4 / 3, '1:1': 1 };

export default function WebtoonTab(props: WsProps) {
  const { p, update, focusScene } = props;
  const toast = useToast();
  const scenes = useMemo(() => getScenes(p.lines), [p.lines]);
  const names = useMemo(() => knownNames(p), [p.lines, p.chars]);
  const startIdx = focusScene ? Math.max(0, scenes.findIndex(s => s.id === focusScene)) : 0;
  const [from, setFrom] = useState(startIdx);
  const [to, setTo] = useState(focusScene ? startIdx : Math.max(0, scenes.length - 1));
  const [edit, setEdit] = useState(false);
  const [titles, setTitles] = useState(true);
  const [busy, setBusy] = useState('');
  const stripRef = useRef<HTMLDivElement>(null);
  const ratio = ASPECTS[p.aspect || '16:9'] || 16 / 9;
  const shown = scenes.slice(Math.min(from, to), Math.max(from, to) + 1);
  const setWt = (key: string, wt: WebtoonPanel | undefined) => update(x => ({ ...x, cuts: { ...x.cuts, [key]: { ...x.cuts[key], wt } } }));

  const exportImages = async () => {
    if (!stripRef.current) return;
    const wasEdit = edit; setEdit(false); setBusy('그림 만드는 중…');
    await new Promise(r => setTimeout(r, 400));
    try {
      const els = Array.from(stripRef.current.querySelectorAll<HTMLElement>('.wt-scene'));
      let last = '';
      for (let i = 0; i < els.length; i++) {
        setBusy(`그림 만드는 중… ${i + 1}/${els.length}`);
        const cv = await html2canvas(els[i], { scale: 1.5, backgroundColor: '#ffffff', useCORS: true, logging: false });
        const blob: Blob = await new Promise(r => cv.toBlob(b => r(b!), 'image/jpeg', 0.9));
        last = await saveFile(blob, `${p.title}_웹툰_S${els[i].dataset.num}.jpg`, i === els.length - 1);
      }
      toast(`씬 ${els.length}개를 그림으로 저장했어요: ${last}`);
    } catch (e: any) { toast('저장 실패: ' + (e?.message || e)); }
    setBusy(''); setEdit(wasEdit);
  };

  return (
    <div className="page"><div className="page-inner">
      <div className="toolbar">
        <b>웹툰</b>
        <span className="muted small-t">씬</span>
        <select value={from} onChange={e => { const v = +e.target.value; setFrom(v); if (to < v) setTo(v); }}>{scenes.map((s, i) => <option key={s.id} value={i}>S#{s.num}</option>)}</select>
        <span>~</span>
        <select value={to} onChange={e => { const v = +e.target.value; setTo(v); if (from > v) setFrom(v); }}>{scenes.map((s, i) => <option key={s.id} value={i}>S#{s.num}</option>)}</select>
        <label className="small-t row" style={{ gap: 4 }}><input type="checkbox" checked={titles} onChange={e => setTitles(e.target.checked)} />씬 제목</label>
        <div className="grow" />
        <button className={edit ? 'primary' : ''} onClick={() => setEdit(!edit)}>{edit ? '고치기 끝' : '말풍선·효과 고치기'}</button>
        <button className="primary" onClick={exportImages} disabled={!!busy}>{busy || '그림으로 저장'}</button>
      </div>
      <p className="muted small-t" style={{ marginTop: -6 }}>
        그림 탭에서 넣은 컷 그림을 세로로 이어 보여 줘요. 대사는 말풍선으로, 효과음과 화면 효과는 대본과 장면 묘사를 보고 자동으로 넣어요.
        {edit ? ' 말풍선과 효과음은 끌어서 옮기고, 누르면 글을 고칠 수 있어요.' : ' "말풍선·효과 고치기"를 누르면 옮기거나 고칠 수 있어요.'}
      </p>
      <div ref={stripRef} className="wt-strip">
        {shown.map(s => <WtScene key={s.id} p={p} scene={s} names={names} ratio={ratio} edit={edit} title={titles} setWt={setWt} />)}
        {!shown.length && <p className="muted">씬이 없어요.</p>}
      </div>
    </div></div>
  );
}

function WtScene({ p, scene, names, ratio, edit, title, setWt }: { p: WsProps['p']; scene: Scene; names: string[]; ratio: number; edit: boolean; title: boolean; setWt: (k: string, wt: WebtoonPanel | undefined) => void }) {
  const cuts = getCuts(p, scene, names);
  return <div className="wt-scene" data-num={scene.num}>
    {title && <div className="wt-title">S#{scene.num}. {scene.heading.replace(/^S#?\s*\d+\.?\s*/, '')}</div>}
    {cuts.map(c => <Panel key={c.key} cut={c} meta={p.cuts[c.key] || {}} ratio={ratio} edit={edit} names={[...new Set([...c.auto.chars, ...c.dialogues.map(d => d.speaker)])].filter(Boolean)} setWt={wt => setWt(c.key, wt)} />)}
  </div>;
}

type Sel = { t: 'b' | 's'; id: string } | null;

function Panel({ cut, meta, ratio, edit, names, setWt }: { cut: Cut; meta: CutMeta; ratio: number; edit: boolean; names: string[]; setWt: (wt: WebtoonPanel | undefined) => void }) {
  const saved = panelOf(cut, meta);
  const [draft, setDraft] = useState<WebtoonPanel | null>(null); // 끄는 중
  const pan = draft || saved;
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [h, setH] = useState(Math.round(W / ratio));
  const [sel, setSel] = useState<Sel>(null);
  const fxKey = pan.fx.join(',');
  useEffect(() => { if (cv.current) { cv.current.width = W; cv.current.height = h; drawFx(cv.current, pan.fx, cut.key); } }, [fxKey, h, cut.key]);
  useEffect(() => { if (!edit) setSel(null); }, [edit]);
  const save = (np: WebtoonPanel) => { setDraft(null); setWt(np); };
  const drag = useRef<{ t: 'b' | 's'; id: string; sx: number; sy: number; x: number; y: number; moved: boolean } | null>(null);
  const down = (t: 'b' | 's', id: string, x: number, y: number) => (e: React.PointerEvent) => {
    if (!edit) return;
    e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { t, id, sx: e.clientX, sy: e.clientY, x, y, moved: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const dx = (e.clientX - d.sx) / r.width, dy = (e.clientY - d.sy) / r.height;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
    if (!d.moved) return;
    const nx = Math.min(0.98, Math.max(0.02, d.x + dx)), ny = Math.min(0.98, Math.max(0.02, d.y + dy));
    const base = draft || saved;
    setDraft(d.t === 'b' ? { ...base, bubbles: base.bubbles.map(b => b.id === d.id ? { ...b, x: nx, y: ny } : b) } : { ...base, sfx: base.sfx.map(s => s.id === d.id ? { ...s, x: nx, y: ny } : s) });
  };
  const up = () => {
    const d = drag.current; drag.current = null; if (!d) return;
    if (d.moved && draft) save(draft); else setSel({ t: d.t, id: d.id });
  };
  const selB = sel?.t === 'b' ? pan.bubbles.find(b => b.id === sel.id) : undefined;
  const selS = sel?.t === 's' ? pan.sfx.find(s => s.id === sel.id) : undefined;
  const setB = (patch: Partial<Bubble>) => selB && save({ ...pan, bubbles: pan.bubbles.map(b => b.id === selB.id ? { ...b, ...patch } : b) });
  const setS = (patch: Partial<Sfx>) => selS && save({ ...pan, sfx: pan.sfx.map(s => s.id === selS.id ? { ...s, ...patch } : s) });
  const toggleFx = (k: FxKind) => save({ ...pan, fx: pan.fx.includes(k) ? pan.fx.filter(x => x !== k) : [...pan.fx, k] });
  const addBubble = () => { const b: Bubble = { id: wid(), speaker: names[0] || '', text: '대사', kind: 'talk', x: 0.5, y: 0.2, tx: 0.5 }; save({ ...pan, bubbles: [...pan.bubbles, b] }); setSel({ t: 'b', id: b.id }); };
  const addSfx = () => { const s: Sfx = { id: wid(), text: '쾅!', x: 0.5, y: 0.5, size: 54, rot: -8 }; save({ ...pan, sfx: [...pan.sfx, s] }); setSel({ t: 's', id: s.id }); };

  return <div className={'wt-panel' + (edit ? ' editing' : '')}>
    <div ref={box} className="wt-box" style={{ minHeight: meta.img ? undefined : h }} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setDraft(null); }} onClick={() => edit && setSel(null)}>
      {meta.img ? <ImgSized id={meta.img} onH={setH} /> : <div className="wt-empty" style={{ height: h }}><b>{cut.label}</b><span>{(meta.desc || cut.auto.see || cut.action || '').slice(0, 160)}</span><i>그림 탭에서 그림을 넣으면 여기에 보여요</i></div>}
      {pan.fx.includes('shake') && meta.img && <div className="wt-ghost"><Img id={meta.img} /></div>}
      <canvas ref={cv} className="wt-fx" />
      {pan.sfx.map(s => <div key={s.id} className={'wt-sfx' + (sel?.id === s.id ? ' sel' : '')} onPointerDown={down('s', s.id, s.x, s.y)} onClick={e => e.stopPropagation()}
        style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, fontSize: s.size, transform: `translate(-50%,-50%) rotate(${s.rot}deg)`, color: s.color || '#fff' }}>{s.text}</div>)}
      {pan.bubbles.map(b => <BubbleView key={b.id} b={b} sel={sel?.id === b.id} onDown={down('b', b.id, b.x, b.y)} />)}
    </div>
    {edit && <div className="wt-tools">
      <div className="row">
        <b className="small-t">{cut.label}</b>
        <button className="small" onClick={addBubble}>+ 말풍선</button>
        <button className="small" onClick={addSfx}>+ 효과음</button>
        {FX_LABEL.map(([k, l]) => <button key={k} className={'small' + (pan.fx.includes(k) ? ' primary' : '')} onClick={() => toggleFx(k)}>{l}</button>)}
        <div className="grow" />
        {meta.wt && <button className="small" onClick={() => { setSel(null); setWt(undefined); }}>자동으로 되돌리기</button>}
      </div>
      {selB && <div className="row" style={{ marginTop: 6 }}>
        <select value={selB.kind} onChange={e => setB({ kind: e.target.value as BubbleKind })}>{KIND_LABEL.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={selB.speaker} onChange={e => setB({ speaker: e.target.value })}><option value="">(이름 없음)</option>{[...new Set([...names, selB.speaker])].filter(Boolean).map(n => <option key={n} value={n}>{n}</option>)}</select>
        <input style={{ flex: 1, minWidth: 200 }} value={selB.text} onChange={e => setB({ text: e.target.value })} />
        <span className="small-t muted">꼬리</span>
        <input type="range" min={0} max={100} value={Math.round((selB.tx ?? selB.x) * 100)} onChange={e => setB({ tx: +e.target.value / 100 })} />
        <button className="small danger" onClick={() => { save({ ...pan, bubbles: pan.bubbles.filter(b => b.id !== selB.id) }); setSel(null); }}>지우기</button>
      </div>}
      {selS && <div className="row" style={{ marginTop: 6 }}>
        <input style={{ width: 160 }} value={selS.text} onChange={e => setS({ text: e.target.value })} />
        <span className="small-t muted">크기</span><input type="range" min={20} max={110} value={selS.size} onChange={e => setS({ size: +e.target.value })} />
        <span className="small-t muted">기울기</span><input type="range" min={-40} max={40} value={selS.rot} onChange={e => setS({ rot: +e.target.value })} />
        {['#ffffff', '#ffd400', '#ff3b30', '#111111'].map(c => <button key={c} className="small" style={{ background: c, width: 34, padding: 0, border: (selS.color || '#ffffff') === c ? '3px solid var(--accent)' : undefined }} onClick={() => setS({ color: c })} />)}
        <button className="small danger" onClick={() => { save({ ...pan, sfx: pan.sfx.filter(s => s.id !== selS.id) }); setSel(null); }}>지우기</button>
      </div>}
    </div>}
  </div>;
}

function ImgSized({ id, onH }: { id: string; onH: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => { const im = el.querySelector('img'); if (im && im.naturalWidth) onH(Math.round(W * im.naturalHeight / im.naturalWidth)); });
    ro.observe(el); return () => ro.disconnect();
  }, [id]);
  return <div ref={ref} className="wt-img"><Img id={id} /></div>;
}

/** 말풍선: 모양은 SVG, 글은 위에 */
function BubbleView({ b, sel, onDown }: { b: Bubble; sel: boolean; onDown: (e: React.PointerEvent) => void }) {
  const tail = b.kind === 'talk' || b.kind === 'shout' || b.kind === 'think';
  const tx = b.tx ?? b.x;
  const tailLeft = Math.min(78, Math.max(22, 50 + (tx - b.x) * 220));
  const shape = (() => {
    const st = { fill: '#fff', stroke: '#111', strokeWidth: 2.5, vectorEffect: 'non-scaling-stroke' as const };
    if (b.kind === 'shout') {
      const pts: string[] = []; const N = 22;
      for (let i = 0; i < N * 2; i++) { const a = (i / (N * 2)) * Math.PI * 2; const r = i % 2 ? 50 : 41; pts.push(`${50 + Math.cos(a) * r},${50 + Math.sin(a) * r}`); }
      return <polygon points={pts.join(' ')} {...st} />;
    }
    if (b.kind === 'off') return <rect x="1.5" y="1.5" width="97" height="97" rx="10" {...st} strokeDasharray="6 4" />;
    if (b.kind === 'nar') return <rect x="1" y="1" width="98" height="98" {...st} fill="#fff7d6" />;
    if (b.kind === 'think') return <ellipse cx="50" cy="50" rx="48.5" ry="48" {...st} strokeDasharray="3 3" />;
    return <ellipse cx="50" cy="50" rx="48.5" ry="48" {...st} />;
  })();
  return <div className={'wt-bubble k-' + b.kind + (sel ? ' sel' : '')} onPointerDown={onDown} onClick={e => e.stopPropagation()} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%` }}>
    <svg className="wt-shape" viewBox="0 0 100 100" preserveAspectRatio="none">{shape}</svg>
    {tail && b.kind !== 'think' && <div className="wt-tail2" style={{ left: `${tailLeft}%`, transform: `translateX(-50%) skewX(${tx < b.x - 0.02 ? 28 : tx > b.x + 0.02 ? -28 : 0}deg)` }}><i /><b /></div>}
    {b.kind === 'think' && <svg className="wt-tail" viewBox="0 0 30 34" style={{ left: `${tailLeft}%`, transform: 'translateX(-50%)' }}>
      <circle cx="12" cy="10" r="6" fill="#fff" stroke="#111" strokeWidth="2" /><circle cx="8" cy="26" r="3.5" fill="#fff" stroke="#111" strokeWidth="2" /></svg>}
    <div className="wt-text">{b.kind === 'off' && b.speaker ? <small>{b.speaker}</small> : null}{b.text}</div>
  </div>;
}
