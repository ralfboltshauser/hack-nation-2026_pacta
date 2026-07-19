import type { Predicate } from "./schema";
import { getPointer, hasPointer } from "./pointers";

export type PredicateSources = Record<
  "job" | "offer" | "session" | "facts",
  unknown
>;

export function evaluatePredicate(
  predicate: Predicate,
  sources: PredicateSources,
): boolean {
  if ("all" in predicate)
    return predicate.all.every((child) => evaluatePredicate(child, sources));
  if ("any" in predicate)
    return predicate.any.some((child) => evaluatePredicate(child, sources));
  if ("not" in predicate) return !evaluatePredicate(predicate.not, sources);

  const source = sources[predicate.source];
  const exists = hasPointer(source, predicate.path);
  if (predicate.op === "missing") return !exists;
  if (predicate.op === "present") return exists;
  if (!exists) return false;

  const actual = getPointer(source, predicate.path);
  switch (predicate.op) {
    case "eq":
      return Object.is(actual, predicate.value);
    case "neq":
      return !Object.is(actual, predicate.value);
    case "in":
      return (
        Array.isArray(predicate.value) &&
        predicate.value.some((value) => Object.is(actual, value))
      );
    case "not_in":
      return (
        Array.isArray(predicate.value) &&
        !predicate.value.some((value) => Object.is(actual, value))
      );
    case "contains":
      return (
        Array.isArray(actual) &&
        actual.some((value) => Object.is(value, predicate.value))
      );
    case "lt":
      return (
        typeof actual === "number" &&
        typeof predicate.value === "number" &&
        actual < predicate.value
      );
    case "lte":
      return (
        typeof actual === "number" &&
        typeof predicate.value === "number" &&
        actual <= predicate.value
      );
    case "gt":
      return (
        typeof actual === "number" &&
        typeof predicate.value === "number" &&
        actual > predicate.value
      );
    case "gte":
      return (
        typeof actual === "number" &&
        typeof predicate.value === "number" &&
        actual >= predicate.value
      );
    default:
      return false;
  }
}
