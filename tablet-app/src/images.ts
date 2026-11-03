import { getImageBlob, putImage } from './store';

/** 큰 그림은 줄여서 JPEG로 저장 (태블릿 저장 공간 아끼기) */
export async function storeImageFile(file: Blob, maxW = 1600): Promise<string> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxW / bmp.width);
    if (scale >= 1 && file.size < 900_000) { bmp.close(); return putImage(file); }
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
    const blob: Blob = await new Promise(r => c.toBlob(b => r(b!), 'image/jpeg', 0.88));
    return putImage(blob);
  } catch { return putImage(file); }
}
export function imageFromPaste(e: React.ClipboardEvent | ClipboardEvent): File | null {
  const dt = (e as ClipboardEvent).clipboardData; if (!dt) return null;
  for (const it of Array.from(dt.items)) if (it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) return f; }
  return dt.files[0] && dt.files[0].type.startsWith('image/') ? dt.files[0] : null;
}
export async function imageFromClipboard(): Promise<Blob | null> {
  try {
    const items = await (navigator.clipboard as any).read();
    for (const it of items) for (const t of it.types) if (t.startsWith('image/')) return await it.getType(t);
  } catch { /* 권한 없음 */ }
  return null;
}

/** 저장된 그림을 좌우로 뒤집은 새 그림(Blob). 원래 그림은 그대로 둠 */
export async function flipImage(id: string): Promise<Blob | null> {
  const b = await getImageBlob(id); if (!b) return null;
  const bmp = await createImageBitmap(b);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d')!;
  g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(bmp, 0, 0); bmp.close();
  return new Promise(r => c.toBlob(x => r(x), b.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92));
}
