import { useState } from 'react';
import type { Character, Settings, World } from './engine/types';
import { DIR_LABEL, ROOT_FIELDS, ROOT_LABEL } from './engine/types';
import { stageOf } from './engine/change';
import { checkArc, type ArcCheck } from './engine/pipeline';
import { arcPrompt } from './engine/prompts';
import { ConfirmButton, Field, LinesField, copyText } from './ui';
import { newCharacter } from './store';
import OrganizePanel from './OrganizePanel';
import { mergeChars } from './engine/organize';

const HINT: Record<string, string> = {
  basics: '나이, 직업, 사는 곳, 경제 사정. 예: 42세, 지방 중소기업 과장, 전세 대출',
  personality: '모순되는 면도 함께. 예: 침착하지만 가족 앞에서는 조급함',
  values: '갈등할 때 무엇을 우선하나. 예: 체면이 정직보다 앞선다',
  wounds: '행동을 무의식적으로 제한하는 과거. 예: 어릴 때 아버지의 사업 실패',
  desires: '자기도 모르는 것까지. 예: 인정받고 싶다',
  coping: '스트레스를 받을 때 하는 일. 예: 말이 없어지고 밤에 혼자 운전한다',
  speech: '어휘, 버릇, 피하는 말. 예: 미안하다는 말을 잘 못한다',
};

export default function CharactersTab({ chars, world, settings, onChange }: { chars: Character[]; world: World; settings: Settings; onChange: (c: Character[]) => void }) {
  const [sel, setSel] = useState<string | null>(() => (window.innerWidth > 760 ? chars[0]?.id ?? null : null));
  const c = chars.find(x => x.id === sel) ?? null;
  const put = (n: Character) => onChange(chars.map(x => (x.id === n.id ? { ...n, updatedAt: Date.now() } : x)));
  const add = () => { const n = newCharacter(`인물 ${chars.length + 1}`); onChange([...chars, n]); setSel(n.id); };

  return (
    <>
    <OrganizePanel kind="chars" settings={settings} known={chars.map(x => x.name)} onApply={(raw, keep) => {
      const r = mergeChars(chars, raw, keep, newCharacter);
      if (!r.added && !r.updated) return 'AI 답에서 인물을 찾지 못했어요.';
      onChange(r.value);
      if (!sel && r.value[0] && window.innerWidth > 760) setSel(r.value[0].id);
      return `새 인물 ${r.added}명, 채운 인물 ${r.updated}명. 왼쪽 목록에서 확인하고 고쳐 주세요.`;
    }} />
    <div className={'split' + (c ? ' has-sel' : '')}>
      <div className="list">
        <button className="primary" onClick={add}>+ 인물 추가</button>
        {chars.map(x => (
          <button key={x.id} className={'item' + (x.id === sel ? ' on' : '')} onClick={() => setSel(x.id)}>
            <b>{x.name}</b><small>{x.root.basics.split('\n')[0] || '설정을 적어 주세요'}</small>
          </button>
        ))}
        {!chars.length && <div className="empty small-t">인물을 추가하거나, 설정에서 시나리오 작업실 작품의 인물을 가져오세요.</div>}
      </div>
      <div className="body">
        {c ? <Editor key={c.id} c={c} chars={chars} world={world} settings={settings} put={put} onBack={() => setSel(null)}
          onDelete={() => { onChange(chars.filter(x => x.id !== c.id).map(x => ({ ...x, relations: x.relations.filter(r => r.otherId !== c.id) }))); setSel(null); }} />
          : <div className="empty">왼쪽에서 인물을 고르세요.</div>}
      </div>
    </div>
    </>
  );
}

function Editor({ c, chars, world, settings, put, onBack, onDelete }: { c: Character; chars: Character[]; world: World; settings: Settings; put: (c: Character) => void; onBack: () => void; onDelete: () => void }) {
  const others = chars.filter(x => x.id !== c.id);
  const [arc, setArc] = useState<ArcCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const runArc = async () => {
    setBusy(true); setErr('');
    try { setArc(await checkArc(settings, world, c, chars)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <button className="small backbtn" onClick={onBack}>← 인물 목록</button>
      <div className="panel">
        <div className="row">
          <input type="text" className="grow" style={{ fontWeight: 700, fontSize: 18 }} value={c.name} onChange={e => put({ ...c, name: e.target.value })} />
          <ConfirmButton onConfirm={onDelete}>인물 삭제</ConfirmButton>
        </div>
        <div className="muted small-t">뿌리는 잘 변하지 않는 부분이에요. 사건을 겪으며 바뀌는 건 아래 '현재 상태'와 '변화 압력'에 쌓여요.</div>
      </div>

      <div className="panel">
        <h3>뿌리</h3>
        <div className="grid2">
          {ROOT_FIELDS.map(f => <Field key={f} label={ROOT_LABEL[f]} value={c.root[f]} placeholder={HINT[f]} rows={3} onChange={v => put({ ...c, root: { ...c.root, [f]: v } })} />)}
        </div>
      </div>

      <div className="panel">
        <h3>관계</h3>
        {c.relations.map((r, i) => (
          <div className="row" key={i}>
            <select value={r.otherId} onChange={e => put({ ...c, relations: c.relations.map((x, j) => (j === i ? { ...x, otherId: e.target.value } : x)) })}>
              {others.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <input type="text" placeholder="관계 (예: 동생)" value={r.label} onChange={e => put({ ...c, relations: c.relations.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
            <input type="text" className="grow" placeholder="친밀도, 미해결 감정 (예: 5년째 연락 안 함)" value={r.feeling} onChange={e => put({ ...c, relations: c.relations.map((x, j) => (j === i ? { ...x, feeling: e.target.value } : x)) })} />
            <button className="small ghost" onClick={() => put({ ...c, relations: c.relations.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        {others.length ? <button className="small" onClick={() => put({ ...c, relations: [...c.relations, { otherId: others[0].id, label: '', feeling: '' }] })}>+ 관계 추가</button>
          : <div className="muted small-t">다른 인물을 추가하면 관계를 적을 수 있어요.</div>}
      </div>

      <div className="panel">
        <h3>현재 상태</h3>
        <Field label="감정과 컨디션" value={c.state.mood} placeholder="예: 잠을 못 자서 예민함" onChange={v => put({ ...c, state: { ...c.state, mood: v } })} />
        <LinesField label="인물이 아는 것과 믿고 있는 오해" value={c.state.knows} placeholder="예: 아내의 병을 아직 모른다" onChange={v => put({ ...c, state: { ...c.state, knows: v } })} />
        <LinesField label="기억 (사건을 돌리면 자동으로 쌓여요)" value={c.state.memories} onChange={v => put({ ...c, state: { ...c.state, memories: v } })} />
      </div>

      <div className="panel">
        <h3>성격 변화</h3>
        <Field label="목표 변화 (선택)" value={c.arcGoal} placeholder="예: 3막까지 타락해서 동료를 배신한다" onChange={v => put({ ...c, arcGoal: v })} />
        {c.arcGoal.trim() && (
          <div className="row">
            {settings.mode === 'api'
              ? <button onClick={runArc} disabled={busy}>{busy ? '점검 중…' : '지금까지의 사건으로 정당화되나 점검'}</button>
              : <button onClick={async () => { setCopied(await copyText(arcPrompt(world, c, chars, settings.threshold))); }}>{copied ? '복사했어요. 외부 AI에 붙여넣으세요' : '아크 점검 요청 복사'}</button>}
          </div>
        )}
        {err && <div className="err">{err}</div>}
        {arc && (
          <div className="proposal">
            <b className={arc.justified ? 'ok' : 'bad'}>{arc.justified ? '지금 바뀌어도 자연스러워요' : '아직 이 사람은 안 바뀌어요'}</b>
            <p>{arc.progress}</p>
            {arc.missing.length > 0 && <><span className="k">더 필요한 사건이나 만남</span><ul>{arc.missing.map((m, i) => <li key={i}>{m}</li>)}</ul></>}
            {arc.risk && <p className="small-t muted">억지로 바꾸면: {arc.risk}</p>}
          </div>
        )}
        <span className="k small-t muted">변화 압력 (문턱 {settings.threshold}. 절반을 넘으면 균열, 문턱에 닿으면 전환점 가능)</span>
        {c.pressures.filter(p => p.amount > 0).length === 0 && <div className="muted small-t">아직 쌓인 압력이 없어요.</div>}
        {c.pressures.filter(p => p.amount > 0).map(p => {
          const st = stageOf(p.amount, settings.threshold);
          return (
            <div key={p.field + p.dir} className="field">
              <div className="row"><b style={{ minWidth: 150 }}>{ROOT_LABEL[p.field]} · {DIR_LABEL[p.dir]}</b>
                <div className="bar"><i className={st} style={{ width: `${Math.min(100, (p.amount / settings.threshold) * 100)}%` }} /></div>
                <span className="small-t">{p.amount}/{settings.threshold}{st === 'crack' ? ' 균열' : st === 'ready' ? ' 전환점 가능' : ''}</span>
              </div>
              {p.notes.length > 0 && <div className="muted small-t">{p.notes.join(' · ')}</div>}
            </div>
          );
        })}
        {c.arc.length > 0 && (
          <>
            <span className="k small-t muted">변화 이력</span>
            <ul>{c.arc.map((a, i) => <li key={i}><b>{ROOT_LABEL[a.field]} {DIR_LABEL[a.dir]}</b>: "{a.before}" → "{a.after}" <span className="muted small-t">({a.reason})</span></li>)}</ul>
          </>
        )}
      </div>
    </>
  );
}
