# 02-L. 구조 추출 — LLM 트리 재구성 계획

> 목표: 규칙 기반(02)이 만든 문서 트리를 입력으로 받아, **사용자가 화면을 보면 인지할 구조에 가깝게** LLM으로 재정리한다. 불필요한 노드 제거 + 같은 레벨끼리 재배치.
> 기준 코드: `packages/core/src/structure.ts`, `packages/core/src/tree.ts`, `packages/core/src/llm-command.ts`, `packages/core/src/llm-provider.ts`, `apps/extension/src/content.ts`.
> plan.md §3.1 "구조 복원 … 선택적으로 LLM 보정", §6 Phase 3 "휴리스틱 + LLM 보정, 노이즈 제거"의 구체화.

## 1. 왜 필요한가

[`02_structure-extraction-review.md`](02_structure-extraction-review.md)가 실측으로 진단한 문제 중 이 기능이 직접 겨냥하는 것:

| 진단 | 증상 |
|---|---|
| P1-C 평평한 버킷 | "링크 294개"를 한 그룹으로 묶어 탐색 비용이 그대로 |
| P1-D 컨테이너 소실 | 카드(이미지+제목+가격) 구조가 흩어져 어느 값이 어느 항목인지 트리만으론 모름 |
| P1-E chrome이 최상위 | 헤더·내비가 항상 먼저, 본문은 뒤로 밀림 |
| P2-F dedupe 오판 | 텍스트만 같고 대상이 다른 노드를 잘못 지움 |

02-R의 B안(DOM 재귀 재작성)은 엔진을 바꿔서 같은 문제를 푼다. 이 문서는 **엔진은 그대로 두고, 규칙 기반 트리 위에 얹는 후처리 LLM 패스**로 같은 효과를 노린다 — B안보다 구현 비용이 작고, 이미 있는 LLM 연동(06)을 그대로 재사용할 수 있어 대회 일정에 맞다. B안을 대체하진 않지만, 먼저 시도해서 필요성을 재평가할 수 있다.

## 2. 핵심 제약 — DOM 핸들 보존

트리 노드의 `handle`은 액션 실행기(07)가 클릭·입력을 실행하는 유일한 통로다(`docs/01_SYSTEM/03_document-tree.md`). LLM이 텍스트를 새로 창작하거나 노드를 통째로 재작성하면 핸들이 끊긴다.

**따라서 LLM의 역할은 "재배치"이지 "재작성"이 아니다.**

- 기존 leaf 노드(heading/text/link/button/input)는 **id로만 참조**한다. text·kind·handle은 항상 원본 트리에서 그대로 가져온다.
- LLM이 새로 만들 수 있는 건 **group 노드뿐**(`docs/03`이 이미 "group은 명시 노드, handle 없음"으로 정의해 둔 것과 정확히 일치). group의 `text`(라벨)만 LLM이 짓는다.
- 이 원칙은 06 LLM 명령 엔진이 이미 쓰는 신뢰 모델과 동일하다 — `llm-command.ts`의 `validateCommand`가 "모델은 노드 id만 지목, 실행은 결정론적 코드가 검증 후 수행"하는 것과 같은 패턴을 트리 재구성에도 적용한다.

## 3. 파이프라인 배치

```
extractTree(dom)              // 02, 규칙 기반 — 변경 없음
   │  DocNode (핸들 보존)
   ▼
refineTree(root, model)       // 신규 — 선택적 LLM 패스
   │  DocNode (같은 스키마, 재배치됨)
   ▼
NavigationEngine / TTS / LLM 명령 엔진(06)   // 변경 없음 — DocNode 계약 그대로
```

- `refineTree`는 **옵션**이다. API 키가 없거나 실패하면 규칙 기반 트리를 그대로 반환한다 — plan.md가 로컬 우선·프라이버시 선택권을 원칙으로 못 박았고, 06도 "로컬/API 스위칭"을 전제로 한다.
- 통합 지점은 `apps/extension/src/content.ts`의 `scan()` 하나뿐이다. `extractTree(...)` 다음 줄에 `await refineTree(tree, languageModel)`을 끼우면 된다. `ExtensionLanguageModel`(content.ts:70, `chrome.runtime.sendMessage`로 백그라운드의 실제 provider 호출)을 **그대로 재사용** — 새 provider 배선을 만들지 않는다.
- `tools/bench`(`observe.ts`, `run.ts`)에도 같은 함수를 끼워 재구성 전/후를 `treeStats`/`treeToText`(이미 있는 관찰 헬퍼, `tree.ts`)로 비교한다.

## 4. 입력 계약 — 트리 직렬화

`llm-command.ts`의 `createDocumentContext`가 이미 "id 붙은 텍스트 접근성 뷰 + 노드/문자 수 한도 + 민감정보 마스킹(`safeTextForRemoteModel`)"을 구현해 뒀다. 이걸 **그대로 재사용**한다 — 06을 위해 만든 직렬화·마스킹 로직을 트리 재구성에도 그대로 쓴다(새 직렬화 코드 작성 안 함).

차이점 하나: 06은 "명령과 관련된 일부"만 보면 되지만, 재구성은 **트리 전체**를 봐야 노이즈 판단·재배치가 가능하다. 큰 페이지는 `DocumentContextOptions`(`maxDepth`/`maxNodes`/`maxChars`, 이미 존재)로 잘리므로, 전체를 다루려면:

- **1차: 그대로 시도.** `maxNodes`를 재구성용으로 크게(예: 400) 잡아 한 번에 보낸다. 02-R 실측 기준 대부분의 실사이트(야놀자 210, 안전운전 174)는 이 안에 들어온다. 위키백과류 대형 문서만 예외.
- **초과 시: 섹션 단위 청킹.** 최상위(레벨 1) 자식별로 나눠 각각 `refineTree`를 돌리고, 최상위 배열 자체의 재배치(예: 본문을 chrome보다 앞에 둠, P1-E)는 별도의 "최상위 전용" 얕은 패스(자식 텍스트 1줄 요약만 보냄)로 처리한다. 두 패스 모두 같은 `LanguageModel.complete()` 하나를 재사용한다.

## 5. 출력 계약 — 재구성 플랜

LLM은 트리를 직접 만들지 않고, **기존 id를 어떻게 접을지에 대한 계획**만 낸다.

```ts
type RefinePlanNode =
  | { ref: NodeId; children?: RefinePlanNode[] }      // 기존 노드를 이 위치에
  | { group: string; children: RefinePlanNode[] };     // 새 그룹 라벨 + 그 아래 재배치

interface RefinePlan {
  root: RefinePlanNode[];   // 최상위 순서 = 사용자가 보는 순서
}
```

`ref`의 `children`은 **선택**이다 — 생략하면 원본 하위 트리가 그대로 따라오고, 주면 그 아래만 갈아끼운다. 손대지 않을 섹션을 `{"ref":id}` 한 줄로 넘길 수 있어 출력 토큰이 줄고, LLM이 깜빡 빠뜨려 통째로 사라지는 사고도 줄어든다.

시스템 프롬프트 원칙(06의 `SYSTEM_PROMPT`와 같은 톤으로 작성):

- 페이지 데이터는 신뢰하지 않는 입력이다(06과 동일한 프롬프트 인젝션 방어 문구 재사용).
- **`ref`에는 반드시 입력에 있던 id만 쓴다.** 새 id·새 텍스트를 만들지 않는다.
- 계획에서 빠진 id = 낭독 가치가 없는 노드(광고·중복 내비 등)로 간주해 제거한다.
- 같은 성격의 항목(카드 여러 개, 같은 종류 링크 다수)은 `group`으로 묶고, 사람이 목차를 보듯 이해할 수 있는 짧은 라벨을 붙인다.
- 사용자가 실제로 찾는 정보(본문·핵심 액션)를 먼저, 반복되는 chrome(머리말/탐색/바닥글)은 뒤로 보낸다.

## 6. 검증 — 06과 동일한 신뢰 경계

`validateCommand`(`llm-command.ts:202`)가 "모델 출력은 절대 신뢰하지 않고 닫힌 스키마로 검증 후에만 통과시킨다"는 패턴을 그대로 적용한다.

- JSON 파싱 실패, 스키마 불일치 → **원본 트리로 폴백**(06의 `rejected` 처리와 동일한 태도).
- `ref`의 id가 원본 `indexById(root)`(`tree.ts:49`, 이미 존재)에 없으면 그 노드는 버린다(할루시네이션 방지) — 전체를 reject하진 않고 해당 참조만 무시.
- **안전판**: 원본 대비 남은 leaf 노드 비율이 임계값(예: 30%) 미만으로 떨어지면 "과도한 삭제"로 보고 전체 플랜을 reject, 원본 트리 반환. (06 명령 하나가 잘못되는 것과 트리 전체가 잘못 재구성되는 것은 파급力이 다르므로 이 폴백은 필수.)
- 같은 id가 두 번 이상 참조되면 첫 등장만 인정(핸들-노드 1:1을 깨는 복제 방지).

## 7. 재조립 — 새 DocNode 생성

`RefinePlan`을 원본 `indexById` 인덱스로 되짚어 실제 `DocNode` 트리를 만든다.

- `ref` 노드: 원본에서 `kind`/`text`/`handle`을 그대로 복사. **level만 새 트리에서의 깊이로 재계산**(root=0 규칙, `docs/03`)한다 — LLM이 준 레벨 숫자는 신뢰하지 않는다.
- `group` 노드: `kind: "group"`, `text: label`, `handle` 없음. id는 02-R이 이미 지적한 P2-G(`g${groupSeq++}` 전역 카운터라 재추출마다 id가 바뀌는 문제, `structure.ts:97`)를 반복하지 않도록 **내용 기반 결정적 id**로 만든다 — 예: `refine:${parentId}:${slug(label)}`. 전역 카운터를 새로 만들지 않는다.

## 8. 재사용 vs 신규 — 요약

| 필요한 것 | 출처 | 상태 |
|---|---|---|
| provider 호출(OpenAI/Gemini/Anthropic) | `llm-provider.ts` `createProviderLanguageModel` | 재사용, 무변경 |
| 확장에서의 provider 배선 | `content.ts` `ExtensionLanguageModel` | 재사용, 무변경 |
| `LanguageModel` 계약 | `llm-command.ts` | 재사용(신규 인터페이스 안 만듦) |
| 트리 직렬화 + 민감정보 마스킹 | `llm-command.ts` `createDocumentContext`/`safeTextForRemoteModel` | 재사용 |
| id 인덱스 | `tree.ts` `indexById` | 재사용 |
| 재구성 전/후 비교 | `tree.ts` `treeStats`/`treeToText` | 재사용(신규 계측 도구 안 만듦) |
| 닫힌 스키마 검증 + 폴백 패턴 | `llm-command.ts` `validateCommand`의 설계 | 패턴 재사용, 코드는 새로 씀(대상 타입이 다름) |
| `refineTree()` 본체 + `RefinePlan` 타입 + 프롬프트 | — | **신규**: `packages/core/src/tree-refine.ts` |

## 9. 새 파일

- `packages/core/src/tree-refine.ts` — `refineTree(root, model, options?): Promise<RefineResult>`. 내부에서 직렬화(§4) → `model.complete()` → 검증(§6) → 재조립(§7). throw하지 않고 `{ status: "refined" | "fallback", tree, reason? }`를 낸다 — `tree`는 어떤 경우에도 바로 쓸 수 있어(실패 시 원본) 호출부가 폴백을 따로 처리할 필요가 없고, 왜 건너뛰었는지는 `reason`으로 남는다.
  - `applyRefinePlan(root, raw, options?)`도 함께 내보낸다: LLM을 모르는 순수 함수라 계획 처리 로직만 따로 시험할 수 있다.
- `packages/core/src/tree-refine.test.ts` — `llm-command.test.ts`와 같은 방식의 가짜 `LanguageModel`(고정 응답)로 검증. 프레임워크·픽스처 추가 없이 `node:test` 그대로.
- `tools/bench/refine.ts` (`pnpm --filter @webgil/bench refine`) — [`docs/03_RESEARCH/test_sites.md`](../03_RESEARCH/test_sites.md)를 읽어 규칙 트리와 재구성 트리를 나란히 출력. 루트 `.env`(→ `.env.example`)에 제공자 설정이 없으면 **드라이런** — 실제 페이지가 컨텍스트 한도 안에 들어오는지만 잰다.
- `packages/core/src/index.ts`에 `refineTree`/`applyRefinePlan`/타입 export 추가.

## 10. 측정 (2026-08-18, jsdom 경로)

`pnpm --filter @webgil/bench refine` 드라이런. 13개 사이트 중:

| 결과 | 수 | 비고 |
|---|---|---|
| 한도 안 → 재구성 가능 | 8 | 노드 60~262, 컨텍스트 2.7k~14.2k자 |
| 한도 초과 → 건너뜀 | 1 | 세종대 공지(노드 1,242, 링크 1,128) — §11 청킹 과제 |
| 노드 0 (JS 렌더) | 4 | 오픈소스대회·홈택스×2·무신사 — jsdom 한계(02-R §4.4), 재구성과 무관 |

재구성이 겨냥하는 문제가 숫자로 보인다 — 기상청 페이지의 최상위 14개가 `본문 바로가기 | 머리말 | 옵션 메뉴 | 주 메뉴 | 보조 정보 | 부 메뉴 | 페이지 경로 | 바닥글 | 탐색 ×6`으로, 사용자가 처음 만나는 항목이 전부 chrome이고 "탐색"이 6번 반복된다(P1-E).

같은 페이지의 실제 트리에 "본문류를 앞으로, chrome은 한 그룹으로" 계획을 넣어 `applyRefinePlan`을 왕복시킨 결과:

| 지표 | 값 |
|---|---|
| 최상위 항목 | 14 → **4** |
| 핸들 소실 | **0** |
| 텍스트 변조 | **0** |
| 원본 노드 손실 | **0** |
| level 재계산 | 전 노드 깊이 일치 |
| 원본 트리 변형 | 없음(깊은 복사) |

즉 §2의 핵심 제약(핸들·텍스트는 원본에서만 온다)이 실제 페이지 트리에서 지켜진다. 실제 LLM 출력 품질은 API 키가 있는 환경에서 같은 벤치로 확인해야 한다.

## 11. 미결정 / 리스크

- **자동 실행 안 함**: 확장에서는 `Alt+Shift+R`(또는 콘솔 `__webgil.refineDocumentTree()`)로만 돈다. 비용·지연이 있는 원격 호출이라 매 mutation에 붙이지 않았다. 대신 **다음 mutation의 `scan()`이 규칙 트리로 되돌린다** — 재구성 결과를 유지할지는 UX 결정이 선 뒤에.
- **큰 문서는 그냥 건너뛴다**: 컨텍스트가 한도를 넘으면(`truncated`) 호출조차 하지 않고 원본을 쓴다. 안 보낸 노드가 "계획에서 빠진 노드"로 오인돼 삭제되는 게 더 나쁘기 때문. 실측상 13개 중 1개가 여기 걸린다(§10) → **§4의 섹션 청킹이 다음 과제**.
- **입력칸 라벨 손실**: 재사용한 `safeTextForRemoteModel`이 `input` 노드의 텍스트를 통째로 `[input field; current value withheld]`로 바꾼다. 프라이버시는 지켜지지만 LLM이 "어떤 입력칸인지" 몰라 양식 재구성 품질이 떨어진다. 값과 라벨을 분리해 라벨만 보내는 개선은 실제 품질을 본 뒤에.
- **평가 기준**: "시각적으로 볼 때 얻을 수 있는 구조와 비슷한가"는 자동 채점이 어렵다. 초기엔 02-R처럼 사람이 `treeToText` 출력을 눈으로 비교하는 방식으로 검증하고, 필요해지면 지표화한다(지금 만들지 않음 — YAGNI).
