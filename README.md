# 타임라인 비주얼라이저 V1.3 (웹)

[mahlernim/google-timeline-visualizer](https://github.com/mahlernim/google-timeline-visualizer) Android 앱의 브라우저 이식 버전입니다. 아이폰에서 내보낸 `Timeline.json`을 이 컴퓨터에서 미리보고, 아이폰에서 바로 재생되는 MP4 영상과 전체 경로 PNG로 저장할 수 있습니다.

타임라인 파일은 서버로 올라가지 않습니다. 지도 타일만 CARTO(OpenStreetMap)에서 불러옵니다.

## 로컬에서 열기

브라우저 보안 때문에 `index.html`을 더블클릭하면 동작하지 않습니다. 아래 중 하나로 로컬 서버를 켜세요.

PowerShell:

```powershell
cd "C:\Users\EFRIKIA\Desktop\NCP 자격\timeline"
.\serve.ps1
```

또는 배치 파일 `start.bat`을 실행합니다.

접속 주소: [http://127.0.0.1:8765](http://127.0.0.1:8765)

## 사용 순서

1. 아이폰 Google 지도 → 프로필 → 설정 → 개인 콘텐츠 → 타임라인 데이터 내보내기
2. JSON 파일을 이 PC로 복사
3. **파일 선택** 또는 **샘플로 체험**
4. 기간과 재생 시간을 고른 뒤 **미리보기**
5. **영상 만들기**(MP4, 아이폰에서 바로 재생) 또는 **전체 경로 이미지**

원본 앱은 [MIT License](LICENSE)입니다. 파싱, 대권 보간, 카메라, 엔딩 줌은 원본 Kotlin/Python 로직을 웹으로 옮긴 것입니다.
