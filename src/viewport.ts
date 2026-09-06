export type ViewportProfile = "micro" | "compact" | "focused" | "standard" | "wide" | "ultrawide";
export type ViewportHeightProfile = "short" | "regular" | "tall";
export type ViewportPointer = "coarse" | "fine" | "none";

export interface ViewportMetrics {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  readonly profile: ViewportProfile;
  readonly heightProfile: ViewportHeightProfile;
  readonly pointer: ViewportPointer;
  readonly profileLabel: string;
}

const PROFILE_LABELS: Readonly<Record<ViewportProfile, string>> = {
  micro: "微型",
  compact: "紧凑",
  focused: "聚焦",
  standard: "标准",
  wide: "宽屏",
  ultrawide: "超宽",
};

function finitePixelValue(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;
}

export function getViewportMetrics(
  width: number,
  height: number,
  devicePixelRatio = 1,
  pointer: ViewportPointer = "none",
): ViewportMetrics {
  const safeWidth = finitePixelValue(width, 1);
  const safeHeight = finitePixelValue(height, 1);
  const safeDpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;

  const profile: ViewportProfile = safeWidth < 440
    ? "micro"
    : safeWidth < 680
      ? "compact"
      : safeWidth < 980
        ? "focused"
        : safeWidth < 1360
          ? "standard"
          : safeWidth < 2200
            ? "wide"
            : "ultrawide";
  const heightProfile: ViewportHeightProfile = safeHeight < 560
    ? "short"
    : safeHeight < 760
      ? "regular"
      : "tall";

  return {
    width: safeWidth,
    height: safeHeight,
    devicePixelRatio: safeDpr,
    profile,
    heightProfile,
    pointer,
    profileLabel: PROFILE_LABELS[profile],
  };
}
