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
  parts.push(...bibleBlock(p, scene));
  if (p.debate?.trim()) parts.push('', '- 토론 결론이 있으니 컷 묘사는 그 결론의 인물 몸짓·표정·위치·공간을 그대로 살려, 컷마다 3~5문장으로 정확하고 자세히. 일반적인 표현(예: 슬픈 표정)으로 뭉뚱그리지 말고 눈·입·손·어깨가 어떻게 되는지 구체적으로.');
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
  '- 대본의 문장마다 (1), (2) 처럼 번호가 붙어 있어. 컷마다 그 컷이 보여 주는 지문의 번호와 들리는 대사의 번호만 적어. 대본 문장이나 대사는 한 글자도 옮겨 쓰지 마 (앱이 번호로 원문을 채워). 번호는 대본에 적힌 번호 그대로 쓰고 새로 세지 마. 대사·소리는 그게 들리는 동안 화면에 보이는 컷에 번호로 넣어.',
  '- 시나리오 전체를 끝까지 먼저 읽고 작업해. 뒤 씬에서 처음 드러나는 설정(인물의 나이·직업·관계·생김새·옷차림·버릇, 장소의 구조와 위치, 차량·소품, 시대·계절, 숨겨진 사실)도 앞 씬부터 일관되게 반영하고, 이 씬만 보고 추측해서 엉뚱하게 만들지 마. [작품 설정]이 있으면 꼭 지켜.',
  '- 바깥 정보는 쓰지 마: 웹 검색을 하지 말고, 같은 제목이나 비슷한 내용의 실제 영화·드라마·원작 소설, 실제 감독·배우·제작 뒷이야기, 리뷰·평점, 다른 영화와의 비교나 인용을 모두 쓰지 마. 이 시나리오가 실제 작품과 비슷해 보여도 모르는 새 작품이라고 생각하고, 첨부한 시나리오 글만 근거로 생각해.',
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
  '대본 번호: 이 컷에 해당하는 지문 번호만 (예: 2 또는 3-4)',
  '화면: 이 컷 한 순간에 보이는 것 (2~4문장, 카메라가 어디서 보는지로 시작, 위치·자세·시선·손동작·접촉)',
  '연출: 왜 이렇게 찍는지 한 줄',
  '효과음: 웹툰 효과음 (없으면 없음)',
  '화면효과: 집중선/속도선/번쩍/어둡게/흔들림 (없으면 없음)',
  '인물: 화면에 나오는 인물 이름 (없으면 없음)',
  '대사 번호: 이 컷에 들리는 대사 번호만 (예: 7 또는 8-9) (없으면 없음)',
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
function bibleBlock(p: Project, scene?: Scene): string[] {
  const out: string[] = [];
  const deb = debateFor(p, scene);
  if (deb) out.push('', '[3인 토론 결론 (감독·작가·평론가가 합의한 이 시나리오의 해석과 화면 그림. 인물의 생김새·몸짓·표정, 공간, 톤앤무드, 카메라 언어를 이대로 따르고, [씬] 항목의 순간·위치·동작·표정은 컷 묘사에 빠짐없이 살려)]', deb);
  if (p.bible?.trim()) out.push('', '[작품 설정 (시나리오 전체에서 정리한 것, 꼭 지켜)]', p.bible.trim());
  return out;
}

// -------- 감독·작가·평론가 3인 토론 --------
export function buildDebateRequest(p: Project, oneGo = false): string {
  const n = getScenes(p.lines).length;
  const lines = [
    `첨부한 시나리오 파일 "${scriptFileName(p)}"(씬 ${n}개, 내가 쓴 미발표 작품)을 끝까지 읽고, 아래 세 사람이 이 시나리오를 화면으로 옮기기 전에 깊이 있게 토론하는 자리를 실제 대화로 써 줘.`,
    '',
    '[이 토론의 목적]',
    '- 이 시나리오는 확정본이야. 이야기, 대사, 설정, 구성을 고치거나 보완하거나 더하거나 빼자는 말은 하지 마. 약점·개연성 지적이나 "이렇게 바꾸면 더 좋겠다"는 제안도 하지 마.',
    '- 토론할 것은 오직 "이 시나리오를 얼마나 깊이 이해하고 생생하게 상상해서 화면으로 그려 낼 것인가"야: 글 속 인물을 어떤 사람으로 그려 낼지, 장소와 화면을 얼마나 구체적으로 설정할지, 인물의 표정과 몸짓과 행동을 어떻게 보여 줄지.',
    '- 대본에 쓰여 있지 않은 것은 대본에 쓰인 것(행동, 대사, 지문의 단어)에서 근거를 찾아 상상해. 근거 없이 새 사건이나 설정을 만들지 마.',
    '',
    '[참석자] (세 사람 모두 이 시나리오만 읽은 가상의 인물이고, 서로 다른 분야의 전문가야)',
    '- 감독 (연출 전문가): 이 시나리오를 그대로 찍을 사람. 관심은 "어떻게 보여 줄까". 장면을 머릿속에 그려서 공간, 배우의 위치·동선·동작, 표정, 리듬, 카메라로 구체적으로 말한다. 화면으로 옮길 수 없는 해석에는 "그걸 화면에서 어떻게 보여 주지?"라고 되묻는다.',
    '- 작가 (이야기·인물 전문가): 이 시나리오를 쓴 사람. 관심은 "왜 이 인물이 이렇게 하는가". 지문과 대사 뒤에 숨은 속마음, 일부러 쓰지 않은 감정, 장면이 놓인 이유와 앞뒤 연결을 말하고, 감독의 그림이 인물의 마음이나 원래 뜻에서 벗어나면 막는다.',
    '- 평론가 (관객·해석 전문가): 완성된 영화를 보는 관객과 비평의 눈을 가진 사람. 관심은 "관객에게 무엇이 어떻게 전해지는가". 주제와 상징, 반복되는 이미지와 소품, 관객이 언제 무엇을 알게 되고 느끼는지, 해석이 대본의 글과 맞는지를 따지고, 두 사람이 놓친 단서를 찾는다. 대본 자체는 비판하지 않고, 대본을 가장 잘 읽어 내는 방향을 제안한다.',
    '',
    '[토론 방식]',
    '- 세 사람은 각자 자기 분야의 눈으로만 본다. 같은 장면을 보고도 서로 다른 것을 먼저 보고, 다른 것을 중요하게 여긴다. 말투와 관심사도 직업에 맞게 다르게.',
    '- 맞장구치거나 앞사람 말을 되풀이하지 마. 각자 자기 분야에서 새 관점을 하나 이상 더하고, 생각이 다르면 근거를 대고 반대해. 한쪽 시선으로 쏠리지 않게, 매 주제마다 세 사람이 모두 자기 입장에서 말해.',
    '- 의견이 갈리면 쉽게 넘어가지 말고 근거(씬 번호, 대사, 지문)로 따진 뒤, 세 시선을 모두 살리는 하나의 그림으로 합의해. 끝내 갈린 점은 그대로 남겨.',
    '- "감독:", "작가:", "평론가:"로 시작하는 대화로 써.',
    '- 일반론 말고 이 시나리오의 구체적인 씬, 대사, 지문의 한 단어까지 짚어서 말해.',
    '- 중요: 바깥 정보는 쓰지 마: 웹 검색을 하지 말고, 같은 제목이나 비슷한 내용의 실제 영화·드라마·원작 소설, 실제 감독·배우·제작 뒷이야기, 리뷰·평점, 다른 영화와의 비교나 인용을 모두 쓰지 마. 이 시나리오가 실제 작품과 비슷해 보여도 모르는 새 작품이라고 생각하고, 첨부한 시나리오 글만 근거로 생각해.',
    '- 아래 순서로 한 부씩 깊게. 한 번에 1~2부만 쓰고, 내가 "다음"이라고 하면 이어서 써.',
    '  1부. 시나리오 읽기: 이 이야기가 무엇에 관한 것인지, 씬마다 무슨 일이 일어나고 인물에게 무엇이 걸려 있는지, 대사와 지문 뒤의 속뜻, 앞뒤 씬을 잇는 단서',
    '  2부. 인물 그려 내기: 인물마다 나이·생김새·체격·옷차림·소지품을 대본의 단서로 구체화하고, 성격과 속마음이 몸으로 드러나는 방식(자세, 걸음걸이, 손버릇, 시선 처리, 숨, 말할 때의 표정), 다른 인물과의 거리와 태도',
    '  3부. 감정의 흐름과 표정·행동: 씬마다 인물의 감정이 어떻게 바뀌고, 그 순간 얼굴(눈, 입, 눈썹)과 몸(손, 어깨, 발)이 어떻게 움직이는지. 대사 없는 순간의 반응까지',
    '  4부. 공간과 화면: 장소마다 구조, 크기, 물건 배치, 낡음과 질감, 빛의 방향과 색, 날씨와 시간대, 소리. 인물이 공간 안 어디에 서고 어떻게 움직이는지',
    '  5부. 씬별 핵심 순간과 분위기: 씬마다 가장 중요한 순간, 화면에 무엇이 보여야 하는지, 그 씬의 톤앤무드(긴장, 고요, 불안, 따뜻함 …)와 그 분위기를 만드는 빛·공간·리듬, 꼭 필요한 순간(손·소품, 듣는 사람의 반응, 인물의 시점)',
    '  6부. 씬별 컷과 앵글 (마지막, 가장 깊게): 첫 씬부터 마지막 씬까지 씬 하나하나를 차례로 다뤄. 씬마다',
    '     - 컷을 몇 개로 어떻게 나눌지: 어디서 시작해 무엇을 어떤 순서로 보여 줄지(정보 공개 순서), 감정이 커지는 지점에서 컷이 어떻게 짧아지고 가까워지는지, 다음 씬으로 어떻게 넘어가는지',
    '     - 컷마다 샷 크기(EWS·WS·FS·MS·MCU·CU·ECU·OTS·2S), 앵글(눈높이, 하이앵글, 로우앵글, 부감, 앙각, 어깨 너머, 인물 시점, 기울인 앵글), 카메라 위치와 움직임(고정, 팬, 틸트, 달리, 트래킹, 핸드헬드, 줌)',
    '     - 앵글의 다양성: 같은 크기·같은 앵글이 이어지지 않게, 인물 사이의 힘의 관계와 감정에 맞게 높이와 거리를 바꾸는 이유',
    '     - 분위기에 맞는 화면 구성: 앞·뒤 깊이(전경·배경), 문틀·창 같은 틀 안의 틀, 빈 공간, 대칭과 치우침, 인물의 화면 속 위치와 크기, 빛과 그림자',
    '     - 시선과 방향의 연결(180도 선, 시선 방향, 움직이는 방향)이 끊기지 않는지',
    '     감독이 컷 구성을 내면, 작가는 그 컷이 인물의 속마음을 제대로 담는지, 평론가는 관객이 그 순서로 무엇을 알게 되고 느끼는지 따져서 함께 고쳐. 씬이 많으니 6부는 씬 몇 개씩 나눠서 "다음"으로 끝까지 이어 가고, 씬을 건너뛰거나 뭉뚱그리지 마.',
    '- 6부의 마지막 씬까지 끝나면 따로 결론을 정리하지 말고 "토론 끝"이라고만 써. 토론을 근거로 한 최종 콘티는 내가 따로 요청할게.',
    '',
    ];
  if (!oneGo) return [...lines, '지금은 1부부터 시작해 줘.'].join('\n');
  // 한 번에 끝까지: 중간에 "다음"을 기다리지 않고, 파일 만들기로 부마다 이어 써서 길이 한계를 넘김 (Claude 추천)
  const one = lines.map(l => l.startsWith('- 아래 순서로 한 부씩 깊게.')
    ? '- 아래 순서로 1부부터 6부까지 한 부씩 깊게, 중간에 멈추거나 나에게 묻지 말고 끝까지 진행해. 답이 아주 길어지니 파일 만들기 기능으로 "토론.md" 파일을 만들고 부마다 그 파일에 이어 써. 뒤로 갈수록 줄이거나 요약하지 말고 모든 부를 같은 깊이로.'
    : l.startsWith('- 6부의 마지막 씬까지 끝나면')
    ? '- 6부의 마지막 씬까지 다 쓰면 "토론.md"를 내려받을 수 있게 하고, 대화창에는 "토론 끝"이라고만 써. 토론을 근거로 한 최종 콘티는 내가 따로 요청할게.'
    : l.replace('씬이 많으니 6부는 씬 몇 개씩 나눠서 "다음"으로 끝까지 이어 가고, 씬을 건너뛰거나 뭉뚱그리지 마.', '6부는 모든 씬을 하나씩, 건너뛰거나 뭉뚱그리지 마.'));
  return [...one, '지금 1부부터 6부까지 끝까지 진행해 줘.'].join('\n');
}
const DEBATE_FORMAT = [
  '[결론 형식]',
  '- 결론은 요약이 아니라 장면 묘사 담당자가 이것만 보고 화면을 정확히 그릴 수 있는 "연출 노트"야. 토론에서 나온 구체적인 내용(표정, 몸짓, 위치, 물건, 빛)을 줄이지 말고 빠짐없이 옮겨. 길어도 돼.',
  '- 한 번에 다 못 쓰면 끊긴 곳에서 멈추고, 내가 "다음"이라고 하면 [토론 결론 계속]으로 이어서 써.',
  '- 대괄호 머리표를 아래 그대로 써 (앱이 이 표로 씬마다 필요한 부분을 골라 써).',
  '[토론 결론]',
  '[전체]',
  '이야기의 핵심: (3~5문장)',
  '톤앤무드: (3~5문장)',
  '색감·조명: (장소·시간대별로)',
  '카메라 언어: (인물별·상황별 원칙)',
  '관객에게 전해질 것: (주제, 상징, 반복되는 이미지·소품, 관객이 무엇을 언제 알게 되는지)',
  '세 시선의 합의: 감독·작가·평론가가 각자 꼭 지키자고 한 것, 끝내 갈린 점',
  '[인물 이름]  ← 인물마다 하나씩, 이름을 대괄호 안에',
  '생김새·체격·옷차림: (씬에 따라 바뀌면 씬 번호와 함께)',
  '자세·걸음·손버릇·시선:',
  '감정별 표정과 몸짓: (예: 화를 참을 때 …, 거짓말할 때 …, 무너질 때 …)',
  '말할 때의 모습:',
  '씬별 감정과 행동의 변화: S#번호 - … (나오는 씬마다)',
  '[공간 장소 이름]  ← 장소마다 하나씩',
  '구조와 크기, 물건 배치, 질감과 낡음, 빛·색·소리, 인물이 서는 곳과 동선',
  '[씬 번호]  ← 모든 씬마다 하나씩, 빠짐없이 (예: [씬 1], [씬 2] …)',
  '핵심 순간:',
  '인물별 위치·동작·표정 (일어나는 순서대로, 대사 없는 반응까지):',
  '꼭 보여 줄 것과 보여 주는 방법 (거리, 앵글, 인서트, 리액션):',
  '분위기와 화면 구성: (톤앤무드, 빛, 깊이, 틀, 빈 공간)',
  '컷 구성: 6부에서 정한 컷을 순서대로 한 줄씩 — 번호) 샷 크기 / 앵글 / 카메라 위치·움직임 - 보여 줄 것 - 이렇게 찍는 이유',
  '[작품 설정]',
  '인물별 나이·직업·관계·생김새·소지품, 주요 장소, 차량·소품, 시대·계절 (한 줄씩, 뒤 씬에서 드러나는 것까지)',
];
/** 3인 토론 2부(인물 그려 내기) 내용을 따르는 캐릭터 시트 그림 요청 */
export const CHAR_SHEET_STYLE = '마커펜으로 빠르게 그린 러프한 흑백 스토리보드 콘티풍. 검정 마커·펜의 거칠고 빠른 선, 선이 겹치고 삐져나와도 됨, 회색 마커 2~3톤으로 명암과 그림자, 흰 종이 배경. 사실적인 인체 비율과 얼굴. 깔끔한 일러스트, 애니메이션·만화 캐릭터, 웹툰 채색, 사진 같은 그림, 컬러는 쓰지 마.';
export function buildCharSheetRequest(name: string, look?: string): string {
  return [
    `방금 토론 2부 "인물 그려 내기"에서 감독·작가·평론가가 합의한 ${name}의 모습을 그대로 따르는 캐릭터 시트를 그림 한 장으로 그려 줘.`,
    '',
    '[먼저 정리] 그리기 전에, 2부 토론에서 이 인물에 대해 정한 내용을 아래 항목으로 짧게 정리해서 보여 줘. 그림은 이 정리를 한 줄도 빠짐없이 따라.',
    '- 나이, 키와 체격, 어깨·목·배 같은 몸의 특징',
    '- 얼굴형, 머리 모양과 길이, 눈·눈썹·코·입·턱의 특징, 피부, 주름·수염·흉터·안경',
    '- 기본 옷차림 (겉옷·안쪽 옷·바지/치마·신발, 옷감과 낡은 정도, 색은 글로만), 장신구와 늘 지니는 소지품',
    '- 기본 자세, 걸음걸이, 손버릇, 시선 처리',
    '- 토론에서 정한 감정별 표정 (예: 화를 참을 때, 거짓말할 때, 무너질 때 … 이 인물에 해당하는 것)',
    '- 정리할 때 근거는 토론 2부와 대본뿐이야. 토론과 대본에 없는 것은 대본 근거로만 최소한으로 채우고 "추정"이라고 표시해. 새 설정을 꾸며 내지 마.',
    ...(look?.trim() ? ['', `[앱에 적어 둔 ${name} 외모 (토론과 다르면 토론을 따르고 다른 점을 알려 줘)]`, look.trim()] : []),
    '',
    '[그림 구성] 가로로 긴 종이 한 장(3:2)에, 같은 사람이 모든 그림에서 똑같아 보이게.',
    '- 왼쪽 절반: 전신 3개를 같은 바닥선, 같은 크기로 나란히 — 정면, 옆모습(오른쪽 보기), 뒷모습. 차렷이 아니라 이 인물의 기본 자세와 몸의 기울기로. 기본 옷차림과 신발, 소지품까지 다 보이게.',
    '- 오른쪽 위: 얼굴 클로즈업 6개 (2줄 × 3칸) — 무표정 1개 + 토론에서 정한 감정 표정 5개. 눈·눈썹·입·이마 주름·고개 각도로 감정 차이가 분명하게.',
    '- 오른쪽 아래: 손버릇·습관 동작 2~3개 (상반신이나 손 위주), 늘 지니는 소지품 1~2개 확대.',
    '- 각 그림 사이에 여백을 두고, 칸 테두리 선은 얇게 하거나 없이.',
    '',
    `[그림체] ${CHAR_SHEET_STYLE}`,
    '',
    '[지킬 것]',
    '- 그림 안에 글자, 설명문, 화살표, 이름표, 숫자를 넣지 마.',
    '- 실제 배우나 유명인을 닮게 그리지 마. 이 시나리오만 읽고 떠올린 새로운 얼굴로.',
    '- 이 인물 한 사람만 그려. 다른 인물은 넣지 마.',
    '- 그린 뒤 정리한 항목 중 그림에 못 담은 것이 있으면 알려 줘.',
  ].join('\n');
}

export const DEBATE_NEXT = '다음. 앞과 같은 깊이로 이어서 토론해 줘. 감독은 연출, 작가는 이야기·인물, 평론가는 관객·해석의 눈으로 각자 다른 관점을 내고, 맞장구 대신 근거를 대며 따져 줘. 시나리오를 고치거나 보완하는 이야기는 하지 말고, 이 시나리오를 어떻게 이해하고 인물의 표정·행동과 화면을 어떻게 구체적으로 그려 낼지만. 6부(씬별 컷과 앵글)는 씬 몇 개씩 끝까지 이어 가고, 마지막 씬까지 끝났으면 결론은 쓰지 말고 "토론 끝"이라고만 써 줘.';
/** 토론을 이미 끝낸 뒤, 결론만 자세히 다시 받기 */
export function buildDebateSummaryRequest(): string {
  return ['지금까지 세 사람이 나눈 토론 전체를 바탕으로 [토론 결론]을 처음부터 다시, 아주 자세히 정리해 줘. 앞에 쓴 결론은 너무 짧았어.', '', ...DEBATE_FORMAT].join('\n');
}
/** 토론 답(여러 번 붙여 넣은 기록 전체) → 결론. [토론 결론]이 다시 나오면 새로 시작, [토론 결론 계속]은 이어 붙임 */
export function parseDebate(text: string): string | undefined {
  const t = unescapeMd(text.replace(/\r/g, '')).replace(/\*\*/g, '');
  const re = /^\s*#*\s*\[\s*토론\s*결론(\s*계속)?[^\]\n]*\]\s*$/gm;
  const marks: { at: number; end: number; cont: boolean }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) marks.push({ at: m.index, end: m.index + m[0].length, cont: !!m[1] });
  if (!marks.length) return undefined;
  let out: string[] = [];
  marks.forEach((mk, i) => {
    let body = t.slice(mk.end, marks[i + 1]?.at ?? t.length);
    const stop = body.search(/^\s*#*\s*\[\s*작품\s*설정\s*\]/m);
    if (stop >= 0) body = body.slice(0, stop);
    body = body.replace(/\n━━━━━━━━\n[\s\S]*$/, '').trim();   // 다음 붙여넣기의 토론 대화는 빼기
    if (!mk.cont) out = [];
    if (body) out.push(body);
  });
  const r = out.join('\n').trim();
  return r || undefined;
}
/** 결론을 [머리표] 덩어리로 */
function debateBlocks(d: string): { head: string; body: string }[] {
  const out: { head: string; body: string }[] = []; let cur: { head: string; body: string } | null = { head: '', body: '' };
  for (const line of d.split('\n')) {
    const h = line.trim().match(/^#*\s*\[\s*([^\]]+?)\s*\]\s*(.*)$/);
    if (h && !/^\d+\s*-\s*\d+$/.test(h[1])) { if (cur && cur.body.trim()) out.push(cur); cur = { head: h[1].trim(), body: h[2] ? h[2] + '\n' : '' }; continue; }
    cur!.body += line + '\n';
  }
  if (cur && cur.body.trim()) out.push(cur);
  return out;
}
/** 이 씬에 필요한 결론만: [전체] + 나오는 인물 + 이 씬 장소 + [씬 n] (머리표가 없으면 전체) */
export function debateFor(p: Project, scene?: Scene): string {
  const d = p.debate?.trim(); if (!d) return '';
  if (!scene) return d;
  const blocks = debateBlocks(d);
  if (blocks.filter(b => b.head).length < 2) return d;
  const text = scene.lines.map(l => l.text).join(' ') + ' ' + scene.heading;
  const keep = blocks.filter(b => {
    const h = b.head.replace(/^(인물|공간|장소)\s*/, '');
    if (!b.head || /^전체/.test(b.head)) return true;
    const sn = b.head.match(/^(씬|S#?)\s*#?\s*(\d+)/i); if (sn) return Number(sn[2]) === scene.num;
    if (/^(공간|장소)/.test(b.head)) return h.split(/[\s/·,()]+/).filter(w => w.length >= 2).some(w => scene.heading.includes(w));
    return h.split(/[\s/·,()]+/).filter(w => w.length >= 2).some(w => text.includes(w));
  });
  return keep.map(b => (b.head ? `[${b.head}]\n` : '') + b.body.trim()).join('\n\n');
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
  if (p.debate?.trim()) parts.push('- [3인 토론 결론]의 인물 몸짓·표정·위치, 공간, [씬] 항목의 순간들을 컷 나누기와 "화면" 묘사에 빠짐없이 살려. [씬] 항목에 "컷 구성"이 있으면 그 컷 순서·샷 크기·앵글·움직임을 기본으로 따르고, 한 컷에 담기지 않는 것만 나눠서 보태. "화면"은 이때 3~5문장으로, 눈·입·손·어깨까지 구체적으로. 토론 기록 파일을 첨부했으면 그 대화의 세부도 참고해.');
  parts.push(...bibleBlock(p, scene));
  if (looks.length) parts.push('', '[등장인물]', ...looks);
  parts.push('', '[전체 씬 흐름]', ...sceneOutline(p, scene.num));
  parts.push('', `[씬] S#${scene.num}. ${scene.heading}`, '', '[대본]', numberedScene(scene), '', ...ANSWER_FORMAT(scene.num));
  return parts.join('\n');
}
/** 첨부할 시나리오 파일 내용 */
export function fullScriptText(p: Project, scenes: Scene[]): string {
  const parts: string[] = []; // 제목은 넣지 않음 (AI가 같은 제목의 실제 영화 정보를 끌어오지 않게)
  for (const s of scenes) parts.push(`S#${s.num}. ${s.heading}`, numberedScene(s), '');
  return parts.join('\n');
}
export const scriptFileName = (_p: Project) => '시나리오.txt'; // 제목을 빼서 실제 작품 검색을 막음
/** 시나리오는 파일로 첨부하고, 이 요청 문장만 붙여 넣음 */
export function buildFullCutSplitRequest(p: Project, scenes: Scene[], per = 3, range?: { from: number; to: number }, fromDebate = false, toFile = false): string {
  const looks = charList(p, p.lines);
  const nums = scenes.map(s => s.num);
  const from = range?.from ?? nums[0] ?? 1;
  const to = range?.to ?? nums[nums.length - 1] ?? from;
  const inRange = nums.filter(n => n >= from && n <= to);
  const first = inRange[0] ?? from;
  const last = inRange[Math.min(per, inRange.length) - 1] ?? first;
  const partial = range && (from !== nums[0] || to !== nums[nums.length - 1]);
  const parts = [
    ...(fromDebate ? [
      '[토론 결과 정리] 지금까지 이 대화에서 감독·작가·평론가가 나눈 토론(1부~6부)이 끝났어. 이제 그 토론을 근거로 감독이 씬바이씬 최종 콘티를 정리해 줘.',
      '- 토론에서 합의한 인물의 생김새·옷차림·몸짓·표정, 공간과 빛, 씬별 분위기, 6부에서 정한 씬별 컷 나누기와 샷 크기·앵글·카메라 움직임을 그대로 따라. 토론에서 다루지 못한 부분만 같은 원칙으로 채워.',
      '- 토론 내용을 요약하거나 다시 쓰지 말고, 아래 [답하는 형식]의 콘티로만 답해.',
      ...(toFile ? ['- 콘티는 파일 만들기 기능으로 "콘티.txt" 파일에 씬 순서대로 이어 써. 중간에 멈추거나 묻지 말고 마지막 씬까지 모두, 뒤로 갈수록 줄이지 말고 같은 자세함으로. 다 쓰면 파일을 내려받을 수 있게 하고 대화창에는 "끝"이라고만 써.'] : []),
      '',
    ] : []),
    ...DIRECTOR_RULES.map(r => r.replace(/씬 3개/g, `씬 ${per}개`)),
    fromDebate ? `- 시나리오는 이 대화 처음에 첨부한 파일 "${scriptFileName(p)}"(문장마다 번호)야. 대본 번호와 대사 번호는 그 파일의 번호로. (씬 ${scenes.length}개)`
      : `- 시나리오 전체는 첨부한 파일 "${scriptFileName(p)}"에 있어. 파일을 끝까지 읽고 이야기 전체를 이해한 다음 작업해 줘. (씬 ${scenes.length}개)`];
  if (partial) parts.push(`- 이번에 나눌 씬은 S#${from}부터 S#${to}까지(${inRange.length}개)야. 앞뒤 씬은 흐름 이해에만 쓰고 답하지 마. S#${to}까지 끝나면 "끝"이라고 써.`);
  if (!p.bible?.trim()) parts.push('- 첫 답의 맨 앞에 [작품 설정]을 써: 시나리오 전체를 읽고 인물별(나이, 직업, 관계, 생김새, 늘 입는 옷, 소지품, 버릇), 주요 장소별(구조, 위치, 분위기), 차량·소품, 시대·계절을 한 줄씩. 뒤 씬에서 드러나는 것까지 모두. 그다음 [설정표]와 컷을 써.');
  if (p.debate?.trim()) parts.push('- [3인 토론 결론]의 인물 몸짓·표정·위치, 공간, [씬] 항목의 순간들을 컷 나누기와 "화면" 묘사에 빠짐없이 살려. [씬] 항목에 "컷 구성"이 있으면 그 컷 순서·샷 크기·앵글·움직임을 기본으로 따르고, 한 컷에 담기지 않는 것만 나눠서 보태. "화면"은 이때 3~5문장으로, 눈·입·손·어깨까지 구체적으로. 토론 기록 파일을 첨부했으면 그 대화의 세부도 참고해.');
  parts.push(...bibleBlock(p));
  if (looks.length) parts.push('', '[등장인물]', ...looks);
  parts.push('', ...ANSWER_FORMAT(first), '', toFile ? `S#${first}부터 S#${inRange[inRange.length - 1] ?? to}까지 모든 씬을 "콘티.txt" 파일로 써 줘.` : `지금은 S#${first}부터 씬 ${Math.min(per, inRange.length || per)}개(S#${first}~S#${last})만 답해 줘.`);
  return parts.join('\n');
}
/** 이어 받기 요청 (마지막으로 넣은 컷 다음부터 씬 per개, until 씬까지만) */
export function buildNextRequest(scene: number, cut: number, per: number, until?: number): string {
  return `다음. 지난 답은 [${scene}-${cut}]까지 받았어. S#${scene}가 그 컷에서 끝났으면 다음 씬의 설정표와 첫 컷부터, 아직 안 끝났으면 [${scene}-${cut + 1}]부터 이어서, 씬 ${per}개 분량을 앞과 같은 형식, 같은 자세함으로 답해 줘.${until ? ` S#${until}까지만 하고, 거기서 끝나면 "끝"이라고 써.` : ''} 감독으로서 컷마다 충분히 검토해서, 초벌·요약 말고 최종 콘티 수준으로.`;
}

const stripMd = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/^\s*[-*•]\s+/, '').trim();

/** AI 답 → 컷 목록. "[1-1] …" 형식과 표(| 컷 | 카메라 | 화면 |) 형식 둘 다 */
export type ParsedCut = AICut & { scene: number; idx?: number; srcNums?: number[]; dlgNums?: number[]; srcHints?: string[]; dlgHints?: string[] };
/** 토론 6부처럼 "S#19 …" 제목 아래 "C1 WS, 화면…" / "컷 1. MS / …" 로 쓴 답 → [19-1] 형식으로 바꾸기 */
function convertSceneCutList(lines: string[]): string[] {
  const hasStd = lines.some(l => /^\s*[-*•]?\s*\[?\s*S?#?\s*\d+\s*-\s*\d+\s*\]/.test(stripMd(l)));
  if (hasStd) return lines;
  const out: string[] = []; let scene = 0; let hit = false;
  for (const raw of lines) {
    const l = stripMd(raw);
    const sh = l.match(/^#*\s*S\s*#\s*(\d+)\b/i) || l.match(/^#*\s*씬\s*(\d+)\b/);
    if (sh) { scene = +sh[1]; out.push(raw); continue; }
    const c = scene ? l.match(/^(?:C|컷|CUT)\s*(\d+)\s*[.:)\]]?\s+(.+)$/i) : null;
    if (!c) { out.push(raw); continue; }
    hit = true;
    // 앞쪽의 샷·앵글·움직임 말은 카메라, 나머지는 화면
    const toks = c[2].split(/\s*[,/·|]\s*/);
    const camT: string[] = [];
    while (toks.length > 1 && (parseShotLine(toks[0]) || /^(OTS|POV|2S|인서트|insert|부감|앙각|하이|로우|아이레벨|눈높이|핸드헬드|고정|팬|틸트|달리|트래킹|줌)/i.test(toks[0])) && toks[0].length <= 20) camT.push(toks.shift()!);
    out.push(`[${scene}-${+c[1]}] ${camT.join(' / ')}`, `화면: ${toks.join(', ')}`);
  }
  return hit ? out : lines;
}
export function parseCutSplitAnswer(text: string, names: string[]): ParsedCut[] {
  const lines = convertSceneCutList(unescapeMd(text.replace(/\r/g, '')).split('\n'));
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
/** 번호 없이 컷만 온 답: 씬 대본 문장을 순서대로 컷에 나눠 담기.
 *  컷의 화면 묘사·인물과 문장이 얼마나 닮았는지 보고, 순서는 지키면서 가장 잘 맞게 나눔 */
const bigrams = (t: string) => { const n = t.replace(/[^가-힣A-Za-z0-9]/g, ''); const b = new Set<string>(); for (let i = 0; i < n.length - 1; i++) b.add(n.slice(i, i + 2)); return b; };
export function fillByOrder(scene: Scene, list: AICut[]): AICut[] {
  const units = sceneUnits(scene).filter(u => u.kind !== 'trans');
  const N = units.length, M = list.length;
  if (!N || !M) return list;
  const cb = list.map(c => bigrams(`${c.see} ${c.cam || ''}`));
  const score = (i: number, j: number) => {
    const u = units[i]; const ub = bigrams(u.text); let common = 0;
    ub.forEach(x => { if (cb[j].has(x)) common++; });
    let sc = common / (Math.min(ub.size, cb[j].size) + 2);
    const chars = list[j].chars || [];
    if (u.kind === 'dlg' && u.speaker && chars.some(n => u.speaker!.includes(n) || n.includes(u.speaker!))) sc += 0.35;
    if (u.kind !== 'dlg' && chars.some(n => n && u.text.includes(n))) sc += 0.1;
    return sc - 0.6 * Math.abs((j + 0.5) / M - (i + 0.5) / N); // 대략 순서대로 고르게
  };
  // dp[i][j]: 문장 0..i 를 나눴고 문장 i 가 컷 j 에 들어간 최고 점수 (컷 번호는 줄지 않음)
  const dp = Array.from({ length: N }, () => new Array<number>(M).fill(-Infinity));
  const from = Array.from({ length: N }, () => new Array<number>(M).fill(0));
  for (let j = 0; j < M; j++) dp[0][j] = score(0, j);
  for (let i = 1; i < N; i++) {
    let best = -Infinity, bj = 0;
    for (let j = 0; j < M; j++) {
      if (dp[i - 1][j] > best) { best = dp[i - 1][j]; bj = j; }
      dp[i][j] = best + score(i, j); from[i][j] = bj;
    }
  }
  let j = dp[N - 1].indexOf(Math.max(...dp[N - 1]));
  const at = new Array<number>(N);
  for (let i = N - 1; i >= 0; i--) { at[i] = j; j = from[i][j]; }
  return list.map((c, k) => {
    const mine = units.filter((_, i) => at[i] === k);
    const src = mine.filter(u => u.kind !== 'dlg').map(u => u.text).join(' ');
    const dl: { speaker: string; text: string; off: boolean }[] = [];
    for (const u of mine.filter(u => u.kind === 'dlg')) { const last = dl[dl.length - 1]; if (last && u.cont && last.speaker === (u.speaker || '')) last.text += ' ' + u.text; else dl.push({ speaker: u.speaker || '', text: u.text, off: !!u.off }); }
    return { ...c, src: c.src?.trim() ? c.src : src, dlg: c.dlg?.length ? c.dlg : dl };
  });
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


// -------- ComfyUI용 영어 프롬프트 (외부 AI에게 번역·정리 받기) --------
export function buildEnRequest(p: Project, scene: Scene, cuts: Cut[]): string {
  const looks = p.chars.filter(ch => ch.look.trim() && scene.lines.some(l => l.text.includes(ch.name))).map(ch => `${ch.name}: ${ch.look.trim()}`);
  const parts = [
    '아래 스토리보드 컷들을 그림 AI(Stable Diffusion/Flux)에 넣을 영어 프롬프트로 바꿔 줘.',
    '- 컷마다 영어 한 단락(40~90단어). 쉼표로 이어진 묘사 문장으로.',
    '- 순서: 샷 크기와 앵글(예: extreme wide shot, low angle) → 장소 → 인물(이름 대신 나이·성별·생김새·옷차림으로, 같은 인물은 모든 컷에서 똑같은 말로) → 자세·동작·표정·시선 → 빛과 시간대.',
    '- 그림체, 색, 화질 단어는 쓰지 마 (앱이 따로 붙여). 글자·말풍선·대사도 넣지 마.',
    '- 화면에 사람이 없으면 "no people"을 넣어.',
    '- 한 컷 = 한 장면 한 순간. 여러 칸이나 여러 장면을 섞지 마.',
    '',
  ];
  if (looks.length) parts.push('[인물 외모]', ...looks, '');
  const st = p.scenes[scene.id]?.setTable?.trim();
  if (st) parts.push('[씬 설정표]', st, '');
  parts.push(`[씬] S#${scene.num}. ${scene.heading}`, '');
  cuts.forEach((c, i) => parts.push(cutPromptFor(p, scene, c, cuts[i - 1]).split('\n').filter(l => !l.startsWith('⚠')).join('\n'), ''));
  parts.push('[답하는 형식] 다른 말 없이 컷마다 한 줄씩:', `[${cuts[0]?.label || scene.num + '-1'}] extreme wide shot, …`, `[${cuts[1]?.label || scene.num + '-2'}] …`);
  return parts.join('\n');
}
/** "[1-2] english…" → { '1-2': 'english…' } */
export function parseEnAnswer(text: string): Record<string, string> {
  const out: Record<string, string> = {}; let cur = '';
  for (const raw of unescapeMd(text.replace(/\r/g, '')).split('\n')) {
    const l = raw.replace(/\*\*|__|`/g, '').trim();
    const m = l.match(/^[-*•]?\s*\[?\s*(?:컷\s*)?S?#?\s*(\d+)\s*-\s*(\d+)\s*\]?\s*[.:)\]]?\s*(.*)$/);
    if (m) { cur = `${+m[1]}-${+m[2]}`; out[cur] = m[3].trim(); continue; }
    if (cur && l) out[cur] = (out[cur] + ' ' + l).trim();
  }
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}
