import type { AICut, Project, Settings } from './types';
import { type Cut, type Scene, type Unit, cutValues, isNightTime, sceneUnits } from './script';
import { SHOT_SIZES, ANGLES, MOVES, termLabel, parseShotLine } from './shots';
import { cleanPasted, unescapeMd } from './util';

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
  const cam = [v.shot && termLabel(SHOT_SIZES, v.shot), v.angle && termLabel(ANGLES, v.angle), v.move && termLabel(MOVES, v.move)].filter(Boolean).join(' · ');
  const lines = [`[컷 ${cut.label}]`];
  const note = cut.auto.note && !m.shot && !m.angle && !m.move ? cut.auto.note : '';
  if (note || cam) lines.push('카메라: ' + (note || cam));
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
  if (v.move) lines.push('카메라 움직임은 화살표로 그리지 말고, 움직임이 시작되는 한 순간의 화면으로.');
  if (v.chars.length && !/차렷|정면을 (바라|보)/.test(see)) lines.push('인물은 차렷 자세로 정면을 보지 말고, 상황에 맞는 동작 중인 자세로.');
  lines.push(ONE_CUT_RULE);
  return lines.join('\n');
}
export function cutPromptFor(p: Project, scene: Scene, cut: Cut, prev?: Cut): string {
  return p.cuts[cut.key]?.prompt ?? autoCutPrompt(p, scene, cut, prev);
}
export function fullCutPrompt(p: Project, scene: Scene, cut: Cut, prev: Cut | undefined, s: Settings): string {
  return commonFor(p, scene, s) + '\n\n' + cutPromptFor(p, scene, cut, prev);
}
export const ONE_CUT_RULE = '⚠ 이 컷 하나만, 한 순간을 그림 한 장(한 칸)에 그려 줘. 칸을 나누거나 여러 컷·여러 장면을 한 장에 넣지 말 것. 다음 컷을 미리 그리지 말 것.';
/** 첫 컷 앞에 붙는 안내 */
export function sceneGuide(): string {
  return '이 대화에서 스토리보드 컷을 한 번에 하나씩 따로 요청할 거야. 매번 요청한 그 컷 하나만 그림 한 장으로 그려 줘. 앞으로 요청할 모든 컷에서 장소, 인물의 생김새와 옷을 똑같이 유지해 줘.';
}
/** 씬 전체를 한꺼번에 붙여 넣을 때 안내 */
export function sceneAllGuide(n: number): string {
  return `아래는 스토리보드 ${n}컷이야. 한 번에 한 컷씩, 컷마다 따로 그림 한 장으로 그려 줘. 지금은 첫 번째 컷만 그리고, 내가 "다음"이라고 하면 그다음 컷을 그려 줘. 여러 컷을 한 장에 나누어 그리지 말 것. 모든 컷에서 장소, 인물의 생김새와 옷을 똑같이 유지해 줘.`;
}
export function masterPrompt(p: Project, scene: Scene, cuts: Cut[], s: Settings): string {
  const events = cuts.map(c => (p.cuts[c.key]?.desc || c.action || '').split(/(?<=[.!?])\s/)[0]).filter(Boolean).slice(0, 12);
  return commonFor(p, scene, s) + '\n\n[마스터 샷] 이 씬 전체 상황을 한 장에 담은 넓은 화면으로 그려 줘. 공간 배치와 등장인물 모두가 한눈에 보이게.\n씬에서 일어나는 일:\n' + events.map(e => '- ' + e).join('\n');
}

// -------- 외부 AI로 컷 나누기 --------
const DIRECTOR_RULES = [
  '너는 이 영화를 연출하는 영화감독이야. 촬영 전에 스토리보드를 만들 수 있게 시나리오를 컷으로 나눠 줘.',
  '- 이야기 전체의 흐름과 인물의 감정을 생각해서, 관객에게 무엇을 어떤 순서로 보여 줄지 감독으로서 정해.',
  '- 한 컷 = 카메라가 끊기지 않고 보여 주는 한 화면.',
  '- 한 문장 안에서도 보이는 대상, 크기, 장소가 바뀌면 컷을 나눠. (예: 항공 전경 → 도로 → 코너에서 나타나는 차)',
  '- 대본의 문장마다 (1), (2) 처럼 번호가 붙어 있어. 대본 문장이나 대사는 다시 옮겨 쓰지 말고 번호로만 가리켜 줘.',
  '- 대사·소리는 그게 들리는 동안 화면에 보이는 컷에 번호로 넣어.',
  '- 샷 크기는 EWS, WS, FS, MS, MCU, CU, ECU, OTS, 2S 중에서, 앵글과 카메라 움직임은 한국어로 써.',
  '- 컷 번호는 [씬번호-컷번호] 로. (예: [12-3] 은 12번 씬의 세 번째 컷)',
];
const ANSWER_FORMAT = (n: number) => [
  '[답하는 형식] 표로 쓰지 말고, 컷마다 아래 모양 그대로. 다른 말은 붙이지 마.',
  `[${n}-1] 샷 크기 / 앵글 / 카메라 움직임`,
  '대본 번호: 이 컷에 해당하는 지문 번호 (예: 1 또는 2-3)',
  '화면: 이 컷 화면에 보이는 것을 네 말로 짧게 (한 순간, 구체적으로)',
  '인물: 화면에 나오는 인물 이름 (없으면 없음)',
  '대사 번호: 이 컷에 들리는 대사 번호 (없으면 없음)',
  '',
  `[${n}-2] …`,
];
/** 씬 대본에 문장 번호 붙이기 (AI가 원문을 옮기지 않고 번호로 가리키게) */
export function numberedScene(scene: Scene): string {
  const out: string[] = []; let k = 0; let lastSpeaker = '';
  for (const u of sceneUnits(scene)) {
    k++;
    if (u.kind === 'dlg') {
      const sp = (u.speaker || '') + (u.off ? '(소리)' : '');
      out.push(`(${k}) ${sp && sp !== lastSpeaker ? sp + ': ' : '   '}${u.paren && !u.cont ? u.paren + ' ' : ''}${u.text}`);
      lastSpeaker = sp;
    } else { out.push(`(${k}) ${u.kind === 'shot' ? '[샷] ' : ''}${u.text}`); lastSpeaker = ''; }
  }
  return out.join('\n');
}
/** 번호 → 대본 단위 */
export function unitsByNumber(scene: Scene): Unit[] { return sceneUnits(scene); }

function charList(p: Project, lines: { text: string }[]): string[] {
  return p.chars.filter(ch => lines.some(l => l.text.includes(ch.name))).map(ch => `${ch.name}${ch.look.trim() ? ': ' + ch.look.trim() : ''}`);
}
export function buildCutSplitRequest(p: Project, scene: Scene): string {
  const looks = charList(p, scene.lines);
  const parts = [...DIRECTOR_RULES, '', `[씬] S#${scene.num}. ${scene.heading}`];
  if (looks.length) parts.push('', '[등장인물]', ...looks);
  parts.push('', '[대본]', numberedScene(scene), '', ...ANSWER_FORMAT(scene.num));
  return parts.join('\n');
}
/** 첨부할 시나리오 파일 내용 */
export function fullScriptText(p: Project, scenes: Scene[]): string {
  const parts = [`${p.title}`, ''];
  for (const s of scenes) parts.push(`S#${s.num}. ${s.heading}`, numberedScene(s), '');
  return parts.join('\n');
}
export const scriptFileName = (p: Project) => `${(p.title || '시나리오').replace(/[\\/:*?"<>|]/g, '_')}_시나리오.txt`;
/** 시나리오는 파일로 첨부하고, 이 요청 문장만 붙여 넣음 */
export function buildFullCutSplitRequest(p: Project, scenes: Scene[], per = 8): string {
  const all = per >= scenes.length;
  const looks = charList(p, p.lines);
  const parts = [...DIRECTOR_RULES,
    `- 시나리오 전체는 첨부한 파일 "${scriptFileName(p)}"에 있어. 파일을 끝까지 읽고 이야기 전체를 이해한 다음 나눠 줘. (씬 ${scenes.length}개)`,
    all ? `- 씬 ${scenes.length}개 전부를 한 번에 나눠 줘. 답이 한 번에 다 안 들어가면 전체 답을 "컷나누기.txt" 파일로 만들어서 내려받을 수 있게 해 줘. 씬을 건너뛰거나 줄이지 마.`
      : `- 답이 길어서 한 번에 씬 ${per}개씩만 답하고, 내가 "다음"이라고 하면 이어서 다음 씬들을 답해 줘. 씬을 건너뛰지 마.`,
    '', `[작품] ${p.title}`];
  if (looks.length) parts.push('', '[등장인물]', ...looks);
  parts.push('', ...ANSWER_FORMAT(scenes[0]?.num || 1), '', all ? '전체 씬을 답해 줘.' : `지금은 S#${scenes[0]?.num || 1}부터 씬 ${per}개만 답해 줘.`);
  return parts.join('\n');
}

const stripMd = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/^\s*[-*•]\s+/, '').trim();

/** AI 답 → 컷 목록. "[1-1] …" 형식과 표(| 컷 | 카메라 | 화면 |) 형식 둘 다 */
export type ParsedCut = AICut & { scene: number; srcNums?: number[]; dlgNums?: number[] };
export function parseCutSplitAnswer(text: string, names: string[]): ParsedCut[] {
  const lines = unescapeMd(text.replace(/\r/g, '')).split('\n');
  const out: ParsedCut[] = [];
  const sceneOf = (l: string) => Number((l.match(/(\d+)\s*-\s*\d+/) || [])[1]) || 0;
  const cam = (h: string): Partial<AICut> => {
    const r: Partial<AICut> = { cam: stripMd(h) };
    for (const tok of h.split(/[\/·,|]/)) {
      const t = tok.trim(); if (!t) continue;
      const info = parseShotLine(t) || parseShotLine(t.replace(/^(측면|정면|후면|빠른|느린|천천히)\s*/, ''));
      if (!info) continue;
      if (info.shot && !r.shot) r.shot = info.shot;
      if (info.angle && !r.angle) r.angle = info.angle;
      if (info.move && !r.move) r.move = info.move;
    }
    return r;
  };
  // 표 형식
  const rows = lines.filter(l => /^\s*\|/.test(l)).map(l => l.split('|').slice(1, -1).map(c => stripMd(c)));
  const tableRows = rows.filter(r => /^\s*S?#?\s*\d+\s*-\s*\d+\s*$/.test(r[0] || ''));
  if (tableRows.length) {
    const head = rows.find(r => !/\d+\s*-\s*\d+/.test(r[0] || '') && r.some(c => /카메라|샷|화면/.test(c))) || [];
    const idx = (re: RegExp, d: number) => { const i = head.findIndex(c => re.test(c)); return i >= 0 ? i : d; };
    const iCam = idx(/카메라|샷|앵글/, 1), iSee = idx(/화면|내용|묘사/, 2), iSrc = idx(/대본|지문/, -1), iDlg = idx(/대사|소리|오디오/, -1), iChar = idx(/인물/, -1);
    for (const r of tableRows) {
      const see = r[iSee] || '';
      out.push({ scene: sceneOf(r[0]), ...cam(r[iCam] || ''), see, src: iSrc >= 0 ? r[iSrc] : '', chars: iChar >= 0 ? splitNames(r[iChar]) : undefined, dlg: iDlg >= 0 ? parseDlg(r[iDlg]) : [] });
    }
    return out;
  }
  // [n-k] 형식
  let cur: ParsedCut | null = null; let field = '';
  for (const raw of lines) {
    const l = stripMd(raw);
    const m = l.match(/^\[?\s*S?#?\s*\d+\s*-\s*\d+\s*\]?\s*[.:)]?\s*(.*)$/);
    if (m && /^\[?\s*S?#?\s*\d+\s*-\s*\d+/.test(l)) { cur = { scene: sceneOf(l), ...cam(m[1] || ''), src: '', see: '', dlg: [] }; out.push(cur); field = ''; continue; }
    if (!cur || !l) continue;
    const f = l.match(/^(대본\s*번호|대사\s*번호|대본|화면|인물|대사|소리|카메라)\s*[:：]\s*(.*)$/);
    if (f) {
      field = f[1].replace(/\s/g, ''); const v = f[2].trim();
      if (field === '대본번호') { cur.srcNums = nums(v); field = ''; }
      else if (field === '대사번호') { cur.dlgNums = nums(v); field = ''; }
      else if (field === '대본') cur.src = v;
      else if (field === '화면') cur.see = v;
      else if (field === '인물') cur.chars = splitNames(v);
      else if (field === '카메라') Object.assign(cur, cam(v));
      else if (v) cur.dlg!.push(...parseDlg(v));
      continue;
    }
    if (field === '대본') cur.src += ' ' + l;
    else if (field === '화면') cur.see += ' ' + l;
    else if (field === '대사' || field === '소리') cur.dlg!.push(...parseDlg(l));
  }
  void names;
  return out;
}
function nums(v: string): number[] {
  const out: number[] = [];
  for (const m of v.matchAll(/(\d+)\s*(?:[-~–]\s*(\d+))?/g)) {
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b) && i - a < 200; i++) out.push(i);
  }
  return out;
}
/** 번호로 받은 답을 앱의 대본으로 채우기 */
export function resolveNumbers(c: ParsedCut, scene: Scene): AICut {
  const units = sceneUnits(scene);
  const pick = (ns?: number[]) => (ns || []).map(n => units[n - 1]).filter(Boolean);
  const { scene: _s, srcNums, dlgNums, ...rest } = c;
  const out: AICut = { ...rest };
  const su = pick(srcNums);
  const du = pick(dlgNums);
  const all = [...su, ...du];
  if (su.length) out.src = su.filter(u => u.kind !== 'dlg').map(u => u.text).join(' ') || out.src;
  const dl = all.filter(u => u.kind === 'dlg');
  if (dl.length) {
    const merged: { speaker: string; text: string; off: boolean }[] = [];
    for (const u of dl) { const last = merged[merged.length - 1]; if (last && u.cont && last.speaker === (u.speaker || '')) last.text += ' ' + u.text; else merged.push({ speaker: u.speaker || '', text: u.text, off: !!u.off }); }
    out.dlg = merged;
  }
  return out;
}
function splitNames(v: string): string[] {
  if (!v || /^(없음|없다|-|—)$/.test(v.trim())) return [];
  return v.split(/[,，、·]/).map(x => x.replace(/\(.*?\)/g, '').trim()).filter(Boolean);
}
function parseDlg(v: string): { speaker: string; text: string; off: boolean }[] {
  if (!v || /^(없음|-|—)$/.test(v.trim())) return [];
  const m = v.match(/^([^:：]{1,20}?)\s*(\((소리|V\.?O\.?|O\.?S\.?|E)\))?\s*[:：]\s*["“]?(.+?)["”]?$/);
  if (!m) return [{ speaker: '', text: v, off: false }];
  return [{ speaker: m[1].trim(), text: m[4].trim(), off: !!m[2] || /소리/.test(m[1]) }];
}
