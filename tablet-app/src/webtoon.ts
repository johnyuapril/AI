// 웹툰 칸 자동 배치: 말풍선(인물 위치), 효과음, 화면효과
import type { Bubble, BubbleKind, CutMeta, FxKind, Sfx, WebtoonPanel } from './types';
import type { Cut } from './script';

export const FX_LABEL: [FxKind, string][] = [['focus', '집중선'], ['speed', '속도선'], ['flash', '번쩍'], ['dark', '어둡게'], ['shake', '흔들림']];
export const KIND_LABEL: [BubbleKind, string][] = [['talk', '말'], ['shout', '외침'], ['think', '생각'], ['off', '화면 밖 소리'], ['nar', '내레이션']];

let n = 0;
export const wid = () => Date.now().toString(36) + (n++).toString(36);

/** 화면 묘사에서 인물이 화면 어디에 있는지 (0 왼쪽 ~ 1 오른쪽) */
export function charX(desc: string, name: string): number | undefined {
  if (!desc || !name) return undefined;
  let best: number | undefined;
  let at = desc.indexOf(name);
  while (at >= 0) {
    // 이름 앞뒤 가까운 곳의 위치 말
    // 이름 바로 뒤(같은 구절)를 먼저 보고, 없으면 바로 앞
    const after = desc.slice(at + name.length, at + name.length + 30).split(/[,.，。]|그리고|, /)[0];
    const before = desc.slice(Math.max(0, at - 14), at).split(/[,.，。]/).pop() || '';
    const re = /(왼쪽|좌측|오른쪽|우측|가운데|중앙|한가운데)/;
    const m = after.match(re) || before.match(re);
    if (m) { best = /왼|좌/.test(m[1]) ? 0.27 : /오른|우/.test(m[1]) ? 0.73 : 0.5; break; }
    at = desc.indexOf(name, at + name.length);
  }
  return best;
}

const SFX_RULES: [RegExp, string][] = [
  [/총성|총을 쏘|발사|탕/, '탕!'],
  [/폭발|터진다|터지/, '콰광!!'],
  [/급정거|브레이크|끼익|급정지|미끄러/, '끼이익!'],
  [/경적|클랙슨|빵빵/, '빠앙—!'],
  [/전화벨|벨소리|벨이 울|따르릉/, '따르르릉'],
  [/비상깜박이|깜박|깜빡/, '깜빡 깜빡'],
  [/문을 (쾅|세게)|쾅/, '쾅!'],
  [/깨진다|깨지|산산조각|쨍그랑/, '쨍그랑!'],
  [/노크|문을 두드|똑똑/, '똑똑'],
  [/주먹|때린다|때리|후려|걷어차|퍽/, '퍽!'],
  [/넘어진다|넘어지|쓰러진다|쓰러지|자빠/, '쿠당!'],
  [/심장|두근/, '두근 두근'],
  [/빗소리|비가 쏟|폭우|쏴아/, '쏴아아—'],
  [/질주|가속|굉음|엔진|부릉/, '부우웅—'],
  [/뛰어간다|달려간다|뛴다|달린다|타다닥/, '타다닥'],
  [/발소리|저벅/, '저벅 저벅'],
  [/박수/, '짝짝짝'],
  [/웅성|시끌|북적|붐비/, '웅성웅성'],
  [/한숨/, '하아…'],
  [/정적|침묵|고요/, '……'],
];
const FX_RULES: [RegExp, FxKind][] = [
  [/놀란다|놀라|경악|충격|굳는다|얼어붙|눈이 커|소스라|번뜩/, 'focus'],
  [/질주|달린다|달려|뛰어|돌진|급히|빠르게|가속|추격/, 'speed'],
  [/폭발|번쩍|섬광|플래시|터진다|불빛이 번/, 'flash'],
  [/어둠|어두운|암전|그림자|회상|악몽/, 'dark'],
  [/흔들|충돌|부딪|진동|지진|들이받/, 'shake'],
];
const FX_WORDS: [RegExp, FxKind][] = [[/집중/, 'focus'], [/속도|스피드/, 'speed'], [/번쩍|섬광|플래시/, 'flash'], [/어둡|암전|어둠/, 'dark'], [/흔들|진동|쉐이크/, 'shake']];

function bubbleKind(text: string, off: boolean, action: string): BubbleKind {
  if (off) return 'off';
  if (/!{2,}|！{2,}/.test(text) || /소리친다|외친다|소리 지르|고함|비명|버럭/.test(action)) return 'shout';
  if (/^\(?속(으로|마음)|생각한다/.test(text)) return 'think';
  return 'talk';
}

/** 저장된 웹툰 칸이 없을 때 자동으로 만든 칸 */
export function autoPanel(c: Cut, m: CutMeta): WebtoonPanel {
  const desc = [m.desc, c.auto.see].filter(Boolean).join(' ');
  const action = c.action || '';
  const text = desc + ' ' + action;
  // 말하는 사람 위치: 묘사에서 찾고, 없으면 등장 순서대로 왼쪽/오른쪽
  const speakers = [...new Set(c.dialogues.map(d => d.speaker).filter(Boolean))];
  const order = [...new Set([...(m.chars || c.auto.chars || []), ...speakers])];
  const posOf = (sp: string): number => {
    const x = charX(desc, sp);
    if (x != null) return x;
    if (speakers.length <= 1 && order.length <= 1) return 0.5;
    const i = Math.max(0, order.indexOf(sp));
    return order.length <= 1 ? 0.5 : 0.22 + 0.56 * (i / (order.length - 1));
  };
  const bubbles: Bubble[] = c.dialogues.map((d, i) => {
    const kind = bubbleKind(d.text, d.off, action);
    const sx = posOf(d.speaker);
    const x = kind === 'off' || kind === 'nar' ? (i % 2 ? 0.7 : 0.3) : Math.min(0.78, Math.max(0.22, sx + (sx < 0.5 ? 0.06 : sx > 0.5 ? -0.06 : 0)));
    return { id: `${c.key}~b${i}`, speaker: d.speaker, text: d.text, kind, x, y: Math.min(0.75, 0.13 + i * 0.2), tx: sx };
  });
  // 효과음: AI가 준 것 우선, 없으면 대본·묘사에서 찾기
  let sfxTexts = (c.auto.sfx || []).filter(Boolean);
  if (!sfxTexts.length) for (const [re, t] of SFX_RULES) if (re.test(text) && !sfxTexts.includes(t)) { sfxTexts.push(t); if (sfxTexts.length >= 2) break; }
  const sfx: Sfx[] = sfxTexts.slice(0, 3).map((t, i) => ({ id: `${c.key}~s${i}`, text: t, x: i % 2 ? 0.3 : 0.7, y: bubbles.length ? 0.8 - i * 0.12 : 0.3 + i * 0.25, size: t.length > 5 ? 40 : 54, rot: i % 2 ? 8 : -10 }));
  // 화면효과
  let fx: FxKind[] = [];
  if (c.auto.fx?.length) { for (const w of c.auto.fx) for (const [re, k] of FX_WORDS) if (re.test(w) && !fx.includes(k)) fx.push(k); }
  else {
    for (const [re, k] of FX_RULES) if (re.test(text) && !fx.includes(k)) fx.push(k);
    if (!fx.includes('focus') && /Push In/i.test(c.auto.move || m.move || '') && /CU/.test(c.auto.shot || m.shot || '')) fx.push('focus');
    fx = fx.slice(0, 2);
  }
  return { bubbles, sfx, fx };
}

export const panelOf = (c: Cut, m: CutMeta): WebtoonPanel => m.wt || autoPanel(c, m);

/** 집중선·속도선·번쩍·어둡게를 캔버스에 그림 */
export function drawFx(cv: HTMLCanvasElement, fx: FxKind[], seed: string) {
  const g = cv.getContext('2d'); if (!g) return;
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  let s = 0; for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  if (fx.includes('dark')) {
    const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
    gr.addColorStop(0, 'rgba(0,0,0,0.15)'); gr.addColorStop(1, 'rgba(0,0,0,0.75)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  if (fx.includes('flash')) {
    const gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.35, 'rgba(255,255,240,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  if (fx.includes('focus')) {
    // 가장자리에서 가운데로 모이는 가는 쐐기들
    const cx = W / 2, cy = H / 2, R = Math.hypot(W, H) / 2 + 10;
    const inner = Math.min(W, H) * 0.33;
    g.fillStyle = 'rgba(0,0,0,0.85)';
    for (let i = 0; i < 160; i++) {
      const a = rnd() * Math.PI * 2, w = 0.004 + rnd() * 0.012;
      const r0 = inner + rnd() * Math.min(W, H) * 0.22;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a - w) * R, cy + Math.sin(a - w) * R);
      g.lineTo(cx + Math.cos(a + w) * R, cy + Math.sin(a + w) * R);
      g.closePath(); g.fill();
    }
  }
  if (fx.includes('speed')) {
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    for (let i = 0; i < 70; i++) {
      const y = rnd() * H, len = W * (0.15 + rnd() * 0.35), fromLeft = rnd() < 0.5;
      const x0 = fromLeft ? 0 : W - len;
      g.lineWidth = 0.6 + rnd() * 2.2;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + len, y); g.stroke();
    }
  }
}
