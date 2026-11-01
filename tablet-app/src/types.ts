export type LineType = 'scene' | 'action' | 'character' | 'dialogue' | 'paren' | 'transition' | 'shot';
export interface Line { id: string; t: LineType; text: string; m?: 1 }
export type Format = 'ko-stack' | 'ko-side' | 'hollywood';

export interface CharInfo { name: string; memo: string; look: string }

export interface CutMeta {
  shot?: string; angle?: string; move?: string;
  chars?: string[];
  desc?: string;      // 장면 묘사 (컷)
  descManual?: boolean;
  corr?: string;      // 컷 바로잡기
  prompt?: string;    // 직접 고친 그림 프롬프트
  img?: string;       // 이미지 id
  ctx?: string; audio?: string; time?: string; // 스토리보드 칸 직접 고친 값
  wait?: boolean;     // 그림 기다리는 중
}
export interface SceneMeta {
  summary?: string; notes?: string;
  breaks?: string[];  // 직접 추가한 컷 나눔(단위 id)
  noBreaks?: string[]; // 직접 없앤 컷 나눔(단위 id)
  setTable?: string;  // 씬 설정표
  corr?: string;      // 씬 바로잡기
  common?: string;    // 그림 공통(마스터 샷) 직접 고친 값
}
export interface Project {
  id: string; title: string; team: string; format: Format;
  lines: Line[];
  chars: CharInfo[];
  scenes: Record<string, SceneMeta>;
  cuts: Record<string, CutMeta>;
  sbFormat?: string; aspect?: string;
  createdAt: number; updatedAt: number;
}
export interface ProjectSummary { id: string; title: string; updatedAt: number; sceneCount: number; lineCount: number }
export interface GSync { url: string; key: string; auto: boolean }
export interface Settings { gptInstruction: string; styleText: string; styleImg?: string; promptHeader: string; gsync?: GSync }
