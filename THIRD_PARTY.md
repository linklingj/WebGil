# 제3자 오픈소스 고지 (Third-Party Notices)

WebGil은 [MIT License](LICENSE)로 배포된다. 아래는 WebGil이 직접 가져다 쓴 외부 오픈소스 목록이다.
전체 목록은 `package.json`(각 워크스페이스)과 `pnpm-lock.yaml`에서 확인할 수 있으며, 이 문서는 직접 의존성만 정리한 것이다.

버전은 `pnpm-lock.yaml` 기준 실제 설치 버전이다.

| # | 라이브러리 | 버전 | 라이선스 | 공식 저장소 | 사용 목적 및 결합 방식 |
|---|---|---|---|---|---|
| 1 | d3-hierarchy | 3.1.2 | ISC | https://github.com/d3/d3-hierarchy | 문서 구조 트리의 계층 레이아웃(노드 좌표) 계산 / 라이브러리로 불러 씀 |
| 2 | d3-zoom | 3.0.0 | ISC | https://github.com/d3/d3-zoom | 트리 뷰 화면 이동·확대/축소 카메라 제어 / 라이브러리로 불러 씀 |
| 3 | d3-selection | 3.0.0 | ISC | https://github.com/d3/d3-selection | d3-zoom 동작을 사이드패널 DOM에 연결 / 라이브러리로 불러 씀 |
| 4 | esbuild | 0.24.2 | MIT | https://github.com/evanw/esbuild | Chrome 확장(content·background·panel) 번들 빌드 / 빌드 스크립트에서 API로 호출 |
| 5 | TypeScript | 5.9.3 | Apache-2.0 | https://github.com/microsoft/TypeScript | 전체 소스 타입 검사 및 컴파일 / 빌드 도구로 실행 |
| 6 | tsx | 4.23.1 | MIT | https://github.com/privatenumber/tsx | TypeScript 테스트·벤치 스크립트 실행 로더 / 실행 도구로 사용 |
| 7 | jsdom | 25.0.1 | MIT | https://github.com/jsdom/jsdom | 단위 테스트·구조추출 벤치 하니스의 가상 DOM 환경 / 라이브러리로 불러 씀 |
| 8 | pnpm | 9.15.9 | MIT | https://github.com/pnpm/pnpm | 모노레포 워크스페이스 의존성 관리 및 빌드·테스트 오케스트레이션 / 패키지 매니저로 실행 |
| 9 | Node.js | 20 (CI 기준) | MIT | https://github.com/nodejs/node | 확장 빌드·테스트·벤치 실행 런타임 / 실행 환경 |
| 10 | @types/node, @types/jsdom, @types/d3-hierarchy, @types/d3-selection, @types/d3-zoom (DefinitelyTyped) | 22.20.1 등 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped | node·jsdom·d3 타입 정의 제공(빌드 타임 전용) / 타입 선언으로 불러 씀 |

런타임에 번들되는 것은 1~3(d3)뿐이며, 4~10은 빌드·테스트 도구다.

## 벤더링·복사 코드

없음. `lib/`, `vendor/`, `third_party/` 폴더나 외부에서 복사해 붙여 넣은 소스코드가 없고,
CDN으로 불러오는 스크립트·폰트도 사용하지 않는다.

## AI 모델 및 외부 API

모델 가중치를 저장소에 포함하거나 배포하지 않는다. 파인튜닝·자체 학습도 수행하지 않았다.

| 대상 | 성격 | 라이선스 / 약관 |
|---|---|---|
| Ollama로 구동하는 오픈웨이트 모델 (Llama 3.2, Qwen2.5 등) | 사용자가 자신의 기기에 설치한 모델을 `localhost:11434`로 호출 | 각 모델의 라이선스 (Llama 3.2 Community License, Apache-2.0 등) |
| Ollama 런타임 | 사용자가 별도 설치. 저장소에 포함하지 않음 | MIT |
| OpenAI · Google Gemini · Anthropic Claude API | 사용자가 본인 API 키를 입력한 경우에만 동작하는 선택 경로 | 각 사업자 API 이용약관 |
| ElevenLabs (Multilingual v2) | 선택적 음성 합성. 미설정·실패 시 브라우저 내장 Web Speech API로 폴백 | ElevenLabs 이용약관 |

상용 API 없이도 로컬 Ollama 경로만으로 동일한 자연어 명령·트리 재구성이 동작하며,
구조 추출·계층 탐색·검색·음성 낭독 등 핵심 기능은 AI 모델 없이도 전부 동작한다.

## 개발 보조 도구

설계·아키텍처 결정과 코드 리뷰는 팀원이 직접 수행하였으며, 구현 코드 작성 및 디버깅 보조 목적으로
Claude Code(Claude)를 활용하였다.

---

문의: 이 목록에 누락이나 오류가 있다면 이슈로 알려 주세요.
