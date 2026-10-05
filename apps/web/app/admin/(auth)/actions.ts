"use server";

import { headers } from "next/headers";
import { isSameOrigin } from "@/lib/actions";
import { getAcpContext, verifyAcpCredentials } from "@/lib/acp";
import { services } from "@/lib/services";

/** 5 încercări de reautentificare pe user la 15 minute. */
const REAUTH_RULE = { window: 15 * 60, max: 5 };

export type GcsReauthResult = { ok: true } | { ok: false; error: "invalid" | "rate_limited" };

/** Reautentificarea în ACP: parola + codul 2FA. La succes se salvează momentul și IP-ul (spec §6.4). */
export async function acpReauth(input: { password: string; code: string }): Promise<GcsReauthResult> {
  if (!isSameOrigin(await headers())) return { ok: false, error: "invalid" };
  const ctx = await getAcpContext();
  if (ctx.state === "forbidden" || ctx.state === "need_2fa_setup") return { ok: false, error: "invalid" };

  const { rateLimiter, acpDashboard } = services();
  const limit = await rateLimiter.consume(`acp-reauth:${ctx.user.id}`, REAUTH_RULE);
  if (!limit.allowed) return { ok: false, error: "rate_limited" };

  const ok = await verifyAcpCredentials(ctx.user.id, String(input.password ?? ""), String(input.code ?? ""));
  await acpDashboard.recordAcpLogin(ctx.user.id, ctx.ip, ok);
  return ok ? { ok: true } : { ok: false, error: "invalid" };
}
