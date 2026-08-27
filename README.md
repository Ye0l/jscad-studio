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

## 자동 빌드

`main` 에 커밋하면 GitHub Actions 가 두 가지를 만듭니다.

| 워크플로 | 결과물 |
| --- | --- |
| `.github/workflows/android.yml` | ARM64 설치 APK — 실행 페이지의 `jscad-studio-arm64-apk` 아티팩트 |
| `.github/workflows/pages.yml` | 웹앱 — GitHub Pages 배포 |

Pages 는 저장소 **Settings → Pages → Source** 를 `GitHub Actions` 로 한 번 바꿔 두어야 동작합니다.

APK 는 기본적으로 그 실행에서만 쓰는 임시 키로 서명하므로 설치는 되지만 이전 빌드 위에 덮어쓸 수 없습니다. 고정 키로 서명하려면 키스토어를 한 번 만들어

```bash
keytool -genkeypair -keystore release.jks -alias jscad-studio \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.jks   # 출력값을 ANDROID_KEYSTORE_BASE64 시크릿에 넣는다
```

저장소 시크릿에 `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` 를 등록하면 됩니다.

프로젝트는 Android 앱 전용 `AppLocalData/jscad-studio/projects` 아래에 저장됩니다. 외부 저장소 권한을 요구하지 않습니다.

## 웹 앱

브라우저에서는 [JSCAD Studio Web](https://ye0l.github.io/jscad-studio/)으로 바로 쓸 수 있습니다. `main` 에 커밋하면 GitHub Actions 가 빌드해 GitHub Pages 로 배포합니다. 프로젝트는 해당 브라우저 프로필의 로컬 저장소(`localStorage`)에 보관되며, 앱 설치나 오프라인 캐시는 아직 지원하지 않습니다.

## 라이선스

이 저장소 자체의 라이선스는 아직 정하지 않았습니다.

앱에는 오픈소스 소프트웨어가 포함되어 있으며, 저작권자와 라이선스 원문은 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) 에 그대로 실려 있습니다. 앱 안에서는 **설정 → 오픈소스 라이선스** 에서 같은 내용을 볼 수 있습니다. 주요 구성 요소는 다음과 같습니다.

- [JSCAD](https://github.com/jscad/OpenJSCAD.org) (`@jscad/modeling`, `@jscad/regl-renderer`) — MIT, © 2017-2024 JSCAD Organization
- [CodeMirror 6](https://github.com/codemirror) — MIT
- [React](https://github.com/facebook/react) — MIT, © Meta Platforms, Inc.
- [Tauri](https://github.com/tauri-apps/tauri) — MIT 또는 Apache-2.0
- [regl](https://github.com/regl-project/regl) — MIT · [Lucide](https://github.com/lucide-icons/lucide) — ISC

고지 파일은 실제 설치된 의존성에서 자동으로 만듭니다. 의존성을 바꾼 뒤에는 다시 생성해 주세요.

```bash
npm run notices
```
