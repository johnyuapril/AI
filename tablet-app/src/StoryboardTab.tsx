import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { WsProps } from './Workspace';
import type { CutMeta } from './types';
import { getCuts, getScenes, knownNames, cutValues, type Cut, type Scene } from './script';
import { shotLabel } from './shots';
import { Img, Modal, useToast } from './ui';
import { pickFiles, saveFile } from './native';
import { imageFromClipboard, imageFromPaste, storeImageFile } from './images';
import { pagesToPdf } from './pdf';
import DrawPad from './DrawPad';
import { toCSV } from './util';

type Fmt = 'basic' | 'grid6' | 'shotlist';
const ASPECTS: [string, number][] = [['16:9', 16 / 9], ['2.39:1', 2.39], ['1.85:1', 1.85], ['4:3', 4 / 3], ['1:1', 1]];

interface Row { scene: Scene; cut: Cut; meta: CutMeta; ctx: string; audio: string; time: string }

function autoCtx(c: Cut, m: CutMeta, p: WsProps['p']): string {
  const v = cutValues(p, c);
  const head = shotLabel(v);
  const body = (m.desc || c.action || '').trim();
  return [head && `[${head}]`, body].filter(Boolean).join('\n');
}
function autoAudio(c: Cut): string {
  return c.dialogues.map(d => `${d.speaker}${d.off ? '(소리)' : ''}${d.paren ? ' ' + d.paren : ''}: ${d.text}`).join('\n');
}

export default function StoryboardTab(props: WsProps) {
  const { p, update, focusScene } = props;
  const toast = useToast();
  const scenes = useMemo(() => getScenes(p.lines), [p.lines]);
  const names = useMemo(() => knownNames(p), [p.lines, p.chars]);
  const fmt = (p.sbFormat as Fmt) || 'basic';
  const aspect = p.aspect || '16:9';
  const ratio = ASPECTS.find(a => a[0] === aspect)?.[1] || 16 / 9;
  const startIdx = focusScene ? Math.max(0, scenes.findIndex(s => s.id === focusScene)) : 0;
  const [from, setFrom] = useState(startIdx);
  const [to, setTo] = useState(focusScene ? startIdx : Math.max(0, scenes.length - 1));
  const [zoom, setZoom] = useState(0.8);
  const [busy, setBusy] = useState('');
  const [editText, setEditText] = useState<{ key: string; field: 'ctx' | 'audio' | 'time'; auto: string; label: string } | null>(null);
  const [editImg, setEditImg] = useState<Row | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (to >= scenes.length) setTo(Math.max(0, scenes.length - 1)); }, [scenes.length]);

  const rowsByScene = useMemo(() => scenes.slice(from, to + 1).map(s => ({
    scene: s,
    rows: getCuts(p, s, names).map(c => {
      const m = p.cuts[c.key] || {};
      return { scene: s, cut: c, meta: m, ctx: m.ctx ?? autoCtx(c, m, p), audio: m.audio ?? autoAudio(c), time: m.time ?? `${c.seconds}s` } as Row;
    }),
  })), [p, scenes, from, to, names]);

  const setMeta = (key: string, patch: Partial<CutMeta>) => update(x => ({ ...x, cuts: { ...x.cuts, [key]: { ...x.cuts[key], ...patch } } }));
  const setImg = async (row: Row, b: Blob) => { const id = await storeImageFile(b); setMeta(row.cut.key, { img: id, wait: false }); setEditImg(null); toast(`${row.cut.label} 그림을 넣었어요.`); };

  const per = fmt === 'grid6' ? 6 : fmt === 'shotlist' ? 22 : 5;
  const pages: { scene: Scene; rows: Row[]; first: boolean }[] = [];
  for (const g of rowsByScene) {
    if (!g.rows.length) continue;
    for (let i = 0; i < g.rows.length; i += per) pages.push({ scene: g.scene, rows: g.rows.slice(i, i + per), first: i === 0 });
  }
  const landscape = fmt === 'grid6';

  const exportPdf = async () => {
    if (!pagesRef.current || !pages.length) return;
    setBusy('PDF 만드는 중…');
    const z = zoom; setZoom(1);
    await new Promise(r => setTimeout(r, 300));
    try {
      const els = Array.from(pagesRef.current.querySelectorAll<HTMLElement>('.sb-page'));
      const blob = await pagesToPdf(els, landscape);
      const path = await saveFile(blob, `${p.title}_스토리보드.pdf`);
      toast('저장했어요: ' + path);
    } catch (e: any) { toast('PDF 실패: ' + (e?.message || e)); }
    setZoom(z); setBusy('');
  };
  const exportCsv = async () => {
    const rows: unknown[][] = [['컷', '씬', '샷', '내용', '소리', '시간']];
    for (const g of rowsByScene) for (const r of g.rows) rows.push([r.cut.label, r.scene.heading, shotLabel(cutValues(p, r.cut)), r.ctx, r.audio, r.time]);
    const path = await saveFile(new Blob([toCSV(rows)], { type: 'text/csv' }), `${p.title}_샷리스트.csv`); toast('저장했어요: ' + path);
  };

  const editable = (r: Row, field: 'ctx' | 'audio' | 'time', label: string) => () =>
    setEditText({ key: r.cut.key, field, label: `${r.cut.label} ${label}`, auto: field === 'ctx' ? autoCtx(r.cut, r.meta, p) : field === 'audio' ? autoAudio(r.cut) : `${r.cut.seconds}s` });

  const Video = ({ r, w }: { r: Row; w: number }) => (
    <div className="sb-video" style={{ width: w, height: Math.round(w / ratio) }} onClick={() => setEditImg(r)}>
      {r.meta.img ? <Img id={r.meta.img} /> : <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 12 }}>눌러서 그림 넣기</span>}
    </div>
  );
  const Head = ({ i, scene }: { i: number; scene: Scene }) => (
    <>
      <div className="sb-head"><span><b>Title</b> {p.title}</span><span><b>Team</b> {p.team}</span><span className="pn">{i + 1} / {pages.length}</span></div>
      <div className="sb-sceneinfo">S#{scene.num}. {scene.heading.replace(/^S#?\s*\d+\.?\s*/, '')}</div>
    </>
  );

  return (
    <div className="page"><div className="page-inner">
      <div className="toolbar">
        <b>스토리보드</b>
        <select value={fmt} onChange={e => update(x => ({ ...x, sbFormat: e.target.value }))}>
          <option value="basic">기본 콘티 (A4 세로, 5컷)</option>
          <option value="grid6">6컷 모아보기 (A4 가로)</option>
          <option value="shotlist">샷 리스트 (표)</option>
        </select>
        <select value={aspect} onChange={e => update(x => ({ ...x, aspect: e.target.value }))} title="화면 비율">
          {ASPECTS.map(([a]) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="muted small-t">씬</span>
        <select value={from} onChange={e => { const v = +e.target.value; setFrom(v); if (to < v) setTo(v); }}>{scenes.map((s, i) => <option key={s.id} value={i}>S#{s.num}</option>)}</select>
        <span>~</span>
        <select value={to} onChange={e => { const v = +e.target.value; setTo(v); if (from > v) setFrom(v); }}>{scenes.map((s, i) => <option key={s.id} value={i}>S#{s.num}</option>)}</select>
        <input placeholder="Team" value={p.team} onChange={e => update(x => ({ ...x, team: e.target.value }))} style={{ width: 120 }} />
        <div className="grow" />
        <button className="small" onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(1)))}>－</button>
        <span className="small-t">{Math.round(zoom * 100)}%</span>
        <button className="small" onClick={() => setZoom(z => Math.min(1.5, +(z + 0.1).toFixed(1)))}>＋</button>
        {fmt === 'shotlist' && <button onClick={exportCsv}>CSV</button>}
        <button className="primary" onClick={exportPdf} disabled={!!busy}>{busy || 'PDF로 저장'}</button>
      </div>
      {!pages.length && <p className="muted">컷이 없어요. 대본 탭에서 씬과 지문을 먼저 써 주세요.</p>}
      <p className="muted small-t" style={{ marginTop: -6 }}>칸을 누르면 고칠 수 있어요. 그림 칸은 갤러리에서 넣거나 직접 그릴 수 있어요. 씬마다 새 쪽에서 시작해요.</p>
      <div ref={pagesRef} className="sb-pages" style={{ zoom } as React.CSSProperties}>
        {pages.map((pg, i) => (
          <div key={pg.scene.id + i} className={'sb-page ' + (landscape ? 'landscape' : 'portrait')}>
            <Head i={i} scene={pg.scene} />
            {fmt === 'basic' && (
              <table className="sb-table">
                <colgroup><col style={{ width: 46 }} /><col style={{ width: 300 }} /><col /><col /><col style={{ width: 44 }} /></colgroup>
                <thead><tr><th>Cut</th><th>Video</th><th>Context</th><th>Audio</th><th>Time</th></tr></thead>
                <tbody>
                  {pg.rows.map(r => (
                    <tr key={r.cut.key} style={{ height: 186 }}>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>{r.cut.label}</td>
                      <td><Video r={r} w={292} /></td>
                      <td className="ctx"><div className={'clamp' + (r.meta.ctx != null ? ' tag-manual' : '')} style={{ WebkitLineClamp: 9, minHeight: 160 }} onClick={editable(r, 'ctx', 'Context')}>{r.ctx}</div></td>
                      <td><div className="clamp" style={{ WebkitLineClamp: 11, minHeight: 160 }} onClick={editable(r, 'audio', 'Audio')}>{r.audio}</div></td>
                      <td style={{ textAlign: 'center' }} onClick={editable(r, 'time', 'Time')}>{r.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {fmt === 'grid6' && (
              <div className="sb-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {pg.rows.map(r => (
                  <div key={r.cut.key} className="sb-cell">
                    <div className="cap">{r.cut.label} <span style={{ fontWeight: 400 }}>{shotLabel(cutValues(p, r.cut))} · {r.time}</span></div>
                    <Video r={r} w={334} />
                    <div className="clamp" style={{ WebkitLineClamp: 3 }} onClick={editable(r, 'ctx', 'Context')}>{r.ctx.replace(/^\[[^\]]*\]\n?/, '')}</div>
                    {r.audio && <div className="clamp" style={{ WebkitLineClamp: 2, color: '#444' }} onClick={editable(r, 'audio', 'Audio')}>{r.audio}</div>}
                  </div>
                ))}
              </div>
            )}
            {fmt === 'shotlist' && (
              <table className="sb-table">
                <colgroup><col style={{ width: 50 }} /><col style={{ width: 130 }} /><col /><col style={{ width: 200 }} /><col style={{ width: 44 }} /></colgroup>
                <thead><tr><th>Cut</th><th>Shot</th><th>내용</th><th>소리</th><th>Time</th></tr></thead>
                <tbody>
                  {pg.rows.map(r => (
                    <tr key={r.cut.key}>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>{r.cut.label}</td>
                      <td>{shotLabel(cutValues(p, r.cut))}</td>
                      <td><div className="clamp" style={{ WebkitLineClamp: 2 }} onClick={editable(r, 'ctx', 'Context')}>{r.ctx.replace(/^\[[^\]]*\]\n?/, '')}</div></td>
                      <td><div className="clamp" style={{ WebkitLineClamp: 2 }} onClick={editable(r, 'audio', 'Audio')}>{r.audio}</div></td>
                      <td style={{ textAlign: 'center' }} onClick={editable(r, 'time', 'Time')}>{r.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
      {editText && <TextEdit {...editText} value={(p.cuts[editText.key] || {})[editText.field] ?? editText.auto}
        onClose={() => setEditText(null)}
        onSave={v => { setMeta(editText.key, { [editText.field]: v === editText.auto ? undefined : v }); setEditText(null); }}
        onReset={() => { setMeta(editText.key, { [editText.field]: undefined }); setEditText(null); }} />}
      {editImg && <ImgEdit row={editImg} ratio={ratio} onClose={() => setEditImg(null)} onSet={b => setImg(editImg, b)}
        onRemove={() => { setMeta(editImg.cut.key, { img: undefined }); setEditImg(null); }} />}
    </div></div>
  );
}

function TextEdit({ label, value, auto, onSave, onReset, onClose }: { label: string; value: string; auto: string; onSave: (v: string) => void; onReset: () => void; onClose: () => void }) {
  const [v, setV] = useState(value);
  return (
    <Modal title={label} onClose={onClose} actions={<><button onClick={onReset}>자동으로 되돌리기</button><button className="primary" onClick={() => onSave(v)}>저장</button></>}>
      <textarea autoFocus value={v} onChange={e => setV(e.target.value)} rows={12} style={{ width: '100%', fontSize: 16 }} />
      {auto !== v && <p className="muted small-t">자동 내용: {auto.slice(0, 200)}</p>}
    </Modal>
  );
}

function ImgEdit({ row, ratio, onSet, onRemove, onClose }: { row: Row; ratio: number; onSet: (b: Blob) => void; onRemove: () => void; onClose: () => void }) {
  const [mode, setMode] = useState<'img' | 'draw'>('img');
  const toast = useToast();
  return (
    <Modal wide title={`${row.cut.label} 그림`} onClose={onClose} actions={<>
      <button className={mode === 'img' ? 'primary' : ''} onClick={() => setMode('img')}>그림 넣기</button>
      <button className={mode === 'draw' ? 'primary' : ''} onClick={() => setMode('draw')}>직접 그리기</button></>}>
      {mode === 'img' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="imgslot" style={{ width: '100%', maxWidth: 720, aspectRatio: String(ratio), margin: '0 auto' }} tabIndex={0}
            onPaste={e => { const f = imageFromPaste(e); if (f) onSet(f); }}>
            {row.meta.img ? <Img id={row.meta.img} /> : '아직 그림이 없어요'}
          </div>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button onClick={() => pickFiles('image/*').then(f => f[0] && onSet(f[0]))}>갤러리에서 고르기</button>
            <button onClick={async () => { const b = await imageFromClipboard(); if (b) onSet(b); else toast('클립보드에 그림이 없어요. 아래 칸을 길게 눌러 붙여넣기 해 보세요.'); }}>붙여넣기</button>
            {row.meta.img && <button onClick={onRemove}>그림 빼기</button>}
          </div>
          <div contentEditable suppressContentEditableWarning className="muted small-t"
            style={{ border: '1px dashed var(--line)', borderRadius: 8, padding: 14, textAlign: 'center' }}
            onPaste={e => { const f = imageFromPaste(e); e.preventDefault(); if (f) onSet(f); }}
            onInput={e => { (e.currentTarget as HTMLElement).textContent = '여기를 길게 눌러 붙여넣기'; }}>여기를 길게 눌러 붙여넣기</div>
          <p className="muted small-t" style={{ textAlign: 'center' }}>"직접 그리기"에서 S Pen으로 그리거나, 지금 그림 위에 덧그릴 수 있어요.</p>
        </div>
      ) : (
        <DrawPad bgId={row.meta.img} ratio={ratio} onSave={onSet} onCancel={() => setMode('img')} />
      )}
    </Modal>
  );
}
