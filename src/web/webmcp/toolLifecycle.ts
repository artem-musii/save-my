type AbortSignalLike = {
  readonly aborted?: boolean;
  readonly reason?: unknown;
  addEventListener?: (
    type: "abort",
    listener: () => void,
    options?: { once?: boolean },
  ) => void;
  removeEventListener?: (type: "abort", listener: () => void) => void;
};

/**
 * WebMCP hosts can pass an AbortSignal from a different JavaScript realm.
 * AbortSignal.any() brand-checks its inputs, so linking the signals manually
 * keeps cancellation working in the browser, in tests, and across host realms.
 */
export function linkToolAbortSignals(
  hostSignal: unknown,
  lifecycleSignal: AbortSignal,
) {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];

  const relay = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object") return;
    const signal = candidate as AbortSignalLike;
    const abort = () => {
      if (!controller.signal.aborted) controller.abort(signal.reason);
    };
    if (signal.aborted) {
      abort();
      return;
    }
    if (typeof signal.addEventListener !== "function") return;
    signal.addEventListener("abort", abort, { once: true });
    cleanups.push(() => signal.removeEventListener?.("abort", abort));
  };

  relay(lifecycleSignal);
  if (hostSignal !== lifecycleSignal) relay(hostSignal);

  return {
    signal: controller.signal,
    cleanup: () => cleanups.splice(0).forEach((cleanup) => cleanup()),
  };
}
