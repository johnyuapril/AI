# 인물 엔진 (프로토타입)

사건을 겪는 인물이 "그 사람이라면 정말 그렇게 할 것 같은" 반응을 만드는 도구. 설계는 [인물 엔진 설계서](https://claude.ai/artifact/StfQFv8HQumQWCfLdAy9EL)를 따른다.
나중에 시나리오 작업실(`tablet-app`)과 코드를 합치려고 같은 기술(React 18 + TypeScript + Vite, IndexedDB 저장)로 만들었다.

## 실행
```
cd character-engine && npm ci
npm run dev     # 브라우저에서 확인 (휴대폰에서도 같은 와이파이로 열 수 있음)
npm test        # AI 없이 엔진 계산 시험
npm run build   # dist/ 에 웹앱
```

## 구조
- `src/engine/` : 화면과 상관없는 엔진. 작업실 `tablet-app/src` 로 그대로 옮길 수 있게 React를 쓰지 않는다.
  - `types.ts` 인물(뿌리 + 현재 상태 + 변화 압력 + 아크), 배경, 사건, 반응
  - `prompts.ts` 원칙, 반응 생성 흐름(인지 → 감정 → 판단 → 행동과 말), 작위성 점검 규칙, 성격 변화 안내, JSON 스키마
  - `change.ts` 성격 변화 계산: 압력 쌓기(사건 하나 최대 3), 균열(문턱 절반), 전환점(문턱 + 결정적 사건, 또는 문턱 1.5배), 승인하면 뿌리 바꾸고 아크에 기록
  - `pipeline.ts` 사건 돌리기: 인물마다 반응 → 검수 → 걸리면 한 번 다시 → 상태와 압력 반영. 뒤 인물은 앞 인물의 행동과 말만 본다(속마음은 모름)
  - `ai.ts` Claude API 호출(구조화된 출력, 거절 시 서버 쪽 대체 모델), 붙여넣은 답에서 JSON 꺼내기
- `src/store.ts` 저장(idb-keyval), `src/importer.ts` 작업실 .sbk 에서 인물 가져오기
- 화면: `App.tsx`(탭, 배경, 설정), `CharactersTab.tsx`, `EventsTab.tsx`, `ReactionCard.tsx`

## AI 쓰는 방식 (설정 탭)
- 복사 → 붙여넣기 (기본): 작업실처럼 요청을 복사해 외부 AI에 붙여넣고 답을 붙여넣는다. 요금 없음. 반응과 자체 점검을 한 번에 받는다.
- Claude API: 설정에 넣은 사용자 자신의 API 키로 기기에서 바로 부른다(키는 기기에만 저장). 반응 → 별도 검수 → 고치기를 자동으로 한다.
  개인용이라 브라우저에서 키를 쓴다(`dangerouslyAllowBrowser`). 배포용으로 바꿀 때는 서버를 두고 키를 서버로 옮겨야 한다.

## 윈도우 설치 파일 (.exe)
- `desktop/` : Electron 껍데기. 웹앱(`dist`)을 `app://local/` 주소로 띄운다(저장 위치가 이 주소에 묶이니 바꾸지 말 것). 작업실 `tablet-app/desktop` 과 같은 방식.
- `.github/workflows/character-engine.yml` 이 `character-engine/` 이 바뀐 push(main, character-engine 브랜치)마다 .exe 를 만들어 릴리스 `ce-v1.0.<번호>` 로 올린다. 작업실 업데이트가 latest 릴리스를 보므로 인물 엔진 릴리스는 latest 로 표시하지 않는다.
- 업데이트: 앱을 켜면 `ce-v` 릴리스 중 가장 큰 번호를 확인해서 위쪽에 "업데이트 v…" 버튼을 띄운다. 누르면 설치 파일을 받아 실행하고 앱을 닫는다(한 번 클릭 설치, 끝나면 다시 켜짐). 설정 탭에서 다시 확인할 수 있다.
- 리눅스에서 시험: `npm run build && cd desktop && npm ci && npm start`
