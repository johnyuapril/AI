import { useEffect, useState } from 'react';
import type { ProjectSummary, Settings } from './types';
import GoogleSyncModal from './GoogleSync';
import { deleteProject, listProjects, loadProject, newProject, saveProject } from './store';
import { importFile } from './importer';
import { exportAll, importBackup } from './backup';
import { pickFiles, saveFile } from './native';
import { useToast } from './ui';
import { currentVersion, installUpdate, latestRelease, openExternal, RELEASES_PAGE, type Latest } from './update';
import { isDesktop, isNative } from './native';

export default function Home({ onOpen, settings, setSettings }: { onOpen: (id: string) => void; settings: Settings; setSettings: (s: Settings) => void }) {
  const [gOpen, setGOpen] = useState(false);
  const [list, setList] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState('');
  const toast = useToast();
  const refresh = () => listProjects().then(setList);
  useEffect(() => { refresh(); }, []);
  const [ver, setVer] = useState<{ name: string; code: number } | null>(null);
  const [latest, setLatest] = useState<Latest | null | 'private'>(null);
  const check = async (manual = false) => {
    const v = await currentVersion(); setVer(v);
    try {
      const l = await latestRelease(); setLatest(l || 'private');
      if (manual) toast(!l ? '업데이트 정보를 못 가져왔어요. 다운로드 페이지를 열게요.' : l.code > v.code ? `새 버전 v${l.name}이 있어요.` : '지금 최신 버전이에요.');
      if (manual && !l) openExternal(RELEASES_PAGE);
    } catch { if (manual) toast('인터넷 연결을 확인해 주세요.'); }
  };
  useEffect(() => { check(); }, []);
  const doUpdate = async (l: Latest) => {
    if (!isNative() && !isDesktop()) { openExternal(l.url); return; }
    setBusy('새 버전 받는 중…');
    if (isDesktop()) {
      try { await installUpdate(l.url); toast('설치가 끝나면 앱이 다시 켜져요.'); }
      catch (e: any) {
        toast(String(e?.message || e).replace(/^.*Error: /, '') + ' 다운로드 페이지를 열게요. .zip 을 받아 설치해 주세요.');
        openExternal(RELEASES_PAGE);
      }
      setBusy(''); return;
    }
    try { await installUpdate(l.url); toast('설치 화면에서 "업데이트"를 눌러 주세요.'); }
    catch (e: any) {
      const m = String(e?.message || e);
      toast(m.includes('NEED_PERMISSION') ? '"이 출처 허용"을 켠 뒤 돌아와서 다시 눌러 주세요.' : m);
    }
    setBusy('');
  };
  const hasNew = latest && latest !== 'private' && ver && latest.code > ver.code ? latest : null;

  const create = async () => { const p = newProject(); await saveProject(p); onOpen(p.id); };
  const importScript = async () => {
    const [f] = await pickFiles('.pdf,.hwp,.hwpx,.docx,.txt,.fountain,text/plain,application/pdf');
    if (!f) return;
    setBusy(`"${f.name}" 불러오는 중…`);
    try {
      const r = await importFile(f);
      const p = newProject(r.title); p.lines = r.lines; p.format = r.format;
      await saveProject(p);
      toast(`씬 ${r.lines.filter(l => l.t === 'scene').length}개를 불러왔어요.`);
      onOpen(p.id);
    } catch (e: any) { toast('불러오기 실패: ' + (e?.message || e)); }
    setBusy('');
  };
  const restore = async () => {
    const [f] = await pickFiles('.sbk,.zip,application/zip,application/octet-stream');
    if (!f) return;
    setBusy('백업 복원 중…');
    try { const n = await importBackup(f); toast(`작품 ${n}개를 복원했어요.`); refresh(); } catch (e: any) { toast('복원 실패: ' + (e?.message || e)); }
    setBusy('');
  };
  const backupAll = async () => {
    setBusy('전체 백업 만드는 중…');
    const d = new Date(); const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    try { const path = await saveFile(await exportAll(), `시나리오작업실-전체백업-${stamp}.sbk`); toast('저장했어요: ' + path); } catch (e: any) { toast('백업 실패: ' + (e?.message || e)); }
    setBusy('');
  };
  const rename = async (s: ProjectSummary) => {
    const t = prompt('작품 이름', s.title); if (!t) return;
    const p = await loadProject(s.id); if (!p) return;
    p.title = t; p.updatedAt = Date.now(); await saveProject(p); refresh();
  };
  const remove = async (s: ProjectSummary) => {
    if (!confirm(`"${s.title}"을(를) 지울까요? 되돌릴 수 없어요. 먼저 백업해 두는 걸 권해요.`)) return;
    await deleteProject(s.id); refresh();
  };
  return (
    <div className="app scroll">
      <div className="home">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1>시나리오 작업실 <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>{ver ? (ver.code ? `v${ver.name}` : ver.name) : ''}</span></h1>
          <div className="row">
            {hasNew ? <button className="primary" onClick={() => doUpdate(hasNew)}>업데이트 v{hasNew.name}</button>
              : <button onClick={() => check(true)}>업데이트 확인</button>}
            <button onClick={() => setGOpen(true)}>{settings.gsync ? '구글 연결됨' : '구글 연결'}</button>
            <button onClick={restore}>백업 불러오기</button>
            <button onClick={backupAll}>전체 백업</button>
            <button onClick={importScript}>대본 불러오기</button>
            <button className="primary" onClick={create}>+ 새 작품</button>
          </div>
        </div>
        {busy && <p className="muted">{busy}</p>}
        {!list.length && <div className="box"><div className="box-b">
          <p><b>아직 작품이 없어요.</b> "새 작품"으로 바로 쓰거나, "대본 불러오기"로 PDF·한글(HWP/HWPX)·워드·텍스트 대본을 불러오세요.</p>
          <p className="muted small-t">작품은 이 기기 안에 저장돼요. 다른 기기로 옮기거나 지켜 두려면 "전체 백업"으로 파일을 만들어 두세요.</p>
        </div></div>}
        <div className="cards">
          {list.map(s => (
            <div className="card" key={s.id}>
              <h3 onClick={() => onOpen(s.id)}>{s.title}</h3>
              <div className="meta">씬 {s.sceneCount}개 · {s.lineCount}줄<br />{new Date(s.updatedAt).toLocaleString('ko-KR')}</div>
              <div className="acts">
                <button className="primary" onClick={() => onOpen(s.id)}>열기</button>
                <button onClick={() => rename(s)}>이름</button>
                <button className="danger" onClick={() => remove(s)}>지우기</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {gOpen && <GoogleSyncModal settings={settings} setSettings={setSettings} onClose={() => setGOpen(false)} />}
    </div>
  );
}
