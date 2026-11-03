import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Settings, Format } from './types';
import { loadProject, saveProject } from './store';
import { getScenes, knownNames } from './script';
import ScriptTab from './ScriptTab';
import SceneListTab from './SceneListTab';
import DescribeTab from './DescribeTab';
import PromptTab from './PromptTab';
import StoryboardTab from './StoryboardTab';
import WebtoonTab from './WebtoonTab';
import AnalysisTab from './AnalysisTab';
import { Modal, useToast } from './ui';
import { importFile, toFountain } from './importer';
import { exportProject } from './backup';
import { isDesktop, openAiSide, pickFiles, saveFile } from './native';
import { exportScriptPdf } from './pdf';
import { getLinks, syncProject } from './gsync';
import { openExternal } from './update';
import GoogleSyncModal from './GoogleSync';

export type Updater = (fn: (p: Project) => Project) => void;
export interface WsProps { p: Project; update: Updater; settings: Settings; setSettings: (s: Settings) => void; go: (tab: Tab, sceneId?: string) => void; focusScene?: string }
type Tab = 'script' | 'list' | 'desc' | 'prompt' | 'board' | 'webtoon' | 'analysis';
const TABS: [Tab, string][] = [['script', '대본'], ['list', '신 리스트'], ['desc', '장면 묘사'], ['prompt', '그림'], ['board', '스토리보드'], ['webtoon', '웹툰'], ['analysis', '분석']];

export default function Workspace({ id, onClose, settings, setSettings }: { id: string; onClose: () => void; settings: Settings; setSettings: (s: Settings) => void }) {
  const [p, setP] = useState<Project | null>(null);
  const [tab, setTab] = useState<Tab>('script');
  const [focusScene, setFocusScene] = useState<string | undefined>();
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState('');
  const toast = useToast();
  const saveTimer = useRef<number>();
  const latest = useRef<Project | null>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const gTimer = useRef<number>();
  const gDirty = useRef(false);
  const [gs, setGs] = useState<{ st: 'idle' | 'busy' | 'ok' | 'err'; msg?: string; at?: number }>(() => ({ st: 'idle', at: getLinks(id)?.at }));
  const [gOpen, setGOpen] = useState(false);
  const gsync = useCallback(async (manual = false) => {
    const g = settingsRef.current.gsync; const cur = latest.current;
    if (!g || !cur) { if (manual) setGOpen(true); return; }
    clearTimeout(gTimer.current); gDirty.current = false;
    setGs({ st: 'busy' });
    try { const l = await syncProject(g, cur); setGs({ st: 'ok', at: l.at }); if (manual) toast('구글 드라이브에 올렸어요.'); }
    catch (e: any) { gDirty.current = true; setGs({ st: 'err', msg: String(e?.message || e) }); if (manual) toast('구글 저장 실패: ' + (e?.message || e)); }
  }, []);

  useEffect(() => { loadProject(id).then(x => { if (!x) onClose(); else { setP(x); latest.current = x; } }); }, [id]);
  const flush = useCallback(() => {
    if (latest.current) saveProject(latest.current);
    if (gDirty.current && settingsRef.current.gsync?.auto) gsync();
  }, [gsync]);
  useEffect(() => {
    const h = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', h);
    return () => { document.removeEventListener('visibilitychange', h); flush(); };
  }, [flush]);

  const update: Updater = useCallback(fn => {
    setP(prev => {
      if (!prev) return prev;
      const next = { ...fn(prev), updatedAt: Date.now() };
      latest.current = next;
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => saveProject(next), 700);
      if (settingsRef.current.gsync?.auto) { gDirty.current = true; clearTimeout(gTimer.current); gTimer.current = window.setTimeout(() => gsync(), 60000); }
      return next;
    });
  }, []);
  const go = useCallback((t: Tab, sceneId?: string) => { setTab(t); setFocusScene(sceneId); }, []);

  if (!p) return <div className="app"><p style={{ padding: 20 }}>여는 중…</p></div>;

  const replaceScript = async () => {
    setMenu(false);
    const [f] = await pickFiles('.pdf,.hwp,.hwpx,.docx,.txt,.fountain,text/plain,application/pdf');
    if (!f) return;
    if (!confirm('지금 대본을 불러온 대본으로 통째로 바꿀까요? (신 리스트 메모·그림은 같은 줄이 없으면 연결이 끊겨요)')) return;
    setBusy('불러오는 중…');
    try { const r = await importFile(f); update(x => ({ ...x, lines: r.lines, format: r.format })); toast(`씬 ${r.lines.filter(l => l.t === 'scene').length}개를 불러왔어요.`); }
    catch (e: any) { toast('불러오기 실패: ' + (e?.message || e)); }
    setBusy('');
  };
  const exportFountain = async () => { setMenu(false); const path = await saveFile(new Blob([toFountain(p.title, p.lines)], { type: 'text/plain' }), `${p.title}.fountain`); toast('저장했어요: ' + path); };
  const exportSbk = async () => { setMenu(false); setBusy('백업 만드는 중…'); const path = await saveFile(await exportProject(p), `${p.title}.sbk`); setBusy(''); toast('저장했어요: ' + path); };
  const exportPdf = async () => { setMenu(false); setBusy('대본 PDF 만드는 중…'); try { const path = await exportScriptPdf(p); toast('저장했어요: ' + path); } catch (e: any) { toast('PDF 실패: ' + (e?.message || e)); } setBusy(''); };

  const props: WsProps = { p, update, settings, setSettings, go, focusScene };
  return (
    <div className="app">
      <div className="topbar">
        <button className="ghost" onClick={() => { flush(); onClose(); }}>‹ 목록</button>
        <input className="title" value={p.title} onChange={e => update(x => ({ ...x, title: e.target.value }))} />
        <div className="tabs">
          {TABS.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>{label}</button>)}
        </div>
        <div className="grow" />
        {busy && <span className="muted small-t">{busy}</span>}
        <button className="ghost small" title="ChatGPT를 옆 화면에 열기" onClick={() => openAiSide()}>AI 열기 ◫</button>
        {settings.gsync && <button className="ghost small" title={gs.msg} onClick={() => gsync(true)}>
          {gs.st === 'busy' ? '구글 올리는 중…' : gs.st === 'err' ? '구글 실패 ↻' : gs.at ? `구글 ✓ ${new Date(gs.at).toTimeString().slice(0, 5)}` : '구글에 올리기'}</button>}
        <select value={p.format} onChange={e => update(x => ({ ...x, format: e.target.value as Format }))} title="대본 양식">
          <option value="ko-stack">한국식 (위아래)</option>
          <option value="ko-side">한국식 (나란히)</option>
          <option value="hollywood">할리우드식</option>
        </select>
        <button onClick={() => setMenu(true)}>⋯ 파일</button>
      </div>
      <div className="main">
        {tab === 'script' && <ScriptTab {...props} />}
        {tab === 'list' && <SceneListTab {...props} />}
        {tab === 'desc' && <DescribeTab {...props} />}
        {tab === 'prompt' && <PromptTab {...props} />}
        {tab === 'board' && <StoryboardTab {...props} />}
        {tab === 'webtoon' && <WebtoonTab {...props} />}
        {tab === 'analysis' && <AnalysisTab {...props} />}
      </div>
      {menu && <Modal title="파일" onClose={() => setMenu(false)}>
        <div style={{ display: 'grid', gap: 10 }}>
          <button onClick={replaceScript}>대본 가져오기 (PDF · HWP · HWPX · DOCX · TXT · Fountain)</button>
          <button onClick={exportPdf}>대본 PDF로 저장</button>
          <button onClick={exportFountain}>Fountain으로 내보내기 (다른 시나리오 앱용)</button>
          <button onClick={exportSbk}>이 작품 백업 파일(.sbk) 만들기</button>
          <button onClick={() => { setMenu(false); settings.gsync ? gsync(true) : setGOpen(true); }}>{settings.gsync ? '구글 문서·시트에 지금 올리기' : '구글 문서·시트 연결하기'}</button>
          {getLinks(p.id) && <div className="row">
            <button className="small" onClick={() => openExternal(getLinks(p.id)!.script)}>대본 문서 열기</button>
            <button className="small" onClick={() => openExternal(getLinks(p.id)!.sheet)}>신 리스트 시트 열기</button>
            <button className="small" onClick={() => openExternal(getLinks(p.id)!.desc)}>장면 묘사 문서 열기</button>
          </div>}
          {settings.gsync && <button className="small" onClick={() => { setMenu(false); setGOpen(true); }}>구글 연결 설정</button>}
          <p className="muted small-t">{isDesktop() ? '저장한 파일은 "문서\\시나리오작업실" 폴더에 들어가고, 탐색기 창이 열려요. AI 창에 끌어다 놓으면 돼요.' : '저장한 파일은 태블릿의 "문서/시나리오작업실" 폴더에 들어가고, 공유 창으로 드라이브나 메신저에 바로 보낼 수 있어요.'}</p>
          <p className="muted small-t">씬 {getScenes(p.lines).length}개 · 인물 {knownNames(p).length}명 · {p.lines.length}줄</p>
        </div>
      </Modal>}
      {gOpen && <GoogleSyncModal settings={settings} setSettings={setSettings} onClose={() => setGOpen(false)} />}
    </div>
  );
}
