import { afterEach, describe, expect, it } from "vitest";

import { hasDemoAccess } from "./access";

const originalDemoAccessKey = process.env.PACTA_DEMO_ACCESS_KEY;

afterEach(() => {
  if (originalDemoAccessKey === undefined)
    delete process.env.PACTA_DEMO_ACCESS_KEY;
  else process.env.PACTA_DEMO_ACCESS_KEY = originalDemoAccessKey;
});

describe("hasDemoAccess", () => {
  it("fails closed when no server key is configured", () => {
    delete process.env.PACTA_DEMO_ACCESS_KEY;
    expect(
      hasDemoAccess(
        new Request("https://pacta.test", {
          headers: { "x-pacta-demo-key": "supplied" },
        }),
      ),
    ).toBe(false);
  });

  it("accepts only the exact configured key", () => {
    process.env.PACTA_DEMO_ACCESS_KEY = "expected";
    expect(
      hasDemoAccess(
        new Request("https://pacta.test", {
          headers: { "x-pacta-demo-key": "wrong" },
        }),
      ),
    ).toBe(false);
    expect(
      hasDemoAccess(
        new Request("https://pacta.test", {
          headers: { "x-pacta-demo-key": "expected" },
        }),
      ),
    ).toBe(true);
  });
});
