# JSCAD Studio

Lenovo Xiaoxin Pad Pro GT 같은 Android 태블릿과 물리 키보드를 우선한 Tauri 2 기반 JSCAD 편집기입니다.

## 포함 기능

- 앱 내부 저장소의 `.jscad` 프로젝트 생성, 검색, 이름 변경, 삭제, 자동 저장
- CodeMirror 기반 JavaScript 편집기와 JSCAD 실시간 3D 미리보기
- 터치 회전, 두 손가락 이동/확대, 마우스·트랙패드 조작
- 다크 테마와 태블릿 가로/세로 반응형 레이아웃
- 앱 내부 모달·토스트 UI (브라우저 `prompt`/`alert` 미사용)
- 설정에서 끌 수 있는 모션/전환, 자동 실행, 자동 저장, UI 배율, 글자 크기
- 3D 회전·확대 감도 조절과 태블릿용 저감도 기본값
- 키캡과 60% 키보드 보강판 시작 템플릿

## 키보드 단축키

| 동작 | 단축키 |
| --- | --- |
| 실행 | `Ctrl+Enter` |
| 저장 | `Ctrl+S` |
| 새 프로젝트 | `Ctrl+N` |
| 프로젝트 검색 | `Ctrl+P` |
| 프로젝트 패널 | `Ctrl+B` |
| 출력 패널 | `Ctrl+J` |
| 설정 | `Ctrl+,` |
| 단축키 도움말 | `F1` |

## 개발 및 Android 빌드

```bash
npm install
npm run dev

# Rust, Android SDK/NDK 설정 후 최초 1회
npm run android:init

# 샤오신패드용 ARM64 설치 APK
npm run android:build -- --target aarch64
```

프로젝트는 Android 앱 전용 `AppLocalData/jscad-studio/projects` 아래에 저장됩니다. 외부 저장소 권한을 요구하지 않습니다.

## 웹 앱

데스크톱 브라우저용 PWA는 [JSCAD Studio Web](https://jscad-studio-web.ye0l.chatgpt.site)에서 사용할 수 있습니다. 프로젝트는 해당 브라우저 프로필의 로컬 저장소에 보관되며, 첫 접속 후 설치하거나 오프라인으로 다시 열 수 있습니다.
