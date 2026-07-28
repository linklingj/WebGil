# 05. TTS 엔진

> 텍스트 노드를 자연스러운 음성으로 낭독한다. **로컬/API 엔진을 인터페이스 하나로 교체**.

## 목적 / 책임

- 네비게이션(04)이 지목한 노드 텍스트를 음성으로 출력한다.
- **로컬·API 엔진을 플러그인처럼 교체**한다(프라이버시 vs 품질 선택권).
- 보이스/톤/속도 프리셋을 제공한다.
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
- 확장 MVP 구현체는 `WebSpeechEngine`이다. Chrome/OS의 Web Speech API를 사용하고, 한국어 음성 중 `localService` 음성을 우선 선택한다. 별도 모델 설치는 필요 없지만, 로컬 음성이 없을 때의 시스템 음성은 OS 제공자에 따라 원격일 수 있으므로 **외부 전송이 없음을 보장하지 않는다**. 강한 로컬·프라이버시 보장은 Piper/Kokoro 등 별도 로컬 엔진에서 제공한다.
- Chrome이 첫 `getVoices()` 호출에서 빈 목록을 줄 수 있으므로, 첫 낭독에만 최대 250ms 동안 `voiceschanged`를 기다린다. 그 뒤에도 목록이 비어 있으면 브라우저 기본 음성으로 폴백한다.
- Piper/Kokoro 같은 로컬 신경망 엔진과 API 엔진은 이후 동일한 `TTSEngine`으로 교체한다. 네비게이션(04) 브랜치가 병합된 뒤 이동 결과를 `NarrationController.announce()`에 연결한다.

## 의존

- **상류**: 네비게이션(04), 문서 트리(03)의 텍스트.
- **셸**: 로컬 엔진 실행 방식은 셸마다 다름(데스크톱은 서브프로세스로 쉬움, 확장은 제약 있음 → 아래).

## 범위 / Phase

- Phase 2: 로컬 TTS + 음성 스타일 → 대회 MVP.
- Phase 5: API TTS 옵션.

## 미결정 / 리스크

- **확장(MV3)에서 로컬 엔진 실행 방식**: WASM(Piper wasm 등) vs 네이티브 메시징. 데스크톱(Phase 6)은 서브프로세스로 해결.
- 긴 텍스트의 스트리밍/청크 낭독 경계(첫 소리까지 지연 최소화).
