import { useEffect, useRef, useState } from 'react';
import { getImageBlob } from './store';

type Tool = 'pen' | 'marker' | 'dark' | 'eraser';
export default function DrawPad({ bgId, ratio, onSave, onCancel }: { bgId?: string; ratio: number; onSave: (b: Blob) => void; onCancel: () => void }) {
  const W = 1600, H = Math.round(1600 / ratio);
  const bg = useRef<HTMLCanvasElement>(null);
  const dr = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [size, setSize] = useState(4);
  const [keepBg, setKeepBg] = useState(true);
  const undo = useRef<ImageData[]>([]);
  const penSeen = useRef(false);
  const last = useRef<{ x: number; y: number; p: number } | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const g = bg.current!.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    if (bgId) getImageBlob(bgId).then(async b => { if (!b) return; const im = await createImageBitmap(b); const s = Math.max(W / im.width, H / im.height); const w = im.width * s, h = im.height * s; g.drawImage(im, (W - w) / 2, (H - h) / 2, w, h); });
  }, [bgId]);

  const pos = (e: React.PointerEvent) => { const r = dr.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height, p: e.pressure || 0.5 }; };
  const down = (e: React.PointerEvent) => {
    if (e.pointerType === 'pen') penSeen.current = true;
    if (penSeen.current && e.pointerType === 'touch') return; // S펜 쓸 때 손바닥 무시
    dr.current!.setPointerCapture(e.pointerId);
    const g = dr.current!.getContext('2d')!;
    undo.current.push(g.getImageData(0, 0, W, H)); if (undo.current.length > 25) undo.current.shift(); force(x => x + 1);
    last.current = pos(e);
  };
  const move = (e: React.PointerEvent) => {
    if (!last.current) return;
    if (penSeen.current && e.pointerType === 'touch') return;
    const g = dr.current!.getContext('2d')!;
    const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() || [e.nativeEvent];
    for (const ev of evs) {
      const r = dr.current!.getBoundingClientRect();
      const pt = { x: (ev.clientX - r.left) * W / r.width, y: (ev.clientY - r.top) * H / r.height, p: ev.pressure || 0.5 };
      g.save();
      g.lineCap = 'round'; g.lineJoin = 'round';
      if (tool === 'eraser') { g.globalCompositeOperation = 'destination-out'; g.lineWidth = size * 8; g.strokeStyle = '#000'; }
      else if (tool === 'marker') { g.globalAlpha = 0.25; g.strokeStyle = '#555'; g.lineWidth = size * 6; }
      else if (tool === 'dark') { g.globalAlpha = 0.85; g.strokeStyle = '#111'; g.lineWidth = size * 5; }
      else { g.strokeStyle = '#000'; g.lineWidth = size * (0.4 + pt.p * 1.4); }
      g.beginPath(); g.moveTo(last.current!.x, last.current!.y); g.lineTo(pt.x, pt.y); g.stroke(); g.restore();
      last.current = pt;
    }
  };
  const up = () => { last.current = null; };
  const doUndo = () => { const d = undo.current.pop(); if (d) dr.current!.getContext('2d')!.putImageData(d, 0, 0); force(x => x + 1); };
  const clear = () => { const g = dr.current!.getContext('2d')!; undo.current.push(g.getImageData(0, 0, W, H)); g.clearRect(0, 0, W, H); force(x => x + 1); };
  const save = () => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    if (keepBg) g.drawImage(bg.current!, 0, 0);
    g.drawImage(dr.current!, 0, 0);
    c.toBlob(b => b && onSave(b), 'image/jpeg', 0.9);
  };
  return <div>
    <div className="row" style={{ marginBottom: 10 }}>
      {([['pen', '펜'], ['dark', '진한 붓'], ['marker', '회색 마커'], ['eraser', '지우개']] as [Tool, string][]).map(([t, l]) => <button key={t} className={tool === t ? 'primary' : ''} onClick={() => setTool(t)}>{l}</button>)}
      <label className="row small-t">굵기 <input type="range" min={1} max={12} value={size} onChange={e => setSize(+e.target.value)} /></label>
      <button onClick={doUndo} disabled={!undo.current.length}>되돌리기</button>
      <button onClick={clear}>그린 것 지우기</button>
      {bgId && <label className="row small-t"><input type="checkbox" checked={keepBg} onChange={e => setKeepBg(e.target.checked)} /> 원래 그림 위에</label>}
      <div className="grow" />
      <button onClick={onCancel}>취소</button>
      <button className="primary" onClick={save}>저장</button>
    </div>
    <div className="draw-area" style={{ width: '100%', maxWidth: `calc((100vh - 220px) * ${ratio})`, aspectRatio: `${ratio}` }}>
      <canvas ref={bg} width={W} height={H} style={{ opacity: keepBg ? 1 : 0.15 }} />
      <canvas ref={dr} width={W} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
    </div>
    <p className="muted small-t">S펜으로 그리면 손바닥은 무시해요. 펜은 누르는 힘에 따라 굵기가 바뀌어요.</p>
  </div>;
}
