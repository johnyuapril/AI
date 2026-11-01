import type { Project } from './types';
import { autoSummary, cutValues, estimatePages, getCuts, getScenes, knownNames, sceneStats, TYPE_LABEL } from './script';
import { ANGLES, MOVES, termLabel } from './shots';

export type Rows = (string | number)[][];

export function sceneRows(p: Project): Rows {
  const scenes = getScenes(p.lines); const names = knownNames(p);
  const rows: Rows = [['S#', '장소', '시간', '등장인물', '내용', '컷수', '쪽', '예상 초', '대사 수', '비고']];
  for (const s of scenes) {
    const st = sceneStats(s, names); const cuts = getCuts(p, s, names);
    rows.push([s.num, s.place, s.time, st.chars.join(', '), p.scenes[s.id]?.summary || autoSummary(s), cuts.length, +estimatePages(s.lines).toFixed(1), cuts.reduce((a, c) => a + c.seconds, 0), st.dialogueCount, p.scenes[s.id]?.notes || '']);
  }
  return rows;
}

export function cutRows(p: Project): Rows {
  const scenes = getScenes(p.lines); const names = knownNames(p);
  const rows: Rows = [['컷', 'S#', '장소', '시간', '샷 크기', '앵글', '움직임', '인물', '화면 내용', '대사', '초', '그림 칸']];
  for (const s of scenes) for (const c of getCuts(p, s, names)) {
    const v = cutValues(p, c);
    rows.push([c.label, s.num, s.place, s.time, v.shot || '', termLabel(ANGLES, v.angle), termLabel(MOVES, v.move), v.chars.join(', '), p.cuts[c.key]?.desc || c.action, c.dialogues.map(d => `${d.speaker}: ${d.text}`).join(' / '), c.seconds, '']);
  }
  return rows;
}

export function describeRows(p: Project): Rows {
  const scenes = getScenes(p.lines); const names = knownNames(p);
  const rows: Rows = [['컷', 'S#', '장소', '대본', '장면 묘사', '바로잡기']];
  for (const s of scenes) for (const c of getCuts(p, s, names)) {
    const m = p.cuts[c.key] || {};
    const src = [c.action, ...c.dialogues.map(d => `${d.speaker}${d.off ? '(소리)' : ''}: ${d.text}`)].filter(Boolean).join('\n');
    rows.push([c.label, s.num, s.heading, src, m.desc || '', m.corr || '']);
  }
  return rows;
}

export function describeText(p: Project): string[] {
  const scenes = getScenes(p.lines); const names = knownNames(p);
  const out: string[] = [];
  for (const s of scenes) {
    const cuts = getCuts(p, s, names);
    out.push(`S#${s.num}. ${s.heading}`);
    const st = p.scenes[s.id]?.setTable; if (st) out.push('[설정표]', st);
    for (const c of cuts) { const d = p.cuts[c.key]?.desc; if (d) out.push(`[${c.label}] ${d}`); }
    out.push('');
  }
  return out;
}

/** 대본: 줄 종류와 글자 (구글 문서에서 서식을 입힘) */
export function scriptParas(p: Project): { t: string; text: string }[] {
  let n = 0;
  return p.lines.filter(l => l.text.trim() || l.t === 'scene').map(l => ({ t: l.t, text: l.t === 'scene' ? `S#${++n}. ${l.text}` : l.text }));
}
export { TYPE_LABEL };
