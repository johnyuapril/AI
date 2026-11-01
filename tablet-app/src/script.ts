import type { AICut, CutMeta, Line, LineType, Project } from './types';
import { parseShotLine, type ShotInfo } from './shots';
import { countMentions } from './util';

export const TYPE_LABEL: Record<LineType, string> = {
  scene: '씬', action: '지문', character: '인물', dialogue: '대사', paren: '괄호', transition: '전환', shot: '샷',
};
export const TYPE_ORDER: LineType[] = ['scene', 'action', 'character', 'dialogue', 'paren', 'transition', 'shot'];

const TIMES = ['낮', '밤', '아침', '저녁', '새벽', '오전', '오후', '해질녘', '해 질 녘', '석양', '황혼', '동틀녘', '한낮', '심야', '같은 시각', '같은 시간', '연속', '이어서', '잠시 후', '다음 날', '며칠 후', 'DAY', 'NIGHT', 'MORNING', 'EVENING', 'DAWN', 'DUSK', 'CONTINUOUS', 'LATER'];
const TIME_RE = new RegExp(`\\s*[/\\-–—|,]\\s*(${TIMES.join('|')})\\s*\\)?\\.?\\s*$`, 'i');
const TIME_PAREN_RE = new RegExp(`\\s*\\((${TIMES.join('|')})\\)\\s*$`, 'i');

export function stripSceneNumber(t: string): string {
  return t.replace(/^\s*(S\s*#\s*\d+[A-Za-z]?|#\s*\d+[A-Za-z]?|씬\s*\d+|scene\s*\d+|\d+[A-Za-z]?)\s*[.):]?\s*/i, '').trim();
}
export function parseHeading(text: string): { place: string; time: string } {
  let t = stripSceneNumber(text);
  let time = '';
  let m = t.match(TIME_RE) || t.match(TIME_PAREN_RE);
  if (m) { time = m[1]; t = t.slice(0, m.index).trim(); }
  t = t.replace(/^(INT\.?\/EXT\.?|INT\.?|EXT\.?|I\/E\.?)\s*/i, '').replace(/^(내부|외부)\.?\s*/, '');
  return { place: t.replace(/[.\s]+$/, ''), time };
}
export function looksLikeHeading(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 60) return false;
  if (/^(S\s*#\s*\d+|#\s*\d+|씬\s*\d+)/i.test(t)) return true;
  if (/^(INT|EXT|I\/E)[.\s]/.test(t)) return true;
  const s = stripSceneNumber(t);
  return TIME_RE.test(s) || TIME_PAREN_RE.test(s);
}
export function isNightTime(time: string, extra = ''): boolean {
  return /밤|저녁|새벽|심야|해질|황혼|석양|NIGHT|EVENING|DUSK/i.test(time) || /밤바다|어둠|가로등|달빛|네온/.test(extra);
}
export const TRANSITION_RE = /^(CUT TO|FADE (IN|OUT)|DISSOLVE|SMASH CUT|MATCH CUT|F\.?\s?[IO]\.?|O\.?L\.?|컷 ?투|페이드 ?(인|아웃)|디졸브|암전|화면 ?전환|오버랩|(장면|씬) ?전환)\s*[.:]?\s*(TO)?\s*[:.]?$/i;

export interface Scene { id: string; idx: number; num: number; heading: string; place: string; time: string; start: number; end: number; lines: Line[] }

export function getScenes(lines: Line[]): Scene[] {
  const out: Scene[] = [];
  let cur: Scene | null = null;
  lines.forEach((l, i) => {
    if (l.t === 'scene') {
      if (cur) cur.end = i;
      const { place, time } = parseHeading(l.text);
      cur = { id: l.id, idx: out.length, num: out.length + 1, heading: l.text, place, time, start: i, end: lines.length, lines: [] };
      out.push(cur);
    } else if (cur) cur.lines.push(l);
  });
  return out;
}

/** 대본 전체에서 대사로 나온 인물 + 등록 인물 */
export function knownNames(p: Project): string[] {
  const s = new Set<string>(p.chars.map(c => c.name));
  for (const l of p.lines) if (l.t === 'character') { const n = speakerName(l.text); if (n) s.add(n); }
  return [...s].filter(Boolean);
}
export function speakerName(t: string): string {
  return t.replace(/\(.*?\)/g, '').replace(/\s+(V\.?O\.?|O\.?S\.?|NA|E)\s*$/i, '').trim();
}
export function isOffscreenTag(t: string): boolean {
  return /\((V\.?O\.?|O\.?S\.?|Na|NA|E|소리|목소리|전화|off|OFF|화면 ?밖|내레이션|N)\)/i.test(t) || /\s(V\.?O\.?|O\.?S\.?)$/i.test(t);
}

/** Enter 칠 때 줄 내용을 보고 요소를 자동 판별 (직접 고른 줄은 안 건드림) */
export function autoDetect(line: Line, names: Set<string>): LineType | null {
  if (line.m) return null;
  const t = line.text.trim();
  if (!t) return null;
  if (line.t === 'dialogue') {
    if (/^\(.*\)$/.test(t)) return 'paren';
    return null;
  }
  if (line.t === 'scene') return null;
  if (TRANSITION_RE.test(t)) return 'transition';
  if (/^\(.*\)$/.test(t) && t.length < 40) return 'paren';
  if (looksLikeHeading(t)) return 'scene';
  if (parseShotLine(t)) return 'shot';
  if (names.has(speakerName(t)) && t.length <= 20) return 'character';
  if (line.t === 'character') {
    // 인물 칸인데 문장이면 지문
    if (/[.!?…]$/.test(t) || t.length > 20 || /\s.+\s/.test(t)) return 'action';
  }
  return null;
}

/** 빈 줄 첫 글자 단축키 */
export const PREFIX_KEYS: Record<string, LineType> = { '.': 'scene', '@': 'character', '(': 'paren', '>': 'transition', '!': 'action', '/': 'shot' };

export function nextTypeAfter(t: LineType): LineType {
  switch (t) {
    case 'scene': return 'action';
    case 'character': return 'dialogue';
    case 'paren': return 'dialogue';
    case 'dialogue': return 'character';
    case 'transition': return 'scene';
    case 'shot': return 'action';
    default: return 'action';
  }
}

// ---------- 컷 나누기 ----------
export interface Unit {
  id: string; lineId: string; kind: 'action' | 'dlg' | 'shot' | 'trans';
  text: string; speaker?: string; paren?: string; cont?: boolean; off?: boolean; shot?: ShotInfo;
  sentStart?: boolean; // 줄의 첫 문장
}
export interface Cut {
  key: string; sceneId: string; no: number; label: string; units: Unit[];
  action: string; dialogues: { speaker: string; text: string; off: boolean; paren?: string }[];
  auto: { shot?: string; angle?: string; move?: string; chars: string[]; src: string; note?: string };
  seconds: number;
}

export function splitSentences(t: string): string[] {
  const out: string[] = [];
  for (const para of t.split('\n')) {
    const parts = para.match(/[^.!?…。]+[.!?…。]+["'”’」)]*\s*|[^.!?…。]+$/g) || [];
    for (const p of parts) { const s = p.trim(); if (s) out.push(s); }
  }
  return out;
}

export function sceneUnits(scene: Scene): Unit[] {
  const units: Unit[] = [];
  const ls = scene.lines;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (l.t === 'action') {
      splitSentences(l.text).forEach((s, k) => units.push({ id: `${l.id}#${k}`, lineId: l.id, kind: 'action', text: s, sentStart: k === 0 }));
    } else if (l.t === 'shot') {
      units.push({ id: l.id, lineId: l.id, kind: 'shot', text: l.text, shot: parseShotLine(l.text) || { note: l.text } });
    } else if (l.t === 'transition') {
      units.push({ id: l.id, lineId: l.id, kind: 'trans', text: l.text });
    } else if (l.t === 'character') {
      const speaker = speakerName(l.text);
      const off = isOffscreenTag(l.text);
      let first = true; let paren: string | undefined;
      let j = i + 1;
      for (; j < ls.length && (ls[j].t === 'dialogue' || ls[j].t === 'paren'); j++) {
        const d = ls[j];
        if (d.t === 'paren') { paren = d.text; continue; }
        splitSentences(d.text).forEach((s, k) => {
          units.push({ id: `${d.id}#${k}`, lineId: d.id, kind: 'dlg', text: s, speaker, paren, cont: !first, off: off || !!(paren && /소리|V\.?O|O\.?S|전화|목소리/i.test(paren)), sentStart: k === 0 });
          first = false;
        });
      }
      i = j - 1;
    } else if (l.t === 'dialogue') {
      splitSentences(l.text).forEach((s, k) => units.push({ id: `${l.id}#${k}`, lineId: l.id, kind: 'dlg', text: s, speaker: '', cont: units.length > 0 && units[units.length - 1].kind === 'dlg', sentStart: k === 0 }));
    }
  }
  return units;
}

const SOUND_CUE = /들려|들린다|목소리|소리가|소리를|방송|스피커|전화 ?너머|라디오/;
const PULLBACK = /카메라[가는]?\s*(뒤로\s*)?(빠지|물러나|멀어지)|줌\s?아웃|화면이\s*넓어지|프레임이\s*넓어지/;
const PUSHIN = /카메라[가는]?\s*(다가가|다가간|밀고)|줌\s?인|클로즈업\s*되/;
const isPlaceOnly = (t: string) => t.length <= 16 && !/다[.!]?$|[가-힣]+(고|며|서)\s/.test(t);

/** 자동 컷 나누기: 각 단위 앞에서 새 컷을 시작할지 */
export function autoBreaks(units: Unit[], names: string[]): Set<string> {
  const b = new Set<string>();
  for (let i = 0; i < units.length; i++) {
    const u = units[i]; const prev = units[i - 1];
    if (i === 0) { b.add(u.id); continue; }
    if (prev.kind === 'shot') continue;                // 샷 줄 다음은 같은 컷
    if (u.kind === 'shot') { b.add(u.id); continue; }
    if (u.kind === 'trans') continue;
    if (u.kind === 'dlg') {
      if (u.cont) continue;
      if (u.off) continue;
      if (prev.kind === 'action' && SOUND_CUE.test(prev.text)) continue;
      if (prev.kind === 'action' && u.speaker && countMentions(prev.text, u.speaker) > 0) continue;
      b.add(u.id); continue;
    }
    // action
    if (!u.sentStart && prev.kind === 'action' && prev.lineId === u.lineId) continue;
    if (prev.kind === 'action' && isPlaceOnly(prev.text) && prev.sentStart) {
      // 장소만 적은 짧은 줄은 다음 장면과 한 컷
      const pi = i - 1; if (pi === 0 || b.has(prev.id)) continue;
    }
    if (prev.kind === 'action' && PULLBACK.test(prev.text)) continue;
    b.add(u.id);
  }
  void names;
  return b;
}

const WALK = /걸어|나오는|나온다|들어오|들어간|달려|뛰어|다가오|다가간|지나가|지나간|올라오|올라간|내려오|내려간|끌고|끌려/;
const CROWD = /관객|사람들|군중|무리|명의|명이|들이 |인파|학생들|손님들|건달들/;

export function getCuts(p: Project, scene: Scene, names?: string[]): Cut[] {
  const nm = names || knownNames(p);
  const meta = p.scenes[scene.id];
  if (meta?.aiCuts?.length) return aiCutsToCuts(scene, meta.aiCuts, nm);
  const units = sceneUnits(scene);
  if (!units.length) return [];
  const breaks = autoBreaks(units, nm);
  for (const x of meta?.breaks || []) breaks.add(x);
  for (const x of meta?.noBreaks || []) breaks.delete(x);
  breaks.add(units[0].id);
  units.forEach(u => { if (u.kind === 'shot') breaks.add(u.id); });
  const groups: Unit[][] = [];
  for (const u of units) {
    if (breaks.has(u.id) || !groups.length) groups.push([u]); else groups[groups.length - 1].push(u);
  }
  const sceneText = scene.lines.map(l => l.text).join('\n');
  const night = isNightTime(scene.time, sceneText);
  void night;
  return groups.map((g, gi) => {
    const action = g.filter(u => u.kind === 'action').map(u => u.text).join(' ');
    const dialogues: Cut['dialogues'] = [];
    for (const u of g) if (u.kind === 'dlg') {
      const last = dialogues[dialogues.length - 1];
      if (last && u.cont && last.speaker === (u.speaker || '')) last.text += ' ' + u.text;
      else dialogues.push({ speaker: u.speaker || '', text: u.text, off: !!u.off || (g.indexOf(u) > 0 && g.slice(0, g.indexOf(u)).some(x => x.kind === 'action' && SOUND_CUE.test(x.text))), paren: u.paren });
    }
    const shotU = g.find(u => u.kind === 'shot');
    const onSpeakers = [...new Set(dialogues.filter(d => !d.off && d.speaker).map(d => d.speaker))];
    const mentioned = nm.filter(n => countMentions(action, n) > 0 && !(SOUND_CUE.test(action) && dialogues.some(d => d.off && d.speaker === n)));
    const chars = [...new Set([...mentioned, ...onSpeakers])];
    let shot: string | undefined, angle: string | undefined, move: string | undefined, src = '자동';
    if (shotU?.shot) { shot = shotU.shot.shot; angle = shotU.shot.angle; move = shotU.shot.move; src = '대본'; }
    if (!shot) {
      if (PULLBACK.test(action)) { shot = 'FS'; move = move || 'Dolly Out'; src = '문맥'; }
      else if (PUSHIN.test(action)) { shot = 'CU'; move = move || 'Push In'; src = '문맥'; }
      else if (CROWD.test(action)) { shot = 'FS'; src = '문맥'; }
      else if (gi === 0) shot = 'WS';
      else if (/얼굴|표정|눈빛|눈물|입술|손에 든|손끝/.test(action) && chars.length <= 1) shot = 'CU';
      else if (chars.length >= 3) shot = 'GS';
      else if (chars.length === 2) shot = '2S';
      else if (chars.length === 1 && WALK.test(action) && !dialogues.length) { shot = 'FS'; move = move || 'Pan Right'; }
      else if (dialogues.length) shot = 'MS';
      else shot = 'MS';
    }
    if (!angle) {
      if (/내려다보|내려다 보|위에서 본|부감/.test(action)) angle = 'High-Angle';
      else if (/올려다보|올려다 보|아래에서 본|앙각/.test(action)) angle = 'Low-Angle';
    }
    if (!move && /따라가|따라간다|뒤를 쫓/.test(action)) move = 'Follow';
    if (!move && /흔들리는 화면|흔들리는 카메라/.test(action)) move = 'Handheld';
    const dlgLen = dialogues.reduce((a, d) => a + d.text.length, 0);
    const seconds = Math.max(2, Math.round(action.length / 12 + dlgLen / 7));
    return {
      key: g[0].id, sceneId: scene.id, no: gi + 1, label: `${scene.num}-${gi + 1}`, units: g, action, dialogues,
      auto: { shot, angle, move, chars, src }, seconds,
    };
  });
}

/** 외부 AI가 나눈 컷 → 앱의 컷 */
export const aiKey = (sceneId: string, i: number) => `${sceneId}~ai${i}`;
function aiCutsToCuts(scene: Scene, list: AICut[], names: string[]): Cut[] {
  return list.map((a, i) => {
    const dialogues = (a.dlg || []).map(d => ({ speaker: d.speaker, text: d.text, off: d.off }));
    const chars = a.chars ?? names.filter(n => countMentions(a.see + ' ' + a.src, n) > 0);
    const dlgLen = dialogues.reduce((x, d) => x + d.text.length, 0);
    return {
      key: aiKey(scene.id, i), sceneId: scene.id, no: i + 1, label: `${scene.num}-${i + 1}`,
      units: [], action: a.src || a.see, dialogues,
      auto: { shot: a.shot, angle: a.angle, move: a.move, chars, src: 'AI', note: a.cam },
      seconds: Math.max(2, Math.round((a.src || a.see).length / 14 + dlgLen / 7)),
    };
  });
}
export function isAiScene(p: Project, scene: Scene) { return !!p.scenes[scene.id]?.aiCuts?.length; }

/** 컷 합치기/나누기 */
export function mergeCuts(p: Project, scene: Scene, aKey: string, bKey: string): Project {
  const cuts = getCuts(p, scene);
  const ia = cuts.findIndex(c => c.key === aKey), ib = cuts.findIndex(c => c.key === bKey);
  if (ia < 0 || ib < 0 || ia === ib) return p;
  const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
  const ai = p.scenes[scene.id]?.aiCuts;
  if (ai?.length) {
    const keep = ai[lo];
    const merged: AICut = { ...keep, src: ai.slice(lo, hi + 1).map(x => x.src).filter(Boolean).join(' '), see: ai.slice(lo, hi + 1).map(x => x.see).filter(Boolean).join(' '), dlg: ai.slice(lo, hi + 1).flatMap(x => x.dlg || []) };
    const next = [...ai.slice(0, lo), merged, ...ai.slice(hi + 1)];
    const om = ai.map((_, i) => p.cuts[aiKey(scene.id, i)]);
    const metas = [...om.slice(0, lo), { ...om[lo], desc: merged.see || om[lo]?.desc }, ...om.slice(hi + 1)];
    return applyAiCuts(p, scene, next, metas);
  }
  const auto = autoBreaks(sceneUnits(scene), knownNames(p));
  const m = { ...(p.scenes[scene.id] || {}) };
  const add = new Set(m.breaks || []); const rm = new Set(m.noBreaks || []);
  for (let i = lo + 1; i <= hi; i++) { const k = cuts[i].key; add.delete(k); if (auto.has(k)) rm.add(k); }
  m.breaks = [...add]; m.noBreaks = [...rm];
  return { ...p, scenes: { ...p.scenes, [scene.id]: m } };
}
export function splitAt(p: Project, scene: Scene, unitIds: string[]): Project {
  const m = { ...(p.scenes[scene.id] || {}) };
  const add = new Set(m.breaks || []); const rm = new Set(m.noBreaks || []);
  for (const u of unitIds) { add.add(u); rm.delete(u); }
  m.breaks = [...add]; m.noBreaks = [...rm];
  return { ...p, scenes: { ...p.scenes, [scene.id]: m } };
}
/** AI 컷 목록을 씬에 넣기. 예전 AI 컷의 그림·묘사 등은 지움 */
export function applyAiCuts(p: Project, scene: Scene, list: AICut[], metas?: (CutMeta | undefined)[], setTable?: string): Project {
  const cuts = { ...p.cuts };
  const old = p.scenes[scene.id]?.aiCuts?.length || 0;
  for (let i = 0; i < Math.max(old, list.length); i++) {
    const k = aiKey(scene.id, i);
    if (i < list.length) cuts[k] = metas ? { ...(metas[i] || {}) } : { desc: list[i].see || undefined };
    else delete cuts[k];
  }
  const m = { ...(p.scenes[scene.id] || {}), aiCuts: list, ...(setTable ? { setTable } : {}) };
  return { ...p, cuts, scenes: { ...p.scenes, [scene.id]: m } };
}
export function resetBreaks(p: Project, scene: Scene): Project {
  const m = { ...(p.scenes[scene.id] || {}) }; delete m.breaks; delete m.noBreaks; delete m.aiCuts;
  return { ...p, scenes: { ...p.scenes, [scene.id]: m } };
}

export function cutValues(p: Project, c: Cut) {
  const m = p.cuts[c.key] || {};
  return {
    shot: m.shot ?? c.auto.shot, angle: m.angle ?? c.auto.angle, move: m.move ?? c.auto.move,
    chars: m.chars ?? c.auto.chars,
    shotSrc: m.shot ? '직접' : c.auto.src, charsManual: !!m.chars,
  };
}

/** 씬 요약(자동): 첫 지문 문장 */
export function autoSummary(scene: Scene): string {
  const a = scene.lines.find(l => l.t === 'action' && l.text.trim());
  if (!a) { const d = scene.lines.find(l => l.t === 'dialogue'); return d ? '"' + d.text.slice(0, 40) + '"' : ''; }
  const s = splitSentences(a.text)[0] || '';
  return s.length > 60 ? s.slice(0, 58) + '…' : s;
}

export interface SceneStat { speakers: Record<string, number>; mentions: Record<string, number>; chars: string[]; dialogueCount: number; textLen: number }
export function sceneStats(scene: Scene, names: string[]): SceneStat {
  const speakers: Record<string, number> = {}; const mentions: Record<string, number> = {};
  let dialogueCount = 0; let textLen = 0;
  for (const l of scene.lines) {
    textLen += l.text.length;
    if (l.t === 'character') { const n = speakerName(l.text); if (n) { speakers[n] = (speakers[n] || 0) + 1; dialogueCount++; } }
    if (l.t === 'action' || l.t === 'dialogue') for (const n of names) { const c = countMentions(l.text, n); if (c) mentions[n] = (mentions[n] || 0) + c; }
  }
  const chars = [...new Set([...Object.keys(speakers), ...Object.keys(mentions)])];
  return { speakers, mentions, chars, dialogueCount, textLen };
}
/** 대략 쪽수: 한 쪽 ≈ 55줄 x 32자 */
export function estimatePages(lines: Line[]): number {
  let rows = 0;
  for (const l of lines) rows += Math.max(1, Math.ceil(l.text.length / 32)) + (l.t === 'scene' || l.t === 'character' ? 1 : 0);
  return rows / 50;
}

/** 대사 글자 수 (분량) */
export function dialogueVolume(lines: Line[]): Record<string, { chars: number; count: number; scenes: Set<string> }> {
  const out: Record<string, { chars: number; count: number; scenes: Set<string> }> = {};
  let speaker = ''; let sceneId = '';
  for (const l of lines) {
    if (l.t === 'scene') sceneId = l.id;
    else if (l.t === 'character') { speaker = speakerName(l.text); if (speaker) { out[speaker] ||= { chars: 0, count: 0, scenes: new Set() }; out[speaker].count++; out[speaker].scenes.add(sceneId); } }
    else if (l.t === 'dialogue' && speaker && out[speaker]) out[speaker].chars += l.text.length;
    else if (l.t !== 'paren') speaker = '';
  }
  return out;
}
