import React, { useMemo, useState } from 'react';
import type { WsProps } from './Workspace';
import type { Project } from './types';
import { getCuts, getScenes, knownNames, type Cut, type Scene } from './script';
import { autoCommon, autoCutPrompt, commonFor, cutPromptFor, fullCutPrompt, masterPrompt, sceneGuide } from './prompts';
import { Img, LazyText, Lightbox, useToast } from './ui';
import { copyText } from './util';
import { pickFiles, shareImage } from './native';
import { imageFromClipboard, imageFromPaste, storeImageFile } from './images';
import { getImageBlob } from './store';
import { DEFAULT_STYLE } from './store';

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
            {settings.styleImg && <button className="small" onClick={async () => { const b = await getImageBlob(settings.styleImg!); if (b) shareImage(b, 'style.jpg'); }}>외부 AI로 보내기</button>}
            {settings.styleImg && <button className="small danger" onClick={() => setSettings({ ...settings, styleImg: undefined })}>빼기</button>}
          </div>
          <div className="muted small-t" style={{ marginTop: 4 }}>새 대화를 시작할 때 이 그림을 함께 보내고 "이 그림체로"라고 하면 좋아요.</div>
        </div>
      </div></div>
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
    const parts = [sceneGuide(), '', commonFor(p, scene, settings), ''];
    cuts.forEach((c, i) => parts.push(cutPromptFor(p, scene, c, cuts[i - 1]), ''));
    const ok = await copyText(parts.join('\n'));
    update(x => { const nc = { ...x.cuts }; for (const c of cuts) if (!nc[c.key]?.img) nc[c.key] = { ...nc[c.key], wait: true }; return { ...x, cuts: nc }; });
    toast(ok ? `S#${scene.num} 전체 ${cuts.length}컷을 복사했어요.` : '복사하지 못했어요.');
  };
  const copyMaster = async () => { const ok = await copyText(masterPrompt(p, scene, cuts, settings)); toast(ok ? '마스터 샷 프롬프트를 복사했어요.' : '복사하지 못했어요.'); };
  const auto = autoCommon(p, scene, settings);
  return <div className="box">
    <div className="box-h">
      <button className="small ghost" onClick={onToggle}>{open ? '▾' : '▸'}</button>
      <span className="sn">S#{scene.num}</span><span className="grow">{scene.heading}</span>
      <span className="chip">묘사 {cuts.filter(c => p.cuts[c.key]?.desc).length}/{cuts.length}</span>
      <span className={'chip' + (imgs === cuts.length && imgs ? ' on' : '')}>그림 {imgs}/{cuts.length}</span>
      <button onClick={copyMaster}>마스터 샷 복사</button>
      <button className="primary" onClick={copyAll}>씬 전체 복사</button>
    </div>
    {open && <div className="box-b">
      <div className="lbl" style={{ fontWeight: 700 }}>씬 공통 (마스터 샷) <span className="muted small-t" style={{ fontWeight: 400 }}>그림체·장소·인물 생김새. 복사할 때만 각 컷 앞에 붙어요.</span>
        {meta.common !== undefined && <button className="small" style={{ marginLeft: 8 }} onClick={() => update(x => { const m = { ...x.scenes[scene.id] }; delete m.common; return { ...x, scenes: { ...x.scenes, [scene.id]: m } }; })}>자동으로 되돌리기</button>}</div>
      <LazyText className={meta.common !== undefined ? 'tag-manual' : ''} value={commonFor(p, scene, settings)} rows={5} style={{ width: '100%', marginTop: 6 }}
        onSave={v => update(x => ({ ...x, scenes: { ...x.scenes, [scene.id]: { ...x.scenes[scene.id], common: v === auto ? undefined : v } } }))} />
      {cuts.map((c, i) => <CutPromptRow key={c.key} p={p} scene={scene} cut={c} prev={cuts[i - 1]} onCopy={() => copyCut(c, i)} setCut={setCut} onBig={onBig} />)}
    </div>}
  </div>;
}

function CutPromptRow({ p, scene, cut, prev, onCopy, setCut, onBig }: { p: Project; scene: Scene; cut: Cut; prev?: Cut; onCopy: () => void; setCut: (k: string, patch: Record<string, unknown>) => void; onBig: (id: string) => void }) {
  const toast = useToast();
  const m = p.cuts[cut.key] || {};
  const auto = autoCutPrompt(p, scene, cut, prev);
  const put = async (b: Blob) => { const id = await storeImageFile(b); setCut(cut.key, { img: id, wait: false }); toast(`${cut.label}에 그림을 넣었어요.`); };
  const onPaste = (e: React.ClipboardEvent) => { const f = imageFromPaste(e); if (f) { e.preventDefault(); put(f); } };
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
    </div>
    <div>
      <div className={'imgslot' + (m.wait && !m.img ? ' wait' : '')} tabIndex={0} onPaste={onPaste}
        onClick={() => m.img ? onBig(m.img) : pickFiles('image/*').then(f => f[0] && put(f[0]))}>
        {m.img ? <Img id={m.img} /> : m.wait ? '그림 기다리는 중\n눌러서 넣기' : '눌러서 그림 넣기'}
      </div>
      <div className="row" style={{ marginTop: 6, gap: 4 }}>
        <button className="small" onClick={() => pickFiles('image/*').then(f => f[0] && put(f[0]))}>갤러리</button>
        <button className="small" onClick={async () => { const b = await imageFromClipboard(); if (b) put(b); else toast('클립보드에 그림이 없어요. 그림 칸을 길게 눌러 붙여넣기 하거나 갤러리에서 고르세요.'); }}>붙여넣기</button>
        {m.img && <button className="small danger" onClick={() => setCut(cut.key, { img: undefined })}>빼기</button>}
      </div>
      <div contentEditable suppressContentEditableWarning className="small-t muted" style={{ marginTop: 4, padding: 6, border: '1px dashed var(--line)', borderRadius: 6, minHeight: 32 }}
        onPaste={onPaste} onInput={e => { (e.currentTarget as HTMLElement).textContent = '여기를 길게 눌러 그림 붙여넣기'; }}>여기를 길게 눌러 그림 붙여넣기</div>
    </div>
  </div>;
}
