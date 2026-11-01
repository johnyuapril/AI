import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Line, LineType, Project } from './types';
import type { WsProps } from './Workspace';
import { autoDetect, getScenes, knownNames, nextTypeAfter, parseHeading, PREFIX_KEYS, sceneStats, speakerName, TYPE_LABEL, TYPE_ORDER, estimatePages, isNightTime, type Scene } from './script';
import { uid, renameInText, countMentions } from './util';
import { Modal, useToast } from './ui';

interface RowProps {
  line: Line; idx: number; focused: boolean; num?: number;
  register: (id: string, el: HTMLTextAreaElement | null) => void;
  onChange: (idx: number, text: string, el: HTMLTextAreaElement) => void;
  onKey: (idx: number, e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus: (idx: number) => void;
}
const Row = memo(function Row({ line, idx, focused, num, register, onChange, onKey, onFocus }: RowProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    if (!CSS.supports?.('field-sizing', 'content')) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
  }, [line.text, line.t]);
  return (
    <div className={`ln ${line.t}${focused ? ' focus' : ''}`} data-id={line.id}>
      <span className="tg">{TYPE_LABEL[line.t]}{line.m ? '·' : ''}</span>
      {line.t === 'scene' && <span className="num">{num}.&nbsp;</span>}
      <textarea rows={1} value={line.text} spellCheck={false}
        placeholder={focused ? PH[line.t] : ''}
        ref={el => { ref.current = el; register(line.id, el); }}
        onChange={e => onChange(idx, e.target.value, e.target)}
        onKeyDown={e => onKey(idx, e)}
        onFocus={() => onFocus(idx)} />
    </div>
  );
});
const PH: Record<LineType, string> = {
  scene: '장소 / 낮', action: '지문', character: '인물', dialogue: '대사', paren: '(괄호 지시)', transition: 'CUT TO', shot: 'CU · 로우앵글 · 줌인 — 메모',
};

export default function ScriptTab({ p, update, focusScene, go }: WsProps) {
  const toast = useToast();
  const [focusIdx, setFocusIdx] = useState(0);
  const [sideTab, setSideTab] = useState<'scene' | 'char' | 'place'>('scene');
  const [sideOpen, setSideOpen] = useState(true);
  const [charOpen, setCharOpen] = useState<string | null>(null);
  const [placeOpen, setPlaceOpen] = useState<string | null>(null);
  const els = useRef(new Map<string, HTMLTextAreaElement>());
  const pRef = useRef(p); pRef.current = p;
  const pending = useRef<{ id: string; pos: number; select?: boolean } | null>(null);
  const softBreak = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scenes = useMemo(() => getScenes(p.lines), [p.lines]);
  const names = useMemo(() => knownNames(p), [p.lines, p.chars]);
  const nameSet = useMemo(() => new Set(names), [names]);
  const nameSetRef = useRef(nameSet); nameSetRef.current = nameSet;
  const sceneNum = useMemo(() => { const m = new Map<string, number>(); scenes.forEach(s => m.set(s.id, s.num)); return m; }, [scenes]);
  const curScene = useMemo(() => { let c: Scene | undefined; for (const s of scenes) if (s.start <= focusIdx) c = s; return c; }, [scenes, focusIdx]);

  const register = useCallback((id: string, el: HTMLTextAreaElement | null) => { if (el) els.current.set(id, el); else els.current.delete(id); }, []);
  useLayoutEffect(() => {
    const f = pending.current; if (!f) return;
    const el = els.current.get(f.id); if (!el) return;
    pending.current = null;
    el.focus({ preventScroll: false });
    if (f.select) el.setSelectionRange(0, el.value.length); else el.setSelectionRange(f.pos, f.pos);
    el.scrollIntoView({ block: 'nearest' });
  });
  const focusLine = (id: string, pos: number, select = false) => { pending.current = { id, pos, select }; };

  const setLines = (fn: (ls: Line[]) => Line[]) => update(x => ({ ...x, lines: fn(x.lines) }));

  const partnerFor = (lines: Line[], idx: number): string => {
    // 지금 대사의 화자와 다른, 바로 앞 화자
    let cur = ''; let other = '';
    for (let i = idx; i >= 0; i--) {
      const l = lines[i];
      if (l.t === 'scene') break;
      if (l.t === 'character') { const n = speakerName(l.text); if (!cur) cur = n; else if (n && n !== cur) { other = n; break; } }
    }
    return other;
  };

  const doEnter = (idx: number, caret: number) => {
    const lines = pRef.current.lines; const L = lines[idx];
    const before = L.text.slice(0, caret); const after = L.text.slice(caret);
    if (!L.text.trim() && !after) {
      const swap: Partial<Record<LineType, LineType>> = { action: 'character', character: 'action', dialogue: 'action' };
      const nt = swap[L.t];
      if (nt) { setLines(ls => ls.map((l, i) => i === idx ? { ...l, t: nt, m: undefined } : l)); focusLine(L.id, 0); return; }
    }
    const cur: Line = { ...L, text: before.replace(/\s+$/, '') };
    const det = autoDetect(cur, nameSetRef.current);
    if (det) cur.t = det;
    const nt = nextTypeAfter(cur.t);
    let prefill = '';
    if (nt === 'character' && !after) prefill = partnerFor(lines.map((l, i) => i === idx ? cur : l), idx);
    const nl: Line = { id: uid(), t: nt, text: after || prefill };
    setLines(ls => { const c = ls.slice(); c[idx] = cur; c.splice(idx + 1, 0, nl); return c; });
    focusLine(nl.id, 0, !!prefill && !after);
  };

  const setType = (idx: number, t: LineType) => {
    const L = pRef.current.lines[idx]; if (!L) return;
    setLines(ls => ls.map((l, i) => i === idx ? { ...l, t, m: 1 } : l));
    const el = els.current.get(L.id); focusLine(L.id, el?.selectionStart ?? L.text.length);
  };

  const onChange = useCallback((idx: number, text: string, el: HTMLTextAreaElement) => {
    const lines = pRef.current.lines; const L = lines[idx]; if (!L) return;
    // 빈 줄 첫 글자 단축키
    if (L.text === '' && text.length === 1 && PREFIX_KEYS[text]) {
      const t = PREFIX_KEYS[text];
      setLines(ls => ls.map((l, i) => i === idx ? { ...l, t, m: 1, text: t === 'paren' ? '(' : '' } : l));
      focusLine(L.id, t === 'paren' ? 1 : 0); return;
    }
    // 소프트 키보드 Enter → 줄바꿈 문자 감지
    const nlCount = (s: string) => (s.match(/\n/g) || []).length;
    if (nlCount(text) > nlCount(L.text) && !softBreak.current) {
      const pos = el.selectionStart - 1;
      const t2 = text.slice(0, pos) + text.slice(pos + 1);
      setLines(ls => ls.map((l, i) => i === idx ? { ...l, text: t2 } : l));
      pRef.current = { ...pRef.current, lines: pRef.current.lines.map((l, i) => i === idx ? { ...l, text: t2 } : l) };
      doEnter(idx, pos); return;
    }
    softBreak.current = false;
    setLines(ls => ls.map((l, i) => i === idx ? { ...l, text } : l));
  }, []);

  const suggestions = useMemo(() => {
    const L = p.lines[focusIdx]; if (!L) return [];
    const q = L.text.trim();
    if (L.t === 'character') return names.filter(n => n !== q && (!q || n.startsWith(q))).slice(0, 8);
    if (L.t === 'scene') {
      const places = [...new Set(scenes.map(s => s.place).filter(Boolean))];
      return places.filter(x => x !== q && q && x.startsWith(q)).slice(0, 6);
    }
    return [];
  }, [p.lines, focusIdx, names, scenes]);

  const accept = (s: string) => {
    const L = pRef.current.lines[focusIdx]; if (!L) return;
    const text = L.t === 'scene' ? s + ' / ' : s;
    setLines(ls => ls.map((l, i) => i === focusIdx ? { ...l, text } : l));
    focusLine(L.id, text.length);
  };

  const onKey = useCallback((idx: number, e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget; const lines = pRef.current.lines; const L = lines[idx];
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      if (e.shiftKey) { softBreak.current = true; return; }
      e.preventDefault(); doEnter(idx, el.selectionStart); return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!e.shiftKey && L.t === 'character' && L.text.trim()) {
        const s = names.find(n => n !== L.text.trim() && n.startsWith(L.text.trim()));
        if (s) { setLines(ls => ls.map((l, i) => i === idx ? { ...l, text: s } : l)); focusLine(L.id, s.length); return; }
      }
      const k = TYPE_ORDER.indexOf(L.t);
      setType(idx, TYPE_ORDER[(k + (e.shiftKey ? TYPE_ORDER.length - 1 : 1)) % TYPE_ORDER.length]); return;
    }
    if ((e.ctrlKey || e.metaKey) && /^[1-7]$/.test(e.key)) { e.preventDefault(); setType(idx, TYPE_ORDER[+e.key - 1]); return; }
    if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0 && idx > 0) {
      e.preventDefault();
      const prev = lines[idx - 1];
      if (!L.text) { setLines(ls => ls.filter((_, i) => i !== idx)); focusLine(prev.id, prev.text.length); }
      else { setLines(ls => { const c = ls.slice(); c[idx - 1] = { ...prev, text: prev.text + L.text }; c.splice(idx, 1); return c; }); focusLine(prev.id, prev.text.length); }
      return;
    }
    if (e.key === 'ArrowUp' && el.selectionStart === 0 && idx > 0) { e.preventDefault(); const pr = lines[idx - 1]; focusLine(pr.id, pr.text.length); setFocusIdx(idx - 1); return; }
    if (e.key === 'ArrowDown' && el.selectionStart === el.value.length && idx < lines.length - 1) { e.preventDefault(); focusLine(lines[idx + 1].id, 0); setFocusIdx(idx + 1); return; }
  }, [names]);
  const onFocus = useCallback((idx: number) => setFocusIdx(idx), []);

  const jumpTo = (lineId: string) => {
    const i = pRef.current.lines.findIndex(l => l.id === lineId); if (i < 0) return;
    setFocusIdx(i);
    const el = els.current.get(lineId);
    if (el) { el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); }
  };
  useEffect(() => { if (focusScene) setTimeout(() => jumpTo(focusScene), 50); }, [focusScene]);

  const insertSoftBreak = () => {
    const L = pRef.current.lines[focusIdx]; const el = L && els.current.get(L.id); if (!el) return;
    const pos = el.selectionStart; const text = L.text.slice(0, pos) + '\n' + L.text.slice(el.selectionEnd);
    setLines(ls => ls.map((l, i) => i === focusIdx ? { ...l, text } : l)); focusLine(L.id, pos + 1);
  };
  const newSceneBelow = () => {
    const nl: Line = { id: uid(), t: 'scene', text: '' };
    setLines(ls => { const c = ls.slice(); c.splice(focusIdx + 1, 0, nl); return c; }); focusLine(nl.id, 0);
  };

  const curLine = p.lines[focusIdx];
  return (
    <>
      <div className={'side' + (sideOpen ? '' : ' closed')}>
        <div className="seg">
          <button className={sideTab === 'scene' ? 'on' : ''} onClick={() => setSideTab('scene')}>씬 {scenes.length}</button>
          <button className={sideTab === 'char' ? 'on' : ''} onClick={() => setSideTab('char')}>인물 {names.length}</button>
          <button className={sideTab === 'place' ? 'on' : ''} onClick={() => setSideTab('place')}>장소</button>
        </div>
        <div className="side-list">
          {sideTab === 'scene' && <SceneSide p={p} scenes={scenes} names={names} cur={curScene?.id} onJump={jumpTo} />}
          {sideTab === 'char' && <CharSide p={p} update={update} scenes={scenes} names={names} onOpen={setCharOpen} />}
          {sideTab === 'place' && <PlaceSide scenes={scenes} onOpen={setPlaceOpen} />}
        </div>
      </div>
      <div className={`editor-wrap f-${p.format}`}>
        <div className="editor-scroll" ref={scrollRef}>
          <div className="paper">
            {p.lines.map((l, i) => <Row key={l.id} line={l} idx={i} focused={i === focusIdx} num={l.t === 'scene' ? sceneNum.get(l.id) : undefined}
              register={register} onChange={onChange} onKey={onKey} onFocus={onFocus} />)}
          </div>
        </div>
        <div className="elembar" onPointerDown={e => e.preventDefault()}>
          <button className="small" onClick={() => setSideOpen(o => !o)}>{sideOpen ? '◧' : '☰'}</button>
          {TYPE_ORDER.map((t, k) => <button key={t} className={curLine?.t === t ? 'on' : ''} onClick={() => setType(focusIdx, t)} title={`Ctrl+${k + 1}`}>{TYPE_LABEL[t]}</button>)}
          <button onClick={insertSoftBreak} title="Shift+Enter">줄바꿈</button>
          <button onClick={newSceneBelow}>+ 새 씬</button>
          {suggestions.length > 0 && <div className="sugg">{suggestions.map(s => <button key={s} className="small" onClick={() => accept(s)}>{s}</button>)}</div>}
        </div>
      </div>
      {charOpen !== null && <CharModal p={p} update={update} name={charOpen} scenes={scenes} names={names} onClose={() => setCharOpen(null)} onJump={id => { setCharOpen(null); jumpTo(id); }} />}
      {placeOpen !== null && <Modal title={`장소: ${placeOpen}`} onClose={() => setPlaceOpen(null)}>
        {scenes.filter(s => normPlace(s.place) === placeOpen).map(s => <div key={s.id} className="side-item" onClick={() => { setPlaceOpen(null); jumpTo(s.id); }}>
          <div className="h">S#{s.num}. {s.heading}</div></div>)}
      </Modal>}
    </>
  );
}

function SceneSide({ p, scenes, names, cur, onJump }: { p: Project; scenes: Scene[]; names: string[]; cur?: string; onJump: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector('.cur')?.scrollIntoView({ block: 'nearest' }); }, [cur]);
  return <div ref={ref}>{scenes.map(s => {
    const st = sceneStats(s, names);
    const night = isNightTime(s.time);
    return <div key={s.id} className={'side-item' + (s.id === cur ? ' cur' : '')} onClick={() => onJump(s.id)}>
      <div className="h">{s.num}. {s.place || '(장소 없음)'} {s.time && <span className="chip" style={{ marginLeft: 4 }}>{night ? '🌙' : '☀'} {s.time}</span>}</div>
      <div className="s">{Object.keys(st.speakers).join(', ') || '대사 없음'} · {estimatePages(s.lines).toFixed(1)}쪽</div>
    </div>;
  })}</div>;
}

export function normPlace(place: string): string {
  return place.replace(/^(과거|회상|현재|플래시백|몽타주|인서트)\s*[.)]?\s*/, '').replace(/^(동|같은|다른)\s+/, '').replace(/\s*(앞|안|밖|내부|외부)$/, m => m).trim() || place;
}
function PlaceSide({ scenes, onOpen }: { scenes: Scene[]; onOpen: (p: string) => void }) {
  const groups = new Map<string, Scene[]>();
  for (const s of scenes) { const k = normPlace(s.place); if (!k) continue; groups.set(k, [...(groups.get(k) || []), s]); }
  return <>{[...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, ss]) =>
    <div key={k} className="side-item" onClick={() => onOpen(k)}><div className="h">{k}</div><div className="s">{ss.length}씬 · S#{ss.map(s => s.num).slice(0, 8).join(', ')}{ss.length > 8 ? '…' : ''}</div></div>)}</>;
}

function CharSide({ p, update, scenes, names, onOpen }: { p: Project; update: WsProps['update']; scenes: Scene[]; names: string[]; onOpen: (n: string) => void }) {
  const [nm, setNm] = useState('');
  const reg = new Set(p.chars.map(c => c.name));
  const appear = new Map<string, { dl: number; sc: number }>();
  for (const s of scenes) { const st = sceneStats(s, names); for (const n of st.chars) { const a = appear.get(n) || { dl: 0, sc: 0 }; a.dl += st.speakers[n] || 0; a.sc++; appear.set(n, a); } }
  const add = (n: string) => { n = n.trim(); if (!n || reg.has(n)) return; update(x => ({ ...x, chars: [...x.chars, { name: n, memo: '', look: '' }] })); };
  const unreg = names.filter(n => !reg.has(n) && appear.has(n));
  return <>
    <div style={{ padding: 8, display: 'flex', gap: 6 }}>
      <input type="text" className="grow" placeholder="인물 미리 등록" value={nm} onChange={e => setNm(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { add(nm); setNm(''); } }} />
      <button onClick={() => { add(nm); setNm(''); }}>등록</button>
    </div>
    {unreg.length > 0 && <div style={{ padding: '0 8px 8px' }}><button className="small" onClick={() => update(x => ({ ...x, chars: [...x.chars, ...unreg.map(n => ({ name: n, memo: '', look: '' }))] }))}>나온 인물 {unreg.length}명 모두 등록</button></div>}
    {[...new Set([...p.chars.map(c => c.name), ...names])].sort((a, b) => (appear.get(b)?.dl || 0) - (appear.get(a)?.dl || 0)).map(n => {
      const a = appear.get(n);
      return <div key={n} className="side-item" onClick={() => onOpen(n)}>
        <div className="h">{n} {!reg.has(n) && <span className="chip warn">새 인물</span>} {reg.has(n) && !a && <span className="chip">미등장</span>}</div>
        <div className="s">{a ? `대사 ${a.dl} · ${a.sc}씬` : '아직 안 나옴'}{p.chars.find(c => c.name === n)?.memo ? ' · ' + p.chars.find(c => c.name === n)!.memo.slice(0, 20) : ''}</div>
      </div>;
    })}
  </>;
}

function CharModal({ p, update, name, scenes, names, onClose, onJump }: { p: Project; update: WsProps['update']; name: string; scenes: Scene[]; names: string[]; onClose: () => void; onJump: (id: string) => void }) {
  const info = p.chars.find(c => c.name === name);
  const [memo, setMemo] = useState(info?.memo || '');
  const [look, setLook] = useState(info?.look || '');
  const [to, setTo] = useState(name);
  const toast = useToast();
  const save = () => update(x => {
    const has = x.chars.some(c => c.name === name);
    const chars = has ? x.chars.map(c => c.name === name ? { ...c, memo, look } : c) : [...x.chars, { name, memo, look }];
    return { ...x, chars };
  });
  const rename = () => {
    const t = to.trim(); if (!t || t === name) return;
    if (!confirm(`대본 전체에서 "${name}"을(를) "${t}"(으)로 바꿀까요? 조사도 맞춰 바꿔요.`)) return;
    update(x => ({
      ...x,
      lines: x.lines.map(l => l.t === 'character' ? (speakerName(l.text) === name ? { ...l, text: l.text.replace(name, t) } : l) : { ...l, text: renameInText(l.text, name, t) }),
      chars: x.chars.map(c => c.name === name ? { ...c, name: t } : c),
      cuts: Object.fromEntries(Object.entries(x.cuts).map(([k, c]) => [k, c.chars ? { ...c, chars: c.chars.map(n => n === name ? t : n) } : c])),
    }));
    toast('이름을 바꿨어요.'); onClose();
  };
  const rows = scenes.map(s => { const st = sceneStats(s, names); return { s, dl: st.speakers[name] || 0, mn: st.mentions[name] || 0 }; }).filter(r => r.dl || r.mn);
  return <Modal title={name} onClose={() => { save(); onClose(); }}>
    <div style={{ display: 'grid', gap: 12 }}>
      <label>메모 (나이, 성격, 말투, 관계 등)<textarea style={{ width: '100%' }} rows={2} value={memo} onChange={e => setMemo(e.target.value)} onBlur={save} /></label>
      <label>외모 설명 (그림 프롬프트에 들어가요)<textarea style={{ width: '100%' }} rows={2} placeholder="예: 30대 후반 남자, 헝클어진 짧은 검은 머리, 검은 후드 위에 낡은 청재킷" value={look} onChange={e => setLook(e.target.value)} onBlur={save} /></label>
      <div className="row"><input type="text" value={to} onChange={e => setTo(e.target.value)} /><button onClick={rename}>대본 전체에서 이름 바꾸기</button>
        {info ? <button className="danger" onClick={() => { update(x => ({ ...x, chars: x.chars.filter(c => c.name !== name) })); onClose(); }}>등록 해제</button> : <button onClick={save}>등록</button>}</div>
      <div><b>등장하는 씬 {rows.length}개</b> <span className="muted small-t">누르면 그 씬으로 가요</span></div>
      <div>{rows.map(r => <div key={r.s.id} className="side-item" onClick={() => onJump(r.s.id)}>
        <div className="h">S#{r.s.num}. {r.s.heading}</div><div className="s">대사 {r.dl} · 언급 {r.mn}</div></div>)}</div>
    </div>
  </Modal>;
}
