import { cookies } from "next/headers";

const API = process.env.API_URL ?? "http://127.0.0.1:8000";

// Server-side read from FastAPI, forwarding the browser's session cookie.
// Returns null when the session is missing/expired or the resource is out of scope.
export async function serverGet<T>(path: string): Promise<T | null> {
  const cookie = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const res = await fetch(`${API}/api/v1${path}`, {
    headers: { cookie },
    cache: "no-store",
  });
  if ([401, 403, 404].includes(res.status)) return null;
  if (!res.ok) throw new Error(`Backend ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}
