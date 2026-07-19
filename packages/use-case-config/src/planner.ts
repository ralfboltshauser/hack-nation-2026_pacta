import type { UseCaseConfig } from "./schema";
import { getPointer, hasPointer } from "./pointers";

export function nextMissingQuestion(
  config: UseCaseConfig,
  job: unknown,
  channel: "voice" | "chat",
) {
  return config.job.fields
    .filter((field) => !hasPointer(job, field.path))
    .sort((left, right) => right.priority - left.priority)
    .map((field) => ({ field, question: field.questions[channel]?.[0] }))
    .find((candidate) => candidate.question);
}

export function readback(config: UseCaseConfig, job: unknown) {
  const fields = new Map(config.job.fields.map((field) => [field.path, field]));
  return config.job.completion.confirmation.readbackPaths.map((path) => ({
    path,
    label: fields.get(path)?.confirmationLabel ?? path,
    value: getPointer(job, path),
  }));
}
