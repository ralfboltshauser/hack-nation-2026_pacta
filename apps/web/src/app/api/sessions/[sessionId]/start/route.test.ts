import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ runSessionAction: vi.fn() }));

vi.mock("@/server/orchestration/calls", () => ({
  runSessionAction: calls.runSessionAction,
}));

import { POST } from "./route";

describe("session start route", () => {
  beforeEach(() => {
    calls.runSessionAction.mockReset();
    calls.runSessionAction.mockResolvedValue({ skipped: true });
  });

  it.each([
    ["customer", "call_customer"],
    ["suppliers", "call_suppliers"],
  ] as const)("maps %s retries to %s", async (target, expectedAction) => {
    const sessionId = "00000000-0000-4000-8000-000000000001";
    const response = await POST(
      new Request("https://pacta.test/api/sessions/retry/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target }),
      }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(response.status).toBe(200);
    expect(calls.runSessionAction).toHaveBeenCalledOnce();
    expect(calls.runSessionAction).toHaveBeenCalledWith(
      sessionId,
      expectedAction,
    );
  });
});
