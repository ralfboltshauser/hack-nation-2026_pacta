import { afterEach, describe, expect, it } from "vitest";

import { outboundCallsEnabled } from "./calls";

const original = process.env.PACTA_OUTBOUND_CALLS_ENABLED;

afterEach(() => {
  if (original === undefined) delete process.env.PACTA_OUTBOUND_CALLS_ENABLED;
  else process.env.PACTA_OUTBOUND_CALLS_ENABLED = original;
});

describe("outbound call safety boundary", () => {
  it("fails closed unless the environment value is exactly true", () => {
    delete process.env.PACTA_OUTBOUND_CALLS_ENABLED;
    expect(outboundCallsEnabled()).toBe(false);
    process.env.PACTA_OUTBOUND_CALLS_ENABLED = "false";
    expect(outboundCallsEnabled()).toBe(false);
    process.env.PACTA_OUTBOUND_CALLS_ENABLED = "true";
    expect(outboundCallsEnabled()).toBe(true);
  });
});
