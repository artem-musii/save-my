import { afterEach, describe, expect, test } from "bun:test";
import { requestJson, SiteToolRequestError } from "./requestJson";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("WebMCP JSON requests", () => {
  test("uses the signed-in same-origin session and preserves actionable conflicts", async () => {
    globalThis.fetch = (async (_input, init) => {
      expect(init?.credentials).toBe("same-origin");
      return new Response(
        JSON.stringify({
          error: "Workspace changed. Current version is 7.",
          currentVersion: 7,
        }),
        {
          status: 409,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    try {
      await requestJson("/api/workspaces/example/validate");
      throw new Error("Conflict request unexpectedly succeeded.");
    } catch (reason) {
      expect(reason).toBeInstanceOf(SiteToolRequestError);
      expect((reason as SiteToolRequestError).status).toBe(409);
      expect((reason as SiteToolRequestError).currentVersion).toBe(7);
      expect((reason as Error).message).toContain("Current version is 7");
      expect((reason as Error).message).toContain("HTTP 409");
    }
  });

  test("does not expose an unexpected HTML response as tool output", async () => {
    globalThis.fetch = (async () =>
      new Response("<html>proxy error</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    try {
      await requestJson("/api/bootstrap");
      throw new Error("Non-JSON request unexpectedly succeeded.");
    } catch (reason) {
      expect(reason).toBeInstanceOf(SiteToolRequestError);
      expect((reason as Error).message).toBe(
        "Site Tool request returned a non-JSON response [HTTP 502].",
      );
      expect((reason as Error).message).not.toContain("proxy error");
    }
  });

  test("honors cancellation even when a fetch implementation resolves after abort", async () => {
    let resolveFetch!: (response: Response) => void;
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })) as unknown as typeof fetch;
    const controller = new AbortController();
    const request = requestJson("/api/bootstrap", {
      signal: controller.signal,
    });

    resolveFetch(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      }),
    );
    controller.abort();

    try {
      await request;
      throw new Error("Aborted request unexpectedly succeeded.");
    } catch (reason) {
      expect(reason).toBeInstanceOf(DOMException);
      expect((reason as DOMException).name).toBe("AbortError");
    }
  });
});
