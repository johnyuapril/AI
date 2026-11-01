import { get, set, del, keys } from 'idb-keyval';
import type { Project, ProjectSummary, Settings } from './types';
import { uid } from './util';

export const DEFAULT_GPT_INSTRUCTION = `아래 시나리오의 한 씬을 읽고, 컷마다 카메라로 바라봤을 때 화면에 보이는 것을 사실적이고 자세하게 묘사해 줘.
- 감정, 냄새, 온도, 소리, 비유는 쓰지 말고 눈에 보이는 것만 써.
- 화면에 나오는 사람마다 위치와 방향, 고개, 양팔과 손, 다리와 발, 얼굴(보이는지, 표정), 옷차림을 빠짐없이 써.
- 누가 누구의 어느 부위를 어떻게 잡고 있는지처럼 사람 사이의 접촉과 동작을 구체적으로 써.
- 예: 건달 한 명은 사내의 왼팔을 잡고, 다른 건달 한 명은 사내의 목 뒷덜미를 잡고 사내를 바다 쪽으로 끌고 간다. 사내는 고개가 숙여진 채로 약하게 몸부림치며 끌려간다.
- 먼저 [설정표]에 씬 내내 변하지 않는 장소 모습, 시간·날씨·조명, 인물별 생김새·옷차림·소지품을 정리하고, 모든 컷 묘사가 설정표를 지키게 해 줘.`;

export const DEFAULT_STYLE = '굵은 붓펜으로 빠르게 그린 흑백 스토리보드 콘티. 진한 먹선과 검정 그림자, 회색 마커 2~3톤, 흰 종이 배경. 16:9 한 칸. 글자, 말풍선, 칸 나누기 없음.';

export const DEFAULT_SETTINGS: Settings = {
  gptInstruction: DEFAULT_GPT_INSTRUCTION,
  styleText: DEFAULT_STYLE,
  promptHeader: '한국 영화의 스토리보드 한 컷을 그려 줘.',
};

const IDX = 'projects-index';

export async function listProjects(): Promise<ProjectSummary[]> {
  const list = (await get<ProjectSummary[]>(IDX)) || [];
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function loadProject(id: string): Promise<Project | undefined> {
  return get<Project>('p:' + id);
}
export async function saveProject(p: Project): Promise<void> {
  await set('p:' + p.id, p);
  const list = (await get<ProjectSummary[]>(IDX)) || [];
  const s: ProjectSummary = {
    id: p.id, title: p.title, updatedAt: p.updatedAt,
    sceneCount: p.lines.filter(l => l.t === 'scene').length, lineCount: p.lines.length,
  };
  const i = list.findIndex(x => x.id === p.id);
  if (i >= 0) list[i] = s; else list.push(s);
  await set(IDX, list);
}
export async function deleteProject(id: string): Promise<void> {
  const p = await loadProject(id);
  if (p) {
    const imgs = Object.values(p.cuts).map(c => c.img).filter(Boolean) as string[];
    for (const i of imgs) await del('img:' + i);
  }
  await del('p:' + id);
  const list = ((await get<ProjectSummary[]>(IDX)) || []).filter(x => x.id !== id);
  await set(IDX, list);
}
export function newProject(title = '새 작품'): Project {
  const now = Date.now();
  return {
    id: uid(), title, team: '', format: 'ko-stack',
    lines: [{ id: uid(), t: 'scene', text: '' }],
    chars: [], scenes: {}, cuts: {}, createdAt: now, updatedAt: now,
  };
}

export async function getSettings(): Promise<Settings> {
  const s = await get<Settings>('settings');
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}
export async function saveSettings(s: Settings) { await set('settings', s); }

// 이미지
const urlCache = new Map<string, string>();
export async function putImage(blob: Blob): Promise<string> {
  const id = uid();
  await set('img:' + id, blob);
  return id;
}
export async function getImageBlob(id: string): Promise<Blob | undefined> {
  return get<Blob>('img:' + id);
}
export async function imageUrl(id?: string): Promise<string | undefined> {
  if (!id) return undefined;
  if (urlCache.has(id)) return urlCache.get(id);
  const b = await getImageBlob(id);
  if (!b) return undefined;
  const u = URL.createObjectURL(b);
  urlCache.set(id, u);
  return u;
}
export async function allImageKeys(): Promise<string[]> {
  return (await keys()).map(String).filter(k => k.startsWith('img:')).map(k => k.slice(4));
}
