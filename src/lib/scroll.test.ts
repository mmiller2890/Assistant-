import { describe, expect, test } from "vitest";
import { isNearBottom } from "./scroll";

describe("isNearBottom", () => {
  test("is true when scrolled exactly to the bottom", () => {
    // scrollTop 200 + clientHeight 800 == scrollHeight 1000 → distance 0
    expect(isNearBottom(200, 1000, 800)).toBe(true);
  });

  test("is true when within the default threshold of the bottom", () => {
    // distance = 1000 - 150 - 800 = 50, under the 80px default
    expect(isNearBottom(150, 1000, 800)).toBe(true);
  });

  test("is false when scrolled up beyond the threshold", () => {
    // distance = 1000 - 0 - 800 = 200, well above 80px
    expect(isNearBottom(0, 1000, 800)).toBe(false);
  });

  test("respects a custom threshold", () => {
    // distance = 1000 - 100 - 800 = 100
    expect(isNearBottom(100, 1000, 800, 150)).toBe(true);
    expect(isNearBottom(100, 1000, 800, 50)).toBe(false);
  });

  test("is true when content is shorter than the viewport (nothing to scroll)", () => {
    // distance = 400 - 0 - 800 = -400
    expect(isNearBottom(0, 400, 800)).toBe(true);
  });
});
