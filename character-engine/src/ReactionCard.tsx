import { useState } from 'react';
import type { Character, Reaction } from './engine/types';
import { DIR_LABEL, ROOT_LABEL } from './engine/types';

export default function ReactionCard({ r, char, onAccept, onReject, onAwkward }: {
  r: Reaction; char?: Character; onAccept: () => void; onReject: () => void; onAwkward: (why: string) => void;
}) {
  const [why, setWhy] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <div className="react">
      <div className="row">
        <span className="who">{char?.name ?? '(지운 인물)'}</span>
        <span className={'small-t ' + (r.check.pass ? 'ok' : 'bad')}>
          {r.check.pass ? `점검 통과${r.tries > 1 ? ' (한 번 고쳐서)' : ''}` : '점검에 걸린 채로 남음'}
        </span>
      </div>
      {r.inner && <div><div className="k">속마음</div><div className="inner">{r.inner}</div></div>}
      <div><div className="k">행동</div><p>{r.action}</p></div>
      {r.dialogue && <div><div className="k">대사</div><p className="dlg">"{r.dialogue}"</p></div>}
      {r.later && <div><div className="k">며칠 뒤</div><p>{r.later}</p></div>}
      {r.reasons.length > 0 && <div><div className="k">근거</div><ul>{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      {!r.check.pass && r.check.issues.length > 0 && <div className="err">걸린 점: {r.check.issues.join(' / ')}</div>}
      {r.check.pass && r.tries > 1 && r.check.issues.length > 0 && <div className="muted small-t">처음 걸렸던 점은 고쳤어요.</div>}

      <details>
        <summary>생각의 흐름 (인지 → 감정 → 판단)</summary>
        <div className="field" style={{ marginTop: 8 }}>
          <div><div className="k">인지</div><p>{r.perception}</p></div>
          <div><div className="k">감정</div><p>{r.emotion}</p></div>
          {r.options.length > 0 && <div><div className="k">떠올린 선택지</div><ul>{r.options.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          <div><div className="k">고른 이유</div><p>{r.choiceWhy}</p></div>
          {r.learned.length > 0 && <div><div className="k">새로 알게 된 것 / 생긴 오해</div><ul>{r.learned.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {r.pressure.length > 0 && <div><div className="k">변화 압력</div><ul>{r.pressure.map((p, i) => <li key={i}>{ROOT_LABEL[p.field]} · {DIR_LABEL[p.dir]} {p.amount > 0 ? '+' : ''}{p.amount} {p.note}</li>)}</ul></div>}
        </div>
      </details>

      {r.proposal && (
        <div className="proposal">
          <b>전환점: {ROOT_LABEL[r.proposal.field]}이(가) {DIR_LABEL[r.proposal.dir]} 쪽으로 바뀌려 해요</b>
          {char && <p className="small-t muted">지금: {char.root[r.proposal.field] || '(비어 있음)'}</p>}
          <p>바뀐 뒤: {r.proposal.after}</p>
          {r.proposal.reason && <p className="small-t">{r.proposal.reason}</p>}
          {r.proposal.status === 'pending'
            ? <div className="row"><button className="accent small" onClick={onAccept}>승인하고 뿌리 바꾸기</button><button className="small" onClick={onReject}>아직 아니다</button></div>
            : <span className="small-t">{r.proposal.status === 'accepted' ? '승인해서 뿌리에 반영했어요' : '거절했어요'}</span>}
        </div>
      )}

      {r.flaggedAwkward
        ? <div className="small-t muted">어색하다고 표시함: {r.flaggedAwkward} (점검 규칙에 더했어요)</div>
        : open
          ? <div className="row"><input type="text" className="grow" placeholder="왜 어색한가요? 예: 이 사람은 이렇게 쉽게 사과하지 않는다" value={why} onChange={e => setWhy(e.target.value)} />
              <button className="small" disabled={!why.trim()} onClick={() => { onAwkward(why.trim()); setOpen(false); }}>표시</button></div>
          : <button className="small ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>어색하다</button>}
    </div>
  );
}
