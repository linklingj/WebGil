# 테스트용 웹사이트

구조 추출(02)·트리 재구성(02-L) 검증에 쓰는 사이트 목록. 벤치가 이 파일을 직접 읽는다.

```
pnpm --filter @webgil/bench observe   # 규칙 기반 트리 관찰
pnpm --filter @webgil/bench refine    # 재구성 전/후 비교
```

## SSR — jsdom 벤치에서 트리가 나오는 페이지

- https://www.dataq.or.kr/www/main.do
- https://www.weather.go.kr/w/special-report/overall.do
- https://data.seoul.go.kr/together/guide/useGuide.do
- https://www.safetyreport.go.kr/#main
- https://www.safedriving.or.kr/diGuide/selectDiGuide10.do?menuCd=MN-PO-1215
- https://www.sejong.ac.kr/kor/intro/notice1.do
- https://nol.yanolja.com/
- https://flight.naver.com/
- https://huggingface.co/

## JS 렌더 — jsdom에서는 노드 0, 확장(실제 브라우저)으로만 확인 가능

jsdom은 스크립트를 실행하지 않아 빈 셸만 잡힌다. 벤치를 Playwright로 옮기기 전까지는
이 페이지들의 트리 품질을 숫자로 못 잰다. (`docs/01_SYSTEM/02_structure-extraction-review.md` §4.4)

- https://osscontest.kr/overview
- https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3
- https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&tmIdx=41&tm2lIdx=4103000000&tm3lIdx=4103010000
- https://www.musinsa.com/

## 특성별로 무엇을 보는가

| 페이지 | 보는 것 |
|---|---|
| 세종대 공지 | 링크 편중(1,100개↑) — 재구성 컨텍스트 한도를 넘는 경계 사례 |
| 기상청 특보 | 최상위가 chrome으로 채워지는 문제(02-R P1-E), "탐색" 반복 |
| 야놀자 · 무신사 | 헤딩 없는 카드/목록형 — 컨테이너 구조 소실(02-R P1-D) |
| 홈택스 | 공공 서비스 양식·절차 페이지(WebSquare), JS 렌더 |
| 허깅페이스 | 영문 + 헤딩 많은 문서형, 다국어 라벨 확인 |

## 최근 측정 (2026-08-18, `refine` 드라이런)

| 페이지 | 트리 노드 | 최상위 | 재구성 컨텍스트 |
|---|---|---|---|
| 세종대 공지 | 1,242 | 6 | 400노드 16.5k자 · **한도 초과 → 건너뜀** |
| 기상청 특보 | 262 | 14 | 262노드 14.0k자 |
| 허깅페이스 | 222 | 10 | 222노드 14.2k자 |
| 야놀자 | 221 | 6 | 221노드 10.8k자 |
| 서울열린데이터 | 233 | 3 | 233노드 11.6k자 |
| 안전운전 통합민원 | 216 | 6 | 216노드 11.3k자 |
| 네이버 항공권 | 102 | 6 | 102노드 4.6k자 |
| 안전신문고 | 72 | 4 | 72노드 3.4k자 |
| 데이터자격검정 | 60 | 3 | 60노드 2.7k자 |
| 오픈소스대회 · 홈택스×2 · 무신사 | 0 | 0 | JS 렌더 — jsdom 한계 |
