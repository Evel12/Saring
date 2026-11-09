// Session cookie set by the FastAPI backend (through the /api proxy).
export const SESSION_COOKIE = "saring_session";

export type Me = {
  organization_id: string;
  user_id: string | null;
  role: "admin" | "recruiter" | "candidate" | string;
  is_platform_admin: boolean;
  display_name: string;
  email: string;
  memberships: { org_id: string; role: string; organization_name: string }[];
};

export const roleLabel = (role: string) =>
  role === "admin" ? "Admin" : role === "recruiter" ? "Rekruter" : role;

export function safeNext(next?: string | null) {
  return next && next.startsWith("/dashboard") && !next.startsWith("//")
    ? next
    : "/dashboard";
}
