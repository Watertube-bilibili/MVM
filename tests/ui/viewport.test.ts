import { describe, expect, it } from "vitest";

import { getViewportMetrics } from "../../src/viewport";

describe("viewport profiles", () => {
  it.each([
    [360, 480, "micro", "short"],
    [480, 520, "compact", "short"],
    [640, 720, "compact", "regular"],
    [800, 600, "focused", "regular"],
    [1024, 768, "standard", "tall"],
    [1366, 768, "wide", "tall"],
    [1440, 900, "wide", "tall"],
    [1920, 1080, "wide", "tall"],
    [2560, 1440, "ultrawide", "tall"],
    [3840, 2160, "ultrawide", "tall"],
  ] as const)("maps %ix%i to %s/%s", (width, height, profile, heightProfile) => {
    expect(getViewportMetrics(width, height)).toMatchObject({ width, height, profile, heightProfile });
  });

  it("keeps boundaries deterministic", () => {
    expect(getViewportMetrics(439, 559).profile).toBe("micro");
    expect(getViewportMetrics(440, 560).profile).toBe("compact");
    expect(getViewportMetrics(680, 759).profile).toBe("focused");
    expect(getViewportMetrics(980, 760).profile).toBe("standard");
    expect(getViewportMetrics(1360, 760).profile).toBe("wide");
    expect(getViewportMetrics(2200, 900).profile).toBe("ultrawide");
  });

  it("sanitizes non-finite dimensions and DPR", () => {
    expect(getViewportMetrics(Number.NaN, Number.POSITIVE_INFINITY, 0)).toMatchObject({
      width: 1,
      height: 1,
      devicePixelRatio: 1,
      profile: "micro",
      heightProfile: "short",
    });
    expect(getViewportMetrics(800.9, 600.8, 1.25)).toMatchObject({
      width: 800,
      height: 600,
      devicePixelRatio: 1.25,
    });
  });

  it("carries the live pointer profile without changing layout thresholds", () => {
    expect(getViewportMetrics(1024, 768, 1.5, "coarse")).toMatchObject({
      profile: "standard",
      pointer: "coarse",
      devicePixelRatio: 1.5,
    });
  });
});
