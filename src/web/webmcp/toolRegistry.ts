import { linkToolAbortSignals } from "./toolLifecycle";

export type WebMcpCallLog = {
  id: string;
  name: string;
  title: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt?: string;
  input: string;
  output?: string;
  error?: string;
};

export const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export function assertWorkspaceVersion(value: unknown, source: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new Error(
      `${source} did not return an authoritative workspace version.`,
    );
  return value;
}

function formatLogPayload(value: unknown) {
  try {
    const serialized = JSON.stringify(value, null, 2) ?? String(value);
    const limit = 12_000;
    return serialized.length > limit
      ? `${serialized.slice(0, limit)}\n… log truncated`
      : serialized;
  } catch {
    return "[Payload could not be serialized]";
  }
}

export function registerInstrumentedTools(
  modelContext: ModelContext,
  tools: ModelContextTool[],
  lifecycle: AbortController,
  onToolCall?: (entry: WebMcpCallLog) => void,
) {
  const instrumentedTools = tools.map((tool) => ({
    ...tool,
    annotations: {
      ...tool.annotations,
      untrustedContentHint: true,
    },
    execute: async (
      input: Record<string, unknown>,
      options: { signal: AbortSignal },
    ) => {
      const startedAt = new Date().toISOString();
      const baseLog = {
        id: crypto.randomUUID(),
        name: tool.name,
        title: tool.title ?? tool.name,
        startedAt,
        input: formatLogPayload(input),
      };
      onToolCall?.({ ...baseLog, status: "running" });
      const linked = linkToolAbortSignals(options.signal, lifecycle.signal);
      try {
        const signal = linked.signal;
        signal.throwIfAborted();
        const result = await tool.execute(input, { signal });
        signal.throwIfAborted();
        onToolCall?.({
          ...baseLog,
          status: "succeeded",
          finishedAt: new Date().toISOString(),
          output: formatLogPayload(result),
        });
        return result;
      } catch (reason) {
        onToolCall?.({
          ...baseLog,
          status: "failed",
          finishedAt: new Date().toISOString(),
          error: reason instanceof Error ? reason.message : "Tool call failed.",
        });
        throw reason;
      } finally {
        linked.cleanup();
      }
    },
  }));

  return Promise.all(
    instrumentedTools.map((tool) =>
      modelContext.registerTool(tool, { signal: lifecycle.signal }),
    ),
  )
    .then(() => undefined)
    .catch((reason) => {
      lifecycle.abort();
      throw reason;
    });
}
