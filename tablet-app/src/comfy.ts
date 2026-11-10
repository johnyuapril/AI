// ComfyUI(내 PC에서 돌리는 그림 AI)로 컷 그림을 바로 그리기.
// 윈도우용 앱은 앱 안(메인 프로세스)에서 보내서 브라우저 제한(CORS)이 없고,
// 태블릿·브라우저는 ComfyUI를 --listen --enable-cors-header 로 켜야 한다.
import { desktop } from './native';

export interface ComfySettings {
  url: string;          // 예: http://127.0.0.1:8188
  ckpt?: string;        // 기본 워크플로에서 쓸 모델 파일 이름
  workflow?: string;    // 내가 넣은 워크플로 (API 형식 JSON). 없으면 기본(SDXL 글→그림)
  workflowName?: string;
  style: string;        // 영어 그림체 문구 (모든 컷 앞에)
  neg: string;          // 빼고 싶은 것 (네거티브)
  w: number; h: number; steps: number; cfg: number;
  exe?: string;         // 윈도우: ComfyUI 실행 파일 (없으면 흔한 위치에서 찾음)
  autoStart?: boolean;  // 윈도우 앱을 켜면 ComfyUI도 켜기 (기본 켬)
  engine?: 'auto' | 'qwen' | 'sdxl'; // auto: Qwen-Image 2.1이 있으면 그것(참고 그림 여러 장), 없으면 SDXL 체크포인트
}
export const DEFAULT_COMFY: ComfySettings = {
  url: 'http://127.0.0.1:8188',
  style: 'rough storyboard sketch, quick black marker pen drawing on white paper, loose expressive ink lines, 2-3 tones of grey marker shading, black and white, cinematic film storyboard frame, realistic proportions',
  neg: 'color, colorful, text, letters, words, watermark, signature, speech bubble, caption, panel borders, multiple panels, comic layout, photo, photorealistic, 3d render, anime, manga, clean lineart, blurry, deformed hands',
  w: 1344, h: 768, steps: 28, cfg: 6,
};

const base = (c: ComfySettings) => c.url.trim().replace(/\/+$/, '');

type Res = { status: number; type: string; data: Uint8Array };
async function req(url: string, method = 'GET', body?: Uint8Array | string, headers: Record<string, string> = {}): Promise<Res> {
  if (desktop?.fetchBin) {
    const r = await desktop.fetchBin({ url, method, headers, body });
    return { status: r.status, type: r.type, data: r.data };
  }
  const r = await fetch(url, { method, headers, body: body as BodyInit | undefined });
  return { status: r.status, type: r.headers.get('content-type') || '', data: new Uint8Array(await r.arrayBuffer()) };
}
const txt = (d: Uint8Array) => new TextDecoder().decode(d);
async function getJson(c: ComfySettings, path: string): Promise<any> {
  let r: Res;
  try { r = await req(base(c) + path); }
  catch (e: any) { throw new Error(`ComfyUI에 연결하지 못했어요 (${base(c)}). ComfyUI가 켜져 있는지, 주소가 맞는지 확인해 주세요. ${e?.message || ''}`); }
  if (r.status >= 400) throw new Error(`ComfyUI 오류 ${r.status}: ${txt(r.data).slice(0, 300)}`);
  return JSON.parse(txt(r.data));
}

/** 연결 확인 + 그래픽카드 정보 */
export async function comfyCheck(c: ComfySettings): Promise<string> {
  const j = await getJson(c, '/system_stats');
  const d = j?.devices?.[0];
  const gpu = d ? `${String(d.name || '').replace(/^cuda:\d+\s*/, '').replace(/\s*:.*$/, '')} · 메모리 ${Math.round((d.vram_total || 0) / 1073741824)}GB` : '';
  return `연결됐어요. ComfyUI ${j?.system?.comfyui_version || ''} ${gpu}`.trim();
}
/** 설치된 모델(체크포인트) 목록 */
export async function comfyCheckpoints(c: ComfySettings): Promise<string[]> {
  const j = await getJson(c, '/object_info/CheckpointLoaderSimple');
  return comboList(j?.CheckpointLoaderSimple?.input?.required?.ckpt_name);
}

/** 그림을 ComfyUI input 폴더로 올리기 → 파일 이름 */
async function upload(c: ComfySettings, blob: Blob, name: string): Promise<string> {
  const bnd = '----sw' + Math.random().toString(16).slice(2);
  const enc = new TextEncoder();
  const head = enc.encode(`--${bnd}\r\nContent-Disposition: form-data; name="image"; filename="${name}"\r\nContent-Type: ${blob.type || 'image/png'}\r\n\r\n`);
  const ow = enc.encode(`\r\n--${bnd}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--${bnd}--\r\n`);
  const file = new Uint8Array(await blob.arrayBuffer());
  const body = new Uint8Array(head.length + file.length + ow.length);
  body.set(head, 0); body.set(file, head.length); body.set(ow, head.length + file.length);
  const r = await req(base(c) + '/upload/image', 'POST', body, { 'Content-Type': `multipart/form-data; boundary=${bnd}` });
  if (r.status >= 400) throw new Error(`참고 그림 올리기 실패 ${r.status}: ${txt(r.data).slice(0, 200)}`);
  const j = JSON.parse(txt(r.data));
  return (j.subfolder ? j.subfolder + '/' : '') + j.name;
}

/** 기본 워크플로: SDXL 체크포인트 하나로 글 → 그림 */
function defaultWorkflow(c: ComfySettings, pos: string, neg: string, seed: number): any {
  if (!c.ckpt) throw new Error('쓸 모델을 먼저 골라 주세요 (그림 탭 → ComfyUI 설정 → 모델).');
  return {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: c.ckpt } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: c.w, height: c.h, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: pos, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: neg, clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: { seed, steps: c.steps, cfg: c.cfg, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'storyboard', images: ['8', 0] } },
  };
}

/** 내 워크플로(API 형식)에 프롬프트·참고 그림·시드 넣기.
 *  글 칸에 {{prompt}} / {{negative}} 를 써 두면 거기에 넣고, 없으면 가장 긴 CLIPTextEncode 글에 넣음.
 *  LoadImage 의 그림 이름이 {{ref}} 이거나 노드 제목에 ref/참고 가 있으면 인물 참고 그림(캐릭터 시트)을 넣음 */
function fillWorkflow(json: string, pos: string, neg: string, seed: number, ref?: string): any {
  let wf: any;
  try { wf = JSON.parse(json); } catch { throw new Error('워크플로 파일을 읽지 못했어요. ComfyUI에서 "Export (API)"로 저장한 파일인지 확인해 주세요.'); }
  if (wf.nodes && wf.links) throw new Error('일반 저장 형식이에요. ComfyUI 메뉴에서 "Export (API)"로 다시 저장해 주세요.');
  let placed = false;
  for (const n of Object.values<any>(wf)) {
    const inp = n?.inputs; if (!inp) continue;
    for (const k of Object.keys(inp)) {
      const v = inp[k];
      if (typeof v === 'string') {
        if (v.includes('{{prompt}}')) { inp[k] = v.replace('{{prompt}}', pos); placed = true; }
        else if (v.includes('{{negative}}')) inp[k] = v.replace('{{negative}}', neg);
        else if (v === '{{ref}}') inp[k] = ref || inp[k];
      }
      if ((k === 'seed' || k === 'noise_seed') && typeof v === 'number') inp[k] = seed;
    }
    if (ref && n.class_type === 'LoadImage' && /ref|참고|character|캐릭터/i.test(n?._meta?.title || '')) inp.image = ref;
  }
  if (!placed) {
    const enc = Object.values<any>(wf).filter(n => n?.class_type?.startsWith('CLIPTextEncode') && typeof n.inputs?.text === 'string');
    enc.sort((a, b) => b.inputs.text.length - a.inputs.text.length);
    if (!enc.length) throw new Error('워크플로에서 프롬프트 칸을 찾지 못했어요. 글 칸에 {{prompt}} 라고 써 두고 다시 저장해 주세요.');
    enc[0].inputs.text = pos;
  }
  return wf;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** object_info 의 선택 목록: 옛 형식 [[…], {}] 과 새 형식 ["COMBO", {options:[…]}] 둘 다 */
function comboList(def: any): string[] {
  if (!Array.isArray(def)) return [];
  if (Array.isArray(def[0])) return def[0];
  if (def[0] === 'COMBO') return def[1]?.options || [];
  return [];
}

// -------- Qwen-Image 2.1 (참고 그림 여러 장을 받는 편집 모델) --------
// 노드 입력 이름은 버전마다 달라질 수 있어서, object_info 를 읽고 '종류'로 연결한다.
type NodeInfo = { input: { required?: Record<string, any>; optional?: Record<string, any> }; output: string[] };
const infoCache = new Map<string, { at: number; v: Record<string, NodeInfo> }>();
async function nodeInfo(c: ComfySettings, names: string[]): Promise<Record<string, NodeInfo | undefined>> {
  const out: Record<string, NodeInfo | undefined> = {};
  for (const n of names) {
    const key = base(c) + '|' + n; const hit = infoCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) { out[n] = hit.v[n]; continue; }
    try { const j = await getJson(c, '/object_info/' + n); infoCache.set(key, { at: Date.now(), v: j }); out[n] = j?.[n]; } catch { out[n] = undefined; }
  }
  return out;
}
const inputsOf = (i: NodeInfo) => ({ ...(i.input.required || {}), ...(i.input.optional || {}) });
const typeOf = (def: any): string => Array.isArray(def) ? (Array.isArray(def[0]) ? 'COMBO' : String(def[0])) : '';
/** 필수 입력 중 값(숫자·글·선택)은 기본값으로 채움 */
function defaults(i: NodeInfo, given: Record<string, any>): Record<string, any> {
  const out = { ...given };
  for (const [k, def] of Object.entries(i.input.required || {})) {
    if (k in out) continue;
    const t = typeOf(def); const o = Array.isArray(def) ? def[1] || {} : {};
    if (t === 'COMBO') out[k] = o.default ?? comboList(def)[0];
    else if (t === 'INT' || t === 'FLOAT' || t === 'BOOLEAN' || t === 'STRING') { if (o.default !== undefined) out[k] = o.default; }
  }
  return out;
}
/** 종류(MODEL, CLIP …)로 필수 연결 채우기 */
function linkByType(i: NodeInfo, given: Record<string, any>, links: Record<string, [string, number]>): Record<string, any> {
  const out = { ...given };
  for (const [k, def] of Object.entries(i.input.required || {})) if (!(k in out) && links[typeOf(def)]) out[k] = links[typeOf(def)];
  return out;
}
const outIdx = (i: NodeInfo | undefined, t: string) => Math.max(0, (i?.output || []).indexOf(t));

export interface QwenModels { unet: string; clip: string; vae: string }
/** 이 ComfyUI에 Qwen-Image 2.1이 준비돼 있는지 */
export async function qwenFind(c: ComfySettings): Promise<QwenModels | null> {
  const ni = await nodeInfo(c, ['TextEncodeQwenImage21', 'UNETLoader', 'CLIPLoader', 'VAELoader']);
  if (!ni.TextEncodeQwenImage21 || !ni.UNETLoader || !ni.CLIPLoader || !ni.VAELoader) return null;
  const unets = comboList(inputsOf(ni.UNETLoader).unet_name);
  const clips = comboList(inputsOf(ni.CLIPLoader).clip_name);
  const vaes = comboList(inputsOf(ni.VAELoader).vae_name);
  const unet = unets.filter(n => /qwen/i.test(n) && /2[._]?1/.test(n)).sort((a, b) => +/turbo/i.test(b) - +/turbo/i.test(a))[0];
  // 텍스트 인코더는 8B 를 써야 함 (4B 는 shape 오류)
  const clip = clips.find(n => /qwen3?vl/i.test(n) && /8b/i.test(n)) || clips.find(n => /qwen/i.test(n) && /8b/i.test(n));
  const vae = vaes.find(n => /qwen/i.test(n) && /2[._]?1/.test(n)) || vaes.find(n => /qwen/i.test(n));
  return unet && clip && vae ? { unet, clip, vae } : null;
}
const TURBO_SIGMAS = '1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0';
async function qwenWorkflow(c: ComfySettings, m: QwenModels, prompt: string, images: string[], seed: number): Promise<any> {
  const ni = await nodeInfo(c, ['UNETLoader', 'QwenImage21Cache', 'CLIPLoader', 'VAELoader', 'TextEncodeQwenImage21', 'ConditioningZeroOut', 'EmptyLatentImage', 'CFGGuider', 'RandomNoise', 'KSamplerSelect', 'ManualSigmas', 'BasicScheduler', 'SamplerCustomAdvanced', 'VAEDecode', 'SaveImage']);
  const need = ['TextEncodeQwenImage21', 'CFGGuider', 'RandomNoise', 'KSamplerSelect', 'SamplerCustomAdvanced'];
  const miss = need.filter(n => !ni[n]); if (miss.length) throw new Error('이 ComfyUI에 없는 노드: ' + miss.join(', ') + ' (ComfyUI 0.42 이상 필요)');
  const wf: any = {};
  wf.unet = { class_type: 'UNETLoader', inputs: defaults(ni.UNETLoader!, { unet_name: m.unet }) };
  let model: [string, number] = ['unet', 0];
  if (ni.QwenImage21Cache) { wf.cache = { class_type: 'QwenImage21Cache', inputs: defaults(ni.QwenImage21Cache, linkByType(ni.QwenImage21Cache, {}, { MODEL: model })) }; model = ['cache', outIdx(ni.QwenImage21Cache, 'MODEL')]; }
  const clipTypes = comboList(inputsOf(ni.CLIPLoader!).type);
  wf.clip = { class_type: 'CLIPLoader', inputs: defaults(ni.CLIPLoader!, { clip_name: m.clip, ...(clipTypes.includes('qwen_image') ? { type: 'qwen_image' } : {}) }) };
  wf.vae = { class_type: 'VAELoader', inputs: { vae_name: m.vae } };
  const te = ni.TextEncodeQwenImage21!; const teIn = inputsOf(te);
  const enc: Record<string, any> = {};
  const strKey = Object.keys(teIn).find(k => typeOf(teIn[k]) === 'STRING' && /prompt|text/i.test(k)) || Object.keys(teIn).find(k => typeOf(teIn[k]) === 'STRING');
  if (strKey) enc[strKey] = prompt;
  if ('resolution' in teIn) enc.resolution = 1024;
  for (const k of Object.keys(teIn)) if (typeOf(teIn[k]) === 'VAE') enc[k] = ['vae', 0]; // 참고 그림을 잠재 공간으로 넣을 때 씀 (선택 입력이어도 연결)
  const imgKeys = 'images' in teIn ? images.map((_, i) => `images.image_${i + 1}`) : Object.keys(teIn).filter(k => typeOf(teIn[k]) === 'IMAGE');
  images.forEach((name, i) => {
    if (!imgKeys[i]) return;
    wf['img' + i] = { class_type: 'LoadImage', inputs: { image: name } };
    enc[imgKeys[i]] = ['img' + i, 0];
  });
  wf.enc = { class_type: 'TextEncodeQwenImage21', inputs: defaults(te, linkByType(te, enc, { CLIP: ['clip', 0], VAE: ['vae', 0] })) };
  const cond: [string, number] = ['enc', outIdx(te, 'CONDITIONING')];
  wf.neg = { class_type: 'ConditioningZeroOut', inputs: { conditioning: cond } };
  wf.latent = { class_type: 'EmptyLatentImage', inputs: { width: c.w, height: c.h, batch_size: 1 } };
  wf.guider = { class_type: 'CFGGuider', inputs: { model, positive: cond, negative: ['neg', 0], cfg: 1 } };
  wf.noise = { class_type: 'RandomNoise', inputs: { noise_seed: seed } };
  wf.sampler = { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } };
  const turbo = /turbo/i.test(m.unet);
  if (turbo && ni.ManualSigmas) { const k = Object.keys(inputsOf(ni.ManualSigmas)).find(x => typeOf(inputsOf(ni.ManualSigmas!)[x]) === 'STRING') || 'sigmas'; wf.sigmas = { class_type: 'ManualSigmas', inputs: { [k]: TURBO_SIGMAS } }; }
  else wf.sigmas = { class_type: 'BasicScheduler', inputs: { model, scheduler: 'simple', steps: turbo ? 8 : 28, denoise: 1 } };
  wf.run = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['sampler', 0], sigmas: ['sigmas', 0], latent_image: ['latent', 0] } };
  wf.dec = { class_type: 'VAEDecode', inputs: { samples: ['run', 0], vae: ['vae', 0] } };
  wf.save = { class_type: 'SaveImage', inputs: { filename_prefix: 'storyboard_qwen', images: ['dec', 0] } };
  return wf;
}

/** 컷 그림에 같이 보낼 참고 그림 */
export interface ComfyRef { blob: Blob; name: string; label: string }

/** 그림 하나 그리기 → 그림(Blob). refs: 캐릭터 시트 등 참고 그림(Qwen·내 워크플로에서 씀) */
export async function comfyDraw(c: ComfySettings, prompt: string, opt: { refs?: ComfyRef[]; styleRef?: Blob; onWait?: (s: string) => void; signal?: { stop: boolean }; korean?: boolean; label?: string } = {}): Promise<Blob> {
  const seed = Math.floor(Math.random() * 2 ** 31);
  let wf: any;
  const qwen = !c.workflow && c.engine !== 'sdxl' ? await qwenFind(c) : null;
  if (c.workflow) {
    const pos = [c.style.trim(), prompt.trim()].filter(Boolean).join(', ');
    const ref = opt.refs?.[0] ? await upload(c, opt.refs[0].blob, opt.refs[0].name) : undefined;
    wf = fillWorkflow(c.workflow, pos, c.neg, seed, ref);
  } else if (qwen) {
    // 그림1~N: 인물 캐릭터 시트, 마지막: 화풍 그림. 프롬프트에서 <imageN>으로 가리킴
    const refs = (opt.refs || []).slice(0, 3);
    const names: string[] = [];
    for (const r of refs) names.push(await upload(c, r.blob, r.name));
    if (opt.styleRef) names.push(await upload(c, opt.styleRef, 'sw_style.png'));
    const lines = [
      'One single storyboard frame (one camera shot, one moment). ' + prompt.trim(),
      ...refs.map((r, i) => `<image${i + 1}> is the character sheet of ${r.label}: keep exactly the same face, hairstyle, body type and outfit. Do not copy the sheet layout, draw only this person in the scene.`),
      opt.styleRef ? `Match the drawing style of <image${refs.length + 1}> (style only, not its content).` : '',
      `Drawing style: ${c.style.trim()}.`,
      `Avoid: ${c.neg.trim()}.`,
    ].filter(Boolean);
    wf = await qwenWorkflow(c, qwen, lines.join('\n'), names, seed);
  } else {
    if (c.engine === 'qwen') throw new Error('이 ComfyUI에서 Qwen-Image 2.1 모델을 찾지 못했어요. (8B 텍스트 인코더, 2.1 VAE 포함)');
    if (opt.korean) throw new Error(`${opt.label || '이 컷'}: 영문 프롬프트가 없어요. SDXL은 한국어를 못 읽어서, 씬 위 "영문 요청 복사"로 먼저 받아 주세요.`);
    const pos = [c.style.trim(), prompt.trim()].filter(Boolean).join(', ');
    wf = defaultWorkflow(c, pos, c.neg, seed);
  }
  let r: Res;
  try { r = await req(base(c) + '/prompt', 'POST', JSON.stringify({ prompt: wf, client_id: 'screenwriter' }), { 'Content-Type': 'application/json' }); }
  catch (e: any) { throw new Error(`ComfyUI에 연결하지 못했어요 (${base(c)}). ${e?.message || ''}`); }
  const j = JSON.parse(txt(r.data) || '{}');
  if (r.status >= 400 || j.error) {
    const ne = j.node_errors ? Object.values<any>(j.node_errors).flatMap(x => x.errors || []).map((e: any) => e.message + (e.details ? ': ' + e.details : '')).join(' / ') : '';
    throw new Error(`ComfyUI가 거절했어요: ${j.error?.message || txt(r.data).slice(0, 200)} ${ne}`.trim());
  }
  const id = j.prompt_id;
  const t0 = Date.now();
  while (Date.now() - t0 < 15 * 60_000) {
    if (opt.signal?.stop) throw new Error('멈췄어요.');
    await sleep(1500);
    const h = await getJson(c, '/history/' + id);
    const item = h[id];
    if (!item) { opt.onWait?.(`그리는 중… ${Math.round((Date.now() - t0) / 1000)}초`); continue; }
    if (item.status?.status_str === 'error') {
      const msg = (item.status.messages || []).find((m: any) => m[0] === 'execution_error')?.[1];
      throw new Error('ComfyUI 실행 오류: ' + (msg ? `${msg.node_type}: ${msg.exception_message}` : '알 수 없음'));
    }
    const imgs = Object.values<any>(item.outputs || {}).flatMap(o => o.images || []);
    const im = imgs.find(x => x.type === 'output') || imgs[0];
    if (!im) { if (item.status?.completed) throw new Error('ComfyUI가 그림을 내놓지 않았어요. 워크플로에 Save Image 노드가 있는지 확인해 주세요.'); continue; }
    const q = new URLSearchParams({ filename: im.filename, subfolder: im.subfolder || '', type: im.type || 'output' });
    const v = await req(base(c) + '/view?' + q.toString());
    if (v.status >= 400) throw new Error('그림을 받아오지 못했어요: ' + v.status);
    return new Blob([v.data], { type: v.type || 'image/png' });
  }
  throw new Error('15분이 지나도 그림이 안 나와서 멈췄어요.');
}


/** 켜져 있는 주소 찾기 (설정 주소, 8189 Qwen 포터블, 8188, 8000 데스크톱) */
export async function comfyFindRunning(c: ComfySettings): Promise<string | null> {
  const urls = [...new Set([base(c), 'http://127.0.0.1:8189', 'http://127.0.0.1:8188', 'http://127.0.0.1:8000'])];
  for (const url of urls) {
    try { const r = await req(url + '/system_stats'); if (r.status < 400) return url; } catch { /* 꺼져 있음 */ }
  }
  return null;
}
export let comfyStartNote = '';
/** 윈도우 앱을 켤 때: ComfyUI가 꺼져 있으면 켜기. 찾은 실행 파일 경로를 돌려줌 */
export async function comfyAutoStart(c: ComfySettings): Promise<{ running?: string; launched?: string; notFound?: boolean }> {
  if (!desktop?.comfyLaunch) return {};
  const running = await comfyFindRunning(c);
  if (running) { comfyStartNote = 'ComfyUI가 이미 켜져 있어요.'; return { running }; }
  const r = await desktop.comfyLaunch(c.exe);
  if (!r.ok) { comfyStartNote = 'ComfyUI 실행 파일을 찾지 못했어요. "ComfyUI 위치 고르기"로 알려 주세요.'; return { notFound: true }; }
  comfyStartNote = `ComfyUI를 켰어요 (${r.path}). 완전히 뜰 때까지 30초~1분 걸려요.`;
  return { launched: r.path };
}


/** 기본으로 받을 모델: SDXL 공식 (6.9GB, 10GB 그래픽카드에서 잘 돎) */
export const SDXL_MODEL = { name: 'sd_xl_base_1.0.safetensors', url: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors', size: '6.9GB' };
/** 체크포인트 목록에서 콘티용으로 쓸 만한 것 고르기 (SDXL 계열 우선, refiner·인페인트 빼기) */
export function pickCheckpoint(list: string[]): string | undefined {
  const ok = list.filter(n => !/refiner|inpaint|vae|upscale|pose|sam|detect|depth|svd|video|ltx|wan|hunyuan/i.test(n));
  const score = (n: string) => (/juggernaut/i.test(n) ? 5 : 0) + (/xl|sdxl/i.test(n) ? 3 : 0) + (/flux|sd3|svd|video|wan|ltx|hunyuan/i.test(n) ? -10 : 0) + (/1[._-]?5|sd15/i.test(n) ? -2 : 0);
  return [...ok].sort((a, b) => score(b) - score(a))[0];
}
/** ComfyUI가 뜰 때까지 기다렸다가 주소·모델을 알아서 맞추기 */
export async function comfyAutoSetup(c: ComfySettings, waitMs = 180_000, onNote?: (s: string) => void): Promise<Partial<ComfySettings> | null> {
  const t0 = Date.now(); let url: string | null = null;
  while (!(url = await comfyFindRunning(c)) && Date.now() - t0 < waitMs) { onNote?.(`ComfyUI 켜지는 중… ${Math.round((Date.now() - t0) / 1000)}초`); await sleep(3000); }
  if (!url) return null;
  const cc = { ...c, url };
  const list = await comfyCheckpoints(cc).catch(() => [] as string[]);
  const patch: Partial<ComfySettings> = {};
  if (url !== c.url) patch.url = url;
  if (!c.ckpt || !list.includes(c.ckpt)) { const best = pickCheckpoint(list); if (best) patch.ckpt = best; else if (c.ckpt) patch.ckpt = undefined; }
  const q = await qwenFind(cc).catch(() => null);
  comfyStartNote = q ? `ComfyUI 준비됐어요 (${url}). Qwen-Image 2.1로 캐릭터 시트를 참고해서 그려요.`
    : (patch.ckpt || c.ckpt) ? `ComfyUI 준비됐어요 (${url}). 모델: ${patch.ckpt || c.ckpt}`
    : 'ComfyUI는 켜졌는데 그림 모델이 없어요.';
  onNote?.(comfyStartNote);
  return patch;
}
