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
// ComfyUI(내 PC 그림 AI)와 주고받기: 그림 같은 바이너리도 오가고, 브라우저 제한(CORS)이 없게 앱 안에서
ipcMain.handle('desktop:fetchBin', async (_e, { url, method, headers, body }) => {
  if (!/^https?:\/\//i.test(url)) throw new Error('잘못된 주소');
  const r = await fetch(url, { method: method || 'GET', headers: headers || {}, body: body == null ? undefined : (typeof body === 'string' ? body : Buffer.from(body)) });
  return { status: r.status, type: r.headers.get('content-type') || '', data: new Uint8Array(await r.arrayBuffer()) };
});
// ComfyUI 켜기: 지정한 파일이 없으면 흔한 설치 위치에서 찾는다 (ComfyUI Desktop, 포터블)
function comfyCandidates() {
  const la = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
  const list = [
    path.join(la, 'Programs', '@comfyorgcomfyui-electron', 'ComfyUI.exe'),
    path.join(la, 'Programs', 'ComfyUI', 'ComfyUI.exe'),
    path.join(la, 'Programs', 'comfyui-electron', 'ComfyUI.exe'),
    ...pf.map(d => path.join(d, 'ComfyUI', 'ComfyUI.exe')),
  ];
  // 포터블: 드라이브 바로 아래나 내 폴더, 다운로드, 바탕화면
  const roots = ['C:\\', 'D:\\', 'E:\\', os.homedir(), path.join(os.homedir(), 'Downloads'), path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'Documents')];
  for (const r of roots) for (const d of ['ComfyUI_windows_portable', 'ComfyUI_windows_portable_nvidia', 'ComfyUI']) {
    list.push(path.join(r, d, 'run_nvidia_gpu.bat'));
  }
  return list;
}
ipcMain.handle('desktop:comfyLaunch', async (_e, { exe }) => {
  const found = [exe, ...comfyCandidates()].filter(Boolean).find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  if (!found) return { ok: false, path: '' };
  if (/\.(bat|cmd)$/i.test(found)) spawn('cmd.exe', ['/c', 'start', '"ComfyUI"', '/min', found], { cwd: path.dirname(found), detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else spawn(found, [], { cwd: path.dirname(found), detached: true, stdio: 'ignore' }).unref();
  return { ok: true, path: found };
});
// ComfyUI 모델 폴더 찾기: Desktop 은 %APPDATA%\ComfyUI\config.json 의 basePath, 포터블은 실행 파일 옆
function comfyModelDir(exe) {
  const out = [];
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(app.getPath('appData'), 'ComfyUI', 'config.json'), 'utf8'));
    if (cfg.basePath) out.push(path.join(cfg.basePath, 'models', 'checkpoints'));
  } catch { /* 없음 */ }
  if (exe && /\.(bat|cmd)$/i.test(exe)) out.push(path.join(path.dirname(exe), 'ComfyUI', 'models', 'checkpoints'));
  out.push(path.join(os.homedir(), 'Documents', 'ComfyUI', 'models', 'checkpoints'));
  return out.find(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } }) || '';
}
// 모델 받기 (수 GB): 다 받은 뒤 이름을 바꿔서, 받다 만 파일을 ComfyUI가 읽지 않게
ipcMain.handle('desktop:comfyGetModel', async (_e, { exe, url, name }) => {
  const dir = comfyModelDir(exe);
  if (!dir) throw new Error('ComfyUI 모델 폴더(models/checkpoints)를 찾지 못했어요.');
  const dest = path.join(dir, name);
  if (fs.existsSync(dest)) return dest;
  const tmp = dest + '.part';
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error('모델 받기 실패: ' + r.status);
  const total = Number(r.headers.get('content-length')) || 0;
  const f = fs.createWriteStream(tmp);
  let got = 0, last = 0;
  for await (const chunk of r.body) {
    got += chunk.length;
    if (!f.write(chunk)) await new Promise(res => f.once('drain', res));
    if (Date.now() - last > 700) { last = Date.now(); main?.webContents.send('comfy-dl', { got, total }); }
  }
  await new Promise(res => f.end(res));
  fs.renameSync(tmp, dest);
  main?.webContents.send('comfy-dl', { got, total, done: true });
  return dest;
});
ipcMain.handle('desktop:pickFile', async (_e, { title, filters }) => {
  const r = await dialog.showOpenDialog(main, { title, properties: ['openFile'], filters });
  return r.canceled ? '' : r.filePaths[0] || '';
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
