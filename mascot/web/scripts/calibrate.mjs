import { chromium } from "playwright-core";


const baseURL = process.env.PACTA_URL || "http://127.0.0.1:4185";
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

try {
  const page = await browser.newPage({ viewport: { width: 332, height: 301 } });
  await page.goto(baseURL, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForSelector("html[data-model-ready='true']", { timeout: 30_000 });
  await page.addStyleTag({
    content: ".topbar,.model-meta,.viewer-tools,.load-state,.mobile-process,.studio-glow{display:none!important}",
  });
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: new URL("../artifacts/web-front-332.png", import.meta.url).pathname,
  });
  console.log("Captured calibrated browser front view at 332×301.");
} finally {
  await browser.close();
}
