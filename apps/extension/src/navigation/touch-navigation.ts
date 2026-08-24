import type { NavigationCommand } from "@webgil/core";

export interface TouchNavigationOptions {
  onCommand(command: NavigationCommand): void;
  /** 입력창·명령창처럼 스크롤을 그대로 써야 하는 곳을 걸러낸다. */
  shouldIgnoreTarget?(target: EventTarget | null): boolean;
  /** 한 번의 이동으로 칠 최소 이동량(px). 낮추면 예민해지고, 높이면 손목이 아프다. */
  threshold?: number;
}

/**
 * 트랙패드의 두 손가락 스와이프는 브라우저에서 wheel 이벤트로 들어온다.
 * 일반 스크롤을 빼앗지 않도록 명시적으로 enabled인 동안에만 이벤트를 가로챈다.
 *
 * 브라우저는 wheel 이벤트만으로 트랙패드와 마우스 휠을 구분하지 못한다. 그래서 켜진 동안에는
 * 마우스 휠도 탐색으로 해석된다 — 모드를 사용자가 직접 켜고 끄게 만든 이유다. (docs/01_SYSTEM/04)
 *
 * 한 번의 스와이프는 한 번만 움직인다. wheel은 한 동작에 수십 번 들어오므로,
 * 명령을 한 번 낸 뒤에는 손가락을 뗄 때까지(=이벤트가 잠시 끊길 때까지) 더 내지 않는다.
 */
export class TouchNavigationController {
  private enabled = false;
  /** 이번 스와이프에서 이미 명령을 냈는가. 뗄 때까지 연속 발사를 막는다. */
  private commandFired = false;
  private deltaX = 0;
  private deltaY = 0;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly threshold: number;

  constructor(private readonly options: TouchNavigationOptions) {
    // 70px: 실사용에서 의도한 스와이프는 넘고 손 떨림은 못 넘는 값. 감도 노브다.
    this.threshold = options.threshold ?? 70;
    // passive: false 여야 preventDefault로 페이지 스크롤을 막을 수 있다.
    document.addEventListener("wheel", this.onWheel, { passive: false });
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    this.resetGesture();
    return this.enabled;
  }

  destroy(): void {
    document.removeEventListener("wheel", this.onWheel);
    this.resetGesture();
  }

  // 화살표 함수라 this가 고정된다 — removeEventListener에 같은 참조를 넘길 수 있다.
  private onWheel = (event: WheelEvent): void => {
    // Ctrl+휠은 브라우저 확대다. 저시력 사용자가 자주 쓰므로 절대 가로채지 않는다.
    if (!this.enabled || event.ctrlKey || this.options.shouldIgnoreTarget?.(event.target)) return;
    if (event.cancelable) event.preventDefault();
    if (this.commandFired) {
      // 아직 같은 스와이프가 이어지는 중. 손을 뗄 때까지 타이머만 미룬다.
      this.scheduleReset();
      return;
    }

    const multiplier = wheelMultiplier(event);
    this.deltaX += event.deltaX * multiplier;
    this.deltaY += event.deltaY * multiplier;
    this.scheduleReset();

    const command = commandFor(this.deltaX, this.deltaY, this.threshold);
    if (!command) return;

    this.commandFired = true;
    this.options.onCommand(command);
  };

  /** 160ms 동안 wheel이 없으면 손을 뗐다고 보고 다음 스와이프를 받는다(관성 스크롤의 꼬리보다 짧게). */
  private scheduleReset(): void {
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => this.resetGesture(), 160);
  }

  private resetGesture(): void {
    clearTimeout(this.resetTimer);
    this.resetTimer = undefined;
    this.deltaX = 0;
    this.deltaY = 0;
    this.commandFired = false;
  }
}

/**
 * 쌓인 이동량을 방향 하나로 정리한다. 대각선으로 그어도 더 많이 간 축만 본다 —
 * 두 방향을 동시에 처리하면 한 번의 스와이프가 두 칸씩 움직인다.
 *
 * 방향은 페이지의 Alt 조합과 같은 목록 은유다: 아래=다음, 오른쪽=하위 진입.
 * (패널 트리는 형제가 좌우로 보이므로 반대로 매핑한다 — 화면이 있고 없고의 차이다.)
 */
function commandFor(deltaX: number, deltaY: number, threshold: number): NavigationCommand | undefined {
  const horizontal = Math.abs(deltaX) > Math.abs(deltaY);
  const dominant = horizontal ? deltaX : deltaY;
  if (Math.abs(dominant) < threshold) return undefined;
  if (horizontal) return dominant > 0 ? "enter" : "back";
  return dominant > 0 ? "next" : "previous";
}

/** deltaMode가 줄·페이지 단위인 브라우저도 있다. 전부 px로 환산해야 threshold가 같은 뜻이 된다. */
function wheelMultiplier(event: WheelEvent): number {
  switch (event.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return 16; // 한 줄 ≈ 기본 글꼴 16px
    case WheelEvent.DOM_DELTA_PAGE:
      return window.innerHeight;
    default:
      return 1;
  }
}
