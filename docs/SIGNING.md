# APK 고정 서명 키 넣기 (PC에서 한 번만)

지금은 키가 없어서 빌드할 때마다 임시 키로 서명된다. 그래서 새 버전을 덮어 설치할 수 없다.
아래를 한 번 해 두면 그다음 버전부터는 덮어 설치된다.

1. PC에서 키 만들기 (Java가 깔려 있으면 됨. 비밀번호는 직접 정하기)
   ```
   keytool -genkeypair -keystore release.jks -alias screenwriter -keyalg RSA -keysize 2048 -validity 36500
   ```
2. 키 파일을 글자로 바꾸기
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.jks")) | Set-Clipboard`
   - Mac/Linux: `base64 -w0 release.jks` (Mac은 `base64 -i release.jks`)
3. GitHub → AI2 저장소 → Settings → Secrets and variables → Actions → New repository secret
   - `ANDROID_KEYSTORE_BASE64` : 2번에서 복사한 글자
   - `ANDROID_KEYSTORE_PASSWORD` : 1번에서 정한 비밀번호
4. Actions 탭에서 "안드로이드 APK 만들기"를 다시 실행한다.
5. 태블릿에서 앱 안의 "전체 백업" → 앱 삭제 → 새 APK 설치 → "백업 불러오기". (임시 키 → 고정 키로 바꿀 때 딱 한 번만)

release.jks 파일과 비밀번호는 잃어버리지 않게 따로 보관한다. 잃어버리면 다시 1번부터 하고 앱을 지웠다 깔아야 한다.
