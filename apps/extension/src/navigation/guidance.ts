// 탐색 위치(계층·순서·전체 수) 낭독 설정. 민감 정보가 아니지만 저장소 접근은 Background가 맡는다.
export const NAVIGATION_GUIDANCE_STORAGE_KEY = "webgil.navigation.guidance";

export type NavigationGuidance = "compact" | "detailed";

export function isNavigationGuidance(value: unknown): value is NavigationGuidance {
  return value === "compact" || value === "detailed";
}

export function narrationDetailFor(guidance: NavigationGuidance): "full" | undefined {
  return guidance === "detailed" ? "full" : undefined;
}
