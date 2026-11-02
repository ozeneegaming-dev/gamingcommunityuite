import "server-only";
import {
  ACP_SESSION_MINUTES_DEFAULT,
  ACP_SESSION_MINUTES_SETTING,
  acpGate,
  buildAcpMenu,
  GcsForbidden,
  verifyPassword,
  type GcsAcpGateResult,
  type GcsAcpMenuSection,
  type GcsAcpRight,
  type GcsAcpRights,
  type GcsActor,
} from "@gcs/core";
import { createOTP } from "@better-auth/utils/otp";
import { symmetricDecrypt } from "better-auth/crypto";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { clientIp, currentActor } from "./actor";
import { getAuth } from "./auth";
import { services } from "./services";

export type GcsAcpUser = {
  id: string;
  name: string;
  image: string | null;
  twoFactorEnabled: boolean;
  primaryGroup: { key: string; name: string };
};

type GcsAcpContext =
  | { state: "forbidden"; actor: GcsActor; ip: string; user: null }
  | { state: Exclude<GcsAcpGateResult, "forbidden">; actor: GcsActor; ip: string; user: GcsAcpUser };

/** Starea de acces în ACP a request-ului curent (o singură dată per request). */
export const getAcpContext = cache(async (): Promise<GcsAcpContext> => {
  const ip = clientIp(await headers());
  const actor = await currentActor();
  if (!actor.userId) return { state: "forbidden", actor, ip, user: null };

  const { db, permissions, settings } = services();
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: {
      id: true,
      name: true,
      image: true,
      twoFactorEnabled: true,
      lastAcpAuthAt: true,
      lastAcpAuthIp: true,
      primaryGroup: { select: { key: true, name: true } },
    },
  });
  if (!user) return { state: "forbidden", actor, ip, user: null };

  const [canAccess, reauthMinutes] = await Promise.all([
    permissions.can(actor, "acp.access"),
    // ACP → Setări → Securitate: fereastra reautentificării (implicit 12 ore).
    settings.get<number>(ACP_SESSION_MINUTES_SETTING).catch(() => ACP_SESSION_MINUTES_DEFAULT),
  ]);
  const state = acpGate(
    { canAccess, twoFactorEnabled: user.twoFactorEnabled, lastAcpAuthAt: user.lastAcpAuthAt, lastAcpAuthIp: user.lastAcpAuthIp, reauthMinutes },
    ip,
  );
  if (state === "forbidden") return { state, actor, ip, user: null };
  const { lastAcpAuthAt: _at, lastAcpAuthIp: _ip, ...acpUser } = user;
  return { state, actor, ip, user: acpUser };
});

export type GcsAcpPanel = {
  actor: GcsActor;
  ip: string;
  user: GcsAcpUser;
  rights: GcsAcpRights;
  menu: GcsAcpMenuSection[];
};

/**
 * Garda paginilor ACP (spec §6.4): cine nu are acces primește 404 (ACP-ul nu-și dezvăluie existența),
 * fără 2FA → configurarea 2FA, sesiune ACP expirată sau IP schimbat → reautentificare.
 */
export const requireAcpPanel = cache(async (): Promise<GcsAcpPanel> => {
  const ctx = await getAcpContext();
  if (ctx.state === "forbidden") notFound();
  if (ctx.state === "need_2fa_setup") redirect("/admin/2fa-setup");
  if (ctx.state === "need_reauth") redirect("/admin/reauth");
  const { acp, registry, apps } = services();
  // Paginile aplicațiilor opționale (ex. Grupuri Pro): doar cu aplicația pornită și accesibilă adminului.
  const [rights, canUseApp] = await Promise.all([acp.rights(ctx.actor), apps.accessFilter(ctx.actor)]);
  return { actor: ctx.actor, ip: ctx.ip, user: ctx.user, rights, menu: buildAcpMenu(registry, rights, canUseApp) };
});

/** Ca `requireAcpSection`, pentru pagina unei aplicații opționale: oprită sau fără acces la ea → 404. */
export async function requireAcpAppSection(app: string, section: string, right: GcsAcpRight = "view"): Promise<GcsAcpPanel> {
  const panel = await requireAcpSection(section, right);
  if (!(await services().apps.canAccess(panel.actor, app))) notFound();
  return panel;
}

/** Ca `requireAcpPanel`, plus dreptul pe o secțiune; fără drept → 404. */
export async function requireAcpSection(section: string, right: GcsAcpRight = "view"): Promise<GcsAcpPanel> {
  const panel = await requireAcpPanel();
  if (!(await services().acp.can(panel.actor, section, right))) notFound();
  return panel;
}

/** Garda Server Actions din ACP: aceeași poartă, dar aruncă `GcsForbidden` (devine `{ ok: false }`). */
export async function assertAcpAction(section: string, right: GcsAcpRight): Promise<GcsAcpPanel["actor"]> {
  const ctx = await getAcpContext();
  if (ctx.state !== "ok") throw new GcsForbidden({ reason: "acp_gate" });
  await services().acp.assert(ctx.actor, section, right);
  return ctx.actor;
}

/**
 * Verifică parola contului (dacă userul are una; conturile doar cu Discord/Steam n-au) și codul TOTP.
 * Secretul TOTP e criptat de Better Auth cu secretul aplicației, deci îl decriptăm prin contextul lui.
 */
export async function verifyAcpCredentials(userId: string, password: string, code: string): Promise<boolean> {
  const { db } = services();
  const credential = await db.account.findFirst({ where: { userId, providerId: "credential" }, select: { password: true } });
  if (credential?.password && !(await verifyPassword(credential.password, password))) return false;

  return verifyTwoFactorCode(userId, code);
}

/**
 * Doar codul 2FA (TOTP) al contului, verificat chiar acum: confirmările sensibile din ACP (ex. instalarea unui plugin
 * nesemnat) îl cer din nou, chiar dacă sesiunea ACP e proaspătă.
 */
export async function verifyTwoFactorCode(userId: string, code: string): Promise<boolean> {
  const { db } = services();
  const twoFactor = await db.twoFactor.findFirst({ where: { userId, verified: true }, select: { secret: true } });
  if (!twoFactor) return false;
  const ctx = await (await getAuth()).$context;
  const secret = await symmetricDecrypt({ key: ctx.secretConfig, data: twoFactor.secret });
  return createOTP(secret, { period: 30, digits: 6 }).verify(code.replace(/\s/g, ""));
}
