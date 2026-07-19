import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { configureElevenLabs } from "./lib/elevenlabs.mjs";
import {
  defaultPort,
  experimentDirectory,
} from "./lib/local-config.mjs";

const cloudflaredPath = path.join(experimentDirectory, "bin", "cloudflared");
const port = Number(process.env.PORT ?? defaultPort);
const children = new Set();
let shuttingDown = false;

async function ensureCloudflared() {
  try {
    await fs.access(cloudflaredPath, fs.constants.X_OK);
    return;
  } catch {}

  console.log("Downloading the official Cloudflare Tunnel binary…");
  const response = await fetch(
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
  );
  if (!response.ok) {
    throw new Error(`cloudflared download failed with HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1_000_000) {
    throw new Error(`cloudflared download was unexpectedly small (${bytes.byteLength} bytes)`);
  }
  await fs.mkdir(path.dirname(cloudflaredPath), { recursive: true });
  await fs.writeFile(cloudflaredPath, bytes, { mode: 0o755 });
}

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: experimentDirectory,
    stdio: options.stdio ?? "inherit",
    env: { ...process.env, PORT: String(port) },
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The local server did not become healthy within 15 seconds.");
}

function startTunnel() {
  const tunnel = run(
    cloudflaredPath,
    [
      "tunnel",
      "--no-autoupdate",
      "--protocol",
      "http2",
      "--url",
      `http://127.0.0.1:${port}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) reject(new Error("Cloudflare did not provide a tunnel URL within 30 seconds."));
    }, 30_000);

    const inspect = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };
    tunnel.stdout.on("data", inspect);
    tunnel.stderr.on("data", inspect);
    tunnel.once("exit", (code) => {
      if (!settled) reject(new Error(`Cloudflare Tunnel exited before startup (code ${code}).`));
    });
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 500).unref();
}

function stopWhenChildExitsUnexpectedly(child, label) {
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `${label} exited unexpectedly (code ${code ?? "null"}, signal ${signal ?? "none"}).`,
    );
    shutdown(code && code !== 0 ? code : 1);
  });
}

async function main() {
  await ensureCloudflared();

  const build = run("npm", ["run", "build"]);
  const buildCode = await new Promise((resolve) => build.once("exit", resolve));
  if (buildCode !== 0) throw new Error(`Browser build failed with exit code ${buildCode}.`);

  const server = run(process.execPath, ["server.mjs"]);
  stopWhenChildExitsUnexpectedly(server, "Local server");
  await waitForServer();

  const publicUrl = await startTunnel();
  const tunnel = [...children].find(
    (child) => child.spawnfile === cloudflaredPath,
  );
  if (!tunnel) throw new Error("Cloudflare Tunnel process disappeared during startup.");
  stopWhenChildExitsUnexpectedly(tunnel, "Cloudflare Tunnel");
  console.log(`\nRegistering webhook tools at ${publicUrl}…`);
  const state = await configureElevenLabs(publicUrl);

  console.log("\nREADY: shared-state negotiation demo is running.");
  console.log(`Local dashboard:  http://127.0.0.1:${port}`);
  console.log(`Tunnel dashboard: ${publicUrl}`);
  console.log(`ElevenLabs agent: ${state.agentName} (${state.agentId})`);
  console.log("Run `pnpm prove` in another terminal for the automated two-session proof.");
  console.log("Press Ctrl+C to stop the local server and tunnel.\n");

  await new Promise(() => {});
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

main().catch((error) => {
  console.error(`\nDemo startup failed: ${error.message}`);
  shutdown(1);
});
