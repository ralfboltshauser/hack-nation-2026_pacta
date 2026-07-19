export function decodePointerSegment(segment: string) {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function pointerSegments(pointer: string) {
  if (pointer === "") return [];
  if (!pointer.startsWith("/"))
    throw new Error(`Invalid JSON Pointer: ${pointer}`);
  return pointer.slice(1).split("/").map(decodePointerSegment);
}

export function hasPointer(document: unknown, pointer: string): boolean {
  let current = document;
  for (const segment of pointerSegments(pointer)) {
    if (
      current === null ||
      typeof current !== "object" ||
      !(segment in current)
    )
      return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}

export function getPointer(document: unknown, pointer: string): unknown {
  let current = document;
  for (const segment of pointerSegments(pointer)) {
    if (
      current === null ||
      typeof current !== "object" ||
      !(segment in current)
    )
      return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function setPointer(
  document: Record<string, unknown>,
  pointer: string,
  value: unknown,
) {
  const segments = pointerSegments(pointer);
  if (segments.length === 0)
    throw new Error("Replacing the document root is not allowed");
  let current: Record<string, unknown> = document;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (next === null || typeof next !== "object" || Array.isArray(next))
      current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1)!] = value;
}

export function schemaHasPointer(
  schema: Record<string, unknown>,
  pointer: string,
): boolean {
  let current: unknown = schema;
  for (const segment of pointerSegments(pointer)) {
    if (!current || typeof current !== "object") return false;
    const record = current as Record<string, unknown>;
    const properties = record.properties;
    if (properties && typeof properties === "object" && segment in properties) {
      current = (properties as Record<string, unknown>)[segment];
      continue;
    }
    if (record.type === "array" && record.items && /^\d+$/.test(segment)) {
      current = record.items;
      continue;
    }
    return false;
  }
  return true;
}
