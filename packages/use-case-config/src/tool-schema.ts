import type { UseCaseConfig } from "./schema";

export type ToolLiteralSchema = {
  type: "string" | "number" | "integer" | "boolean";
  description?: string;
  enum?: string[];
};

export type ToolArraySchema = {
  type: "array";
  description?: string;
  items: ToolSchemaProperty;
};

export type ToolObjectSchema = {
  type: "object";
  description?: string;
  properties: Record<string, ToolSchemaProperty>;
  required: string[];
};

export type ToolSchemaProperty =
  ToolLiteralSchema | ToolArraySchema | ToolObjectSchema;

export type ServerValidatedKeyword = {
  /** JSON Pointer to the keyword in the authoritative source schema. */
  schemaPointer: string;
  keyword: string;
  value: unknown;
};

export type CompiledToolRequestBodySchema = {
  requestBodySchema: ToolObjectSchema;
  /**
   * Constraints absent from the tool-provider schema vocabulary. The webhook
   * must validate the submitted body against the authoritative use-case schema.
   */
  serverValidatedKeywords: ServerValidatedKeyword[];
  /** Data JSON Pointers populated by deterministic server normalizers. */
  excludedDerivedPaths: string[];
};

export type CompiledUseCaseToolSchemas = {
  job: CompiledToolRequestBodySchema;
  offer: CompiledToolRequestBodySchema;
};

const primitiveTypes = new Set(["string", "number", "integer", "boolean"]);

const compositionKeywords = new Set([
  "$defs",
  "$ref",
  "allOf",
  "anyOf",
  "contains",
  "definitions",
  "dependentRequired",
  "dependentSchemas",
  "else",
  "if",
  "maxContains",
  "minContains",
  "not",
  "oneOf",
  "patternProperties",
  "prefixItems",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
]);

const serverValidatedKeywordsByType = {
  object: new Set(["minProperties", "maxProperties"]),
  array: new Set(["minItems", "maxItems", "uniqueItems"]),
  string: new Set(["format", "minLength", "maxLength", "pattern"]),
  number: new Set([
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
  ]),
  integer: new Set([
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
  ]),
  boolean: new Set<string>(),
} as const;

function pointerEscape(value: string) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPointer(pointer: string, segment: string) {
  return `${pointer}/${pointerEscape(segment)}`;
}

function assertRecord(
  value: unknown,
  schemaPointer: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Tool schema at ${schemaPointer || "/"} must be a JSON Schema object`,
    );
  }
}

function stableSortReports(reports: ServerValidatedKeyword[]) {
  return reports.sort((left, right) =>
    left.schemaPointer.localeCompare(right.schemaPointer),
  );
}

function recordServerKeyword(
  reports: ServerValidatedKeyword[],
  schemaPointer: string,
  keyword: string,
  value: unknown,
) {
  reports.push({
    schemaPointer: childPointer(schemaPointer, keyword),
    keyword,
    value,
  });
}

function assertKnownKeywords(
  schema: Record<string, unknown>,
  schemaPointer: string,
  type: "object" | "array" | "string" | "number" | "integer" | "boolean",
  reports: ServerValidatedKeyword[],
) {
  const structural = new Set(["type", "description"]);
  if (schemaPointer === "") structural.add("$schema");
  if (type === "object") {
    structural.add("properties");
    structural.add("required");
    structural.add("additionalProperties");
  }
  if (type === "array") structural.add("items");
  if (type === "string") {
    structural.add("enum");
    structural.add("const");
  }

  for (const [keyword, value] of Object.entries(schema)) {
    if (compositionKeywords.has(keyword)) {
      throw new Error(
        `Unsupported shape/composition keyword ${childPointer(schemaPointer, keyword)}`,
      );
    }
    if (structural.has(keyword)) continue;
    if (serverValidatedKeywordsByType[type].has(keyword)) {
      recordServerKeyword(reports, schemaPointer, keyword, value);
      continue;
    }
    throw new Error(
      `Unsupported JSON Schema keyword ${childPointer(schemaPointer, keyword)}`,
    );
  }
}

function compileDescription(schema: Record<string, unknown>) {
  if (schema.description === undefined) return undefined;
  if (typeof schema.description !== "string") {
    throw new Error("JSON Schema description must be a string");
  }
  return schema.description;
}

type CompileContext = {
  excludedDerivedPaths: Set<string>;
  matchedDerivedPaths: Set<string>;
  reports: ServerValidatedKeyword[];
};

function compileNode(
  input: unknown,
  schemaPointer: string,
  dataPointer: string,
  context: CompileContext,
): ToolSchemaProperty | undefined {
  if (context.excludedDerivedPaths.has(dataPointer)) {
    context.matchedDerivedPaths.add(dataPointer);
    return undefined;
  }

  assertRecord(input, schemaPointer);
  for (const keyword of Object.keys(input)) {
    if (compositionKeywords.has(keyword)) {
      throw new Error(
        `Unsupported shape/composition keyword ${childPointer(schemaPointer, keyword)}`,
      );
    }
  }
  const type = input.type;
  if (Array.isArray(type)) {
    throw new Error(
      `Unsupported union type at ${childPointer(schemaPointer, "type")}`,
    );
  }
  if (typeof type !== "string") {
    throw new Error(
      `Tool schema at ${schemaPointer || "/"} must declare exactly one type`,
    );
  }
  if (type !== "object" && type !== "array" && !primitiveTypes.has(type)) {
    throw new Error(
      `Unsupported JSON Schema type ${JSON.stringify(type)} at ${childPointer(schemaPointer, "type")}`,
    );
  }

  const supportedType = type as
    "object" | "array" | "string" | "number" | "integer" | "boolean";
  assertKnownKeywords(input, schemaPointer, supportedType, context.reports);
  const description = compileDescription(input);

  if (supportedType === "object") {
    if (input.additionalProperties !== undefined) {
      if (input.additionalProperties !== false) {
        throw new Error(
          `Only additionalProperties:false is supported at ${childPointer(schemaPointer, "additionalProperties")}`,
        );
      }
      recordServerKeyword(
        context.reports,
        schemaPointer,
        "additionalProperties",
        false,
      );
    }

    assertRecord(input.properties, childPointer(schemaPointer, "properties"));
    const sourceRequired = input.required ?? [];
    if (
      !Array.isArray(sourceRequired) ||
      sourceRequired.some((name) => typeof name !== "string")
    ) {
      throw new Error(
        `Object required must be a string array at ${childPointer(schemaPointer, "required")}`,
      );
    }
    if (new Set(sourceRequired).size !== sourceRequired.length) {
      throw new Error(
        `Object required contains duplicates at ${childPointer(schemaPointer, "required")}`,
      );
    }

    const properties: Record<string, ToolSchemaProperty> = {};
    for (const [name, property] of Object.entries(input.properties)) {
      const compiled = compileNode(
        property,
        childPointer(childPointer(schemaPointer, "properties"), name),
        childPointer(dataPointer, name),
        context,
      );
      if (compiled) properties[name] = compiled;
    }
    for (const name of sourceRequired) {
      if (!(name in input.properties)) {
        throw new Error(
          `Required property ${JSON.stringify(name)} is absent at ${childPointer(schemaPointer, "properties")}`,
        );
      }
    }
    if (
      Object.keys(properties).length === 0 &&
      Object.keys(input.properties).length > 0
    ) {
      return undefined;
    }

    const required = sourceRequired.filter((name) => name in properties);
    return {
      type: "object",
      ...(description === undefined ? {} : { description }),
      properties,
      required,
    };
  }

  if (supportedType === "array") {
    if (input.items === undefined) {
      throw new Error(
        `Array items are required at ${childPointer(schemaPointer, "items")}`,
      );
    }
    const items = compileNode(
      input.items,
      childPointer(schemaPointer, "items"),
      `${dataPointer}/*`,
      context,
    );
    if (!items) {
      throw new Error(
        `Array item schemas cannot be server-derived at ${childPointer(schemaPointer, "items")}`,
      );
    }
    return {
      type: "array",
      ...(description === undefined ? {} : { description }),
      items,
    };
  }

  const literal: ToolLiteralSchema = {
    type: supportedType,
    description: description ?? `Explicit value for ${dataPointer || "/"}.`,
  };
  if (input.enum !== undefined || input.const !== undefined) {
    if (supportedType !== "string") {
      throw new Error(
        `The tool provider only supports enums for strings at ${schemaPointer || "/"}`,
      );
    }
    if (
      input.enum !== undefined &&
      (!Array.isArray(input.enum) ||
        input.enum.length === 0 ||
        input.enum.some((value) => typeof value !== "string"))
    ) {
      throw new Error(
        `String enum must be a non-empty string array at ${childPointer(schemaPointer, "enum")}`,
      );
    }
    if (input.const !== undefined && typeof input.const !== "string") {
      throw new Error(
        `String const must be a string at ${childPointer(schemaPointer, "const")}`,
      );
    }
    if (
      input.enum !== undefined &&
      input.const !== undefined &&
      !(input.enum as string[]).includes(input.const as string)
    ) {
      throw new Error(
        `String const must belong to enum at ${schemaPointer || "/"}`,
      );
    }
    literal.enum =
      input.const === undefined
        ? [...(input.enum as string[])]
        : [input.const as string];
  }
  return literal;
}

export function compileToolRequestBodySchema(
  schema: Record<string, unknown>,
  options: { excludedDerivedPaths?: string[] } = {},
): CompiledToolRequestBodySchema {
  const excludedDerivedPaths = [
    ...new Set(options.excludedDerivedPaths ?? []),
  ].sort();
  for (const path of excludedDerivedPaths) {
    if (!path.startsWith("/")) {
      throw new Error(`Derived field path must be a JSON Pointer: ${path}`);
    }
  }

  const reports: ServerValidatedKeyword[] = [];
  const matchedDerivedPaths = new Set<string>();
  const compiled = compileNode(schema, "", "", {
    excludedDerivedPaths: new Set(excludedDerivedPaths),
    matchedDerivedPaths,
    reports,
  });
  if (!compiled || compiled.type !== "object") {
    throw new Error("Webhook request-body schema root must be an object");
  }
  for (const path of excludedDerivedPaths) {
    if (!matchedDerivedPaths.has(path)) {
      throw new Error(`Derived field path does not exist in schema: ${path}`);
    }
  }
  return {
    requestBodySchema: compiled,
    serverValidatedKeywords: stableSortReports(reports),
    excludedDerivedPaths,
  };
}

export function compileUseCaseToolSchemas(
  config: UseCaseConfig,
): CompiledUseCaseToolSchemas {
  return {
    job: compileToolRequestBodySchema(config.job.schema),
    offer: compileToolRequestBodySchema(config.offer.schema, {
      excludedDerivedPaths: config.offer.normalizers.map(
        (normalizer) => normalizer.output,
      ),
    }),
  };
}
