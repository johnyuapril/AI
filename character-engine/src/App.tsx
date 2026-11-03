import { useEffect, useRef, useState } from 'react';
import type { Settings } from './engine/types';
import { type Book, DEFAULT_SETTINGS, exportBook, loadBook, loadSettings, saveBook, saveSettings } from './store';
import { importFile } from './importer';
import CharactersTab from './CharactersTab';
import EventsTab from './EventsTab';
import ScriptTab from './ScriptTab';
import OrganizePanel from './OrganizePanel';
import { mergeWorld } from './engine/organize';
import { ConfirmButton, Field, download } from './ui';
import { CHECK_RULES } from './engine/prompts';
import { BUILD, VERSION, desktop, latestRelease, openExternal, RELEASES_PAGE, type Latest } from './update';

type Tab = 'chars' | 'world' | 'events' | 'script' | 'settings';
const TABS: [Tab, string][] = [['chars', '인물'], ['world', '배경'], ['events', '사건'], ['script', '시나리오'], ['settings', '설정']];

export default function App() {
  const [book, setBookState] = useState<Book | null>(null);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [tab, setTab] = useState<Tab>('chars');
  const timer = useRef<number>();
  const upd = useUpdate();

  useEffect(() => { loadBook().then(setBookState); loadSettings().then(setSettingsState); }, []);
  const setBook = (f: (b: Book) => Book) => setBookState(b => {
    if (!b) return b;
    const n = f(b);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => saveBook(n), 400);
    return n;
  });
  const setSettings = (s: Settings) => { setSettingsState(s); saveSettings(s); };

  if (!book) return <div className="empty">불러오는 중…</div>;
  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">인물 엔진</span>
        <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        <span className="mode chip">{settings.mode === 'api' ? 'Claude API' : '복사 → 붙여넣기'}</span>
        {upd.latest && upd.latest.code > BUILD && desktop && <button className="accent small" disabled={upd.busy} onClick={upd.install}>{upd.busy ? '받는 중…' : `업데이트 v${upd.latest.name}`}</button>}
      </div>
      <div className="page">
        {tab === 'chars' && <CharactersTab chars={book.chars} world={book.world} settings={settings} onChange={chars => setBook(b => ({ ...b, chars }))} />}
        {tab === 'world' && (
          <div className="body" style={{ margin: '0 auto' }}>
            <OrganizePanel kind="world" settings={settings} known={book.chars.map(c => c.name)} onApply={(raw, keep) => {
              const r = mergeWorld(book.world, raw, keep);
              setBook(b => ({ ...b, world: r.value }));
              return r.updated ? `${r.updated}개 칸을 채웠어요. 아래에서 확인하고 고쳐 주세요.` : '바뀐 칸이 없어요.';
            }} />
            <div className="panel">
              <h3>배경</h3>
              <div className="muted small-t">인물의 선택지를 제한하는 현실 조건이에요. 비워 두면 현대 한국으로 봐요.</div>
              <Field label="시대와 장소" value={book.world.era} placeholder="예: 1997년 외환위기 직후, 경남의 소도시" onChange={v => setBook(b => ({ ...b, world: { ...b.world, era: v } }))} />
              <Field label="사회적 규칙" rows={3} value={book.world.rules} placeholder="그 시대와 공동체에서 당연하거나 금기인 것" onChange={v => setBook(b => ({ ...b, world: { ...b.world, rules: v } }))} />
              <Field label="물리적 제약" rows={3} value={book.world.limits} placeholder="거리, 교통, 통신, 돈, 시간. 예: 휴대폰이 드물다" onChange={v => setBook(b => ({ ...b, world: { ...b.world, limits: v } }))} />
              <Field label="주변 인물과 집단" rows={3} value={book.world.groups} placeholder="직장, 가족, 이웃" onChange={v => setBook(b => ({ ...b, world: { ...b.world, groups: v } }))} />
            </div>
          </div>
        )}
        {tab === 'events' && <EventsTab book={book} setBook={setBook} settings={settings} setSettings={setSettings} />}
        {tab === 'script' && <ScriptTab book={book} setBook={setBook} settings={settings} />}
        {tab === 'settings' && <SettingsTab book={book} setBook={setBook} settings={settings} setSettings={setSettings} upd={upd} />}
      </div>
    </div>
  );
}

function SettingsTab({ book, setBook, settings, setSettings, upd }: { book: Book; setBook: (f: (b: Book) => Book) => void; settings: Settings; setSettings: (s: Settings) => void; upd: Upd }) {
  const [msg, setMsg] = useState('');
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg('');
    try {
      const r = await importFile(f, book.chars);
      if (r.book) { setBook(() => r.book!); setMsg('백업을 불러왔어요.'); }
      else { setBook(b => ({ ...b, chars: [...b.chars, ...(r.chars ?? [])] })); setMsg(`${r.title ? `'${r.title}'에서 ` : ''}인물 ${r.chars?.length ?? 0}명을 가져왔어요. 같은 이름은 건너뛰었어요.`); }
    } catch (e: any) { setMsg(e.message ?? String(e)); }
  };
  return (
    <div className="body" style={{ margin: '0 auto' }}>
      <div className="panel">
        <h3>버전 {VERSION}</h3>
        <div className="row">
          <button className="small" disabled={upd.checking} onClick={upd.check}>{upd.checking ? '확인 중…' : '업데이트 확인'}</button>
          {upd.latest && upd.latest.code > BUILD
            ? (desktop
              ? <button className="accent small" disabled={upd.busy} onClick={upd.install}>{upd.busy ? '받는 중… 설치가 끝나면 다시 켜져요' : `v${upd.latest.name}로 업데이트`}</button>
              : <button className="small" onClick={() => openExternal(upd.latest!.page)}>v{upd.latest.name} 설치 파일 받기</button>)
            : upd.checked && <span className="small-t muted">{upd.latest ? '최신 버전이에요.' : '아직 올라온 설치 파일이 없어요.'}</span>}
          <button className="small ghost" onClick={() => openExternal(RELEASES_PAGE)}>릴리스 페이지</button>
        </div>
        {upd.err && <div className="err">{upd.err}</div>}
        <div className="muted small-t">업데이트해도 인물, 사건, 설정은 그대로 남아요.</div>
      </div>
      <div className="panel">
        <h3>AI 쓰는 방식</h3>
        <label className="row"><input type="radio" checked={settings.mode === 'manual'} onChange={() => setSettings({ ...settings, mode: 'manual' })} /> 복사 → 외부 AI에 붙여넣기 → 답 붙여넣기 (시나리오 작업실과 같은 방식, 요금 없음)</label>
        <label className="row"><input type="radio" checked={settings.mode === 'api'} onChange={() => setSettings({ ...settings, mode: 'api' })} /> Claude API 바로 부르기 (반응 → 검수 → 고치기를 자동으로, 사용한 만큼 요금)</label>
        {settings.mode === 'api' && (
          <>
            <label className="field"><span>Claude API 키 (이 기기에만 저장돼요)</span>
              <input type="password" value={settings.apiKey} placeholder="sk-ant-..." onChange={e => setSettings({ ...settings, apiKey: e.target.value })} /></label>
            <div className="muted small-t">키는 <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">Anthropic 콘솔</a>에서 만들 수 있어요.</div>
            <label className="field"><span>모델</span><input type="text" value={settings.model} onChange={e => setSettings({ ...settings, model: e.target.value })} /></label>
          </>
        )}
      </div>
      <div className="panel">
        <h3>성격 변화</h3>
        <label className="field"><span>전환점 문턱 (압력이 이만큼 쌓여야 뿌리가 바뀔 수 있어요. 사건 하나는 최대 3)</span>
          <input type="number" min={3} max={20} value={settings.threshold} onChange={e => setSettings({ ...settings, threshold: Math.max(3, Number(e.target.value) || 6) })} /></label>
      </div>
      <div className="panel">
        <h3>작위성 점검 규칙</h3>
        <ol className="small-t" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>{CHECK_RULES.map((r, i) => <li key={i}>{r}</li>)}</ol>
        <span className="k small-t muted">반응에 '어색하다'고 표시해서 더한 규칙</span>
        {!settings.extraRules.length && <div className="muted small-t">아직 없어요.</div>}
        {settings.extraRules.map((r, i) => (
          <div className="row" key={i}><span className="grow">{r}</span><button className="small ghost" onClick={() => setSettings({ ...settings, extraRules: settings.extraRules.filter((_, j) => j !== i) })}>✕</button></div>
        ))}
      </div>
      <div className="panel">
        <h3>가져오기와 백업</h3>
        <label className="field"><span>시나리오 작업실 작품(.sbk)에서 인물 가져오기, 또는 이 앱의 백업(.json) 불러오기</span>
          <input type="file" accept=".sbk,.zip,.json" onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
        <div className="row">
          <button onClick={() => download(exportBook(book), `인물엔진-백업-${new Date().toISOString().slice(0, 10)}.json`)}>백업 파일로 저장</button>
          <ConfirmButton onConfirm={() => setBook(() => ({ chars: [], world: { era: '', rules: '', limits: '', groups: '' }, events: [], reactions: [] }))}>모두 지우기</ConfirmButton>
        </div>
        {msg && <div className="small-t">{msg}</div>}
      </div>
    </div>
  );
}

interface Upd { latest: Latest | null; checked: boolean; checking: boolean; busy: boolean; err: string; check: () => void; install: () => void }
/** 켤 때 한 번 새 버전을 확인하고, 설정 탭에서 다시 확인하거나 설치한다 */
function useUpdate(): Upd {
  const [latest, setLatest] = useState<Latest | null>(null);
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const check = async () => {
    setChecking(true); setErr('');
    try { setLatest(await latestRelease()); setChecked(true); } catch { setErr('업데이트를 확인하지 못했어요. 인터넷 연결을 확인해 주세요.'); } finally { setChecking(false); }
  };
  const install = async () => {
    if (!latest || !desktop) return;
    setBusy(true); setErr('');
    try { await desktop.installUpdate(latest.url); } catch (e: any) { setErr((e?.message ?? String(e)) + ' 릴리스 페이지에서 직접 받아 설치해 주세요.'); setBusy(false); }
  };
  useEffect(() => { if (desktop) check(); }, []);
  return { latest, checked, checking, busy, err, check, install };
}
