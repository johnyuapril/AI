# 시나리오 작업실 (갤럭시 탭용 안드로이드 앱 + 윈도우용 앱)

## 꼭 지킬 규칙 (어느 계정의 Claude든 동일)
1. **작업이 하나 끝날 때마다 바로 커밋하고 GitHub(johnyuapril/AI)에 push한다.** 오래 걸리는 작업은 중간에도 커밋해서 올린다. 로컬에만 남겨 두지 않는다.
2. push할 때마다 `docs/HANDOFF.md`를 갱신한다: 지금 상태, 이번에 바꾼 것, 다음에 할 일, 알려진 문제.
3. 사용자에게는 한국어로, 쉬운 말로 답한다.
4. main에 push하면 GitHub Actions가 APK와 윈도우 설치 파일을 만들어 Releases에 올린다. 빌드가 실패하면 고친다.

## 구조
- `tablet-app/` : Vite + React + TypeScript, Capacitor 6으로 만든 안드로이드 앱
  - `src/script.ts` 대본 파싱과 컷 나누기 규칙, `src/importer.ts` PDF/HWP/HWPX/DOCX/TXT/Fountain 불러오기
  - `src/prompts.ts` 외부 AI(ChatGPT 등)에 붙여 넣을 문구, `src/store.ts` 저장(IndexedDB)
  - 탭: 대본(ScriptTab) → 신 리스트(SceneListTab) → 장면 묘사(DescribeTab) → 그림(PromptTab) → 스토리보드(StoryboardTab) → 분석(AnalysisTab)
- `tablet-app/android/` : Capacitor 안드로이드 프로젝트
- `tablet-app/desktop/` : 윈도우용(Electron). 같은 화면(`tablet-app/dist`)을 그대로 띄운다. `main.cjs`(파일 저장, AI 옆 창, 업데이트), `preload.cjs`(`window.desktop`)
- **두 플랫폼은 화면 코드(`src/`)를 함께 쓴다.** 기능은 `src/`에 한 번만 만든다. 플랫폼마다 다른 일(파일 저장, 공유, AI 열기, 업데이트, 구글 전송)은 `src/native.ts`(`isNative()`=안드로이드, `isDesktop()`=윈도우)에서만 나눈다.
- `.github/workflows/android.yml` : APK와 윈도우 설치 파일(.exe) 빌드, 한 릴리스에 함께 올림. 파일 이름을 바꾸면 빌드 번호가 다시 1부터라 업데이트가 깨지니 바꾸지 말 것
- 서명 키는 저장소에 올리지 않는다. GitHub Actions 비밀값 `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`로 CI에서 넣는다. 같은 키로 서명해야 업데이트가 덮어 설치된다. 키를 바꾸면 앱을 지우고 다시 깔아야 한다.

## 개발
```
cd tablet-app && npm ci
npm run dev                              # 브라우저에서 확인
npm run build && npx cap sync android    # 안드로이드에 반영
npm run build && cd desktop && npm ci && npm start   # 윈도우용 실행 (리눅스에서도 뜸)
```
AI는 앱 안에서 부르지 않는다. 모두 "복사 → 외부 AI에 붙여넣기 → 답 붙여넣기" 방식이다.
