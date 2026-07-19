import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { compileUseCaseConfig } from "./compiler";
import {
  compileToolRequestBodySchema,
  compileUseCaseToolSchemas,
  type ServerValidatedKeyword,
} from "./tool-schema";

async function fixture(name: string, version = "0.1.0") {
  return JSON.parse(
    await readFile(
      resolve(
        import.meta.dirname,
        `../../../config/use-cases/${name}/${version}.json`,
      ),
      "utf8",
    ),
  ) as unknown;
}

const validationOnlyKeywords = new Set([
  "additionalProperties",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "pattern",
  "uniqueItems",
]);

function pointerEscape(value: string) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function collectValidationOnlyKeywords(
  schema: Record<string, unknown>,
  pointer = "",
): ServerValidatedKeyword[] {
  const result: ServerValidatedKeyword[] = [];
  for (const [keyword, value] of Object.entries(schema)) {
    if (validationOnlyKeywords.has(keyword)) {
      result.push({
        schemaPointer: `${pointer}/${pointerEscape(keyword)}`,
        keyword,
        value,
      });
    }
  }
  const properties = schema.properties;
  if (
    properties &&
    typeof properties === "object" &&
    !Array.isArray(properties)
  ) {
    for (const [name, property] of Object.entries(properties)) {
      if (
        property &&
        typeof property === "object" &&
        !Array.isArray(property)
      ) {
        result.push(
          ...collectValidationOnlyKeywords(
            property as Record<string, unknown>,
            `${pointer}/properties/${pointerEscape(name)}`,
          ),
        );
      }
    }
  }
  if (
    schema.items &&
    typeof schema.items === "object" &&
    !Array.isArray(schema.items)
  ) {
    result.push(
      ...collectValidationOnlyKeywords(
        schema.items as Record<string, unknown>,
        `${pointer}/items`,
      ),
    );
  }
  return result.sort((left, right) =>
    left.schemaPointer.localeCompare(right.schemaPointer),
  );
}

describe("native webhook tool schema compiler", () => {
  it("compiles the short freight contract without exposing its derived total", async () => {
    const freight = compileUseCaseConfig(
      await fixture("freight-brokerage", "0.2.0"),
    );
    const compiled = compileUseCaseToolSchemas(freight.document);

    expect(
      freight.validateJob({
        origin: "Zurich",
        destination: "Munich",
        pickupTime: "tomorrow at 8am",
      }),
    ).toMatchObject({ valid: true, missingRequiredPaths: [] });
    expect(compiled.job.requestBodySchema.required).toEqual([
      "origin",
      "destination",
      "pickupTime",
    ]);
    expect(compiled.offer.excludedDerivedPaths).toEqual([
      "/normalized/totalMinor",
    ]);
    expect(compiled.offer.requestBodySchema.required).toEqual(["pricing"]);
    expect(compiled.offer.requestBodySchema.properties).not.toHaveProperty(
      "normalized",
    );

    const pricing = compiled.offer.requestBodySchema.properties.pricing;
    if (!pricing || pricing.type !== "object")
      throw new Error("Expected the short freight pricing object");
    expect(pricing.required).toEqual(["currency", "lineItems"]);
    const lineItems = pricing.properties.lineItems;
    if (!lineItems || lineItems.type !== "array")
      throw new Error("Expected the short freight line items array");
    expect(lineItems.items).toMatchObject({
      type: "object",
      properties: {
        code: { type: "string", enum: ["linehaul"] },
        amountMinor: { type: "integer" },
      },
      required: ["code", "amountMinor"],
    });
  });

  it("compiles freight deterministically and reports every server-only constraint", async () => {
    const freight = compileUseCaseConfig(await fixture("freight-brokerage"));
    const first = compileUseCaseToolSchemas(freight.document);
    const second = compileUseCaseToolSchemas(freight.document);

    expect(first).toEqual(second);
    expect(first.job.serverValidatedKeywords).toEqual(
      collectValidationOnlyKeywords(freight.document.job.schema),
    );
    expect(first.job.requestBodySchema.properties.equipmentType).toStrictEqual({
      type: "string",
      description: "Explicit value for /equipmentType.",
      enum: ["dry_van_53", "reefer_53", "flatbed", "box_truck"],
    });
    expect(first.job.serverValidatedKeywords).toContainEqual({
      schemaPointer: "/properties/pickupWindow/properties/start/format",
      keyword: "format",
      value: "date-time",
    });
    expect(first.job.serverValidatedKeywords).toContainEqual({
      schemaPointer: "/properties/specialServices/uniqueItems",
      keyword: "uniqueItems",
      value: true,
    });
    expect(first.job.serverValidatedKeywords).toContainEqual({
      schemaPointer: "/properties/weightKg/minimum",
      keyword: "minimum",
      value: 1,
    });
    expect(first.offer.excludedDerivedPaths).toEqual([
      "/normalized/totalMinor",
    ]);
    expect(first.offer.requestBodySchema.properties).not.toHaveProperty(
      "normalized",
    );
    expect(first.offer.requestBodySchema.required).not.toContain("normalized");

    const validJob = {
      origin: { city: "Zurich", country: "CH" },
      destination: { city: "Berlin", country: "DE" },
      pickupWindow: {
        start: "2026-07-20T08:00:00Z",
        end: "2026-07-20T10:00:00Z",
      },
      deliveryWindow: {
        start: "2026-07-21T08:00:00Z",
        end: "2026-07-21T18:00:00Z",
      },
      equipmentType: "dry_van_53",
      commodity: "Machine parts",
      weightKg: 1,
      handlingUnits: 1,
      hazmat: false,
      specialServices: [],
      risk: { criticality: "standard", minimumCoverageMinor: 0 },
    };
    expect(freight.validateJob(validJob).valid).toBe(true);
    const invalid = freight.validateJob({ ...validJob, weightKg: 0 });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instancePath: "/weightKg",
          keyword: "minimum",
        }),
      ]),
    );
  });

  it("compiles the structurally different contractor schema", async () => {
    const contractor = compileUseCaseConfig(await fixture("contractor-bids"));
    const compiled = compileUseCaseToolSchemas(contractor.document);

    expect(compiled.job.requestBodySchema.properties).toHaveProperty("project");
    expect(compiled.job.requestBodySchema.properties).not.toHaveProperty(
      "origin",
    );
    const pricing = compiled.offer.requestBodySchema.properties.pricing;
    expect(pricing).toMatchObject({ type: "object" });
    if (!pricing || pricing.type !== "object")
      throw new Error("Expected pricing object");
    const lineItems = pricing.properties.lineItems;
    if (!lineItems || lineItems.type !== "array")
      throw new Error("Expected line items array");
    expect(lineItems.items).toMatchObject({
      type: "object",
      properties: {
        basis: { type: "string", enum: ["flat", "per_unit"] },
      },
    });
    expect(compiled.offer.requestBodySchema.properties).not.toHaveProperty(
      "normalized",
    );
    expect(compiled.job.serverValidatedKeywords).toContainEqual({
      schemaPointer: "/properties/project/properties/scope/minLength",
      keyword: "minLength",
      value: 10,
    });
  });

  it("maps a supported string const to the provider's literal enum", () => {
    const compiled = compileToolRequestBodySchema({
      type: "object",
      properties: {
        decision: { type: "string", const: "confirmed" },
      },
      required: ["decision"],
    });
    expect(compiled.requestBodySchema.properties.decision).toEqual({
      type: "string",
      description: "Explicit value for /decision.",
      enum: ["confirmed"],
    });
  });

  it.each([
    [
      "composition",
      {
        type: "object",
        properties: {
          value: { oneOf: [{ type: "string" }, { type: "integer" }] },
        },
      },
      "Unsupported shape/composition keyword /properties/value/oneOf",
    ],
    [
      "nullable union",
      {
        type: "object",
        properties: { value: { type: ["string", "null"] } },
      },
      "Unsupported union type at /properties/value/type",
    ],
    [
      "tuple array",
      {
        type: "object",
        properties: {
          value: {
            type: "array",
            prefixItems: [{ type: "string" }, { type: "integer" }],
          },
        },
      },
      "Unsupported shape/composition keyword /properties/value/prefixItems",
    ],
    [
      "unknown keyword",
      {
        type: "object",
        properties: { value: { type: "string", madeUp: true } },
      },
      "Unsupported JSON Schema keyword /properties/value/madeUp",
    ],
  ])("rejects unsupported %s schemas", (_name, schema, message) => {
    expect(() => compileToolRequestBodySchema(schema)).toThrow(message);
  });
});
