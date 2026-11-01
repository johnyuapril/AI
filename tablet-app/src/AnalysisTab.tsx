import { useMemo } from 'react';
import type { WsProps } from './Workspace';
import { dialogueVolume, estimatePages, getScenes, isNightTime, knownNames, sceneStats } from './script';
import { saveFile } from './native';
import { toCSV } from './util';
import { useToast } from './ui';

const normPlace = (s: string) => s.replace(/\s*[-–,/].*$/, '').replace(/\s+/g, ' ').trim();

export default function AnalysisTab({ p, go }: WsProps) {
  const toast = useToast();
  const scenes = useMemo(() => getScenes(p.lines), [p.lines]);
  const names = useMemo(() => knownNames(p), [p.lines, p.chars]);
  const vol = useMemo(() => Object.entries(dialogueVolume(p.lines)).sort((a, b) => b[1].chars - a[1].chars), [p.lines]);
  const stats = useMemo(() => scenes.map(s => ({ s, st: sceneStats(s, names) })), [scenes, names]);
  const cols = useMemo(() => {
    const c = new Map<string, number>();
    for (const { st } of stats) for (const n of st.chars) c.set(n, (c.get(n) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
  }, [stats]);
  const places = useMemo(() => {
    const m = new Map<string, { day: number; night: number; scenes: number[] }>();
    for (const s of scenes) {
      const k = normPlace(s.place) || '(장소 없음)';
      const e = m.get(k) || { day: 0, night: 0, scenes: [] };
      if (isNightTime(s.time, s.lines.map(l => l.text).join(' '))) e.night++; else e.day++;
      e.scenes.push(s.num); m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => b[1].scenes.length - a[1].scenes.length);
  }, [scenes]);
  const max = Math.max(1, ...vol.map(v => v[1].chars));
  const total = vol.reduce((a, v) => a + v[1].chars, 0) || 1;

  const save = async (rows: unknown[][], name: string) => { const path = await saveFile(new Blob([toCSV(rows)], { type: 'text/csv' }), `${p.title}_${name}.csv`); toast('저장했어요: ' + path); };

  return (
    <div className="page"><div className="page-inner">
      <div className="toolbar"><b>분석</b><span className="muted small-t">씬 {scenes.length}개 · 약 {estimatePages(p.lines).toFixed(1)}쪽 · 등장인물 {cols.length}명 · 장소 {places.length}곳</span></div>

      <div className="box"><div className="box-h"><b>대사 분량</b><div className="grow" />
        <button className="small" onClick={() => save([['인물', '대사 글자 수', '비율(%)', '대사 수', '나오는 씬 수'], ...vol.map(([n, v]) => [n, v.chars, (v.chars / total * 100).toFixed(1), v.count, v.scenes.size])], '대사분량')}>CSV</button></div>
        <div className="box-b" style={{ display: 'grid', gap: 6 }}>
          {!vol.length && <span className="muted">대사가 없어요.</span>}
          {vol.map(([n, v]) => (
            <div key={n} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 160px', alignItems: 'center', gap: 10 }}>
              <b>{n}</b>
              <div style={{ background: 'var(--soft)', borderRadius: 6, height: 22 }}><div style={{ width: `${v.chars / max * 100}%`, background: 'var(--ink)', height: '100%', borderRadius: 6 }} /></div>
              <span className="small-t">{v.chars}자 ({(v.chars / total * 100).toFixed(0)}%) · {v.count}번</span>
            </div>
          ))}
        </div></div>

      <div className="box"><div className="box-h"><b>씬별 등장인물</b><span className="muted small-t">숫자 = 대사 수, ● = 지문에만 나옴</span><div className="grow" />
        <button className="small" onClick={() => save([['씬', '장소', ...cols], ...stats.map(({ s, st }) => [s.num, s.heading, ...cols.map(c => st.speakers[c] || (st.mentions[c] ? '●' : ''))])], '씬별인물')}>CSV</button></div>
        <div className="box-b" style={{ overflowX: 'auto' }}>
          <table className="grid"><thead><tr><th>씬</th><th style={{ textAlign: 'left' }}>장소</th>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{stats.map(({ s, st }) => (
              <tr key={s.id} onClick={() => go('script', s.id)} style={{ cursor: 'pointer' }}>
                <td>{s.num}</td><td style={{ textAlign: 'left', whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.place} {s.time && <span className="muted">/ {s.time}</span>}</td>
                {cols.map(c => <td key={c} style={{ textAlign: 'center' }}>{st.speakers[c] || (st.mentions[c] ? '●' : '')}</td>)}
              </tr>))}</tbody></table>
        </div></div>

      <div className="box"><div className="box-h"><b>장소</b><div className="grow" />
        <button className="small" onClick={() => save([['장소', '씬 수', '낮', '밤', '씬 번호'], ...places.map(([k, v]) => [k, v.scenes.length, v.day, v.night, v.scenes.join(' ')])], '장소')}>CSV</button></div>
        <div className="box-b"><table className="grid"><thead><tr><th style={{ textAlign: 'left' }}>장소</th><th>씬 수</th><th>낮</th><th>밤</th><th style={{ textAlign: 'left' }}>씬 번호</th></tr></thead>
          <tbody>{places.map(([k, v]) => <tr key={k}><td style={{ textAlign: 'left' }}>{k}</td><td style={{ textAlign: 'center' }}>{v.scenes.length}</td><td style={{ textAlign: 'center' }}>{v.day || ''}</td><td style={{ textAlign: 'center' }}>{v.night || ''}</td><td>{v.scenes.join(', ')}</td></tr>)}</tbody></table></div></div>
    </div></div>
  );
}
