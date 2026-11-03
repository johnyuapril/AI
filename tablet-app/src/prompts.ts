import type { AICut, Project, Settings } from './types';
import { type Cut, type Scene, type Unit, cutValues, getScenes, isNightTime, sceneUnits, splitSentences } from './script';
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
  parts.push(...bibleBlock(p));
  if (looks.length) parts.push('', '[인물 외모 (정해 둔 설정, 꼭 지켜 줘)]', ...looks);
  if (!p.bible?.trim()) parts.push('', '[전체 씬 흐름 (앞뒤 이야기 참고)]', ...sceneOutline(p, scene.num));
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
  const mood = (p.debate || '').split('\n').filter(l => /^\s*(톤앤무드|색감·조명|색감|조명)\s*[:：]/.test(l)).map(l => l.trim());
  if (mood.length) parts.push('작품 분위기: ' + mood.join(' / '));
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
  '너는 이 영화를 연출하는 영화감독이야. 촬영 전에 실제로 그릴 수 있는 정밀 콘티(스토리보드)를 만들 수 있게 시나리오를 컷으로 나누고 화면을 설계해 줘.',
  '- 기계적으로 문장마다 자르지 말고, 이야기 전체의 흐름과 인물의 감정을 생각해서 감독으로서 직접 판단해: 관객에게 정보를 공개하는 순서, 샷과 샷의 연결, 인물의 위치와 동작, 카메라의 움직임.',
  '- 한 컷 = 카메라가 끊기지 않고 보여 주는 한 화면. 한 문장 안에서도 보이는 대상, 크기, 장소가 바뀌면 컷을 나눠. (예: 항공 전경 → 도로 → 코너에서 나타나는 차)',
  '- 대본의 문장마다 (1), (2) 처럼 번호가 붙어 있어. 컷마다 그 컷이 보여 주는 대본 지문의 번호를 적고, "대본:" 줄에 그 번호의 원본 문장 전체를 한 글자도 바꾸지 말고 그대로 옮겨 적어 (어느 문장을 그렇게 묘사했는지 확인용. 이 시나리오는 내가 쓴 작품이야). 번호는 대본에 적힌 번호 그대로 쓰고 새로 세지 마. 대사·소리는 그게 들리는 동안 화면에 보이는 컷에 번호로 넣어.',
  '- 시나리오 전체를 끝까지 먼저 읽고 작업해. 뒤 씬에서 처음 드러나는 설정(인물의 나이·직업·관계·생김새·옷차림·버릇, 장소의 구조와 위치, 차량·소품, 시대·계절, 숨겨진 사실)도 앞 씬부터 일관되게 반영하고, 이 씬만 보고 추측해서 엉뚱하게 만들지 마. [작품 설정]이 있으면 꼭 지켜.',
  '- 샷 크기는 EWS, WS, FS, MS, MCU, CU, ECU, OTS, 2S 중에서, 앵글과 카메라 움직임은 한국어로 써.',
  '- 실제 영화처럼 카메라 위치를 다양하게 설계해. 같은 방향에서 크기만 바꾸지 말고, 컷마다 카메라가 공간의 어디에서 누구를 어느 방향으로 보는지 정해: 정면·측면·45도·뒤에서, 어깨 너머(OTS), 인물 시점(POV), 맞은편 리버스 샷, 하이앵글·로우앵글·부감(위에서 수직)·앙각, 기울인 더치 앵글, 앞쪽에 사물·인물을 걸친 전경 구도, 손·소품 인서트, 듣는 사람 리액션 컷, 문틈·창 너머·거울 반사 같은 프레임 속 프레임.',
  '- 장면마다 커버리지를 짜: 공간을 처음 보여 줄 땐 설정 샷, 대화는 180도 선을 지키며 리버스·OTS를 주고받고, 긴장·위압·고립 같은 감정은 앵글 높이와 거리로 표현해. 같은 카메라 위치와 방향이 두 컷 연속 나오지 않게 하고, 한 씬 안에서 앵글 높이도 섞어.',
  '- 렌즈 느낌(광각·표준·망원)과 카메라 높이(바닥·허리·눈높이·머리 위)도 정해.',
  '- 컷 번호는 [씬번호-컷번호] 로. (예: [12-3] 은 12번 씬의 세 번째 컷)',
  '- 씬마다 첫 컷 앞에 [설정표 씬번호]로 씬 내내 변하지 않는 장소 모습, 시간·날씨·조명, 인물별 생김새·옷차림·소지품을 정리해.',
  '- "화면"은 그 컷 한 순간에 카메라에 보이는 것만, 그림을 그릴 수 있을 만큼 2~4문장으로 구체적으로: 화면 안 배치(앞·뒤, 왼쪽·오른쪽), 인물마다 위치·방향·자세·시선·손동작·표정, 누가 누구의 어디를 어떻게 잡는지 같은 접촉. 감정, 냄새, 소리, 비유는 쓰지 말고, 설정표의 옷차림·소품을 지켜.',
  '- 연출 의도가 있으면 "연출:" 한 줄로 짧게 (왜 이 샷인지).',
  '- 이 콘티는 웹툰으로도 만들어. 컷마다 웹툰에 글자로 넣을 "효과음:"(예: 끼이익!, 쾅!, 두근두근)과 "화면효과:"(집중선, 속도선, 번쩍, 어둡게, 흔들림 중에서)를 적어. 없으면 없음. "화면:"에는 말하는 인물이 화면 왼쪽·가운데·오른쪽 중 어디에 있는지 꼭 써.',
  '- 이건 초벌이 아니라 최종 콘티야. 한 번에 씬 3개씩 답해. 씬 수가 많다고 컷을 줄이거나 묘사를 짧게 하지 말고, 모든 컷을 같은 자세함으로. 내가 "다음"이라고 하면 이어지는 씬 3개를 같은 자세함으로 답해. (설정표는 씬마다 그 씬 첫 컷 앞에서 한 번만)',
  '- 답이 너무 길어서 중간에 끊길 것 같으면 씬이 끝나는 곳에서 멈추고 "계속"이라고 써. 시나리오의 마지막 씬까지 끝나면 마지막에 "끝"이라고 써.',
];
const ANSWER_FORMAT = (n: number) => [
  '[답하는 형식] 표로 쓰지 말고, 아래 모양 그대로. 다른 말은 붙이지 마.',
  `[설정표 ${n}]`,
  '장소: …',
  '시간·날씨·조명: …',
  '인물: 이름 - 생김새, 옷차림, 소지품 (한 사람씩 한 줄)',
  '',
  `[${n}-1] 샷 크기 / 카메라 위치·방향 (예: 지영 오른쪽 45도 앞, 영민 어깨 너머) / 앵글 높이 (예: 로우앵글) / 움직임 / 렌즈`,
  '대본 번호: 이 컷에 해당하는 지문 번호 (예: 2 또는 3-4)',
  '대본: 그 번호의 원본 문장 전체 그대로 (여러 문장이면 모두)',
  '화면: 이 컷 한 순간에 보이는 것 (2~4문장, 카메라가 어디서 보는지로 시작, 위치·자세·시선·손동작·접촉)',
  '연출: 왜 이렇게 찍는지 한 줄',
  '효과음: 웹툰 효과음 (없으면 없음)',
  '화면효과: 집중선/속도선/번쩍/어둡게/흔들림 (없으면 없음)',
  '인물: 화면에 나오는 인물 이름 (없으면 없음)',
  '대사 번호: 이 컷에 들리는 대사 번호와 첫 두세 단어 (예: 7 (어디야 지금)) (없으면 없음)',
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
/** 작품 설정 (있으면 모든 요청에) */
function bibleBlock(p: Project): string[] {
  const out: string[] = [];
  if (p.debate?.trim()) out.push('', '[3인 토론 결론 (감독·작가·평론가가 합의한 해석과 연출 방향. 인물 성격·행동, 톤앤무드, 카메라 언어를 이대로 따라)]', p.debate.trim());
  if (p.bible?.trim()) out.push('', '[작품 설정 (시나리오 전체에서 정리한 것, 꼭 지켜)]', p.bible.trim());
  return out;
}

// -------- 감독·작가·평론가 3인 토론 --------
export function buildDebateRequest(p: Project): string {
  const n = getScenes(p.lines).length;
  return [
    `첨부한 시나리오 파일 "${scriptFileName(p)}"(씬 ${n}개, 내가 쓴 작품)을 끝까지 읽고, 아래 세 사람이 이 시나리오를 영화로 만들기 전에 깊이 있게 토론하는 자리를 실제 대화로 써 줘.`,
    '',
    '[참석자]',
    '- 감독: 이 영화를 직접 찍을 사람. 화면, 배우의 동작, 카메라와 편집으로 생각한다. 구체적인 컷과 앵글로 말한다.',
    '- 작가: 이 시나리오를 쓴 사람. 인물의 속마음, 숨은 동기, 장면의 의도와 복선을 안다. 원작 의도가 흐려지면 반대한다.',
    '- 평론가: 관객과 비평의 눈. 상투적인 해석, 개연성 구멍, 톤이 흔들리는 곳을 날카롭게 지적하고 더 좋은 대안을 낸다.',
    '',
    '[토론 방식]',
    '- "감독:", "작가:", "평론가:"로 시작하는 대화로. 서로 묻고 반박하고, 쉽게 동의하지 말고 근거(대본의 씬 번호와 장면)를 대며 다퉈. 마지막엔 합의해.',
    '- 일반론 말고 이 시나리오의 구체적인 씬, 대사, 행동을 짚어서 말해.',
    '- 아래 순서로 한 부씩 깊게. 한 번에 1~2부만 쓰고, 내가 "다음"이라고 하면 이어서 써.',
    '  1부. 주제와 이야기 구조: 이 영화가 결국 무슨 이야기인지, 전환점, 결말의 의미, 복선',
    '  2부. 인물: 인물마다 성격, 욕망과 두려움, 관계, 행동하는 방식과 몸짓·버릇, 말투, 옷차림이 성격을 어떻게 보여 주는지, 씬마다 감정이 어떻게 변하는지',
    '  3부. 톤앤무드: 장르의 결, 리듬과 속도, 색감, 조명, 날씨·시간대, 소리, 참고할 만한 영화',
    '  4부. 카메라 언어: 인물별·상황별 앵글과 거리 원칙, 카메라 높이, 움직임, 렌즈, 반복 모티프와 구도, 피해야 할 상투적 촬영',
    '  5부. 씬별 연출: 중요한 씬마다 핵심 순간, 공개 순서, 꼭 필요한 컷(인서트·리액션·POV 등), 배우 동작과 위치',
    '- 다 끝나면 맨 마지막에 [토론 결론]을 아래 모양으로 정리해. (이 결론을 그대로 다음 작업에 쓸 거야)',
    '',
    '[토론 결론]',
    '주제: …',
    '톤앤무드: …',
    '색감·조명: …',
    '카메라 언어: …',
    '인물: 이름 - 성격, 욕망, 행동 방식, 몸짓·버릇, 말투, 옷차림 (한 사람씩 한 줄)',
    '씬별 연출: S#번호 - 핵심 순간과 연출 방법 (중요한 씬마다 한 줄)',
    '[작품 설정]',
    '인물별 나이·직업·관계·생김새·소지품, 주요 장소, 차량·소품, 시대·계절 (한 줄씩, 뒤 씬에서 드러나는 것까지)',
    '',
    '지금은 1부부터 시작해 줘.',
  ].join('\n');
}
export const DEBATE_NEXT = '다음. 앞과 같은 깊이로 이어서 토론해 줘. 마지막 부까지 끝났으면 [토론 결론]과 [작품 설정]을 정리해 줘.';
/** 토론 답 → 결론 */
export function parseDebate(text: string): string | undefined {
  const t = unescapeMd(text.replace(/\r/g, ''));
  const i = t.search(/\[\s*토론\s*결론\s*\]/);
  if (i < 0) return undefined;
  const body = t.slice(i).replace(/^\[\s*토론\s*결론\s*\][^\n]*\n?/, '');
  const end = body.search(/^\s*\**\[\s*작품\s*설정\s*\]/m);
  const r = (end >= 0 ? body.slice(0, end) : body).replace(/\*\*/g, '').trim();
  return r || undefined;
}
/** 다른 씬들의 흐름: 씬 제목과 첫 지문 */
export function sceneOutline(p: Project, current?: number): string[] {
  return getScenes(p.lines).map(s => {
    const first = sceneUnits(s).filter(u => u.kind !== 'dlg').map(u => u.text).slice(0, 2).join(' ');
    const ppl = [...new Set(sceneUnits(s).filter(u => u.kind === 'dlg' && u.speaker).map(u => u.speaker))].slice(0, 5).join(', ');
    return `${s.num === current ? '▶ ' : ''}S#${s.num}. ${s.heading}${first ? ' — ' + (first.length > 70 ? first.slice(0, 68) + '…' : first) : ''}${ppl ? ` (말하는 인물: ${ppl})` : ''}`;
  });
}
export function buildCutSplitRequest(p: Project, scene: Scene): string {
  const looks = charList(p, p.lines);
  const parts = [...DIRECTOR_RULES.filter(r => !/한 번에 씬 3개씩|"계속"이라고/.test(r)),
    `- 이번에는 S#${scene.num} 한 씬만 나눠. 시나리오 파일을 첨부했으면 전체를 읽고, 없으면 아래 [작품 설정]과 [전체 씬 흐름]으로 앞뒤 이야기를 이해한 다음 작업해.`];
  if (!p.bible?.trim()) parts.push('- 시나리오 파일을 첨부했으면 답 맨 앞에 [작품 설정]을 써: 인물별(나이, 직업, 관계, 생김새, 늘 입는 옷, 소지품), 주요 장소, 차량·소품, 시대·계절을 뒤 씬에서 드러나는 것까지 한 줄씩.');
  parts.push(...bibleBlock(p));
  if (looks.length) parts.push('', '[등장인물]', ...looks);
  parts.push('', '[전체 씬 흐름]', ...sceneOutline(p, scene.num));
  parts.push('', `[씬] S#${scene.num}. ${scene.heading}`, '', '[대본]', numberedScene(scene), '', ...ANSWER_FORMAT(scene.num));
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
export function buildFullCutSplitRequest(p: Project, scenes: Scene[], per = 3, range?: { from: number; to: number }): string {
  const looks = charList(p, p.lines);
  const nums = scenes.map(s => s.num);
  const from = range?.from ?? nums[0] ?? 1;
  const to = range?.to ?? nums[nums.length - 1] ?? from;
  const inRange = nums.filter(n => n >= from && n <= to);
  const first = inRange[0] ?? from;
  const last = inRange[Math.min(per, inRange.length) - 1] ?? first;
  const partial = range && (from !== nums[0] || to !== nums[nums.length - 1]);
  const parts = [...DIRECTOR_RULES.map(r => r.replace(/씬 3개/g, `씬 ${per}개`)),
    `- 시나리오 전체는 첨부한 파일 "${scriptFileName(p)}"에 있어. 파일을 끝까지 읽고 이야기 전체를 이해한 다음 작업해 줘. (씬 ${scenes.length}개)`];
  if (partial) parts.push(`- 이번에 나눌 씬은 S#${from}부터 S#${to}까지(${inRange.length}개)야. 앞뒤 씬은 흐름 이해에만 쓰고 답하지 마. S#${to}까지 끝나면 "끝"이라고 써.`);
  if (!p.bible?.trim()) parts.push('- 첫 답의 맨 앞에 [작품 설정]을 써: 시나리오 전체를 읽고 인물별(나이, 직업, 관계, 생김새, 늘 입는 옷, 소지품, 버릇), 주요 장소별(구조, 위치, 분위기), 차량·소품, 시대·계절을 한 줄씩. 뒤 씬에서 드러나는 것까지 모두. 그다음 [설정표]와 컷을 써.');
  parts.push(...bibleBlock(p));
  parts.push('', `[작품] ${p.title}`);
  if (looks.length) parts.push('', '[등장인물]', ...looks);
  parts.push('', ...ANSWER_FORMAT(first), '', `지금은 S#${first}부터 씬 ${Math.min(per, inRange.length || per)}개(S#${first}~S#${last})만 답해 줘.`);
  return parts.join('\n');
}
/** 이어 받기 요청 (마지막으로 넣은 컷 다음부터 씬 per개, until 씬까지만) */
export function buildNextRequest(scene: number, cut: number, per: number, until?: number): string {
  return `다음. 지난 답은 [${scene}-${cut}]까지 받았어. S#${scene}가 그 컷에서 끝났으면 다음 씬의 설정표와 첫 컷부터, 아직 안 끝났으면 [${scene}-${cut + 1}]부터 이어서, 씬 ${per}개 분량을 앞과 같은 형식, 같은 자세함으로 답해 줘.${until ? ` S#${until}까지만 하고, 거기서 끝나면 "끝"이라고 써.` : ''} 감독으로서 컷마다 충분히 검토해서, 초벌·요약 말고 최종 콘티 수준으로.`;
}

const stripMd = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/^\s*[-*•]\s+/, '').trim();

/** AI 답 → 컷 목록. "[1-1] …" 형식과 표(| 컷 | 카메라 | 화면 |) 형식 둘 다 */
export type ParsedCut = AICut & { scene: number; idx?: number; srcNums?: number[]; dlgNums?: number[]; srcHints?: string[]; dlgHints?: string[] };
export function parseCutSplitAnswer(text: string, names: string[]): ParsedCut[] {
  const lines = unescapeMd(text.replace(/\r/g, '')).split('\n');
  const out: ParsedCut[] = [];
  const sceneOf = (l: string) => Number((l.match(/(\d+)\s*-\s*\d+/) || [])[1]) || 0;
  const cutOf = (l: string) => Number((l.match(/\d+\s*-\s*(\d+)/) || [])[1]) || 0;
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
      out.push({ scene: sceneOf(r[0]), idx: cutOf(r[0]), ...cam(r[iCam] || ''), see, src: iSrc >= 0 ? r[iSrc] : '', chars: iChar >= 0 ? splitNames(r[iChar]) : undefined, dlg: iDlg >= 0 ? parseDlg(r[iDlg]) : [] });
    }
    return out;
  }
  // [n-k] 형식
  let cur: ParsedCut | null = null; let field = '';
  for (const raw of lines) {
    const l = stripMd(raw);
    const m = l.match(/^\[?\s*S?#?\s*\d+\s*-\s*\d+\s*\]?\s*[.:)]?\s*(.*)$/);
    if (m && /^\[?\s*S?#?\s*\d+\s*-\s*\d+/.test(l)) { cur = { scene: sceneOf(l), idx: cutOf(l), ...cam(m[1] || ''), src: '', see: '', dlg: [] }; out.push(cur); field = ''; continue; }
    if (/^\[?\s*설정표/.test(l)) { cur = null; field = ''; continue; }
    if (!cur || !l) continue;
    const f = l.match(/^(대본\s*번호|대사\s*번호|대본|화면\s*효과|효과음|화면|연출|인물|대사|소리|카메라)\s*[:：]\s*(.*)$/);
    if (f) {
      field = f[1].replace(/\s/g, ''); const v = f[2].trim();
      if (field === '대본번호') { cur.srcNums = nums(v); cur.srcHints = hints(v); field = ''; }
      else if (field === '대사번호') { cur.dlgNums = nums(v); cur.dlgHints = hints(v); field = ''; }
      else if (field === '대본') cur.src = v;
      else if (field === '화면') cur.see = v;
      else if (field === '연출') cur.intent = v;
      else if (field === '효과음') { cur.sfx = listOf(v); field = ''; }
      else if (field === '화면효과') { cur.fx = listOf(v); field = ''; }
      else if (field === '인물') cur.chars = splitNames(v);
      else if (field === '카메라') Object.assign(cur, cam(v));
      else if (v) cur.dlg!.push(...parseDlg(v));
      continue;
    }
    if (field === '대본') cur.src += ' ' + l;
    else if (field === '화면') cur.see += ' ' + l;
    else if (field === '연출') cur.intent = (cur.intent || '') + ' ' + l;
    else if (field === '대사' || field === '소리') cur.dlg!.push(...parseDlg(l));
  }
  void names;
  return out;
}
/** 답 속 [작품 설정] 덩어리 */
export function parseBible(text: string): string | undefined {
  const lines = unescapeMd(text.replace(/\r/g, '')).split('\n');
  let on = false; const buf: string[] = [];
  for (const raw of lines) {
    const l = stripMd(raw);
    if (/^\[?\s*작품\s*설정\s*\]?\s*[:：]?\s*$/.test(l)) { on = true; continue; }
    if (on && (/^\[?\s*설정표/.test(l) || /^\[?\s*S?#?\s*\d+\s*-\s*\d+/.test(l))) break;
    if (on) buf.push(raw.trim());
  }
  const t = buf.join('\n').trim();
  return t || undefined;
}
/** 답 속 [설정표 n] → 씬 번호별 설정표 */
export function parseSetTables(text: string): Record<number, string> {
  const lines = unescapeMd(text.replace(/\r/g, '')).split('\n');
  const out: Record<number, string> = {}; let cur = 0; let buf: string[] = [];
  const flush = () => { if (cur && buf.join('').trim()) out[cur] = buf.join('\n').trim(); buf = []; };
  for (const raw of lines) {
    const l = stripMd(raw);
    const m = l.match(/^\[?\s*설정표\s*S?#?\s*(\d+)?\s*\]?\s*[:：]?\s*(.*)$/);
    if (m) { flush(); cur = Number(m[1]) || -1; if (m[2]) buf.push(m[2]); continue; }
    if (/^\[?\s*S?#?\s*\d+\s*-\s*\d+/.test(l)) { flush(); cur = 0; continue; }
    if (cur) buf.push(l);
  }
  flush();
  return out;
}
/** "2 (차량들 틈의)" → 괄호 안 첫머리 글 */
function hints(v: string): string[] {
  return [...v.matchAll(/[(（]([^)）]+)[)）]/g)].map(m => m[1].replace(/^["“'‘]|["”'’]$/g, '').replace(/^[^:：]{1,10}[:：]\s*/, '').trim()).filter(h => h.length >= 2 && !/^(없음|예)$/.test(h));
}
const norm = (t: string) => t.replace(/[\s.,!?…·'"“”‘’()（）\[\]-]/g, '');
/** 첫머리 글로 대본 번호 찾기 (AI가 번호를 잘못 세도 맞는 문장을 찾음) */
function findByHint(units: Unit[], h: string, near: number): number {
  const k = norm(h).slice(0, 8); if (k.length < 2) return 0;
  const hits: number[] = [];
  units.forEach((u, i) => { const t = norm(u.text); if (t.startsWith(k) || (k.length >= 4 && t.includes(k))) hits.push(i + 1); });
  if (!hits.length) return 0;
  return hits.reduce((a, b) => Math.abs(b - near) < Math.abs(a - near) ? b : a);
}
/** 번호와 첫머리 글이 다르면 글을 믿고 번호를 고침 */
function fixNums(units: Unit[], ns: number[] | undefined, hs: string[] | undefined): number[] | undefined {
  if (!hs?.length) return ns;
  const found = hs.map((h, i) => findByHint(units, h, ns?.[i] ?? ns?.[0] ?? 0)).filter(Boolean);
  if (!found.length) return ns;
  if (ns?.length && found.every(f => ns.includes(f))) return ns;   // 번호가 맞음
  const lo = Math.min(...found), hi = Math.max(...found);
  // "3-4 (차 안을 보면)" 처럼 범위에 첫머리 하나면, 범위 길이만큼 옮김
  const span = ns?.length && found.length === 1 ? ns.length : hi - lo + 1;
  return Array.from({ length: span }, (_, i) => lo + i).filter(n => n <= units.length);
}
function nums(v: string): number[] {
  v = v.replace(/[(（][^)）]*[)）]/g, ' ');
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
  const { scene: _s, idx: _i, srcNums, dlgNums, srcHints, dlgHints, ...rest } = c;
  const out: AICut = { ...rest };
  // AI가 옮겨 적은 원본 문장("대본:")이 있으면 그 문장으로 번호를 확인·바로잡음
  const srcText = (c.src || '').trim();
  const fromText = srcText ? splitSentences(srcText).filter(x => norm(x).length >= 2) : [];
  const su = pick(fixNums(units, srcNums, fromText.length ? fromText : srcHints));
  const du = pick(fixNums(units, dlgNums, dlgHints));
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
function listOf(v: string): string[] | undefined {
  if (!v || /^(없음|없다|-|—)$/.test(v.trim())) return undefined;
  return v.split(/[,，、/]/).map(x => x.trim()).filter(x => x && !/^(없음)$/.test(x));
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
