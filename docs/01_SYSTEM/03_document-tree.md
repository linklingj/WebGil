# 03. 문서 트리 모델

> 구조 추출 결과를 담는 **정규화된 계층 자료구조**. 코어의 모든 엔진이 공유하는 단일 표현.

## 목적 / 책임

- 페이지를 **레벨 있는 노드 트리**로 표현한다(마크다운 트리와 유사).
- 각 노드에 텍스트 / 상호작용 종류 / **원본 DOM 핸들**을 담는다.
- 네비게이션 커서(현재 위치·레벨)와 하이라이트·액션이 노드를 지목하는 기준.

## 노드 모델 (확정 — `packages/core/src/tree.ts`)

```ts
type NodeKind = "heading" | "text" | "link" | "button" | "input" | "group";

interface DocNode {
  id: NodeId;            // 안정적 식별자 — 하이라이트·액션이 이 id로 노드 지목
  kind: NodeKind;
  level: number;         // 트리 깊이(root=0, 자식=1…). 시각 크기 아닌 의미 계층 = drill-down 축
  text: string;
  handle?: NodeHandle;   // 원본 DOM 참조. 폴백 트리(02)·group 버킷은 없을 수 있음
  children: DocNode[];
}
```

## 핵심 설계

- **레벨은 시각이 아니라 의미 계층** — 목차(최상위)에서 세부로 drill-down 하는 탐색의 축.
- `handle` 유무로 **조작 가능 노드 vs 낭독 전용 노드**를 구분(폴백 트리 대비).
- 트리는 **읽기 전용 스냅샷**. `onMutation` 시 갱신하며, 커서 상태는 네비게이션 엔진(04)이 별도로 보관한다(트리에 가변 상태를 섞지 않음).
- `id`는 갱신을 넘어 안정적이어야 한다(SPA에서 같은 노드를 계속 추적).

## 의존

- **상류**: 구조 추출 엔진(02).
- **하류**: 네비게이션(04), TTS(05), LLM 명령(06), 액션 실행기(07), 하이라이트.

## 범위 / Phase

- [x] Phase 1: 노드 스키마 확정 → `packages/core/src/tree.ts`.
- [ ] Phase 2~: 커서·갱신 연동.

## 결정 / 미결정

- ✅ `NodeHandle`은 **불투명**(`capture-source.ts`). 셸이 실제 표현을 해소(확장=`Element`, CDP=`backendNodeId`). 코어는 내용을 모른다.
- ✅ `group`은 **명시 노드**. landmark 영역과 동종 leaf 버킷을 같은 `group`으로 통일 → 탐색·낭독이 "묶음"을 1급으로 다룬다.
- ⏳ 갱신 시 노드 `id` 안정성: 같은 `Element`는 재추출에도 같은 id 유지(`ensureNodeId`). 완전한 SPA 재식별 규칙은 Phase 3.
