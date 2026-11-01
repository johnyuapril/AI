import { useMemo, useState } from 'react';
import type { WsProps } from './Workspace';
import { getCuts, getScenes, knownNames, type Cut, type Scene } from './script';
import { buildDescribeRequest, parseDescribeAnswer } from './prompts';
import { LazyText, useToast } from './ui';
import { copyText } from './util';
import { saveFile } from './native';
import { describeText } from './exports';
import { DEFAULT_GPT_INSTRUCTION } from './store';

export default function DescribeTab(props: WsProps) {
  const { p, update, settings, setSettings, focusScene } = props;
  const toast = useToast();
  const scenes = useMemo(() => getScenes(p.lines), [p.lines]);
  const names = useMemo(() => knownNames(p), [p.lines, p.chars]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(focusScene ? [focusScene] : scenes[0] ? [scenes[0].id] : []));
  const [showInst, setShowInst] = useState(false);
  const toggle = (id: string) => setOpen(o => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const exportTxt = async () => {
    toast('저장했어요: ' + await saveFile(new Blob([[p.title, '', ...describeText(p)].join('\n')], { type: 'text/plain' }), `${p.title}-장면묘사.txt`));
  };
  return (
    <div className="page"><div className="page-inner">
      <div className="toolbar">
        <b>장면 묘사</b>
        <span className="muted small-t">씬마다 "외부 AI용 복사" → ChatGPT 등에 붙여 넣기 → 받은 답을 "답 넣기"에 붙여 넣으면 컷마다 나뉘어 들어가요.</span>
        <div className="grow" />
        <button onClick={() => setShowInst(s => !s)}>내 지시문 {showInst ? '접기' : '보기'}</button>
        <button onClick={exportTxt}>문서로 내보내기</button>
      </div>
      {showInst && <div className="box"><div className="box-b">
        <div className="row"><b>외부 AI에게 줄 지시문</b><span className="muted small-t">모든 씬에 같이 쓰여요. 답하는 형식([설정표], [1-1] …)은 앱이 맨 끝에 붙여요.</span>
          <div className="grow" /><button className="small" onClick={() => setSettings({ ...settings, gptInstruction: DEFAULT_GPT_INSTRUCTION })}>기본값으로</button></div>
        <LazyText value={settings.gptInstruction} rows={8} style={{ width: '100%', marginTop: 8 }} onSave={v => setSettings({ ...settings, gptInstruction: v })} />
      </div></div>}
      {scenes.map(s => <SceneDesc key={s.id} {...props} scene={s} names={names} open={open.has(s.id)} onToggle={() => toggle(s.id)} />)}
    </div></div>
  );
}

function SceneDesc({ p, update, settings, scene, names, open, onToggle }: WsProps & { scene: Scene; names: string[]; open: boolean; onToggle: () => void }) {
  const toast = useToast();
  const cuts: Cut[] = useMemo(() => getCuts(p, scene, names), [p.lines, p.scenes, scene, names]);
  const meta = p.scenes[scene.id] || {};
  const done = cuts.filter(c => p.cuts[c.key]?.desc?.trim()).length;
  const [paste, setPaste] = useState<string | null>(null);
  const setScene = (patch: Record<string, unknown>) => update(x => ({ ...x, scenes: { ...x.scenes, [scene.id]: { ...x.scenes[scene.id], ...patch } } }));
  const setCut = (key: string, patch: Record<string, unknown>) => update(x => ({ ...x, cuts: { ...x.cuts, [key]: { ...x.cuts[key], ...patch } } }));
  const copyReq = async () => {
    const ok = await copyText(buildDescribeRequest(p, scene, cuts, settings));
    toast(ok ? `S#${scene.num} 요청문을 복사했어요. 외부 AI에 붙여 넣으세요.` : '복사하지 못했어요.');
  };
  const apply = (text: string) => {
    const r = parseDescribeAnswer(text, cuts.map(c => c.label));
    const n = Object.keys(r.descs).length;
    if (!n && !r.setTable) { toast('답에서 [설정표]나 [컷 번호] 표시를 찾지 못했어요.'); return; }
    update(x => {
      const nc = { ...x.cuts };
      for (const c of cuts) if (r.descs[c.label]) nc[c.key] = { ...nc[c.key], desc: r.descs[c.label], descManual: true };
      return { ...x, cuts: nc, scenes: r.setTable ? { ...x.scenes, [scene.id]: { ...x.scenes[scene.id], setTable: r.setTable } } : x.scenes };
    });
    setPaste(null);
    toast(`컷 ${n}개${r.setTable ? ' + 설정표' : ''}를 넣었어요.${r.missing.length ? ' 답에 없는 컷: ' + r.missing.join(', ') : ''}`);
  };
  const fromClipboard = async () => {
    try { const t = await navigator.clipboard.readText(); if (t.trim()) { apply(t); return; } } catch { /* */ }
    setPaste('');
  };
  return <div className="box">
    <div className="box-h">
      <button className="small ghost" onClick={onToggle}>{open ? '▾' : '▸'}</button>
      <span className="sn">S#{scene.num}</span><span className="grow">{scene.heading}</span>
      <span className={'chip' + (done === cuts.length && cuts.length ? ' on' : '')}>묘사 {done}/{cuts.length}컷</span>
      <button onClick={copyReq}>외부 AI용 복사</button>
      <button className="accent" onClick={fromClipboard}>답 넣기</button>
    </div>
    {paste !== null && <div className="box-b" style={{ background: 'var(--accent-soft)' }}>
      <b>외부 AI가 준 답을 통째로 붙여 넣으세요</b>
      <textarea style={{ width: '100%', marginTop: 6 }} rows={8} value={paste} onChange={e => setPaste(e.target.value)} placeholder="[설정표] … [1-1] … [1-2] …" autoFocus />
      <div className="row" style={{ marginTop: 6 }}><button className="primary" onClick={() => apply(paste)}>넣기</button><button onClick={() => setPaste(null)}>취소</button>
        <span className="muted small-t">줄바꿈 기호, 굵게(**), 제목(#) 같은 표시는 넣을 때 자동으로 지워요.</span></div>
    </div>}
    {open && <div className="box-b">
      <div className="drow" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div><div className="lbl">씬 설정표 <span className="muted small-t">한 번 나온 장소·의상·소품은 모든 컷에 적용돼요</span></div>
          <LazyText value={meta.setTable || ''} placeholder={'장소: …\n시간·날씨·조명: …\n인물: 이름 - 생김새, 옷차림, 소지품'} onSave={v => setScene({ setTable: v })} /></div>
        <div><div className="lbl">씬 전체 바로잡기 <span className="muted small-t">예: 사내와 동수는 같은 사람, 1-5 전까지 얼굴 안 보임</span></div>
          <LazyText value={meta.corr || ''} onSave={v => setScene({ corr: v })} /></div>
      </div>
      <div className="drow" style={{ fontWeight: 700, borderBottom: '2px solid var(--line)' }}><div>대본</div><div>컷 화면 묘사 (바로 눌러 고칠 수 있어요)</div><div>컷 바로잡기</div></div>
      {cuts.map(c => {
        const m = p.cuts[c.key] || {};
        return <div className="drow" key={c.key}>
          <div><div className="lbl">{c.label}</div><div className="scr">{c.action}{c.dialogues.map(d => `\n${d.speaker}${d.off ? '(소리)' : ''}: ${d.text}`).join('')}</div></div>
          <LazyText value={m.desc || ''} placeholder="아직 묘사 없음. 직접 써도 돼요." onSave={v => setCut(c.key, { desc: v, descManual: true })} />
          <LazyText value={m.corr || ''} placeholder="AI가 잘못 이해한 점" onSave={v => setCut(c.key, { corr: v })} />
        </div>;
      })}
    </div>}
  </div>;
}
