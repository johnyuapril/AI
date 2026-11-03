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
  wt?: WebtoonPanel;  // 웹툰 칸 직접 고친 값 (없으면 자동)
}
export type BubbleKind = 'talk' | 'shout' | 'think' | 'off' | 'nar';
export interface Bubble { id: string; speaker: string; text: string; kind: BubbleKind; x: number; y: number; tx?: number } // x,y: 칸 안 비율(0~1, 말풍선 가운데), tx: 꼬리가 가리키는 인물 x
export interface Sfx { id: string; text: string; x: number; y: number; size: number; rot: number; color?: string }
export type FxKind = 'focus' | 'speed' | 'flash' | 'dark' | 'shake';
export interface WebtoonPanel { bubbles: Bubble[]; sfx: Sfx[]; fx: FxKind[]; gap?: number }
export interface SceneMeta {
  summary?: string; notes?: string;
  breaks?: string[];  // 직접 추가한 컷 나눔(단위 id)
  noBreaks?: string[]; // 직접 없앤 컷 나눔(단위 id)
  setTable?: string;  // 씬 설정표
  corr?: string;      // 씬 바로잡기
  common?: string;    // 그림 공통(마스터 샷) 직접 고친 값
  aiCuts?: AICut[];   // 외부 AI가 나눈 컷 (있으면 자동 나누기 대신 씀)
}
export interface AICut {
  intent?: string;   // 연출 의도
  shot?: string; angle?: string; move?: string; cam?: string;
  src: string;        // 이 컷에 해당하는 대본 부분
  see: string;        // 화면 핵심
  chars?: string[];
  dlg?: { speaker: string; text: string; off: boolean }[];
  sfx?: string[];     // 웹툰 효과음
  fx?: string[];      // 웹툰 화면효과
}
export interface Project {
  id: string; title: string; team: string; format: Format;
  lines: Line[];
  chars: CharInfo[];
  scenes: Record<string, SceneMeta>;
  cuts: Record<string, CutMeta>;
  sbFormat?: string; aspect?: string;
  debate?: string;    // 감독·작가·평론가 3인 토론 결론 (모든 AI 요청에 같이 보냄)
  debateLog?: string; // 토론 전체 기록
  bible?: string;     // 작품 설정 (시나리오 전체에서 AI가 정리한 인물·장소·소품·시대, 모든 AI 요청에 같이 보냄)
  createdAt: number; updatedAt: number;
}
export interface ProjectSummary { id: string; title: string; updatedAt: number; sceneCount: number; lineCount: number }
export interface GSync { url: string; key: string; auto: boolean }
export interface Settings { gptInstruction: string; styleText: string; styleImg?: string; promptHeader: string; gsync?: GSync }
