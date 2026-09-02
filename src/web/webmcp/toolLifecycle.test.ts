import { describe, expect, test } from "bun:test";
import { linkToolAbortSignals } from "./toolLifecycle";

class ForeignAbortSignal extends EventTarget {
  aborted = false;
  reason: unknown;

  abort(reason: unknown) {
    this.aborted = true;
    this.reason = reason;
    this.dispatchEvent(new Event("abort"));
  }
}

describe("WebMCP tool lifecycle", () => {
  test("accepts a host cancellation signal from another realm", () => {
    const host = new ForeignAbortSignal();
    const lifecycle = new AbortController();
    const linked = linkToolAbortSignals(host, lifecycle.signal);

    host.abort("host stopped");

    expect(linked.signal.aborted).toBeTrue();
    expect(linked.signal.reason).toBe("host stopped");
    linked.cleanup();
  });

  test("still cancels every tool when its page registration ends", () => {
    const host = new ForeignAbortSignal();
    const lifecycle = new AbortController();
    const linked = linkToolAbortSignals(host, lifecycle.signal);

    lifecycle.abort("page changed");

    expect(linked.signal.aborted).toBeTrue();
    expect(linked.signal.reason).toBe("page changed");
    linked.cleanup();
  });

  test("removes host listeners after execution completes", () => {
    const host = new ForeignAbortSignal();
    const lifecycle = new AbortController();
    const linked = linkToolAbortSignals(host, lifecycle.signal);

    linked.cleanup();
    host.abort("too late");

    expect(linked.signal.aborted).toBeFalse();
  });
});
