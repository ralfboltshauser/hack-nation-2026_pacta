import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { compileUseCaseConfig } from "./compiler";
import { evaluatePredicate } from "./predicates";

async function fixture(name: string) {
  return JSON.parse(
    await readFile(
      resolve(
        import.meta.dirname,
        `../../../config/use-cases/${name}/0.1.0.json`,
      ),
      "utf8",
    ),
  ) as unknown;
}

describe("use-case config compiler", () => {
  it("compiles structurally different freight and contractor contracts", async () => {
    const freight = compileUseCaseConfig(await fixture("freight-brokerage"));
    const contractor = compileUseCaseConfig(await fixture("contractor-bids"));

    expect(freight.document.key).toBe("freight_brokerage");
    expect(contractor.document.key).toBe("contractor_bids");
    expect(freight.contentSha256).not.toBe(contractor.contentSha256);
    expect(freight.document.job.fields.map((field) => field.path)).not.toEqual(
      contractor.document.job.fields.map((field) => field.path),
    );
  });

  it("distinguishes missing from explicit false", () => {
    expect(
      evaluatePredicate(
        { source: "job", path: "/hazmat", op: "missing" },
        { job: {}, offer: {}, session: {}, facts: {} },
      ),
    ).toBe(true);
    expect(
      evaluatePredicate(
        { source: "job", path: "/hazmat", op: "missing" },
        { job: { hazmat: false }, offer: {}, session: {}, facts: {} },
      ),
    ).toBe(false);
    expect(
      evaluatePredicate(
        { source: "job", path: "/hazmat", op: "eq", value: false },
        { job: { hazmat: false }, offer: {}, session: {}, facts: {} },
      ),
    ).toBe(true);
  });

  it("reports required paths without treating false or empty arrays as missing", async () => {
    const freight = compileUseCaseConfig(await fixture("freight-brokerage"));
    const result = freight.validateJob({ hazmat: false, specialServices: [] });
    expect(result.valid).toBe(false);
    expect(result.missingRequiredPaths).not.toContain("/hazmat");
    expect(result.missingRequiredPaths).not.toContain("/specialServices");
    expect(result.missingRequiredPaths).toContain("/origin");
  });
});
