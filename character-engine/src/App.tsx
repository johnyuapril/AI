import { useEffect, useRef, useState } from 'react';
import type { Settings } from './engine/types';
import { type Book, DEFAULT_SETTINGS, exportBook, loadBook, loadSettings, saveBook, saveSettings } from './store';
import { importFile } from './importer';
import CharactersTab from './CharactersTab';
import EventsTab from './EventsTab';
import { ConfirmButton, Field, download } from './ui';
import { CHECK_RULES } from './engine/prompts';

type Tab = 'chars' | 'world' | 'events' | 'settings';
const TABS: [Tab, string][] = [['chars', '인물'], ['world', '배경'], ['events', '사건'], ['settings', '설정']];

export default function App() {
  const [book, setBookState] = useState<Book | null>(null);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [tab, setTab] = useState<Tab>('chars');
  const timer = useRef<number>();

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
      </div>
      <div className="page">
        {tab === 'chars' && <CharactersTab chars={book.chars} world={book.world} settings={settings} onChange={chars => setBook(b => ({ ...b, chars }))} />}
        {tab === 'world' && (
          <div className="body" style={{ margin: '0 auto' }}>
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
        {tab === 'settings' && <SettingsTab book={book} setBook={setBook} settings={settings} setSettings={setSettings} />}
      </div>
    </div>
  );
}

function SettingsTab({ book, setBook, settings, setSettings }: { book: Book; setBook: (f: (b: Book) => Book) => void; settings: Settings; setSettings: (s: Settings) => void }) {
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
