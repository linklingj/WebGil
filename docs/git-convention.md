# Git 협업 규칙 (간이 Gitflow)

## 브랜치 전략

| 브랜치 | 역할 | 규칙 |
|---|---|---|
| `main` | 배포/안정 버전 | 직접 push 금지, `develop`에서 릴리스 머지만 |
| `develop` | 통합 브랜치 | 기능이 모이는 기본 브랜치, PR로만 머지 |
| `feature/*` | 기능 개발 | `develop`에서 분기 → `develop`으로 PR |

> 급한 버그는 `fix/*`를 `develop`에서 분기해 동일하게 처리한다. (main 핫픽스는 규모상 생략)

흐름: `feature/*` → PR → `develop` → (안정화) → `main`

## 브랜치 이름 규칙

```
<type>/<간단한-설명-kebab-case>
feature/capture-source
feature/tts-engine
fix/tree-highlight-offset
```

- 소문자 + 하이픈(kebab-case), 한글 금지.
- 이슈가 있으면 번호를 앞에: `feature/12-capture-source`.

## 커밋 메시지 규칙 (Conventional Commits)

```
<type>: <제목>

<선택: 본문>
```

- 제목은 50자 이내, 명령형("추가한다"보다 "추가"), 마침표 없음.
- `type` 목록:

| type | 용도 |
|---|---|
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `docs` | 문서 |
| `refactor` | 동작 변화 없는 구조 개선 |
| `test` | 테스트 추가/수정 |
| `chore` | 빌드·설정·잡일 |

예시:
```
feat: CaptureSource 인터페이스 추가
fix: 트리 하이라이트 좌표 오차 수정
docs: git 협업 규칙 문서 작성
```

## Pull Request 규칙

- 대상 브랜치는 `develop`.
- 머지 방식은 **Squash and merge** 권장(커밋 히스토리 정리).
- 템플릿(`.github/PULL_REQUEST_TEMPLATE.md`)에 맞춰 작성:

```markdown
## 작업 내용
<!-- 무엇을, 왜 -->

## 변경 사항
- 

## 관련 이슈
Closes #

## 체크리스트
- [ ] 로컬에서 동작 확인
- [ ] 관련 문서 갱신 (필요 시)
- [ ] collaborator에 claude 추가하지 않기
```
