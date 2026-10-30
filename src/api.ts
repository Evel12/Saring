import type { Page } from "./types";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let organization = "";
export function selectOrganization(id: string) {
  organization = id;
}
type Options = { method?: string; body?: unknown; signal?: AbortSignal };
export async function request<T>(
  path: string,
  { method = "GET", body, signal }: Options = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (organization) headers["X-Organization-ID"] = organization;
  if (method !== "GET") {
    const response = await fetch("/api/v1/auth/csrf", {
      credentials: "same-origin",
      signal,
    });
    if (!response.ok)
      throw new ApiError(
        response.status,
        "Could not establish a secure session.",
      );
    headers["X-CSRF-Token"] = (await response.json()).csrf_token;
  }
  if (body !== undefined && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(path.startsWith("/api/") ? path : "/api/v1" + path, {
      method,
      credentials: "same-origin",
      headers,
      body:
        body instanceof FormData
          ? body
          : body === undefined
            ? undefined
            : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(
      0,
      "Disconnected from Saring. Your workflow may still be running on the server.",
    );
  }
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ detail: "The server could not complete this request." }));
    const message =
      typeof data.detail === "string"
        ? data.detail
        : Array.isArray(data.detail)
          ? data.detail
              .map(
                (x: { loc: string[]; msg: string }) =>
                  x.loc.filter((y) => y !== "body").join(" › ") + ": " + x.msg,
              )
              .join("; ")
          : "Request failed.";
    throw new ApiError(response.status, message);
  }
  return response.json();
}
export const post = <T = unknown>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body });
export async function all<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  let offset = 0;
  const items: T[] = [];
  while (true) {
    const page = await request<Page<T>>(
      path + (path.includes("?") ? "&" : "?") + "limit=100&offset=" + offset,
      { signal },
    );
    items.push(...page.items);
    if (!page.has_more) return items;
    if (!page.items.length)
      throw new Error("The server returned an inconsistent page.");
    offset += page.items.length;
    if (offset > 100000)
      throw new Error("Too many records. Narrow your selection.");
  }
}
export async function download(id: string, name: string) {
  const headers: Record<string, string> = {};
  if (organization) headers["X-Organization-ID"] = organization;
  const response = await fetch("/api/v1/documents/" + id + "/download", {
    credentials: "same-origin",
    headers,
  });
  if (!response.ok)
    throw new ApiError(
      response.status,
      "Source unavailable or access expired. Synthetic documents have no original binary.",
    );
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
