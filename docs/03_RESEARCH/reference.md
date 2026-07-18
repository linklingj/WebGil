# 시각장애인용 웹 스크린리더 프로젝트를 위한 레퍼런스 조사 보고서

## TL;DR
- **당신이 구상한 5대 기능(구조 재구성 drill-down / neural TTS / 트랙패드 swipe / LLM 자연어 네비게이션 / 로컬+API LLM)은 각각 성숙한 오픈소스·상용 레퍼런스가 존재하지만, 이 다섯을 하나로 결합한 완성품은 아직 없다.** 가장 근접한 선행연구인 OCAD 대학의 Forootan(2025) 석사논문조차 물리 하드웨어 컨트롤러 기반이며, "재구성 트리 + 트랙패드 swipe + LLM 자연어 네비게이션" 조합은 실증되지 않았다 — 즉 차별화 여지가 분명히 있다.
- **기술 스택 권고: 콘텐츠 추출은 Mozilla Readability(+Turndown) 또는 Trafilatura, 구조 트리는 heading/ARIA landmark 기반 자체 파서, TTS는 로컬 Piper(MIT, CPU 실시간)·Kokoro(Apache-2.0) + API 폴백(ElevenLabs Flash/OpenAI/Azure), LLM 추상화는 OpenAI-호환 엔드포인트(Ollama·LM Studio·vLLM ↔ OpenAI/Claude), 자연어 네비게이션은 accessibility-tree/DOM snapshot 기반 에이전트(Playwright MCP 패턴)로 구현하는 것이 현실적이다.**
- **문제의 타당성은 WebAIM 설문으로 강력히 뒷받침된다: WebAIM Screen Reader User Survey #10(2023-24, n=1539)에서 긴 페이지 첫 탐색 방법으로 heading이 71.6%로 압도적 1위이고, 전체를 순차적으로 읽는 사용자는 6.4%에 불과하다(Find 13.6%, 링크 4.8%). 당신의 heading 계층 drill-down은 사용자가 실제로 원하는 방식과 정확히 일치한다.**

## Key Findings

1. **당신의 핵심 아이디어는 접근성 학계·업계의 최신 방향과 일치한다.** heading 우선 탐색, 비선형/스키밍 지원, AI 코파일럿(자동조종 아님)은 모두 최근 연구·설문이 강조하는 지점이다.
2. **"구조 재구성 트리 네비게이션"의 직접적 완성 사례는 드물다.** 기존 스크린리더는 live DOM을 순차 순회하며, VoiceOver rotor·NVDA elements list처럼 semantic 요소 필터링은 있으나, HTML을 heading 계층 트리로 재구성해 drill-down시키는 UX는 상용 제품에 거의 없다 — 이것이 최대 차별화 포인트다.
3. **TTS는 로컬/API 이원화가 정답이다.** Piper·Kokoro는 CPU에서 실시간·저지연이며 라이선스가 상업적으로 안전하고, ElevenLabs Flash v2.5(~75ms, 네트워크 제외)·Cartesia Sonic 3 Turbo(~40ms)·OpenAI·Azure는 최고 품질/스타일을 제공한다.
4. **로컬+API LLM 동시 지원은 이미 표준 패턴이다.** Ollama·LM Studio·vLLM·llama.cpp가 모두 OpenAI-호환 API를 노출하므로 `base_url`만 바꾸면 로컬↔클라우드 전환이 코드 수정 없이 가능하다.
5. **자연어 네비게이션은 accessibility tree 기반 에이전트로 구현하는 것이 검증된 방법이다.** Playwright MCP, Browser Use 등은 스크린리더가 쓰는 것과 같은 접근성 트리를 LLM에 먹여 클릭·입력을 수행하며, 이는 당신의 "로그인창 들어가줘" 명령과 정확히 같은 메커니즘이다.

## Details

### A. 전통·상용 스크린리더 (웹 네비게이션 방식)

**NVDA (오픈소스, GPL v2, Windows, github.com/nvaccess/nvda).** browse mode(읽기/탐색)와 focus mode(폼 입력)를 자동 전환. 단일키 탐색이 핵심: `H`로 다음 heading, `1`~`6`으로 특정 heading 레벨 점프, `K`(링크), `T`(표), `D`(landmark), `NVDA+F7`로 Elements List(링크·heading·폼 필드 개요). **당신 프로젝트와의 연관:** heading 레벨 점프(1~6)는 당신의 drill-down의 키보드 버전이다. NVDA는 Python으로 작성되어 있고 synthesizer driver(add-on)로 TTS 엔진을 붙이는 구조 — Piper NVDA add-on이 이미 존재한다. **차용점:** browse/focus 모드 이원화 개념, single-key 탐색 문법, add-on 아키텍처.

**VoiceOver (macOS/iOS, Apple 기본 탑재).** rotor가 핵심 UX: 트랙패드에서 두 손가락 회전으로 Links/Headings/Form Controls/Tables/Landmarks/Frames 중 탐색 단위를 선택하고, 위/아래 flick으로 해당 단위의 이전/다음 항목으로 이동. DOM mode와 group mode를 전환 가능. **당신 프로젝트와의 연관:** 이것이 당신의 트랙패드 swipe 네비게이션과 가장 유사한 상용 사례다. "회전으로 레벨/카테고리 선택 → flick으로 같은 레벨 내 이동"은 당신의 "swipe로 같은 heading 레벨 훑기 → 키로 child 진입"과 개념적으로 대응된다. **차용점:** rotor의 "탐색 단위(granularity) 선택 + 방향 제스처로 순회" 2단계 모델.

**JAWS (상용, Vispero, Windows).** 가장 오래된 상용 스크린리더. Auto Forms Mode(폼 진입 시 자동 모드 전환), heading·landmark 탐색 지원. 최근 Vispero Companion으로 task-based 안내 기능 추가. **연관:** 상용 시장 기준점(WebAIM #10에서 40.5%로 여전히 1위, NVDA 37.7%). 유료·폐쇄형이라 차용할 코드는 없으나 UX 관습(convention)의 레퍼런스.

**Narrator(Windows 기본), Orca(리눅스, GNOME, 오픈소스), TalkBack(안드로이드), ChromeVox(ChromeOS/확장, 오픈소스).** Orca는 리눅스 접근성 스택(AT-SPI) 참고용. ChromeVox는 브라우저 확장형 스크린리더의 오픈소스 레퍼런스로, 확장 아키텍처를 참고할 수 있다.

**TalkBack explore-by-touch (안드로이드).** reading controls(granularity)를 세 손가락 스와이프(또는 위/아래 스와이프)로 전환: Characters/Words/Lines/Paragraphs/Headings/Controls/Links. 선택한 단위에서 한 손가락 위/아래로 순회. **연관:** 터치 제스처로 granularity를 바꾸고 방향 제스처로 순회하는 모델 — 당신의 트랙패드 UX 설계에 직접 참고. VoiceOver rotor와 함께 "granularity + directional navigation" 패러다임의 양대 사례.

### B. 최신 AI/LLM 기반 접근성 도구

**Be My Eyes / Be My AI (GPT-4 Vision).** 2023년 말 GPT-4V를 통합한 "Virtual Volunteer". 이미지에 대해 대화형·맥락적 설명 제공. OpenAI 발표에 따르면 웹페이지를 보여주면 "중요한 부분을 골라 요약"하는 능력을 시연 — 쇼핑·뉴스 등 복잡한 페이지에서 sighted 사용자가 스캔하듯 요점만 전달. **연관:** 당신의 "텍스트 요약/구조 파악 + 자연어 대화" 부분의 대표 선행 사례. 단, 이미지 기반 설명이 중심이며 웹 조작(navigation) 에이전트는 아님. 2015년 창립, 6.3백만 자원봉사자, 대상 인구 약 2억 5,300만 명(맹인·저시력).

**Microsoft Seeing AI, Google Lookout.** 물리 세계 OCR·객체·장면 인식 중심(모바일). Lookout은 안드로이드 TalkBack과 통합되어 Explore/Shopping/Quick Read/Food Label 모드 제공. 웹 네비게이션과는 거리가 있으나 "on-demand AI 설명" UX 참고.

**Screen Reader AI (Patel, 2025, 학술 프로토타입, 브라우저 확장, IJESTY).** DOM + AOM(Accessibility Object Model)을 통합해 실시간 "semantic scene graph"를 구축하고 GPT-4o로 해석, 자연어 대화로 전달. "이 페이지에 로그인 폼 있어?", "방금 뭐가 바뀌었어?" 같은 질문에 응답. **연관:** 당신의 LLM 자연어 네비게이션과 매우 유사한 학술적 선행연구. live semantic graph를 상시 갱신하는 아키텍처가 참고점. (76%가 명시적 변경 요약을 일반 AI 설명보다 선호했다고 보고.)

**Gemini "Auto Browse" (Chrome 사이드 패널, agentic).** Blind Access Journal의 2026년 데모에서 접근 불가능한 Salesforce 날짜 선택기를 "start date를 December 2004로 설정해줘"라는 자연어 명령으로 에이전트가 자동 조작하고 실시간 상태를 음성 보고. **연관:** 당신의 "로그인창 들어가줘" 시나리오의 실제 작동 사례. 상용 대기업이 이미 이 방향으로 움직이고 있음을 보여줌(경쟁·검증 동시).

**AI 브라우저 에이전트 일반 (Browser Use, Playwright MCP, Vercel Agent Browser).** 두 가지 접근: (1) accessibility tree/DOM을 텍스트로 LLM에 제공(vision 불필요, 저토큰), (2) 스크린샷 vision. Playwright MCP(Apache-2.0, microsoft/playwright-mcp)는 접근성 트리 snapshot에 `@ref`(예: `@e5`)를 부여해 LLM이 클릭/입력하게 함(스냅샷당 ~200-400 토큰). Browser Use는 CDP로 Chromium 제어, HTML 파싱 후 LLM에 다음 행동 질의. **연관:** 당신의 자연어 네비게이션 엔진의 직접적 구현 청사진. 특히 "스크린리더가 쓰는 것과 같은 accessibility tree를 LLM이 소비한다"는 점이 핵심 — 접근성과 에이전트의 기술적 접점. Playwright MCP + LM Studio(로컬 LLM) 조합으로 완전 로컬·무료 구성도 문서화되어 있어 당신의 로컬 LLM 요구와 부합.

### C. 웹페이지 구조 재구성/단순화 도구

**Mozilla Readability (Apache-2.0, github.com/mozilla/readability).** Firefox Reader View의 핵심 라이브러리. `isProbablyReaderable()`로 판별 후 `parse()`로 title·byline·content·textContent 추출. Node에서는 jsdom 필요, 브라우저에서는 document 직접 사용. DOMPurify 병용 권장(script injection 방지). **연관:** 당신의 "본문 추출 → 구조 재구성" 파이프라인 1단계. **다만 reader view는 DOM 계층을 평탄화(flatten)하므로 heading 트리 재구성은 별도 로직이 필요하다.** Rust(readability-js crate)·Go(mackee/go-readability) 포팅본도 존재하며 후자는 마크다운 출력을 지원.

**Trafilatura (Python, 오픈소스).** 콘텐츠 추출 벤치마크에서 최상위(recall 우수, 한 비교에서 87점으로 Readability 84점 상회). 배치 텍스트 추출에 강함. **연관:** Python 백엔드라면 Readability 대안. 자체 호스팅·프라이버시에 유리.

**Jina Reader / ReaderLM-v2 (오픈소스 모델, jina.ai/reader, HuggingFace jinaai/ReaderLM-v2).** `r.jina.ai/{URL}`로 URL을 마크다운으로 변환(내부적으로 headless Chrome + Readability + Turndown). ReaderLM-v2는 1.5B 파라미터 SLM으로 HTML→Markdown/JSON을 신경망으로 변환, 29개 언어·최대 512K 토큰, 로컬 실행 가능(GPU 권장). **연관:** 당신의 "HTML → md 트리 구조 변환"의 거의 정확한 도구. 규칙 기반(Readability+Turndown) vs 신경망(ReaderLM) 두 경로 모두 검토 가치. 마크다운의 `#`/`##` heading이 그대로 당신의 트리 레벨이 됨. 참고로 Jina Reader는 페이지 끝에 "Buttons & Links" 섹션을 만들어 downstream 에이전트의 조작을 돕는 옵션도 제공 — 당신의 자연어 네비게이션과 시너지.

**Turndown (JS, HTML→Markdown), Pandoc(범용 변환), Crawl4AI/Firecrawl(풀 파이프라인).** heading 계층 보존이 관건이므로 변환 후 `#` 레벨로 트리 재구성.

### D. 최신 Neural TTS 솔루션

**로컬/오픈소스:**
- **Piper (MIT, OHF-Voice/Rhasspy).** CPU에서 실시간(라즈베리파이5에서도 실시간), 경량, **이미 NVDA add-on(synthesizer driver)으로 통합됨**. 상업적 사용 가능. **당신 프로젝트의 기본 로컬 TTS 1순위** — 저지연·저사양·안전 라이선스.
- **Kokoro-82M (Apache-2.0).** 82M 초경량, CPU에서 실시간 이상, 54개 음성·8개 언어. 내레이션 최적. 상업적 안전. 음성 클로닝은 불가(고정 음성).
- **Chatterbox (MIT).** ~350M, 감정 exaggeration 다이얼(0.0~1.0+), 음성 클로닝(~5초), 상업적 안전, 튜닝 시 sub-200ms. **감정/스타일 선택 기능**에 부합.
- **XTTS-v2 (CPML, 비상업용).** 17개 언어·6초 클로닝, 품질 최고급이나 라이선스가 비상업 제한 + Coqui 폐업(2024)으로 상업 라이선스 취득 불가. 개인/연구용만.
- **F5-TTS (CC-BY-NC, 비상업).** ~3초 클로닝, flow-matching으로 빠른 추론.

**API 기반:**
- **ElevenLabs.** 최고 표현력. 공식 문서 기준 Eleven Flash v2.5는 "ultra-low latency (~75ms†) across 32 languages"(†애플리케이션·네트워크 지연 제외, 2024-12-18 출시, $0.05/1K자). 감정/스타일 풍부, 음성 클로닝(30초).
- **Cartesia Sonic.** 최저 지연급. Sonic 3 기준 표준 ~90ms, Turbo ~40ms TTFA(15개 언어), 실시간 에이전트용.
- **OpenAI TTS (gpt-4o-mini-tts).** GPT 생태계 통합 용이, 스트리밍, 토큰 기반 과금.
- **Azure Neural TTS.** 140+ 언어, Custom Neural Voice, cheerful/sad/angry 등 speaking style 태그, 온프레미스 컨테이너 제공(규제 환경 유리).
- **Google Cloud TTS.** WaveNet/Neural2, 380+ 음성, SSML 정밀 제어(발음 사전·강조·속도).
- **Microsoft Edge TTS (edge-tts, 무료·비공식).** API 키 없이 300+ neural 음성, 200-400ms, cheerful/newscast 등 스타일. **프로토타이핑·폴백에 매우 유용.**

**권고:** 기본 로컬 = Piper(저지연) 또는 Kokoro(품질), 감정/스타일 요구 시 = Chatterbox(로컬) 또는 ElevenLabs/Azure(API). 실시간성이 중요하므로 **스트리밍 TTS + 문장 단위 청킹 + 자주 쓰는 문구 프리캐싱**이 필수. 음성 스타일 선택 기능은 Azure speaking style, ElevenLabs, Chatterbox emotion dial이 직접 대응.

### E. 로컬 LLM 실행 프레임워크 및 로컬/API 추상화

- **Ollama.** `ollama pull/run`, OpenAI-호환 API(localhost:11434), 단일 사용자·프로토타이핑 최적. Apple Silicon에서 MLX 백엔드(0.19+).
- **LM Studio.** GUI, HuggingFace 모델 브라우저, OpenAI-호환 서버(포트 1234). 모델 탐색·평가에 최적. (실무 관행: "LM Studio로 모델 고르고 Ollama로 서빙"을 병행.)
- **llama.cpp.** C++ 엔진(Ollama·LM Studio의 기반), 임베디드·단일 바이너리, GGUF, llama-server가 OpenAI-호환 API 노출. 데스크톱 앱에 정적 링크 가능.
- **vLLM.** PagedAttention·continuous batching으로 다중 사용자 고처리량. 벤치마크 근거: Particula Tech(2026)가 인용한 Red Hat/NVIDIA 측정에서 "NVIDIA Blackwell GPU + Llama 3.1 70B(NVFP4)에서 vLLM은 초당 8,033 토큰으로 Ollama의 484 대비 16.6배 처리량"(TTFT 10.7ms vs 65ms), InsiderLLM(2026-05)은 "동시 요청 상황에서 대략 Ollama의 10-20배"로 요약. 프로덕션 서빙용(NVIDIA/AMD GPU 필요).

**로컬/API 추상화의 핵심:** 네 프레임워크 모두 **OpenAI-호환 엔드포인트**를 노출한다. 따라서 `openai` SDK로 `base_url`만 교체하면(localhost ↔ api.openai.com ↔ Claude 등) 코드 변경 없이 로컬/클라우드 전환이 가능하다. LiteLLM·LocalAI 같은 라우터를 두면 다중 백엔드를 단일 API로 통합할 수 있다. **권고:** 처음부터 OpenAI-호환 인터페이스를 내부 추상화 계층으로 설계하고, 설정으로 모델 provider를 주입하라. 사용자 개인정보(방문 페이지 내용)를 다루므로 로컬 우선 옵션은 프라이버시 측면에서 중요하다.

### F. 제스처/트랙패드 기반 접근성 네비게이션

VoiceOver Trackpad Commander(트랙패드가 화면 영역을 표현, drag로 커서 이동, 빈 공간에서 효과음), rotor 회전, flick 순회가 당신의 트랙패드 swipe와 가장 유사. TalkBack explore-by-touch의 granularity 전환 모델도 참고. 학술적으로는 vibro-tactile 웹페이지 레이아웃 전달 연구(HAL/PMC의 "Layout Transposition for Non-Visual Navigation"), Wheeler(3륜 입력장치로 계층 메뉴 탐색, arXiv 2408.13166 — H1 가설로 "H-nav 모드가 키보드+스크린리더보다 계층 탐색이 효율적"), NVMouse(마우스를 계층 문서 구조 탐색에 재활용, PMC) 등이 "물리 입력 → 계층 구조 탐색" 매핑을 다룬다. 이들은 당신의 "swipe로 트리 순회" UX의 학술적 근거를 제공한다.

### G. 오픈소스 스크린리더/접근성 프로젝트 (GitHub)

- **nvaccess/nvda** — 프로덕션 스크린리더 아키텍처 레퍼런스(Python, add-on, synth driver).
- **guidepup/virtual-screen-reader** — 유닛테스트용 스크린리더 시뮬레이터. AOM 지원 감지, accessible name/role 계산. **당신의 트리 구축·읽기 로직 참고에 유용.** @guidepup/playwright로 VoiceOver·NVDA 자동화도 가능.
- **wongcyrus/GeProVis-AI-Screen-Reader** — ChromeVox + Gemini Pro Vision 결합 오픈소스(이미지 설명, Cloud Function 아키텍처).
- **ashishsharma229/AI-Powered-Web-Accessibility-Screen-Reader-Analyzer** — content.js가 alt·ARIA·reading order 수집 → OpenAI로 개선안(MIT). 확장 구조 참고.
- **mozilla/readability, jinaai/ReaderLM-v2, microsoft/playwright-mcp** — 위 참조.

### H. 학계 연구 및 표준 (구조 기반 drill-down의 근거)

**WebAIM Screen Reader User Survey #10 (2023-24, n=1539) — 문제 타당성의 핵심 근거:**
- 긴 페이지에서 첫 탐색 방법: **heading 탐색 71.6%**(1위), Find 13.6%, 전체 순차 읽기 6.4%, 링크 4.8%. WebAIM 표현: "Navigating through headings on a page remains by far the most common (71.6%) method of exploring page content."
- heading 사용은 숙련자와 초보자 간 격차가 큼: "Those with advanced screen reader proficiency are much more likely to use headings (78%) than those with beginner proficiency (47%). Beginners are 2.5 times more likely to use the 'Find' feature." heading 레벨의 유용성은 88.8%가 매우/다소 유용하다고 응답.
- landmark는 사용 의향(31.7%가 "항상/자주")과 실사용 격차가 큼: "only 3.7% use this as a primary method for finding information on a lengthy web page."
- 가장 문제되는 항목: CAPTCHA, 예상대로 동작 않는 인터랙티브 요소(메뉴·탭·다이얼로그) — "지난 14년간 거의 변화 없음".
→ **결론: 당신의 heading 계층 drill-down은 사용자가 실제로 압도적으로 선호하는 방식을 시스템 차원에서 강제·구조화하는 것이다. 특히 heading을 잘 못 쓰는 초보자(47%)에게 "구조를 대신 만들어주는" 가치가 크다. 문제 정의가 데이터로 뒷받침된다.**

**표준:** WAI-ARIA landmark roles(banner/navigation/main/complementary/contentinfo/search/form/region)와 HTML5 sectioning(header/nav/main/footer), heading(h1~h6). 단, DAISY 지식베이스는 "landmark를 목차 대용으로 쓰지 말 것 — heading 구조를 보존하지 않는다"고 명시. **당신 프로젝트는 landmark(대영역)와 heading(계층 목차)을 함께 활용해 트리를 구성하되, drill-down 트리의 뼈대는 heading 계층으로 잡는 것이 표준 정신에 부합.** WCAG 2.4.1(Bypass Blocks), 2.4.6(Headings and Labels), 1.3.1(Info and Relationships) 준수 참고.

**관련 학술:** Pontelli et al. "Intelligent Non-Visual Navigation of Complex HTML Structures"(Universal Access in the Information Society); ACCSAMS(arXiv 2405.19124 — 문서 계층을 위치·열거 스타일 휴리스틱으로 트리 구조로 추출해 스크린리더 접근성 향상, 당신의 트리화와 직접 유사); "Breaking the Linear Barrier: Multi-Modal LLM System for Navigating Complex Web Content"(COMPSAC 2025); VERSE(스크린리더+음성비서+제스처+공간음향 통합, Vtyurina et al. 2019); 스크린리더 5-페르소나 연구(PMC, Jordan et al.); "What frustrates screen reader users on the web"(Lazar et al. 2007) 등이 문제·해법의 학술적 계보를 형성.

### I. 경쟁·차별화 분석 (선행연구 심층)

**Forootan(2025), "Empowering Agentic Non-Visual Web Navigation Through Tactile Controls and AI Support" (OCAD 대학 석사논문, MRP, 53쪽, CC BY-NC 4.0) — 가장 근접한 선행연구.** 5명 BLV 참여자(NVDA·VoiceOver 사용자, 20대~60대) 대상 참여적 co-design + Wizard-of-Oz 연구. **당신 프로젝트와 겹치는 부분:** 선형 탐색의 문제, 비선형 스키밍 부재, heading 의존(참여자 왈 "Headings are like signs on a highway. Without them, I'd be driving blind"), AI는 자동조종이 아닌 on-demand 코파일럿이어야 한다는 결론("I want screen readers and voice assistants to give me clear options without overloading me"), AI 응답을 현재 DOM 포커스에 스코프. 한 참여자는 swipe 기반(폰/아이패드) 탐색이 시간을 절약한다고 명시("Normally when I go through my phone or iPad, I'm swiping. So this actually saves a little bit of time").

**결정적 차이(= 당신의 차별화 여지):**
1. **입력이 트랙패드가 아니라 Arduino 물리 하드웨어(로터리 노브 + 조이스틱 + 로터 스위치)다.** 노브 회전→Tab/Shift+Tab, 조이스틱 틸트→방향키, 조이스틱-홀드+노브→heading 점프로 NVDA 명령을 에뮬레이트. (한 참여자는 노브를 "트랙패드와 트랙볼 사이"로 비유했으나 실제 트랙패드 제스처는 구현하지 않음.)
2. **문서 재구성 트리가 없다** — NVDA의 live DOM 순차 순회에 의존하며, "레이어링"은 iPhone rotor식 semantic 요소 필터(landmark/heading/link/table)이지 재구성 트리가 아님.
3. **LLM 자연어 웹 네비게이션 에이전트가 없다** — LLM(GPT-4o Vision, NVDA AI Content Describer add-on)은 스크린샷 "설명"만 하고 명령 실행은 안 함. 제목의 "agentic"은 사용자 주체성(agency)을 뜻하지 자율 에이전트가 아님.
4. 최종 통합 기기는 실제 구현·검증이 아닌 **설계 제안**이며, n=5 정성 연구로 정량 효능 지표 없음(노브 단독은 목표 도달 실패, 노브+조이스틱은 도달하나 "비효율·비직관적"으로 평가됨).
- 사용 기술: NVDA, Voiceflow(대화형 프로토타입), GPT-4o/GPT-4 Vision, NVDA AI Content Describer add-on, Be My Eyes(비교), LLaVA(비교했으나 GPT-4o Vision보다 열등 판정), Arduino Nano 33 IoT / Pro Micro.

**상용 접근성 위젯(accessiBe accessWidget 등).** AI로 ARIA/alt를 사이트에 자동 주입하는 "오버레이" — 방향이 반대(사이트 측 수정)이며 시각장애 커뮤니티에서 논란. 당신은 사용자 측 클라이언트라는 점에서 차별화.

**종합 차별화 포지셔닝:** ① heading 계층을 **재구성한 트리**로 만들어 top-down drill-down(대부분 제품은 live DOM 순차 필터), ② **트랙패드 swipe**를 1차 입력으로(Forootan은 물리 하드웨어, VoiceOver는 rotor+flick), ③ **재구성 트리 낭독 + neural TTS + LLM 자연어 조작을 한 클라이언트에** 통합(기존은 분리). 이 세 가지 결합이 명확한 신규성이다.

## Recommendations

**1단계 — MVP 아키텍처 (즉시):**
- **콘텐츠 추출·트리화:** 브라우저 확장(content script)으로 구현. `@mozilla/readability`로 본문 추출 → 원본 DOM의 `h1~h6` + ARIA landmark를 파싱해 heading 계층 트리(JSON) 구축. Readability가 계층을 평탄화하므로, **트리 골격은 원본 DOM의 heading 순서·레벨에서 직접 추출**하고 본문 텍스트만 Readability 결과로 채워라. 대안으로 ReaderLM-v2로 md 변환 후 `#` 레벨로 트리 파싱. (ACCSAMS의 위치·열거 스타일 휴리스틱을 트리화 규칙으로 참고.)
- **TTS:** 로컬 Piper(WASM/네이티브)를 기본, 프로토타입 단계는 무료 edge-tts로 빠르게 시작. 스트리밍 + 문장 청킹.
- **네비게이션:** VoiceOver rotor + TalkBack granularity 모델을 벤치마크. "swipe 좌우 = 같은 레벨 형제 순회, swipe 상하 or 스페이스 = child 진입/parent 복귀"로 매핑. 트랙패드 제스처는 브라우저에서 `wheel`/pointer 이벤트 또는 제스처 라이브러리로 캡처. 경계 진입·완료 시 earcon/촉각 피드백(Forootan 권고)으로 방향감 상실 방지.
- **LLM 추상화:** 첫 커밋부터 OpenAI-호환 클라이언트 계층 + provider 설정 주입(로컬 Ollama ↔ OpenAI/Claude).

**2단계 — 자연어 네비게이션 (MVP 검증 후):**
- Playwright MCP / Browser Use 패턴 채택: 당신이 만든 heading 트리 + accessibility tree를 LLM 컨텍스트로 제공하고, "로그인창 들어가줘"를 element ref 클릭/포커스 액션으로 변환. **핵심 설계 원칙(Forootan·Screen Reader AI 공통 결론): AI는 on-demand 코파일럿 — 항상 사용자가 요청할 때만, 스코프는 현재 포커스/트리 노드로 제한, 중단 가능(interruptible)하게.** 이를 어기면(과도한 자동화·중단 불가) 사용자 신뢰를 잃는다는 것이 반복 검증된 실패 사례다(Forootan Iteration 1이 "too polite to be useful"로 실패).

**3단계 — 품질·스타일·검증:**
- TTS 음성 스타일 선택: Azure speaking style / Chatterbox emotion dial / ElevenLabs 중 채택. 로컬은 Piper 다중 음성 + Kokoro.
- 실제 BLV 사용자 정성·정량 테스트(Forootan이 못 한 정량 효능 지표 — 여기서 차별적 근거 확보). guidepup/virtual-screen-reader로 자동 회귀 테스트.

**의사결정 기준(thresholds):**
- 로컬 TTS 지연이 문장당 >300ms이면 → API TTS(Cartesia Turbo ~40ms / ElevenLabs Flash ~75ms) 폴백.
- 로컬 LLM이 네비게이션 명령 정확도 부족(<~80%)이면 → 자연어 네비게이션만 API 모델로, 낭독·트리화는 로컬 유지(프라이버시·비용 균형).
- Readability 트리화 실패율이 높은 사이트군 → ReaderLM-v2(신경망) 경로로 전환.
- 다중 동시 사용자(서버형 서비스로 확장) 필요 시 → LLM 서빙을 Ollama에서 vLLM으로 전환(동시성에서 10-20배 처리량).

## Caveats
- **TTS/LLM 벤치마크 수치(지연 ms, 처리량 배수, 품질 %)는 대부분 벤더·블로그·2차 자료 출처이며 하드웨어·리전·설정에 크게 좌우된다.** ElevenLabs ~75ms·Cartesia ~40ms는 각각 네트워크 제외·Turbo 모델 기준이고, vLLM 16.6배는 특정 GPU(Blackwell)·모델·양자화 조건이다. 반드시 당신의 타깃 환경에서 자체 측정하라. "94% of ElevenLabs quality" 같은 수치는 마케팅성 주장이다.
- Forootan 논문은 n=5 정성 연구, 단일 기관, 최종 기기 미검증이며 GPT-4o Vision 우월성 주장은 일화적이다. 선행연구로서 방향성은 강력하나 정량 근거는 약하다. "4회 세션"이라 서술했으나 실제 3회만 기재된 내부 불일치도 있다.
- 라이선스 주의(상용화 계획 시 초기 확정): XTTS-v2·F5-TTS는 **비상업 전용**, Kokoro·Piper·Chatterbox·Readability·Playwright MCP는 상업 가능.
- AI 웹 에이전트는 **indirect prompt injection**(악성 페이지가 HTML/accessibility tree에 트리거를 심어 에이전트를 탈취, 로그인 정보 유출·강제 클릭 등) 보안 위험이 문서화되어 있다(arXiv 2507.14799). 자연어 네비게이션에 실제 액션 실행을 붙일 때 신뢰경계·사용자 확인 단계를 반드시 둬라.
- 접근성 트리는 "1990년대 스크린리더용으로 설계"되어 최신 웹앱·레거시(ASP.NET WebForms 등)·custom 위젯에서 비어 있거나 부실할 수 있다. DOM/vision 폴백을 병행 고려하고, 당신의 재구성 트리가 이 공백을 일부 보완할 수 있음을 강점으로 활용하라.