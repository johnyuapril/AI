// 탭 위쪽 "AI로 정리해서 채우기": 작가가 정리해 둔 글을 붙여넣으면 AI가 항목별로 나눠 채운다.
import { useState } from 'react';
import type { Settings } from './engine/types';
import { ORG_SCHEMA, organizeManualPrompt, organizePrompt, type OrganizeKind } from './engine/organize';
import { askJson, extractJson } from './engine/ai';
import { copyText } from './ui';

const TITLE: Record<OrganizeKind, string> = { chars: '인물', world: '배경', events: '사건' };
const EXAMPLE: Record<OrganizeKind, string> = {
  chars: '예: 정훈(42)은 지방 중소기업 과장. 어릴 때 아버지 사업이 망하는 걸 봐서 실패를 들키는 걸 제일 두려워한다. 아내 미선에게는 늘 괜찮은 척…',
  world: '예: 1997년 겨울, 외환위기 직후 경남의 작은 공업 도시. 동네 사람들이 서로의 사정을 다 안다…',
  events: '예: 1. 정훈이 구조조정 명단에 오른다. 아내는 모른다. 2. 미선이 남편의 통장 잔고를 보게 된다…',
};

export default function OrganizePanel({ kind, settings, known, onApply }: {
  kind: OrganizeKind; settings: Settings; known: string[];
  onApply: (raw: unknown, keep: boolean) => string; // 반환: 사용자에게 보여 줄 결과 문장
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [answer, setAnswer] = useState('');
  const [fillGaps, setFillGaps] = useState(false);
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const apply = (raw: unknown) => { setMsg(onApply(raw, keep)); setAnswer(''); };
  const runApi = async () => {
    setBusy(true); setErr(''); setMsg('');
    try { apply(await askJson(settings.apiKey, settings.model, '너는 시나리오 기획 메모를 정리하는 조수다.', organizePrompt(kind, notes, fillGaps, known), ORG_SCHEMA[kind])); }
    catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); }
  };
  const pasteIn = () => {
    setErr(''); setMsg('');
    try { apply(extractJson(answer)); } catch (e: any) { setErr(e.message ?? String(e)); }
  };

  if (!open) return <div className="org"><button className="small" onClick={() => setOpen(true)}>✎ 정리한 글을 붙여넣어 AI로 {TITLE[kind]} 채우기</button></div>;
  return (
    <div className="org">
      <div className="panel">
        <div className="row"><h3 className="grow">AI로 {TITLE[kind]} 채우기</h3><button className="small ghost" onClick={() => setOpen(false)}>접기</button></div>
        <div className="muted small-t">기획 메모, 인물 소개, 줄거리처럼 정리해 둔 글을 통째로 붙여넣으면 AI가 항목별로 나눠 채워요.</div>
        <textarea rows={7} value={notes} placeholder={EXAMPLE[kind]} onChange={e => { setNotes(e.target.value); setCopied(false); }} />
        <div className="row small-t">
          <label className="row"><input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} /> 이미 적은 칸은 그대로 두기</label>
          <label className="row"><input type="checkbox" checked={fillGaps} onChange={e => { setFillGaps(e.target.checked); setCopied(false); }} /> 글에 없는 칸도 AI가 어울리게 채우기</label>
        </div>
        {settings.mode === 'api' ? (
          <div className="row"><button className="accent" disabled={!notes.trim() || busy} onClick={runApi}>{busy ? '정리하는 중…' : 'AI로 정리해서 채우기'}</button></div>
        ) : (
          <>
            <div className="row">
              <button disabled={!notes.trim()} onClick={async () => setCopied(await copyText(organizeManualPrompt(kind, notes, fillGaps, known)))}>{copied ? '복사했어요' : '정리 요청 복사'}</button>
              <span className="muted small-t">외부 AI에 붙여넣고, 답을 아래에 그대로 붙여넣으세요.</span>
            </div>
            <textarea rows={4} value={answer} placeholder="AI 답 전체를 붙여넣기" onChange={e => setAnswer(e.target.value)} />
            <div className="row"><button className="primary" disabled={!answer.trim()} onClick={pasteIn}>넣기</button></div>
          </>
        )}
        {err && <div className="err">{err}</div>}
        {msg && <div className="ok small-t">{msg}</div>}
      </div>
    </div>
  );
}
