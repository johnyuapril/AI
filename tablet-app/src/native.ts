import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { downloadBlob } from './util';

export const isNative = () => Capacitor.isNativePlatform();

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej; r.readAsDataURL(b);
  });
}

/** 파일 저장: 태블릿에서는 Documents/시나리오작업실 에 저장하고 공유 창을 띄움 */
export async function saveFile(blob: Blob, name: string, share = true): Promise<string> {
  if (!isNative()) { downloadBlob(blob, name); return name; }
  const data = await blobToBase64(blob);
  const path = '시나리오작업실/' + name;
  let r: { uri: string }; let saved = '문서/' + path;
  try { r = await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true }); }
  catch { r = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache }); saved = '공유 창에서 저장할 곳을 골라 주세요'; share = true; }
  if (share) {
    try { await Share.share({ title: name, url: r.uri, dialogTitle: '파일 보내기' }); } catch { /* 취소 */ }
  }
  return saved;
}

/** 이미지 공유(외부 AI 앱에 화풍 그림 보내기) */
export async function shareImage(blob: Blob, name: string) {
  if (!isNative()) { downloadBlob(blob, name); return; }
  const data = await blobToBase64(blob);
  const r = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
  await Share.share({ title: name, url: r.uri, dialogTitle: '그림 보내기' });
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.onchange = () => res(Array.from(inp.files || []));
    inp.click();
  });
}
