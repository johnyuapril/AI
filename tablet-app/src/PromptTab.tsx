import React, { useMemo, useState } from 'react';
import type { WsProps } from './Workspace';
import type { Project } from './types';
import { getCuts, getScenes, knownNames, type Cut, type Scene } from './script';
import { buildEnRequest, parseEnAnswer, autoCommon, autoCutPrompt, commonFor, cutPromptFor, fullCutPrompt, masterPrompt, sceneAllGuide, sceneGuide } from './prompts';
import { Img, LazyText, Lightbox, useToast } from './ui';
import { copyText } from './util';
import { pickFiles, shareImage } from './native';
import { flipImage, imageFromClipboard, imageFromPaste, storeImageFile } from './images';
import { getImageBlob } from './store';
import { DEFAULT_STYLE } from './store';
import type { Settings } from './types';
import { cutValues } from './script';
import { comfyAutoSetup, comfyAutoStart, pickCheckpoint, SDXL_MODEL, comfyCheck, comfyCheckpoints, comfyDraw, comfyStartNote, DEFAULT_COMFY, type ComfySettings } from './comfy';
import { desktop, isDesktop } from './native';

const comfyOf = (s: Settings): ComfySettings => ({ ...DEFAULT_COMFY, ...(s.comfy || {}) });
/** 컷 하나를 ComfyUI로 그려서 컷에 넣기 */
async function drawCut(p: Project, settings: Settings, cut: Cut, setCut: (k: string, patch: Record<string, unknown>) => void, onWait?: (s: string) => void) {
  const c = comfyOf(settings);
  const m = p.cuts[cut.key] || {};
  const en = m.en?.trim();
  if (!en && !c.workflow) throw new Error(`${cut.label}: 영문 프롬프트가 없어요. 씬 위의 "영문 프롬프트 요청 복사"로 먼저 받아 주세요.`);
  const prompt = en || (m.desc || cut.action || '');
  // 인물 참고 그림(캐릭터 시트): 컷의 첫 인물
  const who = cutValues(p, cut).chars.map(n => p.chars.find(ch => ch.name === n)).find(ch => ch?.sheet);
  const ref = who?.sheet ? await getImageBlob(who.sheet) : undefined;
  const blob = await comfyDraw(c, prompt, { ref: ref || undefined, refName: who ? `sw_${who.name}.png` : undefined, onWait });
  const id = await storeImageFile(blob);
  setCut(cut.key, { img: id, wait: false });
}

export default function PromptTab(props: WsProps) {
  const { p, update, settings, setSettings, focusScene } = props;
  const toast = useToast();
  const scenes = useMemo(() => getScenes(p.lines), [p.lines]);
  const names = useMemo(() => knownNames(p), [p.lines, p.chars]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(focusScene ? [focusScene] : scenes[0] ? [scenes[0].id] : []));
  const [big, setBig] = useState<string | null>(null);
  const toggle = (id: string) => setOpen(o => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const setStyleImg = async (b: Blob) => { const id = await storeImageFile(b, 1200); setSettings({ ...settings, styleImg: id }); toast('화풍 참고 그림을 넣었어요.'); };
  const bulk = async () => {
    const files = await pickFiles('image/*', true); if (!files.length) return;
    const all: { c: Cut; s: Scene }[] = []; for (const s of scenes) for (const c of getCuts(p, s, names)) all.push({ c, s });
    const byLabel = new Map(all.map(x => [x.c.label, x.c]));
    const waiting = all.filter(x => p.cuts[x.c.key]?.wait).map(x => x.c);
    const assign: [string, string][] = []; let left = 0;
    for (const f of files) {
      const m = f.name.match(/(\d+)\s*[-_]\s*(\d+)/);
      const target = (m && byLabel.get(`${+m[1]}-${+m[2]}`)) || waiting.shift();
      if (!target) { left++; continue; }
      assign.push([target.key, await storeImageFile(f)]);
    }
    update(x => { const cuts = { ...x.cuts }; for (const [k, id] of assign) cuts[k] = { ...cuts[k], img: id, wait: false }; return { ...x, cuts }; });
    toast(`그림 ${assign.length}장을 넣었어요.${left ? ` 넣을 컷을 못 찾은 그림 ${left}장 (파일 이름에 1-3처럼 컷 번호를 넣거나, 먼저 "복사"를 눌러 기다리는 컷을 만들어 주세요)` : ''}`);
  };
  return (
    <div className="page"><div className="page-inner">
      <div className="toolbar">
        <b>그림</b>
        <span className="muted small-t">컷 "복사" → 외부 AI(ChatGPT 등)에 붙여 넣어 그림 받기 → 받은 그림을 컷 칸에 넣기</span>
        <div className="grow" />
        <button onClick={bulk}>받은 그림 여러 장 넣기</button>
      </div>
      <div className="box"><div className="box-b" style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 14 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <label><b>프롬프트 첫 줄</b><LazyText value={settings.promptHeader} rows={1} style={{ width: '100%' }} onSave={v => setSettings({ ...settings, promptHeader: v })} /></label>
          <label><b>그림체</b> <span className="muted small-t">모든 컷 프롬프트에 들어가요</span>
            <LazyText value={settings.styleText} rows={3} style={{ width: '100%' }} onSave={v => setSettings({ ...settings, styleText: v })} /></label>
          <div className="row"><button className="small" onClick={() => setSettings({ ...settings, styleText: DEFAULT_STYLE })}>그림체 기본값</button>
            <span className="muted small-t">같은 대화창에서 순서대로 그리면 인물과 장소가 더 잘 이어져요.</span></div>
        </div>
        <div>
          <b>화풍 참고 그림</b>
          <div className="imgslot" style={{ width: '100%', marginTop: 6 }} onClick={() => settings.styleImg ? setBig(settings.styleImg) : pickFiles('image/*').then(f => f[0] && setStyleImg(f[0]))}
            onPaste={e => { const f = imageFromPaste(e); if (f) setStyleImg(f); }} tabIndex={0}>
            {settings.styleImg ? <Img id={settings.styleImg} /> : '눌러서 그림 넣기'}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="small" onClick={() => pickFiles('image/*').then(f => f[0] && setStyleImg(f[0]))}>바꾸기</button>
            {settings.styleImg && <button className="small" onClick={async () => { const b = await getImageBlob(settings.styleImg!); if (b) { const m = await shareImage(b, 'style.jpg'); if (m) toast(m); } }}>외부 AI로 보내기</button>}
            {settings.styleImg && <button className="small danger" onClick={() => setSettings({ ...settings, styleImg: undefined })}>빼기</button>}
          </div>
          <div className="muted small-t" style={{ marginTop: 4 }}>새 대화를 시작할 때 이 그림을 함께 보내고 "이 그림체로"라고 하면 좋아요.</div>
        </div>
      </div></div>
      <ComfyPanel p={p} update={update} settings={settings} setSettings={setSettings} onBig={setBig} />
      {scenes.map(s => <ScenePrompts key={s.id} {...props} scene={s} names={names} open={open.has(s.id)} onToggle={() => toggle(s.id)} onBig={setBig} />)}
      {big && <Lightbox id={big} onClose={() => setBig(null)} />}
    </div></div>
  );
}

function ScenePrompts({ p, update, settings, scene, names, open, onToggle, onBig }: WsProps & { scene: Scene; names: string[]; open: boolean; onToggle: () => void; onBig: (id: string) => void }) {
  const toast = useToast();
  const cuts = useMemo(() => getCuts(p, scene, names), [p.lines, p.scenes, scene, names]);
  const meta = p.scenes[scene.id] || {};
  const imgs = cuts.filter(c => p.cuts[c.key]?.img).length;
  const setCut = (key: string, patch: Record<string, unknown>) => update(x => ({ ...x, cuts: { ...x.cuts, [key]: { ...x.cuts[key], ...patch } } }));
  const copyCut = async (c: Cut, i: number) => {
    let t = fullCutPrompt(p, scene, c, cuts[i - 1], settings);
    if (i === 0) t = sceneGuide() + '\n\n' + t;
    const ok = await copyText(t);
    setCut(c.key, { wait: true });
    toast(ok ? `${c.label} 복사됨 → 외부 AI에 붙여 넣으세요` : '복사하지 못했어요.');
  };
  const copyAll = async () => {
    const parts = [sceneAllGuide(cuts.length), '', commonFor(p, scene, settings), ''];
    cuts.forEach((c, i) => parts.push(cutPromptFor(p, scene, c, cuts[i - 1]), ''));
    const ok = await copyText(parts.join('\n'));
    update(x => { const nc = { ...x.cuts }; for (const c of cuts) if (!nc[c.key]?.img) nc[c.key] = { ...nc[c.key], wait: true }; return { ...x, cuts: nc }; });
    toast(ok ? `S#${scene.num} 전체 ${cuts.length}컷을 복사했어요.` : '복사하지 못했어요.');
  };
  const [busy, setBusy] = useState('');
  const stopRef = React.useRef({ stop: false });
  const copyEn = async () => { const ok = await copyText(buildEnRequest(p, scene, cuts)); toast(ok ? `S#${scene.num} 영문 프롬프트 요청을 복사했어요. 외부 AI에 붙여 넣고, 답을 "영문 답 넣기"로 넣어요.` : '복사하지 못했어요.'); };
  const putEn = async () => {
    let t = ''; try { t = await navigator.clipboard.readText(); } catch { /* */ }
    if (!t.trim()) t = prompt('외부 AI의 답을 붙여 넣으세요') || '';
    const r = parseEnAnswer(t); const hit = cuts.filter(c => r[c.label]);
    if (!hit.length) { toast('답에서 [1-1] 같은 컷 번호를 찾지 못했어요.'); return; }
    update(x => { const nc = { ...x.cuts }; for (const c of hit) nc[c.key] = { ...nc[c.key], en: r[c.label] }; return { ...x, cuts: nc }; });
    toast(`영문 프롬프트 ${hit.length}/${cuts.length}컷을 넣었어요.`);
  };
  const drawAll = async () => {
    if (busy) { stopRef.current.stop = true; return; }
    const todo = cuts.filter(c => !p.cuts[c.key]?.img);
    if (!todo.length) { toast('그림이 없는 컷이 없어요. 다시 그릴 컷은 컷마다 "ComfyUI" 버튼을 눌러요.'); return; }
    stopRef.current = { stop: false };
    let n = 0;
    try {
      for (const c of todo) {
        if (stopRef.current.stop) break;
        setBusy(`${c.label} 그리는 중 (${n + 1}/${todo.length})`);
        await drawCut(p, settings, c, setCut, w => setBusy(`${c.label} ${w} (${n + 1}/${todo.length})`));
        n++;
      }
      toast(`S#${scene.num} ${n}컷을 그렸어요.`);
    } catch (e: any) { toast(String(e?.message || e)); }
    setBusy('');
  };
  const copyMaster = async () => { const ok = await copyText(masterPrompt(p, scene, cuts, settings)); toast(ok ? '마스터 샷 프롬프트를 복사했어요.' : '복사하지 못했어요.'); };
  const auto = autoCommon(p, scene, settings);
  return <div className="box">
    <div className="box-h">
      <button className="small ghost" onClick={onToggle}>{open ? '▾' : '▸'}</button>
      <span className="sn">S#{scene.num}</span><span className="grow">{scene.heading}</span>
      <span className="chip">묘사 {cuts.filter(c => p.cuts[c.key]?.desc).length}/{cuts.length}</span>
      <span className={'chip' + (imgs === cuts.length && imgs ? ' on' : '')}>그림 {imgs}/{cuts.length}</span>
      <span className="chip" title="ComfyUI용 영어 프롬프트">영문 {cuts.filter(c => p.cuts[c.key]?.en).length}/{cuts.length}</span>
      <button onClick={copyEn} title="ComfyUI용 영어 프롬프트를 외부 AI에게 받는 요청">영문 요청 복사</button>
      <button onClick={putEn}>영문 답 넣기</button>
      <button className={busy ? 'danger' : 'accent'} onClick={drawAll} title="그림 없는 컷을 ComfyUI로 차례로 그려요">{busy ? '멈추기 · ' + busy : 'ComfyUI로 씬 그리기'}</button>
      <button onClick={copyMaster}>마스터 샷 복사</button>
      <button className="primary" onClick={copyAll}>씬 전체 복사</button>
    </div>
    {open && <div className="box-b">
      <div className="lbl" style={{ fontWeight: 700 }}>씬 공통 (마스터 샷) <span className="muted small-t" style={{ fontWeight: 400 }}>그림체·장소·인물 생김새. 복사할 때만 각 컷 앞에 붙어요.</span>
        {meta.common !== undefined && <button className="small" style={{ marginLeft: 8 }} onClick={() => update(x => { const m = { ...x.scenes[scene.id] }; delete m.common; return { ...x, scenes: { ...x.scenes, [scene.id]: m } }; })}>자동으로 되돌리기</button>}</div>
      <LazyText className={meta.common !== undefined ? 'tag-manual' : ''} value={commonFor(p, scene, settings)} rows={5} style={{ width: '100%', marginTop: 6 }}
        onSave={v => update(x => ({ ...x, scenes: { ...x.scenes, [scene.id]: { ...x.scenes[scene.id], common: v === auto ? undefined : v } } }))} />
      {cuts.map((c, i) => <CutPromptRow key={c.key} p={p} settings={settings} scene={scene} cut={c} prev={cuts[i - 1]} onCopy={() => copyCut(c, i)} setCut={setCut} onBig={onBig} />)}
    </div>}
  </div>;
}

function CutPromptRow({ p, settings, scene, cut, prev, onCopy, setCut, onBig }: { p: Project; settings: Settings; scene: Scene; cut: Cut; prev?: Cut; onCopy: () => void; setCut: (k: string, patch: Record<string, unknown>) => void; onBig: (id: string) => void }) {
  const toast = useToast();
  const m = p.cuts[cut.key] || {};
  const auto = autoCutPrompt(p, scene, cut, prev);
  const put = async (b: Blob) => { const id = await storeImageFile(b); setCut(cut.key, { img: id, wait: false }); toast(`${cut.label}에 그림을 넣었어요.`); };
  const onPaste = (e: React.ClipboardEvent) => { const f = imageFromPaste(e); if (f) { e.preventDefault(); put(f); } };
  const [drawing, setDrawing] = useState('');
  const draw = async () => {
    if (drawing) return;
    setDrawing('보내는 중…');
    try { await drawCut(p, settings, cut, setCut, setDrawing); toast(`${cut.label}을 그렸어요.`); }
    catch (e: any) { toast(String(e?.message || e)); }
    setDrawing('');
  };
  return <div className="prow">
    <div>
      <div className="row" style={{ marginBottom: 4 }}>
        <b>{cut.label}</b>
        {m.prompt !== undefined && <span className="chip warn">직접 고친 프롬프트</span>}
        {!m.desc && <span className="chip">묘사 없음 · 대본으로 만듦</span>}
        <div className="grow" />
        {m.prompt !== undefined && <button className="small" onClick={() => setCut(cut.key, { prompt: undefined })}>자동으로 되돌리기</button>}
        <button className="small primary" onClick={onCopy}>복사</button>
      </div>
      <LazyText className={m.prompt !== undefined ? 'tag-manual' : ''} value={cutPromptFor(p, scene, cut, prev)} onSave={v => setCut(cut.key, { prompt: v === auto ? undefined : v })} />
      <div className="row small-t" style={{ marginTop: 4 }}><b>영문 (ComfyUI)</b><span className="muted">{m.en ? '' : '없음 · 씬 위 "영문 요청 복사"로 받아요'}</span></div>
      <LazyText value={m.en || ''} rows={2} placeholder="medium shot, eye level, …" onSave={v => setCut(cut.key, { en: v.trim() || undefined })} />
    </div>
    <div>
      <div className={'imgslot' + (m.wait && !m.img ? ' wait' : '')} tabIndex={0} onPaste={onPaste}
        onClick={() => m.img ? onBig(m.img) : pickFiles('image/*').then(f => f[0] && put(f[0]))}>
        {m.img ? <Img id={m.img} /> : m.wait ? '그림 기다리는 중\n눌러서 넣기' : '눌러서 그림 넣기'}
      </div>
      <div className="row" style={{ marginTop: 6, gap: 4 }}>
        <button className="small accent" disabled={!!drawing} onClick={draw} title="ComfyUI로 이 컷 그리기 (다시 누르면 새로 그려요)">{drawing || 'ComfyUI'}</button>
        <button className="small" onClick={() => pickFiles('image/*').then(f => f[0] && put(f[0]))}>갤러리</button>
        <button className="small" onClick={async () => { const b = await imageFromClipboard(); if (b) put(b); else toast('클립보드에 그림이 없어요. 그림 칸을 길게 눌러 붙여넣기 하거나 갤러리에서 고르세요.'); }}>붙여넣기</button>
        {m.img && <button className="small" title="그림 좌우 반전" onClick={async () => { const b = await flipImage(m.img!); if (b) { const id = await storeImageFile(b); setCut(cut.key, { img: id }); } }}>좌우 반전 ⇋</button>}
        {m.img && <button className="small danger" onClick={() => setCut(cut.key, { img: undefined })}>빼기</button>}
      </div>
      <div contentEditable suppressContentEditableWarning className="small-t muted" style={{ marginTop: 4, padding: 6, border: '1px dashed var(--line)', borderRadius: 6, minHeight: 32 }}
        onPaste={onPaste} onInput={e => { (e.currentTarget as HTMLElement).textContent = '여기를 길게 눌러 그림 붙여넣기'; }}>여기를 길게 눌러 그림 붙여넣기</div>
    </div>
  </div>;
}


/** ComfyUI 설정: 주소, 모델, 그림체, 내 워크플로, 인물 참고 그림 */
function ComfyPanel({ p, update, settings, setSettings, onBig }: { p: Project; update: WsProps['update']; settings: Settings; setSettings: (s: Settings) => void; onBig: (id: string) => void }) {
  const toast = useToast();
  const c = comfyOf(settings);
  const [open, setOpen] = useState(!!settings.comfy && !settings.comfy.ckpt);
  React.useEffect(() => { if (comfyStartNote) setStatus(comfyStartNote); }, []);
  const [status, setStatus] = useState('');
  const [ckpts, setCkpts] = useState<string[]>([]);
  const set = (patch: Partial<ComfySettings>) => setSettings({ ...settings, comfy: { ...c, ...patch } });
  const [dl, setDl] = useState('');
  React.useEffect(() => { desktop?.onComfyDl?.(x => setDl(x.done ? '' : `받는 중 ${Math.round(x.got / 1048576)}MB${x.total ? ` / ${Math.round(x.total / 1048576)}MB` : ''}`)); }, []);
  const getModel = async () => {
    if (!confirm(`SDXL 모델(${SDXL_MODEL.size})을 받을까요? 인터넷 속도에 따라 몇 분~수십 분 걸려요.`)) return;
    setDl('받기 시작…');
    try { await desktop!.comfyGetModel!(c.exe, SDXL_MODEL.url, SDXL_MODEL.name); setDl(''); set({ ckpt: SDXL_MODEL.name }); toast('SDXL 모델을 받았어요. 바로 그릴 수 있어요.'); }
    catch (e: any) { setDl(''); toast(String(e?.message || e)); }
  };
  const check = async () => {
    setStatus('연결하는 중…');
    // ComfyUI 데스크톱 앱은 8000, 직접 설치(포터블)는 8188 포트를 써서 둘 다 시도
    const urls = [c.url, ...(/^(https?:\/\/)?(127\.0\.0\.1|localhost):(8188|8000)\/?$/.test(c.url.trim()) ? ['http://127.0.0.1:8000', 'http://127.0.0.1:8188'].filter(u => u !== c.url.trim().replace(/\/$/, '')) : [])];
    let err = '';
    for (const url of urls) {
      try {
        const cc = { ...c, url }; const msg = await comfyCheck(cc); const list: string[] = await comfyCheckpoints(cc).catch(() => []);
        setCkpts(list); setStatus(msg + (list.length ? ` · 모델 ${list.length}개` : ' · 모델(체크포인트)이 없어요'));
        const best = pickCheckpoint(list);
        set({ url, ...((!c.ckpt || !list.includes(c.ckpt)) && best ? { ckpt: best } : {}) }); return;
      } catch (e: any) { if (!err) err = String(e?.message || e); }
    }
    setStatus(err);
  };
  const loadWf = async () => {
    const [f] = await pickFiles('.json,application/json'); if (!f) return;
    const t = await f.text();
    try { const j = JSON.parse(t); if (j.nodes && j.links) { toast('일반 저장 형식이에요. ComfyUI에서 "Export (API)"로 저장한 파일을 넣어 주세요.'); return; } }
    catch { toast('JSON 파일을 읽지 못했어요.'); return; }
    set({ workflow: t, workflowName: f.name }); toast('내 워크플로를 넣었어요.');
  };
  // 대사 많은 순 인물
  const people = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const l of p.lines) if (l.t === 'character') { const n = l.text.replace(/\s*\(.*?\)\s*/g, '').trim(); if (n) cnt.set(n, (cnt.get(n) || 0) + 1); }
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
  }, [p.lines]);
  const setSheet = async (name: string, b: Blob) => {
    const id = await storeImageFile(b, 1600);
    update(x => { const has = x.chars.some(ch => ch.name === name); return { ...x, chars: has ? x.chars.map(ch => ch.name === name ? { ...ch, sheet: id } : ch) : [...x.chars, { name, memo: '', look: '', sheet: id }] }; });
    toast(`${name} 캐릭터 시트를 넣었어요.`);
  };
  return <div className="box">
    <div className="box-h">
      <button className="small ghost" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</button>
      <b className="grow">ComfyUI로 바로 그리기 <span className="muted small-t" style={{ fontWeight: 400 }}>내 PC의 그림 AI. 복사·붙여넣기 없이 버튼 한 번에 컷 그림이 들어와요</span></b>
      {!open && settings.comfy && <span className="chip on">{c.workflow ? '내 워크플로' : c.ckpt || '모델 없음'}</span>}
    </div>
    {open && <div className="box-b" style={{ display: 'grid', gap: 8 }}>
      <div className="row">
        <b>주소</b>
        <input style={{ width: 260 }} value={c.url} onChange={e => set({ url: e.target.value })} placeholder="http://127.0.0.1:8188" />
        <button className="primary" onClick={check}>연결 확인</button>
        <span className="small-t">{status}</span>
      </div>
      {isDesktop() && <div className="row small-t">
        <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={c.autoStart !== false} onChange={e => set({ autoStart: e.target.checked })} /> 이 앱을 켜면 ComfyUI도 같이 켜기</label>
        <button className="small" onClick={async () => { const r = await comfyAutoStart(c); setStatus(comfyStartNote); if (r.notFound) return; const p2 = await comfyAutoSetup(c, 180_000, setStatus); set({ ...(r.launched ? { exe: r.launched } : {}), ...(p2 || {}) }); }}>지금 켜고 맞추기</button>
        {desktop?.comfyGetModel && <button className="small" disabled={!!dl} onClick={getModel} title={`SDXL 공식 모델 ${SDXL_MODEL.size}를 ComfyUI 모델 폴더에 받아요`}>{dl || `SDXL 모델 받기 (${SDXL_MODEL.size})`}</button>}
        {desktop?.pickFile && <button className="small" onClick={async () => { const f = await desktop!.pickFile!('ComfyUI 실행 파일 고르기 (ComfyUI.exe 또는 run_nvidia_gpu.bat)', [{ name: 'ComfyUI', extensions: ['exe', 'bat', 'cmd'] }]); if (f) { set({ exe: f }); toast('ComfyUI 위치를 기억했어요.'); } }}>ComfyUI 위치 고르기</button>}
        <span className="muted">{c.exe ? c.exe : comfyStartNote || '설치 위치는 자동으로 찾아요'}</span>
      </div>}
      <div className="muted small-t">{isDesktop() ? '이 PC에서 ComfyUI를 켜 두면 기본 주소 그대로 돼요.' : '태블릿에서는 PC 주소(예: http://192.168.0.10:8188)를 쓰고, PC의 ComfyUI를 --listen --enable-cors-header 로 켜야 해요.'}</div>
      <div className="row">
        <b>모델</b>
        <select value={c.ckpt || ''} onChange={e => set({ ckpt: e.target.value })} disabled={!!c.workflow}>
          {!c.ckpt && <option value="">연결 확인을 눌러 고르세요</option>}
          {[...new Set([...(c.ckpt ? [c.ckpt] : []), ...ckpts])].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <b>크기</b>
        <select value={`${c.w}x${c.h}`} onChange={e => { const [w, h] = e.target.value.split('x').map(Number); set({ w, h }); }}>
          <option value="1344x768">16:9 (1344×768)</option><option value="1536x640">2.39:1 시네마 (1536×640)</option><option value="1152x896">4:3 (1152×896)</option><option value="1024x1024">1:1</option>
        </select>
        <b>단계</b><input type="number" style={{ width: 60 }} value={c.steps} onChange={e => set({ steps: Math.max(4, +e.target.value || 28) })} />
        <b>CFG</b><input type="number" step="0.5" style={{ width: 60 }} value={c.cfg} onChange={e => set({ cfg: +e.target.value || 6 })} />
      </div>
      <label><b>그림체 (영어)</b> <span className="muted small-t">모든 컷 앞에 붙어요</span>
        <LazyText value={c.style} rows={2} style={{ width: '100%' }} onSave={v => set({ style: v })} /></label>
      <label><b>빼고 싶은 것 (영어)</b>
        <LazyText value={c.neg} rows={2} style={{ width: '100%' }} onSave={v => set({ neg: v })} /></label>
      <div className="row"><button className="small" onClick={() => set({ style: DEFAULT_COMFY.style, neg: DEFAULT_COMFY.neg })}>그림체 기본값 (마커펜 러프 콘티)</button></div>
      <div className="row">
        <b>워크플로</b>
        <span className="small-t">{c.workflow ? `내 워크플로: ${c.workflowName || '이름 없음'}` : '기본 (모델 하나로 글 → 그림)'}</span>
        <button className="small" onClick={loadWf}>내 워크플로 넣기 (API JSON)</button>
        {c.workflow && <button className="small danger" onClick={() => set({ workflow: undefined, workflowName: undefined })}>기본으로</button>}
      </div>
      <div className="muted small-t">내 워크플로: 프롬프트 칸에 {'{{prompt}}'}, 빼고 싶은 것 칸에 {'{{negative}}'}를 쓰고, 인물 참고 그림을 받을 Load Image 노드 제목을 "ref"로 바꾼 뒤 "Export (API)"로 저장해서 넣어요.</div>
      <div className="row small-t"><b>인물 캐릭터 시트</b><span className="muted">내 워크플로에 "ref" 노드가 있으면, 컷에 나오는 첫 인물의 시트를 참고 그림으로 보내요.</span></div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {people.map(n => { const sh = p.chars.find(ch => ch.name === n)?.sheet; return <div key={n} style={{ width: 120, textAlign: 'center' }}>
          <div className="imgslot" style={{ width: 120, height: 80 }} onClick={() => sh ? onBig(sh) : pickFiles('image/*').then(f => f[0] && setSheet(n, f[0]))}
            onPaste={e => { const f = imageFromPaste(e); if (f) setSheet(n, f); }} tabIndex={0}>{sh ? <Img id={sh} /> : '+'}</div>
          <div className="small-t">{n} {sh && <button className="small ghost" onClick={() => pickFiles('image/*').then(f => f[0] && setSheet(n, f[0]))}>바꾸기</button>}</div>
        </div>; })}
      </div>
    </div>}
  </div>;
}
