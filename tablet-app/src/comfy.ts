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
  return j?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
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

/** 그림 하나 그리기 → 그림(Blob) */
export async function comfyDraw(c: ComfySettings, prompt: string, opt: { ref?: Blob; refName?: string; onWait?: (s: string) => void; signal?: { stop: boolean } } = {}): Promise<Blob> {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const pos = [c.style.trim(), prompt.trim()].filter(Boolean).join(', ');
  let ref: string | undefined;
  if (opt.ref && c.workflow) ref = await upload(c, opt.ref, opt.refName || 'sw_ref.png');
  const wf = c.workflow ? fillWorkflow(c.workflow, pos, c.neg, seed, ref) : defaultWorkflow(c, pos, c.neg, seed);
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
