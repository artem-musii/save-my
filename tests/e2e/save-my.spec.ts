import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { wowProjectBlueprint } from "../../src/fixtures/wowProjectBlueprint";

test.setTimeout(45_000);

async function signIn(page: Page) {
  await page.getByRole("button", { name: "Sign in" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in to your account" });
  await dialog.getByLabel("Email").fill("judge@savemy.systems");
  await dialog.getByLabel("Password").fill("SaveMy-Judge-2026");
  await dialog.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Add company" })).toBeVisible();
}

async function settleResponsiveLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function expectLandingHeaderToFit(page: Page, width: number) {
  await page.setViewportSize({ width, height: 760 });
  await settleResponsiveLayout(page);
  const geometry = await page.evaluate(() => {
    const rect = (element: Element) => {
      const bounds = element.getBoundingClientRect();
      const html = element as HTMLElement;
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        right: bounds.right,
        bottom: bounds.bottom,
        scrollWidth: html.scrollWidth,
        clientWidth: html.clientWidth,
        scrollHeight: html.scrollHeight,
        clientHeight: html.clientHeight,
      };
    };
    const header = document.querySelector(".landing-header");
    const brand = document.querySelector(".landing-header .brand");
    const actions = document.querySelector(".landing-actions");
    if (!header || !brand || !actions)
      throw new Error("Landing header geometry is unavailable.");
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      header: rect(header),
      brand: rect(brand),
      actions: rect(actions),
      controls: Array.from(actions.children)
        .filter((element) => getComputedStyle(element).display !== "none")
        .map((element) => {
          const directLabel = element.querySelector(":scope > span");
          return {
            label: element.textContent?.trim() ?? "unnamed control",
            ...rect(element),
            directLabel:
              directLabel && getComputedStyle(directLabel).display !== "none"
                ? rect(directLabel)
                : null,
          };
        }),
    };
  });

  expect
    .soft(geometry.viewportWidth, `viewport width at ${width}px`)
    .toBe(width);
  expect
    .soft(geometry.documentWidth, `landing overflow at ${width}px`)
    .toBeLessThanOrEqual(width);
  expect
    .soft(
      geometry.actions.x - geometry.brand.right,
      `brand/action spacing at ${width}px`,
    )
    .toBeGreaterThanOrEqual(8);

  for (const [label, box] of [
    ["brand", geometry.brand],
    ["actions", geometry.actions],
  ] as const) {
    expect
      .soft(box.x, `${label} left bound at ${width}px`)
      .toBeGreaterThanOrEqual(geometry.header.x);
    expect
      .soft(box.right, `${label} right bound at ${width}px`)
      .toBeLessThanOrEqual(geometry.header.right);
    expect
      .soft(box.y, `${label} top bound at ${width}px`)
      .toBeGreaterThanOrEqual(geometry.header.y);
    expect
      .soft(box.bottom, `${label} bottom bound at ${width}px`)
      .toBeLessThanOrEqual(geometry.header.bottom);
    expect
      .soft(box.scrollWidth, `${label} horizontal clipping at ${width}px`)
      .toBeLessThanOrEqual(box.clientWidth + 1);
    expect
      .soft(box.scrollHeight, `${label} vertical clipping at ${width}px`)
      .toBeLessThanOrEqual(box.clientHeight + 1);
  }

  geometry.controls.forEach((control, index) => {
    expect
      .soft(control.x, `${control.label} left bound at ${width}px`)
      .toBeGreaterThanOrEqual(geometry.header.x);
    expect
      .soft(control.right, `${control.label} right bound at ${width}px`)
      .toBeLessThanOrEqual(geometry.header.right);
    expect
      .soft(control.y, `${control.label} top bound at ${width}px`)
      .toBeGreaterThanOrEqual(geometry.header.y);
    expect
      .soft(control.bottom, `${control.label} bottom bound at ${width}px`)
      .toBeLessThanOrEqual(geometry.header.bottom);
    expect
      .soft(control.width, `${control.label} touch width at ${width}px`)
      .toBeGreaterThanOrEqual(44);
    expect
      .soft(control.height, `${control.label} touch height at ${width}px`)
      .toBeGreaterThanOrEqual(44);
    expect
      .soft(
        control.scrollWidth,
        `${control.label} horizontal clipping at ${width}px`,
      )
      .toBeLessThanOrEqual(control.clientWidth + 1);
    expect
      .soft(
        control.scrollHeight,
        `${control.label} vertical clipping at ${width}px`,
      )
      .toBeLessThanOrEqual(control.clientHeight + 1);
    if (control.directLabel) {
      expect
        .soft(
          control.directLabel.x,
          `${control.label} label left bound at ${width}px`,
        )
        .toBeGreaterThanOrEqual(control.x - 1);
      expect
        .soft(
          control.directLabel.right,
          `${control.label} label right bound at ${width}px`,
        )
        .toBeLessThanOrEqual(control.right + 1);
    }
    if (index > 0) {
      const previous = geometry.controls[index - 1]!;
      expect
        .soft(
          control.x - previous.right,
          `${previous.label}/${control.label} spacing at ${width}px`,
        )
        .toBeGreaterThanOrEqual(8);
    }
  });
}

async function expectLandingCardsToFit(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await settleResponsiveLayout(page);
  const geometry = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    cards: Array.from(
      document.querySelectorAll<HTMLElement>(".company-card"),
    ).map((card) => {
      const bounds = card.getBoundingClientRect();
      return {
        name: card.querySelector("strong")?.textContent ?? "unnamed company",
        x: bounds.x,
        right: bounds.right,
        scrollWidth: card.scrollWidth,
        clientWidth: card.clientWidth,
        childBounds: Array.from(card.children).map((child) => {
          const childRect = child.getBoundingClientRect();
          return { x: childRect.x, right: childRect.right };
        }),
      };
    }),
  }));

  expect
    .soft(geometry.viewportWidth, `viewport width at ${width}px`)
    .toBe(width);
  expect
    .soft(geometry.documentWidth, `landing card overflow at ${width}px`)
    .toBeLessThanOrEqual(width);
  for (const card of geometry.cards) {
    expect
      .soft(card.x, `${card.name} left bound at ${width}px`)
      .toBeGreaterThanOrEqual(0);
    expect
      .soft(card.right, `${card.name} right bound at ${width}px`)
      .toBeLessThanOrEqual(width);
    expect
      .soft(card.scrollWidth, `${card.name} content overflow at ${width}px`)
      .toBeLessThanOrEqual(card.clientWidth + 1);
    for (const child of card.childBounds) {
      expect
        .soft(child.x, `${card.name} child left bound at ${width}px`)
        .toBeGreaterThanOrEqual(card.x - 1);
      expect
        .soft(child.right, `${card.name} child right bound at ${width}px`)
        .toBeLessThanOrEqual(card.right + 1);
    }
  }
}

async function installNativeToolHarness(
  page: Page,
  { failFirstWorkspaceRegistration = false } = {},
) {
  await page.addInitScript(
    ({ failFirstWorkspaceRegistration }) => {
      type CapturedTool = {
        name: string;
        execute: (
          input: Record<string, unknown>,
          options: { signal: AbortSignal },
        ) => Promise<unknown>;
        registrationSignal?: AbortSignal;
      };
      const tools: CapturedTool[] = [];
      let shouldFailWorkspaceRegistration = failFirstWorkspaceRegistration;
      Object.defineProperty(window, "__saveMyWebmcpTools", { value: tools });
      Object.defineProperty(Document.prototype, "modelContext", {
        configurable: true,
        get: () => ({
          registerTool: async (
            tool: Omit<CapturedTool, "registrationSignal">,
            options?: { signal?: AbortSignal },
          ) => {
            tools.push({ ...tool, registrationSignal: options?.signal });
            if (
              shouldFailWorkspaceRegistration &&
              tool.name === "get_workspace_summary"
            ) {
              shouldFailWorkspaceRegistration = false;
              throw new Error("simulated workspace tool registration failure");
            }
          },
        }),
      });
    },
    { failFirstWorkspaceRegistration },
  );
}

test("opens every rich seeded organization", async ({ page }) => {
  const workspaces = [
    ["northstar-studio", "Diamond Apps", "40 items"],
    ["cedar-classroom", "Study Top", "28 items"],
    ["ember-table", "One Evening", "28 items"],
    ["meridian-charter", "Meridian", "28 items"],
  ] as const;
  for (const [slug, name, count] of workspaces) {
    await page.goto(`/?workspace=${slug}`);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByLabel("Continuity dependency graph")).toBeVisible();
    await expect(page.getByText(count, { exact: true })).toBeVisible();
  }
});

test("recovers from bootstrap and company load failures and surfaces action errors", async ({
  page,
}) => {
  let bootstrapAttempts = 0;
  const bootstrapPattern = "**/api/bootstrap";
  await page.route(bootstrapPattern, async (route) => {
    bootstrapAttempts += 1;
    if (bootstrapAttempts === 1)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Bootstrap temporarily unavailable" }),
      });
    else await route.continue();
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "We couldn’t load your companies." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".company-card")).toHaveCount(4);
  await page.unroute(bootstrapPattern);

  let workspaceAttempts = 0;
  const workspacePattern = "**/api/workspaces/northstar-studio";
  await page.route(workspacePattern, async (route) => {
    workspaceAttempts += 1;
    if (workspaceAttempts === 1)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Company temporarily unavailable" }),
      });
    else await route.continue();
  });
  await page.goto("/?workspace=northstar-studio");
  await expect(
    page.getByRole("heading", { name: "We couldn’t load this company." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Diamond Apps" }),
  ).toBeVisible();
  await page.unroute(workspacePattern);

  const searchPattern = "**/api/workspaces/northstar-studio/search**";
  await page.route(searchPattern, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Search temporarily unavailable" }),
    });
  });
  await page.getByRole("button", { name: "Search company" }).click();
  const search = page.getByRole("dialog", { name: "Search the company" });
  await search
    .getByLabel("Search by name, role, or description")
    .fill("billing");
  await expect(search.getByRole("alert")).toContainText(
    "Search failed: Search temporarily unavailable",
  );
  await search.getByRole("button", { name: "Close" }).click();
  await page.unroute(searchPattern);

  const simulatePattern = "**/api/workspaces/northstar-studio/simulate";
  await page.route(simulatePattern, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Simulation temporarily unavailable" }),
    });
  });
  await page.getByRole("button", { name: /Scenarios,/ }).click();
  await page.locator(".scenario-card").first().click();
  await expect(page.getByRole("alert")).toContainText(
    "Simulation temporarily unavailable",
  );
  await page.unroute(simulatePattern);
});

test("shows a connected agent-suggested node only in After, then applies it", async ({
  page,
}) => {
  await page.goto("/?workspace=northstar-studio");
  const baseline = await page.evaluate(
    async () =>
      (await (await fetch("/api/workspaces/northstar-studio")).json())
        .workspace,
  );
  const staged = await page.evaluate(async () => {
    const response = await fetch(
      "/api/workspaces/northstar-studio/draft/repair-options",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: "studio-founder-away",
          workspaceVersion: 1,
          idempotencyKey: "e2e-structural-repair-v1",
          options: [
            {
              optionLabel: "A",
              title: "Add a shared release custodian",
              rationale:
                "Create shared custody for release access and signing administration.",
              assumptions: ["Human verification is required."],
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
                    id: "agent-shared-custodian",
                    name: "Shared release custodian",
                    type: "team",
                    critical: true,
                    description: "Two-person custody for release access.",
                  },
                },
                {
                  op: "add-relationship",
                  relationship: {
                    id: "agent-shared-account-path",
                    from: "studio-apple-account",
                    to: "agent-shared-custodian",
                    type: "owned-by",
                    group: "access",
                    label: "shared custody",
                  },
                },
                {
                  op: "add-relationship",
                  relationship: {
                    id: "agent-shared-signing-path",
                    from: "studio-cert",
                    to: "agent-shared-custodian",
                    type: "administered-by",
                    group: "custody",
                    label: "maintained by",
                  },
                },
                {
                  op: "add-relationship",
                  relationship: {
                    id: "agent-shared-operations-path",
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
                    id: "agent-shared-device-path",
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
                    id: "agent-shared-delegation-path",
                    from: "studio-engineering",
                    to: "studio-ops",
                    type: "substitutes-for",
                    group: "delegation",
                    label: "operations delegate",
                  },
                },
              ],
            },
            {
              optionLabel: "B",
              title: "Add a continuity council and escrow account",
              rationale:
                "Separate shared human custody from the recovery account used for release access.",
              assumptions: ["External custody must be contractually verified."],
              tradeoff: {
                effort: "HIGH",
                timeToRestoreHours: 24,
                residualRisk: "LOW",
                summary: "Adds independent people and account recovery layers.",
              },
              changes: [
                {
                  op: "add-entity",
                  entity: {
                    id: "agent-continuity-council",
                    name: "Continuity council",
                    type: "team",
                    critical: true,
                    description: "Independent dual-control release custodians.",
                  },
                },
                {
                  op: "add-entity",
                  entity: {
                    id: "agent-release-escrow",
                    name: "Release escrow account",
                    type: "account",
                    critical: true,
                    description: "Separate account recovery layer.",
                  },
                },
                {
                  op: "add-relationship",
                  relationship: {
                    id: "agent-council-account-path",
                    from: "studio-apple-account",
                    to: "agent-continuity-council",
                    type: "owned-by",
                    group: "access",
                    label: "council custody",
                  },
                },
                {
                  op: "add-relationship",
                  relationship: {
                    id: "agent-council-signing-path",
                    from: "studio-cert",
                    to: "agent-continuity-council",
                    type: "administered-by",
                    group: "custody",
                    label: "council maintained",
                  },
                },
                {
                  op: "add-relationship",
                  relationship: {
                    id: "agent-council-operations-path",
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
                    id: "agent-council-device-path",
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
                    id: "agent-council-delegation-path",
                    from: "studio-engineering",
                    to: "studio-ops",
                    type: "substitutes-for",
                    group: "delegation",
                    label: "operations delegate",
                  },
                },
                {
                  op: "add-relationship",
                  relationship: {
                    id: "agent-escrow-recovery-path",
                    from: "studio-apple-account",
                    to: "agent-release-escrow",
                    type: "recovers-via",
                    group: "authentication",
                    label: "escrow recovery",
                  },
                },
              ],
            },
          ],
        }),
      },
    );
    return { status: response.status, body: await response.json() };
  });
  expect(staged.status).toBe(201);
  expect(staged.body.workspaceVersion).toBe(2);
  await page.reload();

  const preview = page.getByRole("region", { name: "Repair preview" });
  await expect(preview).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Proposed outcome 0 blocked/ }),
  ).toBeVisible();
  const proposedNode = page.getByRole("button", {
    name: "Shared release custodian, team, critical item, New proposed item",
  });
  await expect(proposedNode).toBeVisible();
  await expect(page.locator(".graph-edge.is-proposed")).toHaveCount(5);
  await proposedNode.click();
  const inspector = page.locator(".entity-inspector");
  await expect(inspector).toContainText("Shared release custodian");
  await expect(inspector).toContainText("Proposed · not applied");

  await preview.getByRole("button", { name: /Current failure/ }).click();
  await expect(
    page.getByRole("button", { name: /Shared release custodian, team/ }),
  ).toHaveCount(0);
  await expect(page.locator(".graph-edge.is-proposed")).toHaveCount(0);
  await expect(
    page.getByText("Baseline graph only · proposal hidden"),
  ).toBeVisible();

  await preview.getByRole("button", { name: /Proposed outcome/ }).click();
  await preview.getByRole("button", { name: "Adjust option" }).click();
  const editor = page.getByRole("dialog", { name: "Adjust this option" });
  await editor.getByLabel("Option name").fill("Shared custody, reviewed");
  await editor.getByRole("button", { name: "Save adjusted option" }).click();
  await expect(preview).toContainText("Shared custody, reviewed");
  await expect(
    page.getByRole("button", { name: /Proposed outcome 0 blocked/ }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "View 6 exact changes" }).click();
  const changes = page.getByLabel("Exact proposed changes");
  await expect(
    changes.getByText("Shared release custodian", { exact: true }),
  ).toBeVisible();
  await expect(changes.getByText("Add path", { exact: true })).toHaveCount(5);
  const unchanged = await page.evaluate(
    async () =>
      (await (await fetch("/api/workspaces/northstar-studio")).json())
        .workspace,
  );
  expect(unchanged.entities).toHaveLength(baseline.entities.length);
  expect(unchanged.relationships).toHaveLength(baseline.relationships.length);
  expect(
    unchanged.entities.some(
      (entity: { id: string }) => entity.id === "agent-shared-custodian",
    ),
  ).toBe(false);

  await preview.getByRole("button", { name: "Apply repair" }).click();
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
  const applied = await page.evaluate(
    async () =>
      (await (await fetch("/api/workspaces/northstar-studio")).json())
        .workspace,
  );
  expect(applied.entities).toHaveLength(baseline.entities.length + 1);
  expect(applied.relationships).toHaveLength(baseline.relationships.length + 5);
  expect(
    applied.entities.some(
      (entity: { id: string }) => entity.id === "agent-shared-custodian",
    ),
  ).toBe(true);
});

test("registers all 18 native tools and shows executions in the product log", async ({
  page,
}) => {
  await installNativeToolHarness(page);
  await page.goto("/?workspace=northstar-studio");
  await expect(page.getByText("Site Tools · 18 ready")).toBeVisible();
  const result = await page.evaluate(async () => {
    type CapturedTool = {
      name: string;
      registrationSignal?: AbortSignal;
      execute: (
        input: Record<string, unknown>,
        options: { signal: AbortSignal },
      ) => Promise<unknown>;
    };
    const tools = (
      window as typeof window & { __saveMyWebmcpTools: CapturedTool[] }
    ).__saveMyWebmcpTools;
    const live = tools.filter((tool) => !tool.registrationSignal?.aborted);
    const summary = [...live]
      .reverse()
      .find((tool) => tool.name === "get_workspace_summary");
    if (!summary) throw new Error("Summary tool was not registered.");
    return {
      activeCount: live.length,
      summary: await summary.execute(
        {},
        { signal: new AbortController().signal },
      ),
    };
  });
  expect(result.activeCount).toBe(18);
  expect(result.summary).toMatchObject({ name: "Diamond Apps" });
  await page
    .getByRole("button", { name: "Open Site Tool call log, 1 calls" })
    .click();
  const log = page.getByRole("dialog", { name: "Site Tool call log" });
  await expect(log.getByText("Get workspace summary")).toBeVisible();
  await expect(log.getByText("succeeded", { exact: true })).toBeVisible();
  await log.getByText("Result", { exact: true }).click();
  await expect(log.getByText(/workspaceVersion/)).toBeVisible();
  await log.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Open Study Top, demo" }).click();
  await expect(page.getByRole("heading", { name: "Study Top" })).toBeVisible();
  const switched = await page.evaluate(async () => {
    type CapturedTool = {
      name: string;
      registrationSignal?: AbortSignal;
      execute: (
        input: Record<string, unknown>,
        options: { signal: AbortSignal },
      ) => Promise<unknown>;
    };
    const tools = (
      window as typeof window & { __saveMyWebmcpTools: CapturedTool[] }
    ).__saveMyWebmcpTools;
    const originalSummary = tools.find(
      (tool) => tool.name === "get_workspace_summary",
    );
    if (!originalSummary) throw new Error("Original summary tool is missing.");
    const summary = (await originalSummary.execute(
      {},
      { signal: new AbortController().signal },
    )) as { name: string };
    return {
      originalRegistrationStillActive:
        !originalSummary.registrationSignal?.aborted,
      name: summary.name,
      activeToolCount: tools.filter((tool) => !tool.registrationSignal?.aborted)
        .length,
    };
  });
  expect(switched).toEqual({
    originalRegistrationStillActive: true,
    name: "Study Top",
    activeToolCount: 18,
  });
});

test("creates a full company and several scenarios through registered Site Tool callbacks", async ({
  page,
}) => {
  await installNativeToolHarness(page);
  await page.goto("/");
  await expect(page.getByText("Site Tools · 2 ready")).toBeVisible();
  await signIn(page);
  const companyName = `Native Wow Project ${Date.now()}`;
  const idempotencyKey = `native-company-${Date.now()}`;
  const chain = await page.evaluate(
    async ({ name, key, blueprint }) => {
      type CapturedTool = {
        name: string;
        registrationSignal?: AbortSignal;
        execute: (
          input: Record<string, unknown>,
          options: { signal: AbortSignal },
        ) => Promise<unknown>;
      };
      const tools = (
        window as typeof window & { __saveMyWebmcpTools: CapturedTool[] }
      ).__saveMyWebmcpTools;
      const live = (toolName: string) => {
        const tool = [...tools]
          .reverse()
          .find(
            (candidate) =>
              candidate.name === toolName &&
              !candidate.registrationSignal?.aborted,
          );
        if (!tool) throw new Error(`${toolName} is not active.`);
        return tool;
      };
      const signal = () => ({ signal: new AbortController().signal });
      const created = (await live("create_company").execute(
        {
          name,
          idempotencyKey: key,
          setupMode: "agent-blueprint",
        },
        signal(),
      )) as Record<string, unknown>;
      const summary = (await live("get_workspace_summary").execute(
        {},
        signal(),
      )) as Record<string, unknown>;
      const drafted = (await live("draft_company_blueprint").execute(
        {
          workspaceVersion: summary.workspaceVersion,
          idempotencyKey: `${key}-blueprint`,
          ...blueprint,
          companyName: name,
        },
        signal(),
      )) as Record<string, unknown>;
      return { created, summary, drafted };
    },
    {
      name: companyName,
      key: idempotencyKey,
      blueprint: wowProjectBlueprint,
    },
  );
  expect(chain.created).toMatchObject({
    companyName,
    workspaceToolsReady: true,
    nextTool: "draft_company_blueprint",
  });
  expect(chain.summary).toMatchObject({ name: companyName, entityCount: 0 });
  expect(chain.drafted.blueprintReview).toMatchObject({
    baselineChanged: false,
    humanReviewRequired: true,
  });
  expect(chain.drafted.proposedChangeCount).toBe(118);
  await expect(
    page.getByRole("region", { name: "Proposal preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Draft preview 40 new items" }),
  ).toBeVisible();
  const beforeApply = await page.evaluate(async () => {
    const slug = new URLSearchParams(location.search).get("workspace")!;
    return (await (await fetch(`/api/workspaces/${slug}`)).json()).workspace;
  });
  expect(beforeApply.entities).toHaveLength(0);
  await page.getByRole("button", { name: "Apply company map" }).click();
  await expect(
    page.getByText("40 items · 30 single-path dependencies"),
  ).toBeVisible();

  const scenarios = await page.evaluate(async () => {
    type EntityResult = { entities: Array<{ id: string; name: string }> };
    type CapturedTool = {
      name: string;
      registrationSignal?: AbortSignal;
      execute: (
        input: Record<string, unknown>,
        options: { signal: AbortSignal },
      ) => Promise<unknown>;
    };
    const tools = (
      window as typeof window & { __saveMyWebmcpTools: CapturedTool[] }
    ).__saveMyWebmcpTools;
    const live = (toolName: string) => {
      const tool = [...tools]
        .reverse()
        .find(
          (candidate) =>
            candidate.name === toolName &&
            !candidate.registrationSignal?.aborted,
        );
      if (!tool) throw new Error(`${toolName} is not active.`);
      return tool;
    };
    const signal = () => ({ signal: new AbortController().signal });
    const summary = (await live("get_workspace_summary").execute(
      {},
      signal(),
    )) as { workspaceVersion: number };
    const ids: string[] = [];
    for (const query of [
      "Sofia Moreno",
      "Booking and point-of-sale",
      "Payment processor",
    ]) {
      const result = (await live("search_entities").execute(
        { query },
        signal(),
      )) as EntityResult;
      const exact = result.entities.find((entity) => entity.name === query);
      if (!exact) throw new Error(`Could not resolve ${query}.`);
      ids.push(exact.id);
    }
    return live("design_failure_scenarios").execute(
      {
        workspaceVersion: summary.workspaceVersion,
        idempotencyKey: "native-scenario-library-v1",
        scenarios: [
          {
            name: "Founder unavailable during payout review",
            unavailableEntityIds: [ids[0]],
            durationDays: 2,
            context: "Payout review and salon operations must continue.",
          },
          {
            name: "Booking platform outage",
            unavailableEntityIds: [ids[1]],
            durationDays: 1,
            context: "Appointments and customer updates must continue.",
          },
          {
            name: "Compound payment disruption",
            unavailableEntityIds: [ids[0], ids[2]],
            durationDays: 3,
            context: "Service delivery must continue while payouts recover.",
          },
        ],
      },
      signal(),
    );
  });
  expect(scenarios).toMatchObject({
    baselineChanged: false,
    humanReviewRequired: true,
  });
  await page.getByRole("button", { name: "Scenarios, 3" }).click();
  await expect(page.getByText(/Agent draft ·/)).toHaveCount(3);
  await expect(
    page.getByText("Compound payment disruption", { exact: true }),
  ).toBeVisible();
});

test("retries a failed workspace-tool handoff with the same company idempotency key", async ({
  page,
}) => {
  await installNativeToolHarness(page, {
    failFirstWorkspaceRegistration: true,
  });
  await page.goto("/");
  await signIn(page);
  const companyName = `Retry native tools ${Date.now()}`;
  const idempotencyKey = `retry-native-tools-${Date.now()}`;
  const result = await page.evaluate(
    async ({ name, key }) => {
      type CapturedTool = {
        name: string;
        registrationSignal?: AbortSignal;
        execute: (
          input: Record<string, unknown>,
          options: { signal: AbortSignal },
        ) => Promise<unknown>;
      };
      const tools = (
        window as typeof window & { __saveMyWebmcpTools: CapturedTool[] }
      ).__saveMyWebmcpTools;
      const live = (toolName: string) => {
        const tool = [...tools]
          .reverse()
          .find(
            (candidate) =>
              candidate.name === toolName &&
              !candidate.registrationSignal?.aborted,
          );
        if (!tool) throw new Error(`${toolName} is not active.`);
        return tool;
      };
      const signal = () => ({ signal: new AbortController().signal });
      const input = {
        name,
        idempotencyKey: key,
        setupMode: "agent-blueprint",
      };
      const first = (await live("create_company").execute(
        input,
        signal(),
      )) as Record<string, unknown>;
      const second = (await live("create_company").execute(
        input,
        signal(),
      )) as Record<string, unknown>;
      const summary = (await live("get_workspace_summary").execute(
        {},
        signal(),
      )) as Record<string, unknown>;
      const bootstrap = (await (await fetch("/api/bootstrap")).json()) as {
        workspaces: Array<{ name: string }>;
      };
      const workspaceSummaryRegistrations = tools.filter(
        (tool) => tool.name === "get_workspace_summary",
      );
      return {
        first,
        second,
        summary,
        workspaceSummaryRegistrationCount: workspaceSummaryRegistrations.length,
        activeWorkspaceSummaryRegistrationCount:
          workspaceSummaryRegistrations.filter(
            (tool) => !tool.registrationSignal?.aborted,
          ).length,
        abortedWorkspaceSummaryRegistrationCount:
          workspaceSummaryRegistrations.filter(
            (tool) => tool.registrationSignal?.aborted,
          ).length,
        matchingCompanies: bootstrap.workspaces.filter(
          (workspace) => workspace.name === name,
        ).length,
      };
    },
    { name: companyName, key: idempotencyKey },
  );

  expect(result.first).toMatchObject({
    companyName,
    workspaceToolsReady: false,
    nextTool: null,
  });
  expect(result.first.guidance).toContain("same idempotency key");
  expect(result.second).toMatchObject({
    companyName,
    workspaceToolsReady: true,
    nextTool: "draft_company_blueprint",
  });
  expect(result.second.companySlug).toBe(result.first.companySlug);
  expect(result.summary).toMatchObject({ name: companyName, entityCount: 0 });
  expect(result.workspaceSummaryRegistrationCount).toBe(2);
  expect(result.activeWorkspaceSummaryRegistrationCount).toBe(1);
  expect(result.abortedWorkspaceSummaryRegistrationCount).toBe(1);
  expect(result.matchingCompanies).toBe(1);
});

test("creates, connects, renames, archives, and restores a company with keyboard-operable menus", async ({
  page,
}) => {
  await page.goto("/");
  await signIn(page);
  await page.getByRole("button", { name: "Add company" }).click();
  const companyName = `Manual continuity ${Date.now()}`;
  const create = page.getByRole("dialog", { name: "New company" });
  await create.getByLabel("Company name").fill(companyName);
  await expect(create.getByLabel("Create with Site Tools")).toBeChecked();
  await create
    .getByLabel("Business context")
    .fill("A small release team whose customer billing must continue.");
  const agentCreationPrompt = await create
    .getByLabel("Prompt for this page’s agent")
    .inputValue();
  expect(agentCreationPrompt).toContain(
    "WebMCP discovery and Site Tool calls are allowed",
  );
  expect(agentCreationPrompt).toContain("create_company");
  expect(agentCreationPrompt).toContain("draft_company_blueprint");
  expect(agentCreationPrompt).toContain(companyName);
  await create.getByLabel("Build manually").check();
  await create.getByRole("button", { name: "Create and add items" }).click();
  await expect(page.getByRole("heading", { name: companyName })).toBeVisible();

  let first = page.getByRole("dialog", { name: "Add an item" });
  await first.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "People and roles" }).click();
  await expect(
    page.getByRole("heading", { name: "Add the owners behind critical work" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Assign fallback" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Scenarios, 0" }).click();
  await expect(
    page.getByRole("heading", { name: "Build the company map first" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Design with agent" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "New scenario" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Continuity map" }).click();
  await page.getByRole("button", { name: "Manual repair" }).click();
  const emptyRepair = page.getByRole("dialog", { name: "Manual repair" });
  await expect(
    emptyRepair.getByRole("button", { name: "Connect items" }),
  ).toBeDisabled();
  await expect(
    emptyRepair.getByRole("button", { name: "Assign fallback" }),
  ).toBeDisabled();
  await emptyRepair.getByRole("button", { name: "Add item" }).click();

  first = page.getByRole("dialog", { name: "Add an item" });
  await first.getByLabel("Name").fill("Release workflow");
  await first.getByLabel("Type").selectOption("workflow");
  await first.getByRole("button", { name: "Save to baseline" }).click();
  await page.getByRole("button", { name: "Manual repair" }).click();
  await page
    .getByRole("dialog", { name: "Manual repair" })
    .getByRole("button", { name: "Add item" })
    .click();
  const second = page.getByRole("dialog", { name: "Add an item" });
  await second.getByLabel("Name").fill("Source repository");
  await second.getByLabel("Type").selectOption("service");
  await second.getByRole("button", { name: "Save to baseline" }).click();

  await page.getByRole("button", { name: "Connect items" }).click();
  const connection = page.getByRole("dialog", { name: "Connect two items" });
  await connection.getByLabel("First item").selectOption({
    label: "Release workflow · Workflow",
  });
  await connection.getByLabel("Relationship").selectOption("depends-on");
  await connection.getByLabel("Second item").selectOption({
    label: "Source repository · Service",
  });
  await connection.getByLabel(/Path group/).fill("source");
  await connection.getByRole("button", { name: "Add to baseline" }).click();

  const trigger = page.getByRole("button", {
    name: "Judge account account menu",
  });
  await trigger.click();
  const account = page.getByRole("dialog", {
    name: "Account and company actions",
  });
  await expect(
    account.getByRole("button", { name: "All companies" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    account.getByRole("button", { name: "Company settings" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    account.getByRole("button", { name: "New company" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  const saved = await page.evaluate(async () => {
    const slug = new URLSearchParams(location.search).get("workspace")!;
    return (await (await fetch(`/api/workspaces/${slug}`)).json()).workspace;
  });
  expect(saved.entities).toHaveLength(2);
  expect(saved.relationships[0]).toMatchObject({
    type: "depends-on",
    group: "source",
    trust: "DECLARED",
  });

  await page.setViewportSize({ width: 768, height: 900 });
  const renamedCompany = `Continuity 長い会社 اسم الشركة 🚀 ${Date.now()}`;
  await trigger.click();
  await account.getByRole("button", { name: "Company settings" }).click();
  const settings = page.getByRole("dialog", { name: "Company settings" });
  await settings.getByLabel("Company name").fill(renamedCompany);
  await settings.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("heading", { name: renamedCompany }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await trigger.click();
  await account.getByRole("button", { name: "Company settings" }).click();
  await settings.getByLabel("Archive this company").check();
  await settings.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Archived companies" }),
  ).toBeVisible();
  const archivedRow = page
    .locator(".archived-company-list article")
    .filter({ hasText: renamedCompany });
  await archivedRow.getByRole("button", { name: "Restore" }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(renamedCompany) }),
  ).toBeVisible();
  await page.getByRole("button", { name: new RegExp(renamedCompany) }).click();

  await page.locator(".delete-current").click();
  const deletion = page.getByRole("dialog", {
    name: `Delete ${renamedCompany}?`,
  });
  await deletion.getByRole("button", { name: "Delete company" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a company to explore" }),
  ).toBeVisible();
});

test("covers editable-copy search, inspector edits, review drafts, activity, tools, reset, and sign-out", async ({
  page,
}) => {
  await page.goto("/");
  await signIn(page);
  await page.goto("/?workspace=northstar-studio");

  const resetResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/workspaces/northstar-studio/reset") &&
      response.request().method() === "POST",
  );
  const resetReload = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/workspaces/northstar-studio") &&
      response.request().method() === "GET",
  );
  await page.getByRole("button", { name: "Reset demo" }).click();
  expect((await resetResponse).ok()).toBe(true);
  expect((await resetReload).ok()).toBe(true);

  await page.getByRole("button", { name: /Make editable copy/ }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        new URLSearchParams(location.search).get("workspace"),
      ),
    )
    .not.toBe("northstar-studio");
  const copy = await page.evaluate(async () => {
    const slug = new URLSearchParams(location.search).get("workspace")!;
    return (await (await fetch(`/api/workspaces/${slug}`)).json())
      .workspace as {
      slug: string;
      name: string;
    };
  });
  await expect(page.getByRole("heading", { name: copy.name })).toBeVisible();

  await page.getByRole("button", { name: "Search company" }).click();
  const search = page.getByRole("dialog", { name: "Search the company" });
  await search
    .getByLabel("Search by name, role, or description")
    .fill("Theo Mercer");
  await search.getByRole("button", { name: /Theo Mercer/ }).click();
  const inspector = page.locator(".entity-inspector");
  await expect(
    inspector.getByRole("heading", { name: "Theo Mercer" }),
  ).toBeVisible();

  await inspector.getByRole("button", { name: "Edit item" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Theo Mercer" });
  await edit.getByLabel("Name").fill("Theo Mercer — edited");
  await edit.getByRole("button", { name: "Save to baseline" }).click();
  await expect(
    inspector.getByRole("heading", { name: "Theo Mercer — edited" }),
  ).toBeVisible();

  await inspector.getByRole("button", { name: "Add connection" }).click();
  const connection = page.getByRole("dialog", { name: "Connect two items" });
  await connection
    .getByLabel("Plain-language label")
    .fill("additional recovery contact");
  await connection.getByRole("button", { name: "Add to baseline" }).click();

  await inspector.getByRole("button", { name: "Reschedule" }).click();
  const schedule = page.getByRole("dialog", {
    name: "Schedule Theo Mercer — edited",
  });
  await schedule.getByLabel("New date").fill("2027-01-15");
  await schedule.getByRole("button", { name: "Stage review draft" }).click();
  await page.getByRole("button", { name: "Review schedule draft" }).click();
  let preview = page.getByRole("region", { name: "Proposal preview" });
  await expect(preview).toBeVisible();
  await expect(
    preview.getByRole("button", { name: /Draft preview 1 graph change/ }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Discard" }).click();
  await expect(preview).toBeHidden();

  await page.getByRole("button", { name: "People and roles" }).click();
  await page.getByRole("button", { name: "Assign fallback" }).click();
  const delegation = page.getByRole("dialog", {
    name: "Assign fallback coverage",
  });
  await delegation.getByLabel("Coverage note").fill("Named rehearsal fallback");
  await delegation.getByRole("button", { name: "Stage review draft" }).click();
  await page.getByRole("button", { name: "Continuity map" }).click();
  await page.getByRole("button", { name: "Review fallback draft" }).click();
  preview = page.getByRole("region", { name: "Proposal preview" });
  await expect(
    preview.getByRole("button", { name: /Draft preview 2 graph changes/ }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Discard" }).click();
  await expect(preview).toBeHidden();

  await page.getByRole("button", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.locator(".activity-list article").first()).toBeVisible();

  await page.getByRole("button", { name: /Scenarios,/ }).click();
  await page.getByRole("button", { name: "Design with agent" }).click();
  const scenarioAgent = page.getByRole("dialog", {
    name: "Design scenarios with Site Tools",
  });
  await expect(
    scenarioAgent.getByLabel("Prompt for the page agent"),
  ).toHaveCount(1);
  await expect(
    scenarioAgent.getByLabel("Prompt for the page agent"),
  ).toHaveValue(/design_failure_scenarios/);
  await scenarioAgent.getByRole("button", { name: "Close" }).click();

  await page.locator(".scenario-card").first().click();
  await page.getByRole("button", { name: "Ask agent" }).click();
  const repairAgent = page.getByRole("dialog", {
    name: "Ask an agent for repair options",
  });
  await expect(
    repairAgent.getByLabel("Prompt for the Site Tools agent"),
  ).toHaveCount(1);
  await expect(
    repairAgent.getByLabel("Prompt for the Site Tools agent"),
  ).toHaveValue(/three complete, materially different repair options/);
  await repairAgent.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: /Open Site Tool call log/ }).click();
  const toolLog = page.getByRole("dialog", { name: "Site Tool call log" });
  await expect(toolLog).toBeVisible();
  await toolLog.getByRole("button", { name: "Close" }).click();

  await page.locator(".delete-current").click();
  const deletion = page.getByRole("dialog", { name: `Delete ${copy.name}?` });
  await deletion.getByRole("button", { name: "Delete company" }).click();
  await page.goto("/?workspace=northstar-studio");
  await page
    .getByRole("button", { name: "Judge account account menu" })
    .click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("keeps graph and account actions usable at 390px and 320px", async ({
  page,
}) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Open account Site Tool log/ }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.goto("/?workspace=northstar-studio");
    const list = page.getByLabel("Interactive graph list");
    await expect(list).toBeVisible();
    await list.getByRole("button", { name: /Theo Mercer/ }).click();
    await expect(
      page.getByRole("heading", { name: "Theo Mercer" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close details" }).click();
    const accountTrigger = page.getByRole("button", {
      name: "Guest mode account menu",
    });
    await expect(accountTrigger.locator("svg")).toBeVisible();
    await accountTrigger.click();
    await expect(
      page.getByRole("dialog", { name: "Account and company actions" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test("keeps the tablet account menu named, wide enough, and on screen", async ({
  page,
}) => {
  for (const width of [900, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?workspace=northstar-studio");
    const accountTrigger = page.getByRole("button", {
      name: "Guest mode account menu",
    });
    await expect(accountTrigger).toBeVisible();
    await accountTrigger.click();

    const account = page.getByRole("dialog", {
      name: "Account and company actions",
    });
    await expect(account).toBeVisible();
    const bounds = await account.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThanOrEqual(220);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(
      await account.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);

    await page.keyboard.press("Escape");
    await expect(account).toBeHidden();
    await expect(accountTrigger).toBeFocused();
  }
});

test("keeps the loaded landing header separated for guests and signed-in users", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.locator(".company-card")).toHaveCount(4);
  for (const width of [
    320, 390, 480, 481, 520, 760, 761, 768, 960, 1024, 1200, 1201, 1280, 1440,
    1920,
  ])
    await expectLandingHeaderToFit(page, width);
  for (const width of [320, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    await settleResponsiveLayout(page);
    await page.screenshot({
      path: testInfo.outputPath(`landing-guest-${width}.png`),
      fullPage: false,
    });
    if (width === 1920) {
      const primaryCta = await page
        .getByRole("button", { name: /Open Diamond Apps/ })
        .boundingBox();
      expect(primaryCta).not.toBeNull();
      expect(primaryCta!.y + primaryCta!.height).toBeLessThanOrEqual(800);
    }
  }

  await page.setViewportSize({ width: 900, height: 760 });
  await signIn(page);
  await expect(page.locator(".company-card")).toHaveCount(4);
  for (const width of [320, 360, 390, 480, 481, 520, 547, 760])
    await expectLandingHeaderToFit(page, width);
  await page.setViewportSize({ width: 390, height: 800 });
  await settleResponsiveLayout(page);
  await page.screenshot({
    path: testInfo.outputPath("landing-signed-in-390.png"),
    fullPage: false,
  });
});

test("keeps loaded landing company rows inside tablet and small-desktop viewports", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".company-card")).toHaveCount(4);
  for (const width of [760, 761, 768, 900, 960, 1024])
    await expectLandingCardsToFit(page, width);
});

test("stores a manual scenario separately from the baseline", async ({
  page,
}) => {
  await page.goto("/?workspace=cedar-classroom");
  const before = await page.evaluate(
    async () =>
      (await (await fetch("/api/workspaces/cedar-classroom")).json()).workspace
        .entities.length,
  );
  await page.getByRole("button", { name: "Scenarios, 2" }).click();
  await page.getByRole("button", { name: "New scenario" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Create a disruption scenario",
  });
  await dialog.getByLabel("Name").fill("Support lead away during enrollment");
  await dialog
    .getByLabel("Context")
    .fill("Enrollment continues with fallback coverage.");
  await dialog.getByRole("checkbox").first().check();
  await dialog.getByRole("button", { name: "Save and explore" }).click();
  await expect(
    page.getByText("Support lead away during enrollment", { exact: true }),
  ).toBeVisible();
  const after = await page.evaluate(
    async () =>
      (await (await fetch("/api/workspaces/cedar-classroom")).json()).workspace
        .entities.length,
  );
  expect(after).toBe(before);
});

test("has no automated accessibility violations", async ({ page }) => {
  await page.goto("/?workspace=northstar-studio");
  await page.addScriptTag({ content: axe.source });
  const results = await page.evaluate(
    async () =>
      await (
        window as typeof window & {
          axe: {
            run: () => Promise<{
              violations: Array<{ impact: string | null; id: string }>;
            }>;
          };
        }
      ).axe.run(),
  );
  expect(
    results.violations.map(
      (violation) => `${violation.impact ?? "unknown"}: ${violation.id}`,
    ),
  ).toEqual([]);
});

test("traps dialog focus and restores its trigger", async ({ page }) => {
  await page.goto("/?workspace=northstar-studio");
  const trigger = page.getByRole("button", { name: /Search company/i });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Search the company" });
  const close = dialog.getByRole("button", { name: "Close" });
  await dialog.locator(".search-results button").last().focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("keeps critical actions operable with 200% text sizing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await settleResponsiveLayout(page);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Open account Site Tool log/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.goto("/?workspace=northstar-studio");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await settleResponsiveLayout(page);
  await expect(
    page.getByRole("button", { name: "Manual repair" }),
  ).toBeVisible();
  const account = page.getByRole("button", {
    name: "Guest mode account menu",
  });
  await expect(account).toBeVisible();
  await account.click();
  await expect(
    page.getByRole("dialog", { name: "Account and company actions" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("renders the company hierarchy at every target breakpoint", async ({
  page,
}, testInfo) => {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 700 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/?workspace=northstar-studio");
    await expect(
      page.getByRole("heading", { name: "Diamond Apps" }),
    ).toBeVisible();
    await expect(page.getByLabel("Continuity dependency graph")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Manual repair" }),
    ).toBeVisible();
    for (const label of ["Connect items", "Manual repair"]) {
      const box = await page.getByRole("button", { name: label }).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
    }
    await page.screenshot({
      path: testInfo.outputPath(`workspace-${size.width}.png`),
      fullPage: false,
    });
  }
});
