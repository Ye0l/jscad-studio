# JSCAD Studio

Lenovo Xiaoxin Pad Pro GT 같은 Android 태블릿과 물리 키보드를 우선한 Tauri 2 기반 JSCAD 편집기입니다.

## 포함 기능

- 앱 내부 저장소의 `.jscad` 프로젝트 생성, 검색, 이름 변경, 삭제, 자동 저장
- CodeMirror 기반 JavaScript 편집기와 JSCAD 실시간 3D 미리보기
- 터치 회전, 두 손가락 이동/확대, 마우스·트랙패드 조작
- 다크 테마와 태블릿 가로/세로 반응형 레이아웃
- 상단바 **보기** 메뉴에서 패널을 열고 닫기 (실수로 닫은 탭도 여기서 되살림)
- VS Code 식 도크 레이아웃: 탭을 끌어 좌·우·상·하 어디로든 배치하고, 다른 그룹에 겹쳐 탭으로 합치고, 각 탭을 닫을 수 있음. 경계를 끌어 크기 조절, 배치는 설정에 저장됨
- 프로젝트를 우클릭(태블릿은 길게 누르기)해 코드·미리보기를 원하는 곳에 열기. 여러 프로젝트를 동시에 열어 편집기와 미리보기를 나란히 볼 수 있음
- 앱 내부 모달·토스트 UI (브라우저 `prompt`/`alert` 미사용)
- 설정에서 끌 수 있는 모션/전환, 자동 실행, 자동 저장, UI 배율, 글자 크기
- 3D 회전·확대 감도 조절과 태블릿용 저감도 기본값
- 미리보기에 치수 표시 — 경계 상자와 X·Y·Z 실제 길이(mm)를 모델 위에 겹쳐 표시
- 이미지로 렌더 (`Ctrl R`) — 보고 있는 각도 그대로 크게 그린 뒤 줄여서 PNG 로 저장. 배경(어두움·밝음·투명)과 격자 포함 여부 선택
- GitHub 저장소 한 곳에 프로젝트 보관·동기화 (토큰 + `사용자명/저장소명`)
- STL·3MF 내보내기 (`Ctrl E`) — 내보내기 전에 모델 크기(mm)와 부피(cm³)를 먼저 확인. 안드로이드·데스크톱에서는 시스템 저장 창이 열리고, 브라우저에서는 바로 내려받는다
- 도형 팔레트: 사이드바 `도형` 탭에서 탭하면 커서 자리에, 편집기로 끌어다 놓으면 그 자리에 코드가 들어가고 필요한 `require` 는 자동으로 채워짐
- JSCAD API 자동완성(`Ctrl Space`)과 매개변수 설명 툴팁 — 함수 이름에 올리거나 괄호 안에 커서를 두면 표시
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
| 내보내기 | `Ctrl E` |
| 이미지로 렌더 | `Ctrl R` |
| 자동완성 열기 | `Ctrl Space` |

## 개발 및 Android 빌드

```bash
npm install
npm run dev

# Rust, Android SDK/NDK 설정 후 최초 1회
npm run android:init

# 샤오신패드용 ARM64 설치 APK
npm run android:build -- --target aarch64
```

## GitHub 연동

프로젝트를 GitHub 저장소 하나에 보관하고, 같은 저장소를 다른 기기에서 그대로 이어 쓸 수 있습니다. 상단바의 구름 아이콘이나 **설정 → GitHub 연동**에서 엽니다.

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** 에서 토큰을 만듭니다. 저장소는 보관용 하나만 고르고, 권한은 **Contents: Read and write** 하나면 됩니다.
2. 앱에 토큰과 `사용자명/저장소명` 을 넣고 연결 확인을 누릅니다. 브랜치와 폴더는 기본값이 `main` 과 `projects` 입니다.
3. **비교** 를 누르면 이 기기와 저장소의 차이를 보여 줍니다. 항목별로 또는 한 번에 올리고 내려받을 수 있습니다.

저장소에는 프로젝트마다 `.jscad` 파일 하나와, 파일과 프로젝트를 이어 주는 `jscad-studio.json` 목록이 들어갑니다. 다른 기기에서는 같은 토큰과 저장소 이름만 넣고 **비교 → 모두 내려받기** 하면 그대로 따라옵니다. 이름을 바꿔도 목록이 같은 프로젝트로 알아봅니다.

내용 비교는 git 이 쓰는 blob 해시로 하기 때문에, 달라진 파일만 실제로 주고받습니다. 다만 자동 병합은 하지 않습니다 — 같은 프로젝트를 두 기기에서 동시에 고쳤다면 어느 쪽을 남길지 직접 고르게 합니다.

토큰은 프로젝트 목록과 같은 곳(안드로이드는 앱 전용 저장소, 브라우저는 그 프로필의 로컬 저장소)에 저장되고 `api.github.com` 외에는 보내지 않습니다. 연동 창의 **연결 끊기** 로 지울 수 있습니다.

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
