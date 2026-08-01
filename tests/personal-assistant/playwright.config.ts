import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const repositoryRoot = resolve(__dirname, "../..");
const port = Number(process.env.JARVIS_PERSONAL_UI_PORT || 43917);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: __dirname,
  testMatch: "personal-assistant.spec.ts",
  outputDir: resolve(__dirname, "artifacts"),
  snapshotPathTemplate: "{testDir}/snapshots/{arg}-{projectName}{ext}",
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 7_500,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.015,
    },
  },
  reporter: [["list"]],
  use: {
    baseURL,
    colorScheme: "dark",
    locale: "pt-BR",
    serviceWorkers: "block",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: "node tests/personal-assistant/server.mjs",
    cwd: repositoryRoot,
    env: { ...process.env, JARVIS_PERSONAL_UI_PORT: String(port) },
    reuseExistingServer: false,
    timeout: 15_000,
    url: `${baseURL}/`,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        browserName: "chromium",
        deviceScaleFactor: 1,
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile-390x844",
      use: {
        browserName: "chromium",
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
