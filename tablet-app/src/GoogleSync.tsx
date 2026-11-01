import { useState } from 'react';
import type { Settings } from './types';
import { Modal, useToast } from './ui';
import { copyText } from './util';
import { newKey, scriptCode, testConnection } from './gsync';
import { openExternal } from './update';

export default function GoogleSyncModal({ settings, setSettings, onClose }: { settings: Settings; setSettings: (s: Settings) => void; onClose: () => void }) {
  const toast = useToast();
  const [key] = useState(() => {
    if (settings.gsync?.key) return settings.gsync.key;
    let k = ''; try { k = localStorage.getItem('gsync-pending-key') || ''; } catch { /* */ }
    if (!k) { k = newKey(); try { localStorage.setItem('gsync-pending-key', k); } catch { /* */ } }
    return k;
  });
  const [url, setUrl] = useState(settings.gsync?.url || '');
  const [auto, setAuto] = useState(settings.gsync?.auto ?? true);
  const [busy, setBusy] = useState(false);
  const connected = !!settings.gsync?.url;

  const save = async () => {
    const g = { url: url.trim(), key, auto };
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(g.url)) { toast('주소는 https://script.google.com/macros/s/…/exec 모양이어야 해요.'); return; }
    setBusy(true);
    try { await testConnection(g); setSettings({ ...settings, gsync: g }); toast('구글에 연결됐어요. 작품을 고치면 자동으로 올라가요.'); onClose(); }
    catch (e: any) { toast('연결 실패: ' + (e?.message || e)); }
    setBusy(false);
  };
  return (
    <Modal wide title="구글 문서·스프레드시트 자동 저장" onClose={onClose}>
      <div style={{ display: 'grid', gap: 12, fontSize: 15, lineHeight: 1.6 }}>
        <p className="muted small-t" style={{ margin: 0 }}>
          대본은 구글 문서, 신 리스트·컷 리스트·장면 묘사는 스프레드시트, 장면 묘사는 문서로도 내 구글 드라이브의 "시나리오 작업실" 폴더에 저장돼요. 처음 한 번만 아래처럼 연결하면 돼요.
        </p>
        <ol style={{ margin: 0, paddingLeft: 22 }}>
          <li><button className="small" onClick={() => openExternal('https://script.google.com/home/projects/create')}>구글 앱스 스크립트 열기</button> → 새 프로젝트가 열려요. (휴대용 화면이면 크롬 메뉴에서 "데스크톱 사이트"를 켜 주세요)</li>
          <li><button className="small primary" onClick={async () => toast(await copyText(scriptCode(key)) ? '코드를 복사했어요.' : '복사 실패')}>코드 복사</button> → 편집기에 있던 내용을 모두 지우고 붙여넣기 → 저장(💾).</li>
          <li>오른쪽 위 <b>배포 → 새 배포</b> → 톱니바퀴에서 <b>웹 앱</b> 선택 → 실행: <b>나</b>, 액세스 권한: <b>모든 사용자</b> → 배포.</li>
          <li>권한 허용 창이 나오면 내 계정 선택 → "고급" → "(안전하지 않음)으로 이동" → 허용. (내가 만든 스크립트라 괜찮아요)</li>
          <li>나온 <b>웹 앱 URL</b>을 복사해서 아래에 붙여넣고 "연결".</li>
        </ol>
        <p className="small-t" style={{ margin: 0 }}><b>코드를 새로 붙여넣었을 때</b>(앱이 "예전 버전"이라고 할 때): 편집기에 새 코드를 붙여넣고 저장 → <b>배포 → 배포 관리 → 연필(✏️) → 버전: 새 버전 → 배포</b>. 주소는 그대로라 앱에서 바꿀 건 없어요.</p>
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" style={{ width: '100%', fontSize: 15 }} />
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} style={{ width: 22, height: 22 }} /> 고칠 때마다 자동으로 올리기 (마지막으로 고친 뒤 1분 쯤 지나서, 그리고 작품을 닫을 때)</label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {connected && <button onClick={() => { setSettings({ ...settings, gsync: undefined }); toast('구글 연결을 끊었어요.'); onClose(); }}>연결 끊기</button>}
          <button className="primary" disabled={busy} onClick={save}>{busy ? '확인 중…' : '연결'}</button>
        </div>
        <p className="muted small-t" style={{ margin: 0 }}>비밀 키: {key} (코드 안에 들어 있어요. 이 키가 없으면 아무도 이 주소로 저장할 수 없어요.)</p>
      </div>
    </Modal>
  );
}
