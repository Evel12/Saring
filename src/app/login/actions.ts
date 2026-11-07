"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  SESSION_COOKIE,
  safeNext,
} from "@/lib/demo-auth";

export async function login(input: {
  email: string;
  password: string;
  next?: string;
}) {
  if (
    input.email.trim().toLowerCase() !== DEMO_EMAIL ||
    input.password !== DEMO_PASSWORD
  )
    return { error: "Email atau kata sandi salah." };
  const secure = (await headers()).get("x-forwarded-proto") === "https";
  (await cookies()).set(SESSION_COOKIE, "demo", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  redirect(safeNext(input.next));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
