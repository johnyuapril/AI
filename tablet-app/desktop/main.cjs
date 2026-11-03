// 시나리오 작업실 윈도우용: 안드로이드 앱과 같은 화면(../dist → web/)을 그대로 띄운다.
// 앱 화면은 공통 코드(src/)이고, 여기는 윈도우에서만 필요한 일(파일 저장, AI 창, 업데이트)만 한다.
const { app, BrowserWindow, ipcMain, protocol, net, shell, screen, clipboard, nativeImage, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

const WEB = path.join(__dirname, 'web');
const SAVE_DIR = () => path.join(app.getPath('documents'), '시나리오작업실');
// 구글 로그인이 "안전하지 않은 브라우저"로 막히지 않게 보통 크롬처럼 보이게 함
const CHROME_UA = () => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

if (!app.requestSingleInstanceLock()) { app.quit(); }

// app:// 주소로 띄워야 저장(IndexedDB)이 안정적으로 남는다. 주소를 바꾸면 작품 저장 위치가 달라지니 바꾸지 말 것.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let main = null;
let ai = null;

function createMain() {
  main = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: '시나리오 작업실', icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true, backgroundColor: '#ffffff',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  main.maximize();
  main.loadURL('app://local/index.html');
  // 앱 안 링크(구글 문서, 릴리스 페이지 등)는 기본 브라우저로
  main.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  main.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  main.on('closed', () => { main = null; if (ai && !ai.isDestroyed()) ai.close(); });
}

/** AI(ChatGPT 등)를 앱 오른쪽에 나란히 띄움. 로그인은 남아 있음(persist:ai). */
function openAiSide(url) {
  const wa = screen.getDisplayMatching(main ? main.getBounds() : { x: 0, y: 0, width: 1, height: 1 }).workArea;
  const leftW = Math.round(wa.width * 0.55);
  if (main) { if (main.isMaximized()) main.unmaximize(); main.setBounds({ x: wa.x, y: wa.y, width: leftW, height: wa.height }); }
  const right = { x: wa.x + leftW, y: wa.y, width: wa.width - leftW, height: wa.height };
  if (ai && !ai.isDestroyed()) {
    ai.setBounds(right);
    if (url && !ai.webContents.getURL().startsWith(new URL(url).origin)) ai.loadURL(url);
    ai.show(); ai.focus(); return;
  }
  ai = new BrowserWindow({
    ...right, title: 'AI', autoHideMenuBar: true, icon: path.join(__dirname, 'icon.png'),
    webPreferences: { partition: 'persist:ai', contextIsolation: true, nodeIntegration: false },
  });
  ai.webContents.setUserAgent(CHROME_UA());
  ai.webContents.setWindowOpenHandler(({ url: u }) => {
    // 로그인 팝업(구글 등)은 같은 창 묶음 안에서 열어야 로그인이 이어짐
    if (/accounts\.google|appleid|login\.microsoftonline|auth/i.test(u)) return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: 'persist:ai' } } };
    shell.openExternal(u); return { action: 'deny' };
  });
  ai.on('closed', () => { ai = null; if (main) main.maximize(); });
  ai.loadURL(url || 'https://chatgpt.com');
}

/** AI 창에서 받은 그림은 문서/시나리오작업실/받은 그림 에 저장 */
function watchDownloads() {
  const { session } = require('electron');
  session.fromPartition('persist:ai').setUserAgent(CHROME_UA());
  session.fromPartition('persist:ai').on('will-download', (_e, item) => {
    const dir = path.join(SAVE_DIR(), '받은 그림');
    fs.mkdirSync(dir, { recursive: true });
    let name = item.getFilename() || 'image.png';
    let p = path.join(dir, name);
    for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, name.replace(/(\.[^.]*)?$/, ` (${i})$1`));
    item.setSavePath(p);
    item.once('done', (_ev, state) => { if (state === 'completed' && main) main.webContents.send('ai-downloaded', p); });
  });
}

function uniquePath(dir, name) {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  return path.join(dir, safe);
}

ipcMain.handle('desktop:info', () => ({ version: app.getVersion(), platform: process.platform, saveDir: SAVE_DIR() }));
ipcMain.handle('desktop:saveFile', async (_e, { name, data, reveal }) => {
  const dir = SAVE_DIR(); fs.mkdirSync(dir, { recursive: true });
  const p = uniquePath(dir, name);
  fs.writeFileSync(p, Buffer.from(data));
  if (reveal) shell.showItemInFolder(p);
  return p;
});
ipcMain.handle('desktop:saveAs', async (_e, { name, data }) => {
  const r = await dialog.showSaveDialog(main, { defaultPath: uniquePath(SAVE_DIR(), name) });
  if (r.canceled || !r.filePath) return '';
  fs.writeFileSync(r.filePath, Buffer.from(data));
  return r.filePath;
});
ipcMain.handle('desktop:copyImage', (_e, { data }) => {
  const img = nativeImage.createFromBuffer(Buffer.from(data));
  if (img.isEmpty()) return false;
  clipboard.writeImage(img); return true;
});
ipcMain.handle('desktop:openAiSide', (_e, { url }) => { openAiSide(url); });
ipcMain.handle('desktop:openExternal', (_e, { url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); });
ipcMain.handle('desktop:showItem', (_e, { path: p }) => { shell.showItemInFolder(p); });
// 구글 앱스 스크립트로 보내기: 브라우저 제한(CORS) 없이 보내야 구글 오류 내용까지 읽힌다
ipcMain.handle('desktop:http', async (_e, { url, method, headers, body }) => {
  const r = await net.fetch(url, { method, headers, body, redirect: 'follow' });
  return { status: r.status, text: await r.text() };
});
// 업데이트: 새 설치 파일을 받아 실행하고 앱을 닫는다 (설치가 끝나면 다시 켜짐)
ipcMain.handle('desktop:installUpdate', async (_e, { url }) => {
  const p = path.join(os.tmpdir(), 'Screenwriter-Setup.exe');
  // 받는 방법을 여러 개 시도: 크롬 방식(net.fetch)이 깃허브 파일 서버에서 400을 받는 PC가 있었음
  const tries = [
    () => fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Screenwriter-Updater', Accept: 'application/octet-stream' } }),
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
    } catch (err) { last = String(err && err.message || err); }
  }
  throw new Error('새 버전을 받지 못했어요 (' + last + ')');
});

app.whenReady().then(() => {
  protocol.handle('app', req => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(fs.existsSync(file) ? file : path.join(WEB, 'index.html')).toString());
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '파일', submenu: [{ label: '저장 폴더 열기', click: () => { fs.mkdirSync(SAVE_DIR(), { recursive: true }); shell.openPath(SAVE_DIR()); } }, { type: 'separator' }, { role: 'quit', label: '끝내기' }] },
    { label: '편집', submenu: [{ role: 'undo', label: '되돌리기' }, { role: 'redo', label: '다시 하기' }, { type: 'separator' }, { role: 'cut', label: '잘라내기' }, { role: 'copy', label: '복사' }, { role: 'paste', label: '붙여넣기' }, { role: 'selectAll', label: '모두 선택' }] },
    { label: '보기', submenu: [{ role: 'reload', label: '새로 고침' }, { role: 'zoomIn', label: '크게' }, { role: 'zoomOut', label: '작게' }, { role: 'resetZoom', label: '원래 크기' }, { role: 'togglefullscreen', label: '전체 화면' }, { type: 'separator' }, { role: 'toggleDevTools', label: '개발자 도구' }] },
  ]));
  watchDownloads();
  createMain();
});
app.on('second-instance', () => { if (main) { if (main.isMinimized()) main.restore(); main.focus(); } });
app.on('window-all-closed', () => app.quit());
