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

## 의존

- **상류**: 네비게이션(04), 문서 트리(03)의 텍스트.
- **셸**: 로컬 엔진 실행 방식은 셸마다 다름(데스크톱은 서브프로세스로 쉬움, 확장은 제약 있음 → 아래).

## 범위 / Phase

- Phase 2: 로컬 TTS + 음성 스타일 → 대회 MVP.
- Phase 5: API TTS 옵션.

## 미결정 / 리스크

- **확장(MV3)에서 로컬 엔진 실행 방식**: WASM(Piper wasm 등) vs 네이티브 메시징. 데스크톱(Phase 6)은 서브프로세스로 해결.
- 긴 텍스트의 스트리밍/청크 낭독 경계(첫 소리까지 지연 최소화).
