# APK 고정 서명 키 넣기 (한 번만, 태블릿에서 가능)

키가 없으면 빌드할 때마다 임시 키로 서명돼서 새 버전을 덮어 설치할 수 없다.
아래를 한 번 해 두면 그다음 버전부터는 덮어 설치되고, 앱 안 "업데이트" 버튼도 동작한다.

## 태블릿 브라우저로 하기
1. 비밀번호 정하기: **16글자 이상**, 영문·숫자·기호를 섞어서. 잃어버리지 않게 따로 적어 둔다.
2. GitHub → AI 저장소 → Settings → Secrets and variables → Actions → **New repository secret**
   - Name: `ANDROID_KEYSTORE_PASSWORD`
   - Secret: 1번 비밀번호
3. Actions 탭 → 왼쪽에서 **서명 키 만들기 (한 번만)** → **Run workflow** → Run workflow
4. 1~2분 뒤 끝나면 "안드로이드 APK 만들기"가 저절로 돌아서 고정 키로 서명된 새 APK가 Releases에 올라온다.
5. 태블릿에서: 앱 안의 "전체 백업" → 앱 삭제 → 새 APK 설치 → "백업 불러오기". (임시 키 → 고정 키로 바꿀 때 딱 한 번만)

## 어떻게 보관되나
- 키 파일은 2번 비밀번호로 암호화된 `tablet-app/android/app/release.jks.enc`로만 저장소에 들어간다. 저장소가 공개라서 비밀번호가 짧으면 위험하므로 16글자 이상만 받는다.
- 빌드할 때 GitHub Actions가 비밀값으로 풀어서 서명한다.
- 비밀번호를 잃어버리거나 바꾸면 키를 새로 만들어야 하고, 그러면 앱을 지웠다 다시 깔아야 한다. (새로 만들려면 release.jks.enc 를 지운 뒤 3번부터)

## (다른 방법) PC에서 직접 만든 키 쓰기
`ANDROID_KEYSTORE_BASE64`(키 파일 base64)와 `ANDROID_KEYSTORE_PASSWORD`를 비밀값으로 넣으면 그 키를 먼저 쓴다. 별칭(alias)은 `screenwriter`.
