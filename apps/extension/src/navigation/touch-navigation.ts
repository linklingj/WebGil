import type { NavigationCommand } from "@webgil/core";

export interface TouchNavigationOptions {
  onCommand(command: NavigationCommand): void;
  shouldIgnoreTarget?(target: EventTarget | null): boolean;
  threshold?: number;
}

/**
 * 트랙패드의 두 손가락 스와이프는 브라우저에서 wheel 이벤트로 들어온다.
 * 일반 스크롤을 빼앗지 않도록 명시적으로 enabled인 동안에만 이벤트를 가로챈다.
 */
export class TouchNavigationController {
  private enabled = false;
  private locked = false;
  private deltaX = 0;
  private deltaY = 0;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly threshold: number;

  constructor(private readonly options: TouchNavigationOptions) {
    this.threshold = options.threshold ?? 70;
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

  private onWheel = (event: WheelEvent): void => {
    if (!this.enabled || event.ctrlKey || this.options.shouldIgnoreTarget?.(event.target)) return;
    if (event.cancelable) event.preventDefault();
    if (this.locked) {
      this.scheduleReset();
      return;
    }

    const multiplier = wheelMultiplier(event);
    this.deltaX += event.deltaX * multiplier;
    this.deltaY += event.deltaY * multiplier;
    this.scheduleReset();

    const command = commandFor(this.deltaX, this.deltaY, this.threshold);
    if (!command) return;

    this.locked = true;
    this.options.onCommand(command);
  };

  private scheduleReset(): void {
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => this.resetGesture(), 160);
  }

  private resetGesture(): void {
    clearTimeout(this.resetTimer);
    this.resetTimer = undefined;
    this.deltaX = 0;
    this.deltaY = 0;
    this.locked = false;
  }
}

function commandFor(deltaX: number, deltaY: number, threshold: number): NavigationCommand | undefined {
  const horizontal = Math.abs(deltaX) > Math.abs(deltaY);
  const dominant = horizontal ? deltaX : deltaY;
  if (Math.abs(dominant) < threshold) return undefined;
  if (horizontal) return dominant > 0 ? "enter" : "back";
  return dominant > 0 ? "next" : "previous";
}

function wheelMultiplier(event: WheelEvent): number {
  switch (event.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return 16;
    case WheelEvent.DOM_DELTA_PAGE:
      return window.innerHeight;
    default:
      return 1;
  }
}
