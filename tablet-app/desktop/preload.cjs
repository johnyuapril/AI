// 앱 화면(공통 코드)에서 window.desktop 으로 윈도우 기능을 부른다. src/native.ts 참고.
const { contextBridge, ipcRenderer } = require('electron');
const call = (name, arg) => ipcRenderer.invoke('desktop:' + name, arg);
contextBridge.exposeInMainWorld('desktop', {
  info: () => call('info'),
  saveFile: (name, data, reveal) => call('saveFile', { name, data, reveal }),
  saveAs: (name, data) => call('saveAs', { name, data }),
  copyImage: data => call('copyImage', { data }),
  openAiSide: url => call('openAiSide', { url }),
  openExternal: url => call('openExternal', { url }),
  showItem: p => call('showItem', { path: p }),
  http: o => call('http', o),
  fetchBin: o => call('fetchBin', o),
  comfyLaunch: exe => call('comfyLaunch', { exe }),
  pickFile: (title, filters) => call('pickFile', { title, filters }),
  comfyGetModel: (exe, url, name) => call('comfyGetModel', { exe, url, name }),
  onComfyDl: cb => ipcRenderer.on('comfy-dl', (_e, p) => cb(p)),
  installUpdate: url => call('installUpdate', { url }),
  onAiDownloaded: cb => ipcRenderer.on('ai-downloaded', (_e, p) => cb(p)),
});
