// Login tiruan untuk prototipe. Belum aman: cookie ini hanya penanda dan bisa
// dibuat siapa saja. Ganti dengan autentikasi sungguhan dari backend.
export const SESSION_COOKIE = "saring_demo_session";
export const DEMO_EMAIL = "hr@contoh.test";
export const DEMO_PASSWORD = "saring-demo";

export function safeNext(next?: string | null) {
  return next && next.startsWith("/dashboard") && !next.startsWith("//")
    ? next
    : "/dashboard";
}
