import { chromium, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

type CapturedTool = {
  name: string;
  registrationSignal?: AbortSignal;
  execute: (
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => Promise<unknown>;
};

const appUrl = process.env.DEMO_APP_URL ?? "http://127.0.0.1:3000";
const artifactDir = resolve("artifacts");
const outputPath = resolve(artifactDir, "save-my-demo-raw.webm");

const pause = (page: Page, milliseconds: number) =>
  page.waitForTimeout(milliseconds);

async function callTool(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const tools = (
        window as typeof window & { __saveMyWebmcpTools: CapturedTool[] }
      ).__saveMyWebmcpTools;
      const tool = [...tools]
        .reverse()
        .find(
          (candidate) =>
            candidate.name === toolName &&
            !candidate.registrationSignal?.aborted,
        );
      if (!tool) throw new Error(toolName + " is not active.");
      return tool.execute(toolInput, {
        signal: new AbortController().signal,
      });
    },
    { toolName: name, toolInput: input },
  );
}

await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: {
    dir: artifactDir,
    size: { width: 1440, height: 900 },
  },
});
const page = await context.newPage();

await page.addInitScript(() => {
  const tools: CapturedTool[] = [];
  Object.defineProperty(window, "__saveMyWebmcpTools", { value: tools });
  Object.defineProperty(Document.prototype, "modelContext", {
    configurable: true,
    get: () => ({
      registerTool: async (
        tool: Omit<CapturedTool, "registrationSignal">,
        options?: { signal?: AbortSignal },
      ) => {
        tools.push({ ...tool, registrationSignal: options?.signal });
      },
    }),
  });
});

await page.goto(appUrl);
await page.evaluate(() => document.fonts.ready);
await pause(page, 6_000);

await page.getByRole("button", { name: "Open Diamond Apps" }).click();
await page.getByRole("heading", { name: "Diamond Apps" }).waitFor();
await pause(page, 9_000);

await page.getByRole("button", { name: /Scenarios,/ }).click();
await pause(page, 4_000);
await page
  .locator(".scenario-card")
  .filter({ hasText: "Founder away, phone unreachable" })
  .click();
await pause(page, 8_000);

const summary = (await callTool(page, "get_workspace_summary", {})) as {
  workspaceVersion: number;
};
await callTool(page, "search_entities", { query: "Theo Mercer" });
await callTool(page, "search_entities", {
  query: "Theo’s personal phone",
});
await callTool(page, "validate_continuity_map", {
  expectedWorkspaceVersion: summary.workspaceVersion,
});
await callTool(page, "simulate_disruption", {
  name: "Founder and trusted phone unavailable",
  unavailableEntityIds: ["studio-founder", "studio-phone"],
  durationDays: 7,
  context: "Product releases and customer support must continue.",
  workspaceVersion: summary.workspaceVersion,
});
await pause(page, 8_000);

await page.getByRole("button", { name: /Open Site Tool call log/ }).click();
await pause(page, 6_000);
const results = page.getByText("Result", { exact: true });
if ((await results.count()) > 0) await results.last().click();
await pause(page, 5_000);
await page
  .getByRole("dialog", { name: "Site Tool call log" })
  .getByRole("button", { name: "Close" })
  .click();

await callTool(page, "draft_repair_options", {
  scenarioId: "studio-founder-away",
  workspaceVersion: summary.workspaceVersion,
  idempotencyKey: "submission-video-shared-custody-v1",
  options: [
    {
      optionLabel: "A",
      title: "Add shared release custody",
      rationale:
        "Create shared custody for release access and signing administration.",
      assumptions: ["Human verification is required before use."],
      tradeoff: {
        effort: "MEDIUM",
        timeToRestoreHours: 12,
        residualRisk: "LOW",
        summary: "Creates durable two-person custody.",
      },
      changes: [
        {
          op: "add-entity",
          entity: {
            id: "video-shared-custodian",
            name: "Shared release custodian",
            type: "team",
            critical: true,
            description: "Two-person custody for release access.",
          },
        },
        {
          op: "add-relationship",
          relationship: {
            id: "video-shared-account-path",
            from: "studio-apple-account",
            to: "video-shared-custodian",
            type: "owned-by",
            group: "access",
            label: "shared custody",
          },
        },
        {
          op: "add-relationship",
          relationship: {
            id: "video-shared-signing-path",
            from: "studio-cert",
            to: "video-shared-custodian",
            type: "administered-by",
            group: "custody",
            label: "maintained by",
          },
        },
        {
          op: "add-relationship",
          relationship: {
            id: "video-shared-operations-path",
            from: "studio-apple-account",
            to: "studio-ops",
            type: "owned-by",
            group: "access",
            label: "operations fallback",
          },
        },
        {
          op: "add-relationship",
          relationship: {
            id: "video-shared-device-path",
            from: "studio-apple-account",
            to: "studio-qa-devices",
            type: "recovers-via",
            group: "authentication",
            label: "shared recovery device",
          },
        },
        {
          op: "add-relationship",
          relationship: {
            id: "video-shared-delegation-path",
            from: "studio-engineering",
            to: "studio-ops",
            type: "substitutes-for",
            group: "delegation",
            label: "operations delegate",
          },
        },
      ],
    },
  ],
});

await page.getByRole("region", { name: "Repair preview" }).waitFor();
await pause(page, 9_000);
const preview = page.getByRole("region", { name: "Repair preview" });
await preview.getByRole("button", { name: /Current failure/ }).click();
await pause(page, 5_000);
await preview.getByRole("button", { name: /Proposed outcome/ }).click();
await pause(page, 7_000);
await preview.getByRole("button", { name: "View 6 exact changes" }).click();
await pause(page, 7_000);
await preview.getByRole("button", { name: "Adjust option" }).click();
await pause(page, 6_000);
await page
  .getByRole("dialog", { name: "Adjust this option" })
  .getByRole("button", { name: "Close" })
  .click();
await pause(page, 3_000);
await preview.getByRole("button", { name: "Apply repair" }).click();
await page.getByText("Resolved", { exact: true }).waitFor();
await pause(page, 8_000);
await page.getByRole("button", { name: "Activity" }).click();
await pause(page, 8_000);

const video = page.video();
await context.close();
if (!video) throw new Error("Playwright did not create a recording.");
await video.saveAs(outputPath);
await browser.close();

console.log(outputPath);
