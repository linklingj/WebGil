# 05. TTS 엔진

> 텍스트 노드를 자연스러운 음성으로 낭독한다. **로컬/API 엔진을 인터페이스 하나로 교체**.

## 목적 / 책임

- 네비게이션(04)이 지목한 노드 텍스트를 음성으로 출력한다.
- **로컬·API 엔진을 플러그인처럼 교체**한다(프라이버시 vs 품질 선택권).
- 보이스/톤/속도 프리셋을 제공한다.
  - **낭독 속도**는 설정에서 느림(0.75×)·일반(1×)·빠름(1.5×)·매우 빠름(2×) 중 고른다. 스크린리더 사용자는 익숙해질수록 빠르게 듣는다. 상한을 2배로 둔 건 그 위에서 ElevenLabs 음성이 알아듣기 어려워지기 때문이다.
  - 값은 두 엔진에 그대로 전달된다(Web Speech `utterance.rate`, ElevenLabs `audio.playbackRate`). 낭독기 기본 옵션이라 페이지 낭독과 패널 안내가 같은 속도로 들린다.
- 낭독 큐·중단(interrupt)을 관리한다 — 다음 노드로 넘어가면 이전 낭독을 즉시 취소.

## 인터페이스 (설계 초안)

```ts
interface TTSEngine {
  speak(text: string, opts?: VoiceOpts): Promise<void>;
  stop(): void;                 // 즉시 중단 — 커서 이동 시 선점
  voices(): VoicePreset[];
}
interface VoiceOpts { voice?: string; rate?: number; pitch?: number; }
```

## 엔진 후보 (plan.md §5)

| 유형 | 후보 | 특징 |
|---|---|---|
| 로컬 | Piper(MIT), Kokoro(Apache-2.0), Coqui | CPU 실시간·오프라인·상업적으로 안전 |
| API | OpenAI TTS, ElevenLabs, Google/Azure | 최고 품질·저지연·스타일 |

## 핵심 설계

- **`stop()`이 필수** — 훑기 중 빠른 커서 이동에 낭독이 밀리지 않도록 취소·선점한다.
- 로컬 우선 모드는 민감 페이지 텍스트를 외부로 보내지 않는다(프라이버시).
- 엔진 선택은 설정에서, 코어는 `TTSEngine` 인터페이스만 의존한다.

## 1차 구현

- 코어에 `TTSEngine`·`VoiceOptions`·`VoicePreset`을 정의하고, `NarrationController`가 새 낭독 전 항상 `stop()`을 호출해 이전 낭독을 선점한다.
- `formatNarration()`은 노드 텍스트에 종류·문서 **계층 깊이**·같은 레벨 순서를 붙여 "소개, 제목, 계층 2, 2번 항목, 전체 3개"처럼 읽는다. 간단 낭독 모드에서는 텍스트만 읽는다.
- 실제 엔진에 보내기 직전 `normalizeKoreanNumberSpeech()`가 숫자 발음을 한자어 수사로 통일한다. 예를 들어 `7번 항목`은 `칠 번 항목`, `12,000원`은 `만 이천 원`으로 읽는다. 날짜·금액·퍼센트·소수와 전화번호·사업자번호 같은 하이픈 식별자를 처리하되 URL·이메일·버전 문자열은 변경하지 않는다. 화면 원문과 LLM 컨텍스트는 그대로 보존한다.
- 확장 MVP 구현체는 `WebSpeechEngine`이다. Chrome/OS의 Web Speech API를 사용하고, 한국어 음성 중 `localService` 음성을 우선 선택한다. 별도 모델 설치는 필요 없지만, 로컬 음성이 없을 때의 시스템 음성은 OS 제공자에 따라 원격일 수 있으므로 **외부 전송이 없음을 보장하지 않는다**. 강한 로컬·프라이버시 보장은 Piper/Kokoro 등 별도 로컬 엔진에서 제공한다.
- Chrome이 첫 `getVoices()` 호출에서 빈 목록을 줄 수 있으므로, 첫 낭독에만 최대 250ms 동안 `voiceschanged`를 기다린다. 그 뒤에도 목록이 비어 있으면 브라우저 기본 음성으로 폴백한다.
- ElevenLabs API 엔진은 `ElevenLabsSpeechEngine`으로 연결한다. API 키와 Voice ID는 확장 프로그램 설정에서만 입력하며, `chrome.storage.local`을 신뢰된 확장 컨텍스트로 제한해 Content Script와 웹페이지가 키를 읽지 못하게 한다. API 요청은 Background Service Worker가 처리하고 Content Script에는 재생용 오디오만 전달한다.
- ElevenLabs 설정이 없거나 API·오디오 재생에 실패하면 `WebSpeechEngine`으로 자동 폴백한다. 따라서 API 키 없이도 기본 내비게이션 낭독은 계속 사용할 수 있다.
- Piper/Kokoro 같은 로컬 신경망 엔진은 이후 동일한 `TTSEngine`으로 추가할 수 있다.
- 네비게이션(04)의 이동 결과는 확장 콘텐츠 스크립트에서 `NarrationController.announce()`로 연결되어 자동 낭독된다.

## 의존

- **상류**: 네비게이션(04), 문서 트리(03)의 텍스트.
- **셸**: 로컬 엔진 실행 방식은 셸마다 다름(데스크톱은 서브프로세스로 쉬움, 확장은 제약 있음 → 아래).

## 범위 / Phase

- Phase 2: 로컬 TTS + 음성 스타일 → 대회 MVP.
- Phase 5: ElevenLabs API TTS 옵션(구현), 로컬 신경망 엔진은 후속 단계.

## 미결정 / 리스크

- **확장(MV3)에서 로컬 엔진 실행 방식**: WASM(Piper wasm 등) vs 네이티브 메시징. 데스크톱(Phase 6)은 서브프로세스로 해결.
- 긴 텍스트의 스트리밍/청크 낭독 경계(첫 소리까지 지연 최소화).
- ElevenLabs 사용 시 읽을 텍스트가 외부 API에 전송된다. 민감 페이지에서는 API 음성을 저장하지 않거나 브라우저 기본 음성을 사용한다.
