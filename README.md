# 한약 드실게요 — PWA

한의원에서 QR로 전달하는 복약 알림 웹앱. Android 앱 v1.0.2의 동작을 웹으로 옮겼습니다.
가입·서버·분석·광고 없음. 모든 데이터는 환자 기기의 브라우저 저장소에만 저장됩니다.

> ⚠️ **시험용 버전**: 서버가 없어서 **앱이 열려 있을 때만** 정시 알림이 옵니다. 자세한 내용은 [REPORT.md](REPORT.md)를 보세요.

© 2026 Socra × Tess

## 파일

| 파일 | 역할 | APK 대응 |
|---|---|---|
| `index.html` | 화면 (첫 화면 / 시작하기 / 설정 / 복용 / 최종 / 진단) | 레이아웃 xml |
| `app.js` | 저장·일정 계산·알림·영상·화면 흐름 | Store, Scheduler, Notifier, 각 Activity |
| `sw.js` | 오프라인 캐시, 알림 터치 처리, (미사용) Web Push 수신 | AlarmReceiver 일부 |
| `manifest.webmanifest`, `icons/` | 홈 화면 설치 정보와 아이콘 (APK 아이콘과 같은 모양) | 런처 아이콘 |
| `media/hanyak_intro.mp4` | 5초 약사발 영상 + 여성 음성 (APK와 같은 파일, H.264/AAC) | res/raw |
| `tools/make_qr.py` | 한의원별 QR 생성 | — |
| `REPORT.md` / `DEVICE_TEST.md` | 기술 검증 보고서 / 실기기 테스트 절차 | — |

## 배포 (GitHub Pages)
1. 이 폴더를 공개 저장소(예: `hanyak-drink-pwa`)에 올립니다.
2. 저장소 Settings → Pages → Branch `main` / `/ (root)` → Save
3. 1~2분 뒤 `https://<계정>.github.io/hanyak-drink-pwa/` 에 접속합니다 (HTTPS 자동 적용).
4. 업데이트할 때는 `sw.js`의 `CACHE` 이름과 `app.js`의 `APP_VERSION`을 올려야 환자 기기에서 새 버전으로 바뀝니다.

## QR 만들기
```
python3 tools/make_qr.py https://<계정>.github.io/hanyak-drink-pwa/ 행복한의원 063-123-4567 qr-행복한의원.png
```
한의원명과 전화번호를 넣으면, 환자가 QR로 처음 접속할 때 자동으로 입력됩니다. 생성한 뒤 디코딩 검사도 함께 실행됩니다.

## 홈 화면 설치 안내 (환자용)
1. 휴대폰 카메라로 QR을 찍어 접속합니다.
2. 홈 화면에 설치합니다.
   - **삼성 인터넷**: 아래쪽 ≡ 메뉴 → 현재 페이지 추가 → 홈 화면
   - **Chrome**: 오른쪽 위 ⋮ → 홈 화면에 추가 (또는 앱 설치)
   - **iPhone**: Safari 공유 버튼 → 홈 화면에 추가
3. 이후에는 홈 화면의 **‘한약 드실게요’ 아이콘**으로 엽니다.
4. 복용 일정을 저장하고, “알림을 허용할까요?”에서 **허용**을 누릅니다.
5. 설정 → **테스트 알림 보내기**로 알림이 오는지 확인합니다.

같은 안내가 앱의 **시작하기** 화면에도 들어 있습니다.

## 로컬 실행
```
python3 -m http.server 8080   # http://localhost:8080 (서비스 워커는 localhost 또는 HTTPS에서만 동작)
```
