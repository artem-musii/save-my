import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const macChromePath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromePath =
  process.env.PLAYWRIGHT_CHROME_PATH ??
  (existsSync(macChromePath) ? macChromePath : undefined);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 30_000,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4178",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "bun run build && PORT=4178 bun run start",
    url: "http://127.0.0.1:4178/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromePath ? { executablePath: chromePath } : {},
      },
    },
  ],
});
