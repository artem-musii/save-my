export class SiteToolRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly currentVersion?: number,
  ) {
    super(message);
    this.name = "SiteToolRequestError";
  }
}

const errorRecord = (value: unknown) =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;

export async function requestJson<T>(path: string, init: RequestInit = {}) {
  init.signal?.throwIfAborted();
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  init.signal?.throwIfAborted();

  const rawBody = await response.text();
  init.signal?.throwIfAborted();
  let body: unknown = {};
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new SiteToolRequestError(
        `Site Tool request returned a non-JSON response [HTTP ${response.status}].`,
        response.status,
      );
    }
  }

  if (!response.ok) {
    const record = errorRecord(body);
    const detail =
      typeof record?.error === "string"
        ? record.error
        : "Site Tool request failed.";
    const currentVersion =
      typeof record?.currentVersion === "number"
        ? record.currentVersion
        : undefined;
    throw new SiteToolRequestError(
      `${detail} [HTTP ${response.status}]`,
      response.status,
      currentVersion,
    );
  }

  return body as T;
}
