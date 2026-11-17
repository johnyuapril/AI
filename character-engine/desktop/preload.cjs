// 웹 화면에서 window.desktop 으로 윈도우 기능을 부른다. src/update.ts 참고.
const { contextBridge, ipcRenderer } = require('electron');
const call = (name, arg) => ipcRenderer.invoke('desktop:' + name, arg);
contextBridge.exposeInMainWorld('desktop', {
  info: () => call('info'),
  openExternal: url => call('openExternal', { url }),
  installUpdate: url => call('installUpdate', { url }),
});
