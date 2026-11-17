// 인물 엔진 윈도우용: 웹앱(../dist → web/)을 그대로 띄우고, 윈도우에서만 필요한 일(업데이트, 링크 열기)만 한다.
// 시나리오 작업실 tablet-app/desktop/main.cjs 와 같은 방식.
const { app, BrowserWindow, ipcMain, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

const WEB = path.join(__dirname, 'web');
const CHROME_UA = () => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

if (!app.requestSingleInstanceLock()) { app.quit(); }

// app:// 주소로 띄워야 저장(IndexedDB)이 업데이트 뒤에도 남는다. 주소를 바꾸면 저장 위치가 달라지니 바꾸지 말 것.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let main = null;

function createMain() {
  main = new BrowserWindow({
    width: 1300, height: 860, minWidth: 420, minHeight: 500,
    title: '인물 엔진', icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true, backgroundColor: '#f4f4f2',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  main.maximize();
  main.loadURL('app://local/index.html');
  // 앱 안 링크(Anthropic 콘솔, 릴리스 페이지 등)는 기본 브라우저로
  main.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  main.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  main.on('closed', () => { main = null; });
}

ipcMain.handle('desktop:info', () => ({ version: app.getVersion(), platform: process.platform }));
ipcMain.handle('desktop:openExternal', (_e, { url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); });
// 업데이트: 새 설치 파일을 받아 실행하고 앱을 닫는다 (한 번 클릭 설치라 끝나면 다시 켜짐)
ipcMain.handle('desktop:installUpdate', async (_e, { url }) => {
  if (!/^https:\/\/github\.com\/johnyuapril\/AI\/releases\/download\//i.test(url)) throw new Error('알 수 없는 주소예요.');
  const p = path.join(os.tmpdir(), 'CharacterEngine-Setup.exe');
  // 작업실에서 크롬 방식(net.fetch)이 깃허브 파일 서버에서 400을 받는 PC가 있었음 → 두 방식 차례로
  const tries = [
    () => fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'CharacterEngine-Updater', Accept: 'application/octet-stream' } }),
    () => net.fetch(url, { redirect: 'follow', headers: { 'User-Agent': CHROME_UA() } }),
  ];
  let last = '';
  for (const t of tries) {
    try {
      const r = await t();
      if (!r.ok) { last = String(r.status); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1000000) { last = '파일이 너무 작아요'; continue; }
      fs.writeFileSync(p, buf);
      spawn(p, [], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => app.quit(), 500);
      return;
    } catch (err) { last = String((err && err.message) || err); }
  }
  throw new Error('새 버전을 받지 못했어요 (' + last + ')');
});

app.whenReady().then(() => {
  protocol.handle('app', req => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(fs.existsSync(file) ? file : path.join(WEB, 'index.html')).toString());
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '파일', submenu: [{ role: 'quit', label: '끝내기' }] },
    { label: '편집', submenu: [{ role: 'undo', label: '되돌리기' }, { role: 'redo', label: '다시 하기' }, { type: 'separator' }, { role: 'cut', label: '잘라내기' }, { role: 'copy', label: '복사' }, { role: 'paste', label: '붙여넣기' }, { role: 'selectAll', label: '모두 선택' }] },
    { label: '보기', submenu: [{ role: 'reload', label: '새로 고침' }, { role: 'zoomIn', label: '크게' }, { role: 'zoomOut', label: '작게' }, { role: 'resetZoom', label: '원래 크기' }, { role: 'togglefullscreen', label: '전체 화면' }, { type: 'separator' }, { role: 'toggleDevTools', label: '개발자 도구' }] },
  ]));
  createMain();
});
app.on('second-instance', () => { if (main) { if (main.isMinimized()) main.restore(); main.focus(); } });
app.on('window-all-closed', () => app.quit());
