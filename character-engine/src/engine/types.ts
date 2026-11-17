// 인물 엔진 데이터 구조. 설계서(인물 엔진 설계서)의 "인물 설정 데이터 구조", "배경과 사건", "성격 변화"를 그대로 옮김.
// 화면과 상관없는 순수 타입이라 나중에 시나리오 작업실(tablet-app/src)에 그대로 옮길 수 있다.

/** 잘 변하지 않는 뿌리. 성격 변화(전환점)로만 바뀐다. */
export interface CharacterRoot {
  basics: string;      // 이름 외 기본 정보: 나이, 직업, 사는 곳, 경제 사정
  personality: string; // 성격 (모순되는 면 포함)
  values: string;      // 가치관: 갈등할 때 무엇을 우선하는가
  wounds: string;      // 상처와 두려움
  desires: string;     // 욕망 (자기도 모르는 것 포함)
  coping: string;      // 습관과 스트레스 대처 방식
  speech: string;      // 말투
}
export type RootField = keyof CharacterRoot;
export const ROOT_FIELDS: RootField[] = ['basics', 'personality', 'values', 'wounds', 'desires', 'coping', 'speech'];
export const ROOT_LABEL: Record<RootField, string> = {
  basics: '기본 정보', personality: '성격', values: '가치관', wounds: '상처와 두려움',
  desires: '욕망', coping: '습관과 대처 방식', speech: '말투',
};

/** 다른 인물과의 관계 (이 인물 쪽에서 본 것) */
export interface Relation { otherId: string; label: string; feeling: string }

/** 사건마다 바뀌는 현재 상태 */
export interface CharacterState {
  mood: string;       // 감정과 컨디션
  knows: string[];    // 인물이 아는 사실과 믿고 있는 오해
  memories: string[]; // 겪은 사건과 그때의 반응 (짧게)
}

export type ChangeDir = 'growth' | 'fall' | 'shift'; // 성장 / 타락 / 방향 없는 변화
export const DIR_LABEL: Record<ChangeDir, string> = { growth: '성장', fall: '타락', shift: '변화' };

/** 뿌리 항목 하나에 쌓인 변화 압력 */
export interface Pressure { field: RootField; dir: ChangeDir; amount: number; notes: string[] }

/** 뿌리가 바뀐 기록 (아크) */
export interface ArcEntry { at: number; eventId: string; field: RootField; dir: ChangeDir; before: string; after: string; reason: string }

export interface Character {
  id: string;
  name: string;
  root: CharacterRoot;
  relations: Relation[];
  state: CharacterState;
  pressures: Pressure[];
  arc: ArcEntry[];
  arcGoal: string; // 작가가 정한 목표 변화 (예: 3막까지 타락). 비어 있으면 없음
  createdAt: number; updatedAt: number;
}

export interface World {
  era: string;      // 시대와 장소
  rules: string;    // 사회적 규칙
  limits: string;   // 물리적 제약
  groups: string;   // 주변 인물과 집단
}

/** 사건. 작가 시점의 사실과 인물별로 아는 것을 나눈다. */
export interface StoryEvent {
  id: string;
  title: string;
  what: string;          // 무슨 일이 일어났나 (객관적 사실)
  whenWhere: string;     // 언제, 어디서
  participants: string[]; // 반응을 만들 인물 id (순서대로)
  knowledge: Record<string, string>; // 인물 id → 그 인물이 보고 들은 것 (없으면 what 전체를 안다고 봄)
  span: 'now' | 'days';  // 즉각 반응만 / 며칠 뒤 변화까지
  decisive: boolean;     // 작가가 '결정적 사건'으로 표시 (전환점 후보)
  createdAt: number;
}

/** 압력 변화 한 줄 */
export interface PressureDelta { field: RootField; dir: ChangeDir; amount: number; note: string }

/** 뿌리 변경 제안 (전환점) */
export interface RootChangeProposal { field: RootField; dir: ChangeDir; after: string; reason: string; status: 'pending' | 'accepted' | 'rejected' }

export interface CheckResult { pass: boolean; issues: string[] }

/** 인물 하나의 반응. 설계서의 "출력 형식" 다섯 칸 + 엔진이 쓰는 값 */
export interface Reaction {
  id: string;
  eventId: string;
  charId: string;
  perception: string;  // 인지
  emotion: string;     // 감정
  options: string[];   // 떠올린 선택지
  choiceWhy: string;   // 판단: 왜 이걸 골랐나
  inner: string;       // 속마음
  action: string;      // 행동
  dialogue: string;    // 대사
  reasons: string[];   // 근거 (어떤 설정이 이 행동을 만들었나)
  later?: string;      // 며칠 뒤 (span=days)
  moodAfter: string;
  learned: string[];   // 새로 알게 된 것 / 새로 생긴 오해
  memory: string;      // 기억으로 남길 한 줄
  pressure: PressureDelta[];
  proposal?: RootChangeProposal;
  check: CheckResult;
  tries: number;
  flaggedAwkward?: string; // 작가가 '어색하다'고 표시한 이유
  createdAt: number;
}

export interface Settings {
  mode: 'api' | 'manual'; // api: Claude API 직접 호출, manual: 복사 → 외부 AI → 붙여넣기 (작업실 방식)
  apiKey: string;         // 기기에만 저장
  model: string;
  threshold: number;      // 전환점이 열리는 압력
  extraRules: string[];   // 작가가 '어색하다'고 표시해서 쌓인 점검 규칙
}
