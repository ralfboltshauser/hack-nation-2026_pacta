import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const experimentDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const repositoryRoot = path.resolve(experimentDirectory, "../../..");
export const runtimeDirectory = path.join(experimentDirectory, ".runtime");
export const runtimeStatePath = path.join(runtimeDirectory, "registration.json");
export const defaultPort = 8787;

export function parseDotEnv(source) {
  const values = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

export async function readRepositoryEnvironment() {
  let fileValues = {};
  try {
    fileValues = parseDotEnv(
      await fs.readFile(path.join(repositoryRoot, ".env"), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  // This experiment is configured by the repository .env. Prefer it over an
  // inherited shell value so a stale machine-wide key cannot silently select a
  // different ElevenLabs account or make authenticated API calls fail.
  return { ...process.env, ...fileValues };
}

export async function requireElevenLabsApiKey() {
  const environment = await readRepositoryEnvironment();
  if (!environment.ELEVENLABS_API_KEY) {
    throw new Error(
      `ELEVENLABS_API_KEY is missing from ${path.join(repositoryRoot, ".env")}`,
    );
  }
  return environment.ELEVENLABS_API_KEY;
}

export async function readRuntimeState() {
  try {
    return JSON.parse(await fs.readFile(runtimeStatePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeRuntimeState(value) {
  await fs.mkdir(runtimeDirectory, { recursive: true });
  const temporaryPath = `${runtimeStatePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.rename(temporaryPath, runtimeStatePath);
}

export async function ensureRuntimeState() {
  const existing = await readRuntimeState();
  if (existing?.webhookSecret) return existing;

  const state = {
    ...(existing ?? {}),
    webhookSecret: crypto.randomBytes(32).toString("hex"),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await writeRuntimeState(state);
  return state;
}
