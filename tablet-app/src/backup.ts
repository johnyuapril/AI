import JSZip from 'jszip';
import type { Project } from './types';
import { getImageBlob, listProjects, loadProject, putImage, saveProject, getSettings, saveSettings } from './store';
import { uid } from './util';

async function addProject(zip: JSZip, p: Project, dir: string) {
  zip.file(dir + 'project.json', JSON.stringify(p));
  const ids = new Set(Object.values(p.cuts).map(c => c.img).filter(Boolean) as string[]);
  for (const id of ids) { const b = await getImageBlob(id); if (b) zip.file(dir + 'images/' + id, b); }
}
export async function exportProject(p: Project): Promise<Blob> {
  const zip = new JSZip();
  await addProject(zip, p, '');
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
export async function exportAll(): Promise<Blob> {
  const zip = new JSZip();
  for (const s of await listProjects()) { const p = await loadProject(s.id); if (p) await addProject(zip, p, `projects/${p.id}/`); }
  const st = await getSettings();
  zip.file('settings.json', JSON.stringify({ ...st, styleImg: undefined }));
  if (st.styleImg) { const b = await getImageBlob(st.styleImg); if (b) zip.file('style-image', b); }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
async function importOne(zip: JSZip, dir: string): Promise<Project> {
  const p: Project = JSON.parse(await zip.file(dir + 'project.json')!.async('string'));
  const map = new Map<string, string>();
  for (const name of Object.keys(zip.files)) {
    if (!name.startsWith(dir + 'images/') || zip.files[name].dir) continue;
    const old = name.slice((dir + 'images/').length);
    const blob = await zip.file(name)!.async('blob');
    map.set(old, await putImage(blob));
  }
  for (const c of Object.values(p.cuts)) if (c.img) c.img = map.get(c.img);
  p.id = uid(); p.updatedAt = Date.now();
  await saveProject(p);
  return p;
}
/** 백업 파일 불러오기: 작품 하나(.sbk) 또는 전체 백업 */
export async function importBackup(file: File): Promise<number> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  if (zip.file('project.json')) { await importOne(zip, ''); return 1; }
  const dirs = new Set(Object.keys(zip.files).filter(n => /^projects\/[^/]+\/project\.json$/.test(n)).map(n => n.replace('project.json', '')));
  for (const d of dirs) await importOne(zip, d);
  const sf = zip.file('settings.json');
  if (sf) {
    const st = JSON.parse(await sf.async('string'));
    const si = zip.file('style-image');
    if (si) st.styleImg = await putImage(await si.async('blob'));
    await saveSettings({ ...(await getSettings()), ...st });
  }
  return dirs.size;
}
