export interface Term { code: string; label: string; aliases: string[] }

export const SHOT_SIZES: Term[] = [
  { code: 'EWS', label: 'EWS 익스트림 와이드', aliases: ['EWS', 'ELS', 'Extreme Wide Shot', 'Extreme Long Shot', '익스트림 와이드', '익스트림 롱'] },
  { code: 'WS', label: 'WS 와이드', aliases: ['WS', 'LS', 'Wide Shot', 'Long Shot', '와이드샷', '와이드 샷', '롱샷', '롱 샷', '원경'] },
  { code: 'ES', label: 'ES 설정 샷', aliases: ['ES', 'Establishing Shot', '설정샷', '설정 샷', '전경'] },
  { code: 'FS', label: 'FS 풀샷(전신)', aliases: ['FS', 'Full Shot', '풀샷', '풀 샷', '전신'] },
  { code: 'MLS', label: 'MLS 니 샷', aliases: ['MLS', 'Medium Long Shot', 'Knee Shot', '니샷', '니 샷', '미디엄 롱'] },
  { code: 'MS', label: 'MS 미디엄(허리 위)', aliases: ['MS', 'Medium Shot', 'Waist Shot', '미디엄샷', '미디엄 샷', '웨이스트'] },
  { code: 'MCU', label: 'MCU 미디엄 클로즈업', aliases: ['MCU', 'Medium Close-Up', 'Medium Close Up', '미디엄 클로즈업'] },
  { code: 'BS', label: 'BS 바스트', aliases: ['BS', 'Bust Shot', '바스트샷', '바스트 샷', '바스트'] },
  { code: 'CU', label: 'CU 클로즈업', aliases: ['CU', 'Close-Up', 'Close Up', 'Closeup', '클로즈업', '클로즈 업'] },
  { code: 'BCU', label: 'BCU 빅 클로즈업', aliases: ['BCU', 'Big Close-Up', '빅 클로즈업', '빅클로즈업'] },
  { code: 'ECU', label: 'ECU 익스트림 클로즈업', aliases: ['ECU', 'XCU', 'Extreme Close-Up', '익스트림 클로즈업', '초근접'] },
  { code: 'INSERT', label: 'INSERT 인서트', aliases: ['INSERT', 'Insert', '인서트'] },
  { code: '1S', label: '1S 원샷', aliases: ['1S', 'One Shot', 'Single', '원샷', '원 샷'] },
  { code: '2S', label: '2S 투샷', aliases: ['2S', 'Two Shot', '투샷', '투 샷'] },
  { code: '3S', label: '3S 쓰리샷', aliases: ['3S', 'Three Shot', '쓰리샷', '쓰리 샷'] },
  { code: 'GS', label: 'GS 그룹샷', aliases: ['GS', 'Group Shot', '그룹샷', '그룹 샷'] },
  { code: 'OTS', label: 'OTS 어깨 너머', aliases: ['OTS', 'OS', 'Over The Shoulder', 'Over-the-Shoulder', '오버 더 숄더', '오버숄더', '어깨 너머'] },
  { code: 'POV', label: 'POV 시점', aliases: ['POV', 'Point of View', '시점샷', '시점 샷'] },
  { code: 'REACTION', label: '리액션', aliases: ['Reaction', 'Reaction Shot', '리액션'] },
];
export const ANGLES: Term[] = [
  { code: 'Eye-Level', label: '눈높이', aliases: ['Eye-Level', 'Eye Level', '아이레벨', '아이 레벨', '눈높이'] },
  { code: 'High-Angle', label: '부감(하이앵글)', aliases: ['High-Angle', 'High Angle', 'High-Level', '하이앵글', '하이 앵글', '부감'] },
  { code: 'Low-Angle', label: '앙각(로우앵글)', aliases: ['Low-Angle', 'Low Angle', '로우앵글', '로우 앵글', '앙각'] },
  { code: "Bird's-Eye", label: '버즈아이', aliases: ["Bird's-Eye", "Bird's Eye", 'Birds Eye', '버즈아이', '조감'] },
  { code: "Worm's-Eye", label: '웜즈아이', aliases: ["Worm's-Eye", "Worm's Eye", '웜즈아이', '극앙각'] },
  { code: 'Overhead', label: '수직 부감', aliases: ['Overhead', 'Top Shot', '오버헤드', '탑샷', '수직 부감'] },
  { code: 'Dutch', label: '더치(기울임)', aliases: ['Dutch', 'Dutch Angle', 'Canted', '더치', '더치 앵글', '사선 앵글'] },
  { code: 'Shoulder', label: '어깨 높이', aliases: ['Shoulder Level', '어깨 높이'] },
  { code: 'Hip', label: '허리 높이', aliases: ['Hip Level', '허리 높이'] },
  { code: 'Knee', label: '무릎 높이', aliases: ['Knee Level', '무릎 높이'] },
  { code: 'Ground', label: '바닥 높이', aliases: ['Ground Level', '바닥 높이', '로우 포지션'] },
  { code: 'Aerial', label: '항공', aliases: ['Aerial', '항공샷', '항공 샷'] },
  { code: 'Profile', label: '측면', aliases: ['Profile', '측면', '옆모습'] },
  { code: 'Back', label: '뒷모습', aliases: ['Back Shot', '뒷모습', '백샷'] },
];
export const MOVES: Term[] = [
  { code: 'Static', label: '고정', aliases: ['Static', 'Fixed', '고정', '픽스'] },
  { code: 'Pan Left', label: '팬 ←', aliases: ['Pan Left', '팬 레프트', '패닝 왼쪽'] },
  { code: 'Pan Right', label: '팬 →', aliases: ['Pan Right', 'Pan', '팬 라이트', '패닝', '팬'] },
  { code: 'Whip Pan', label: '휩 팬', aliases: ['Whip Pan', '휩팬', '휩 팬'] },
  { code: 'Tilt Up', label: '틸트 업', aliases: ['Tilt Up', '틸트업', '틸트 업'] },
  { code: 'Tilt Down', label: '틸트 다운', aliases: ['Tilt Down', 'Tilt', '틸트다운', '틸트 다운', '틸트'] },
  { code: 'Roll', label: '롤', aliases: ['Roll', '롤링'] },
  { code: 'Dolly In', label: '달리 인', aliases: ['Dolly In', '달리인', '달리 인'] },
  { code: 'Dolly Out', label: '달리 아웃', aliases: ['Dolly Out', '달리아웃', '달리 아웃'] },
  { code: 'Push In', label: '푸시 인', aliases: ['Push In', '푸시인', '푸시 인'] },
  { code: 'Pull Out', label: '풀 아웃', aliases: ['Pull Out', 'Pull Back', '풀아웃', '풀 아웃', '풀백'] },
  { code: 'Truck Left', label: '트럭 ←', aliases: ['Truck Left', '트럭 레프트'] },
  { code: 'Truck Right', label: '트럭 →', aliases: ['Truck Right', 'Truck', '트럭 라이트', '트럭'] },
  { code: 'Tracking', label: '트래킹', aliases: ['Tracking', 'Tracking Shot', '트래킹', '트레킹'] },
  { code: 'Follow', label: '팔로우', aliases: ['Follow', 'Follow Shot', '팔로우', '팔로잉'] },
  { code: 'Arc', label: '아크', aliases: ['Arc', 'Arc Shot', '아크'] },
  { code: 'Pedestal Up', label: '페데스탈 업', aliases: ['Pedestal Up', '페데스탈 업'] },
  { code: 'Pedestal Down', label: '페데스탈 다운', aliases: ['Pedestal Down', '페데스탈 다운'] },
  { code: 'Crane Up', label: '크레인 업', aliases: ['Crane Up', 'Crane', '크레인 업', '크레인'] },
  { code: 'Crane Down', label: '크레인 다운', aliases: ['Crane Down', '크레인 다운'] },
  { code: 'Jib', label: '지미집', aliases: ['Jib', 'Jimmy Jib', '지미집', '지브'] },
  { code: 'Drone', label: '드론', aliases: ['Drone Shot', '드론샷', '드론 샷'] },
  { code: 'Zoom In', label: '줌 인', aliases: ['Zoom In', '줌인', '줌 인'] },
  { code: 'Zoom Out', label: '줌 아웃', aliases: ['Zoom Out', '줌아웃', '줌 아웃'] },
  { code: 'Crash Zoom', label: '크래시 줌', aliases: ['Crash Zoom', 'Snap Zoom', '크래시 줌', '크래시줌'] },
  { code: 'Dolly Zoom', label: '달리 줌', aliases: ['Dolly Zoom', 'Vertigo', '달리 줌', '달리줌', '버티고'] },
  { code: 'Rack Focus', label: '포커스 이동', aliases: ['Rack Focus', 'Focus Pull', '랙 포커스', '포커스 이동'] },
  { code: 'Handheld', label: '핸드헬드', aliases: ['Handheld', 'Hand-held', '핸드헬드', '핸드 헬드'] },
  { code: 'Steadicam', label: '스테디캠', aliases: ['Steadicam', '스테디캠'] },
  { code: 'Gimbal', label: '짐벌', aliases: ['Gimbal', '짐벌'] },
];

export const termLabel = (list: Term[], code?: string) => list.find(t => t.code === code)?.label || code || '';

type Hit = { kind: 'shot' | 'angle' | 'move'; code: string; len: number };
const ALL: { kind: Hit['kind']; code: string; alias: string }[] = [];
for (const t of SHOT_SIZES) for (const a of t.aliases) ALL.push({ kind: 'shot', code: t.code, alias: a });
for (const t of ANGLES) for (const a of t.aliases) ALL.push({ kind: 'angle', code: t.code, alias: a });
for (const t of MOVES) for (const a of t.aliases) ALL.push({ kind: 'move', code: t.code, alias: a });
ALL.sort((a, b) => b.alias.length - a.alias.length);

const SEP = /^[\s.·,\-–—/:|>→]*/;

function matchAt(s: string): Hit | null {
  const low = s.toLowerCase();
  for (const x of ALL) {
    const al = x.alias.toLowerCase();
    if (!low.startsWith(al)) continue;
    const next = s.charAt(x.alias.length);
    // 단어 경계: 끝이거나 구분 기호/공백. 한글 뒤에 한글이 붙으면 다른 낱말(예: "달리는")
    if (next === '' || /[\s.·,\-–—/:|>→]/.test(next)) return { kind: x.kind, code: x.code, len: x.alias.length };
  }
  return null;
}

export interface ShotInfo { shot?: string; angle?: string; move?: string; note: string }
/** 줄이 샷 용어로 시작하면 샷 정보로 읽는다 */
export function parseShotLine(text: string): ShotInfo | null {
  let s = text.trim().replace(/^\//, '').trim();
  const info: ShotInfo = { note: '' };
  let found = 0;
  for (let guard = 0; guard < 4; guard++) {
    const h = matchAt(s);
    if (!h) break;
    if (info[h.kind]) break;
    info[h.kind] = h.code; found++;
    s = s.slice(h.len).replace(SEP, '');
  }
  if (!found) return null;
  info.note = s.trim();
  return info;
}
export function shotLabel(i: { shot?: string; angle?: string; move?: string }): string {
  return [i.shot, i.angle && termLabel(ANGLES, i.angle), i.move && termLabel(MOVES, i.move)].filter(Boolean).join(' · ');
}
