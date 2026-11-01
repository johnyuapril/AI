import type { Project, Settings } from './types';
import { type Cut, type Scene, cutValues, isNightTime } from './script';
import { ANGLES, MOVES, termLabel } from './shots';
import { cleanPasted } from './util';

function sceneScript(scene: Scene): string {
  const out: string[] = [];
  for (const l of scene.lines) {
    if (l.t === 'character') out.push(l.text + ':');
    else if (l.t === 'dialogue') out.push('  ' + l.text);
    else if (l.t === 'paren') out.push('  ' + l.text);
    else if (l.t === 'shot') out.push('[샷] ' + l.text);
    else out.push(l.text);
  }
  return out.join('\n');
}
function cutScript(c: Cut): string {
  const parts: string[] = [];
  if (c.action) parts.push(c.action);
  for (const d of c.dialogues) parts.push(`${d.speaker}${d.off ? '(소리)' : ''}: "${d.text}"`);
  return parts.join(' / ') || '(내용 없음)';
}

export function buildDescribeRequest(p: Project, scene: Scene, cuts: Cut[], s: Settings): string {
  const meta = p.scenes[scene.id] || {};
  const corr: string[] = [];
  if (meta.corr?.trim()) corr.push('씬 전체: ' + meta.corr.trim());
  for (const c of cuts) { const cc = p.cuts[c.key]?.corr?.trim(); if (cc) corr.push(`${c.label}: ${cc}`); }
  const looks = p.chars.filter(ch => ch.look.trim() && scene.lines.some(l => l.text.includes(ch.name))).map(ch => `${ch.name}: ${ch.look.trim()}`);
  const parts = [
    s.gptInstruction.trim(),
    '',
    `[씬] S#${scene.num}. ${scene.heading}`,
  ];
  if (looks.length) parts.push('', '[인물 외모 (정해 둔 설정, 꼭 지켜 줘)]', ...looks);
  if (meta.setTable?.trim()) parts.push('', '[지금 설정표 (고쳐 쓴 내용이니 지켜 줘)]', meta.setTable.trim());
  if (corr.length) parts.push('', '[바로잡기 (꼭 반영해 줘)]', ...corr);
  parts.push('', '[대본]', sceneScript(scene), '', '[컷 목록]');
  for (const c of cuts) {
    const v = cutValues(p, c);
    parts.push(`[${c.label}] (${[v.shot, v.angle && termLabel(ANGLES, v.angle), v.move && termLabel(MOVES, v.move)].filter(Boolean).join(' · ')}${v.chars.length ? ' / 인물: ' + v.chars.join(', ') : ''}) ${cutScript(c)}`);
  }
  parts.push('', '[답하는 형식] 아래처럼 대괄호 표시를 그대로 써서 답해 줘. 다른 말은 붙이지 마.', '[설정표]', '장소: …', '시간·날씨·조명: …', '인물: 이름 - 생김새, 옷차림, 소지품 (한 사람씩 한 줄)');
  for (const c of cuts) parts.push(`[${c.label}]`, '(이 컷 화면 묘사)');
  return parts.join('\n');
}

export function parseDescribeAnswer(text: string, labels: string[]): { setTable?: string; descs: Record<string, string>; missing: string[] } {
  const t = cleanPasted(text);
  const re = /\[\s*(설정표|S?#?\s*\d+\s*-\s*\d+)\s*\]/g;
  const marks: { label: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) marks.push({ label: m[1].replace(/\s|S|#/g, ''), start: m.index, end: m.index + m[0].length });
  const descs: Record<string, string> = {}; let setTable: string | undefined;
  marks.forEach((mk, i) => {
    const body = t.slice(mk.end, marks[i + 1]?.start ?? t.length).trim();
    if (!body) return;
    if (mk.label === '설정표') setTable = body; else descs[mk.label] = body;
  });
  return { setTable, descs, missing: labels.filter(l => !descs[l]) };
}

// -------- 그림 프롬프트 --------
export function autoCommon(p: Project, scene: Scene, s: Settings): string {
  const meta = p.scenes[scene.id] || {};
  const sceneText = scene.lines.map(l => l.text).join(' ');
  const night = isNightTime(scene.time, sceneText);
  const parts = [s.promptHeader.trim()];
  if (s.styleText.trim()) parts.push('그림체: ' + s.styleText.trim());
  parts.push(`장소: ${scene.place || scene.heading}${scene.time ? ' / ' + scene.time : ''}${night && !/밤|저녁|새벽/.test(scene.time) ? ' (밤)' : ''}`);
  if (meta.setTable?.trim()) parts.push('씬 설정 (모든 컷에서 똑같이 유지):\n' + meta.setTable.trim());
  else {
    const looks = p.chars.filter(ch => ch.look.trim() && sceneText.includes(ch.name)).map(ch => `- ${ch.name}: ${ch.look.trim()}`);
    if (looks.length) parts.push('인물 (모든 컷에서 똑같이 유지):\n' + looks.join('\n'));
  }
  return parts.join('\n');
}
export function commonFor(p: Project, scene: Scene, s: Settings): string {
  return p.scenes[scene.id]?.common ?? autoCommon(p, scene, s);
}

export function autoCutPrompt(p: Project, scene: Scene, cut: Cut, prev?: Cut): string {
  const v = cutValues(p, cut);
  const m = p.cuts[cut.key] || {};
  const cam = [v.shot, v.angle && termLabel(ANGLES, v.angle), v.move && termLabel(MOVES, v.move)].filter(Boolean).join(' · ');
  const lines = [`[컷 ${cut.label}]`];
  if (cam) lines.push('카메라: ' + cam);
  lines.push('화면에 나오는 인물: ' + (v.chars.length ? v.chars.join(', ') : '없음 (사람을 그리지 말 것)'));
  const see = m.desc?.trim() || cut.action || '';
  if (see) lines.push('화면에 보이는 것: ' + see);
  const speaking = cut.dialogues.filter(d => !d.off && d.speaker);
  if (speaking.length) lines.push('말하는 중인 인물: ' + [...new Set(speaking.map(d => d.speaker))].join(', ') + ' (대사 글자는 그리지 말 것)');
  const offs = cut.dialogues.filter(d => d.off);
  if (offs.length) lines.push('화면 밖 소리: ' + [...new Set(offs.map(d => d.speaker))].join(', ') + ' (이 인물은 화면에 그리지 말 것)');
  if (prev) {
    const pd = (p.cuts[prev.key]?.desc || prev.action || '').trim();
    if (pd) lines.push(`앞 컷(${prev.label})과 이어짐: ${pd.length > 90 ? pd.slice(0, 88) + '…' : pd}`);
  }
  if (!/차렷|정면을 (바라|보)/.test(see)) lines.push('인물은 차렷 자세로 정면을 보지 말고, 상황에 맞는 동작 중인 자세로.');
  return lines.join('\n');
}
export function cutPromptFor(p: Project, scene: Scene, cut: Cut, prev?: Cut): string {
  return p.cuts[cut.key]?.prompt ?? autoCutPrompt(p, scene, cut, prev);
}
export function fullCutPrompt(p: Project, scene: Scene, cut: Cut, prev: Cut | undefined, s: Settings): string {
  return commonFor(p, scene, s) + '\n\n' + cutPromptFor(p, scene, cut, prev);
}
export function sceneGuide(): string {
  return '이 대화에서 아래 스토리보드 컷들을 순서대로 한 장씩 그릴 거야. 모든 컷에서 장소, 인물의 생김새와 옷을 똑같이 유지해 줘.';
}
export function masterPrompt(p: Project, scene: Scene, cuts: Cut[], s: Settings): string {
  const events = cuts.map(c => (p.cuts[c.key]?.desc || c.action || '').split(/(?<=[.!?])\s/)[0]).filter(Boolean).slice(0, 12);
  return commonFor(p, scene, s) + '\n\n[마스터 샷] 이 씬 전체 상황을 한 장에 담은 넓은 화면으로 그려 줘. 공간 배치와 등장인물 모두가 한눈에 보이게.\n씬에서 일어나는 일:\n' + events.map(e => '- ' + e).join('\n');
}
