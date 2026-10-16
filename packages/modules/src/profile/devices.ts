import { createHash } from "node:crypto";
import { GcsForbidden, GcsNotFound, type GcsActor, type GcsMail, type GcsMailer, type GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { normalizeMemberPrefs } from "./memberPrefs";

/**
 * Dispozitivele contului (Setări → Dispozitive, profil gaming v2 §3): la fiecare autentificare se notează browserul și
 * sistemul (din user-agent), metoda (parolă, Discord, Google, Steam), IP-ul și locația aproximativă (țara dată de proxy).
 * Un dispozitiv nou trimite un email (dacă membrul nu l-a oprit). „Fără autentificare automată” pe un dispozitiv:
 * sesiunile lui expiră după `NO_AUTO_LOGIN_HOURS` și cele active se închid.
 */

export const DEVICE_WINDOW_DAYS = 90;
export const NO_AUTO_LOGIN_HOURS = 12;

export type GcsLoginMethod = "password" | "discord" | "google" | "steam" | "other";

/** Browserul și sistemul, din user-agent (ordinea contează: Edge și Opera se dau drept Chrome). */
export function parseUserAgent(ua: string | null | undefined): { browser: string; os: string } {
  const s = ua ?? "";
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /OPR\/|Opera/.test(s)
      ? "Opera"
      : /Firefox\//.test(s)
        ? "Firefox"
        : /SamsungBrowser\//.test(s)
          ? "Samsung Internet"
          : /Chrome\//.test(s)
            ? "Chrome"
            : /Safari\//.test(s)
              ? "Safari"
              : "Browser";
  const os = /Windows/.test(s) ? "Windows" : /Android/.test(s) ? "Android" : /iPhone|iPad|iPod/.test(s) ? "iOS" : /Mac OS X|Macintosh/.test(s) ? "macOS" : /CrOS/.test(s) ? "ChromeOS" : /Linux/.test(s) ? "Linux" : "—";
  return { browser, os };
}

/** Metoda de autentificare, din calea cererii Better Auth (`/sign-in/email`, `/callback/discord`, `/steam/callback`…). */
export function loginMethod(path: string | null | undefined): GcsLoginMethod {
  const p = path ?? "";
  if (/discord/.test(p)) return "discord";
  if (/google/.test(p)) return "google";
  if (/steam/.test(p)) return "steam";
  if (/sign-(in|up)\/email|two-factor/.test(p)) return "password";
  return "other";
}

/** Locația aproximativă: codul țării dat de proxy (2 litere), altfel nimic. IP-ul nu se trimite nicăieri. */
export function approximateLocation(country: string | null | undefined): string | null {
  const c = (country ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1" ? c : null;
}

/** IP-ul mascat pentru listă (ultimul grup ascuns): 203.0.113.x, 2001:db8:…. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.replace(/\.\d+$/, ".x");
  const parts = ip.split(":").filter(Boolean);
  return parts.length > 2 ? `${parts.slice(0, 2).join(":")}:…` : ip;
}

const deviceKey = (userId: string, browser: string, os: string) => createHash("sha256").update(`${userId}|${browser}|${os}`).digest("hex").slice(0, 32);
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export type GcsDeviceView = {
  id: string;
  browser: string;
  os: string;
  method: string;
  ip: string | null;
  location: string | null;
  autoLogin: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  current: boolean;
};

function newDeviceMail(opts: { to: string; name: string; site: string; device: string; when: string; link: string; locale: string }): GcsMail {
  const name = escape(opts.name);
  const device = escape(opts.device);
  const link = escape(opts.link);
  return opts.locale === "en"
    ? {
        to: opts.to,
        subject: `New sign-in to your account — ${opts.site}`,
        html: `<p>Hi ${name},</p><p>Your account was just used on a new device: <strong>${device}</strong> (${escape(opts.when)}).</p><p>If this was not you, change your password and review your devices: <a href="${link}">${link}</a></p>`,
        text: `New sign-in on ${opts.device}. Review your devices: ${opts.link}`,
      }
    : {
        to: opts.to,
        subject: `Autentificare nouă în contul tău — ${opts.site}`,
        html: `<p>Salut, ${name}!</p><p>Contul tău a fost folosit acum de pe un dispozitiv nou: <strong>${device}</strong> (${escape(opts.when)}).</p><p>Dacă nu ai fost tu, schimbă-ți parola și verifică dispozitivele: <a href="${link}">${link}</a></p>`,
        text: `Autentificare nouă de pe ${opts.device}. Verifică dispozitivele: ${opts.link}`,
      };
}

export class GcsDeviceService {
  constructor(private readonly deps: { db: PrismaClient; mailer: GcsMailer; settings: GcsSettingsService; baseUrl: () => Promise<string> }) {}

  /**
   * O autentificare nouă (sesiunea creată): actualizează dispozitivul (sau îl creează), scurtează sesiunea pe un
   * dispozitiv fără autentificare automată și trimite emailul „dispozitiv nou” când contul mai avea alte dispozitive.
   */
  async recordLogin(input: { userId: string; sessionId: string; userAgent: string | null; ip: string | null; country?: string | null; path?: string | null }, now = new Date()): Promise<{ isNew: boolean; autoLogin: boolean }> {
    const { db } = this.deps;
    const { browser, os } = parseUserAgent(input.userAgent);
    const key = deviceKey(input.userId, browser, os);
    const method = loginMethod(input.path);
    const location = approximateLocation(input.country);
    const existing = await db.userDevice.findUnique({ where: { userId_key: { userId: input.userId, key } } });
    const others = existing ? 0 : await db.userDevice.count({ where: { userId: input.userId } });
    const device = existing
      ? await db.userDevice.update({ where: { id: existing.id }, data: { method, ip: input.ip, location: location ?? existing.location, lastSeenAt: now } })
      : await db.userDevice.create({ data: { userId: input.userId, key, browser, os, method, ip: input.ip, location, firstSeenAt: now, lastSeenAt: now } });
    if (!device.autoLogin) {
      await db.session.updateMany({ where: { id: input.sessionId }, data: { expiresAt: new Date(now.getTime() + NO_AUTO_LOGIN_HOURS * 3600_000) } });
    }
    if (!existing && others > 0) await this.notifyNewDevice(input.userId, `${browser} · ${os}`, now).catch(() => {});
    return { isNew: !existing, autoLogin: device.autoLogin };
  }

  private async notifyNewDevice(userId: string, device: string, now: Date): Promise<void> {
    const { db, mailer, settings, baseUrl } = this.deps;
    const user = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true, prefs: true, locale: true, timezone: true } });
    if (!user || !normalizeMemberPrefs(user.prefs).newDeviceEmail || user.email.endsWith(".invalid")) return;
    const [site, base] = await Promise.all([settings.get<string>("site.name"), baseUrl()]);
    const when = new Intl.DateTimeFormat(user.locale === "en" ? "en-GB" : "ro-RO", { dateStyle: "medium", timeStyle: "short", timeZone: user.timezone }).format(now);
    await mailer(newDeviceMail({ to: user.email, name: user.name, site, device, when, link: `${base}/settings/devices`, locale: user.locale }));
  }

  /** Dispozitivele din ultimele 90 de zile (cel mai recent primul); `current` = dispozitivul sesiunii curente. */
  async list(userId: string, current: { userAgent: string | null } | null, now = new Date()): Promise<GcsDeviceView[]> {
    const since = new Date(now.getTime() - DEVICE_WINDOW_DAYS * 86_400_000);
    const rows = await this.deps.db.userDevice.findMany({ where: { userId, lastSeenAt: { gte: since } }, orderBy: { lastSeenAt: "desc" }, take: 50 });
    const currentKey = current ? (({ browser, os }) => deviceKey(userId, browser, os))(parseUserAgent(current.userAgent)) : null;
    return rows.map((r) => ({
      id: r.id,
      browser: r.browser,
      os: r.os,
      method: r.method,
      ip: maskIp(r.ip),
      location: r.location,
      autoLogin: r.autoLogin,
      firstSeenAt: r.firstSeenAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      current: r.key === currentKey,
    }));
  }

  /**
   * Autentificarea automată pe un dispozitiv. Oprită: sesiunile active de pe el (în afară de cea curentă) se închid,
   * iar cele noi expiră după câteva ore.
   */
  async setAutoLogin(actor: GcsActor, deviceId: string, autoLogin: boolean, currentSessionId: string | null): Promise<void> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const { db } = this.deps;
    const device = await db.userDevice.findUnique({ where: { id: deviceId } });
    if (!device || device.userId !== actor.userId) throw new GcsNotFound();
    await db.userDevice.update({ where: { id: deviceId }, data: { autoLogin } });
    if (autoLogin) return;
    const sessions = await db.session.findMany({ where: { userId: actor.userId, expiresAt: { gt: new Date() } }, select: { id: true, userAgent: true } });
    const ids = sessions
      .filter((s) => s.id !== currentSessionId)
      .filter((s) => {
        const { browser, os } = parseUserAgent(s.userAgent);
        return deviceKey(actor.userId!, browser, os) === device.key;
      })
      .map((s) => s.id);
    if (ids.length > 0) await db.session.deleteMany({ where: { id: { in: ids } } });
  }
}
