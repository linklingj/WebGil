# @webgil/bench

`CaptureSource`의 개발/벤치 구현 `PlaywrightSource` (헤드리스). 제품 셸이 아님.

- 세션 없이 코퍼스(여러 사이트)에 대해 구조 추출 트리 품질을 배치 검증
- 결과: 트리 JSON + 주석 스크린샷 + 품질 지표 리포트

## 관찰 runner (지금 있는 것)

```sh
pnpm --filter @webgil/bench observe            # test-sites.md의 URL 전체
pnpm --filter @webgil/bench observe <url> ...  # 특정 URL만
```

각 URL의 HTML을 가져와 jsdom에 세우고 구조 추출 엔진(02)을 돌려 트리 요약(노드 수·최상위·깊이·개요)을 찍는다.
**주의:** jsdom은 JS를 실행하지 않아 SSR 페이지만 실제 트리가 나온다. JS 렌더 SPA는 얇은 셸(노드 0)만 잡히므로
렌더 경로(확장을 실제 브라우저에 로드하거나 향후 `PlaywrightSource`)로 확인해야 한다. `observe.ts`는 렌더된 페이지에
주입할 브라우저 훅.

참고: [`docs/00_PLAN/plan.md`](../../docs/00_PLAN/plan.md) §4.1, §8
