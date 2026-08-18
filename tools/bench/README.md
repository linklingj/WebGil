# @webgil/bench

`CaptureSource`의 개발/벤치 구현 `PlaywrightSource` (헤드리스). 제품 셸이 아님.

- 세션 없이 코퍼스(여러 사이트)에 대해 구조 추출 트리 품질을 배치 검증
- 결과: 트리 JSON + 주석 스크린샷 + 품질 지표 리포트

## 관찰 runner (지금 있는 것)

```sh
pnpm --filter @webgil/bench observe            # 사이트 목록 전체
pnpm --filter @webgil/bench observe <url> ...  # 특정 URL만
```

각 URL의 HTML을 가져와 jsdom에 세우고 구조 추출 엔진(02)을 돌려 트리 요약(노드 수·최상위·깊이·개요)을 찍는다.
사이트 목록은 [`docs/03_RESEARCH/test_sites.md`](../../docs/03_RESEARCH/test_sites.md) 하나를 읽는다.

## 트리 재구성 runner (02-L)

```sh
pnpm --filter @webgil/bench refine             # 규칙 트리 vs LLM 재구성 트리
pnpm --filter @webgil/bench refine <url> ...
```

`.env`(루트, `.env.example` 참고)에 제공자·모델·API 키가 있으면 실제 LLM을 호출하고,
없으면 **드라이런** — 각 페이지가 재구성 컨텍스트 한도 안에 들어오는지만 잰다.
한도를 넘으면 `refineTree`가 원본을 그대로 쓰므로, 그 숫자가 곧 "이 사이트에서 기능이 도느냐"다.
**주의:** jsdom은 JS를 실행하지 않아 SSR 페이지만 실제 트리가 나온다. JS 렌더 SPA는 얇은 셸(노드 0)만 잡히므로
렌더 경로(확장을 실제 브라우저에 로드하거나 향후 `PlaywrightSource`)로 확인해야 한다. `observe.ts`는 렌더된 페이지에
주입할 브라우저 훅.

참고: [`docs/00_PLAN/plan.md`](../../docs/00_PLAN/plan.md) §4.1, §8
