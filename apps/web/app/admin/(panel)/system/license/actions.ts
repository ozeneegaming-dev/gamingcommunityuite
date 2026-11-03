"use server";

import { checkLicenseOnline, GCS_PREMIUM_APPS, GcsConflict, GcsRateLimited, installDomain, normalizeLicenseKey, verifyLicense, writeAudit, type GcsResult } from "@gcs/core";
import { field, runAcpAction } from "@/lib/acp-actions";
import { installState } from "@/lib/install";
import { services } from "@/lib/services";

/** Activările din ACP: Data Center-ul are limita lui, aceasta oprește un formular trimis în buclă. */
const RULE = { window: 15 * 60, max: 10 };

/**
 * Schimbă licența site-ului (ACP › Sistem › Licență): o cheie scurtă (activată la Data Center, ca în installer) sau un
 * token lung (licențele offline; unul emis de Data Center trece și prin verificarea online, ca în installer). Licența
 * nouă trebuie să fie valabilă pentru domeniul site-ului. Pentru un token lung urmează o verificare online imediată,
 * ca starea din ACP să fie a licenței noi (o licență invalidă nu își „uită” astfel perioada de grație).
 */
export async function changeLicenseAction(fd: FormData): Promise<GcsResult<{ licensee: string }>> {
  return runAcpAction("system.license", "edit", async (actor) => {
    const { db, licenseOnline, rateLimiter } = services();
    const input = field(fd, "key").trim();
    const key = normalizeLicenseKey(input);
    let token = input;
    if (key) {
      if (!(await rateLimiter.consume(`acp-license:${actor.userId ?? actor.ip}`, RULE)).allowed) throw new GcsRateLimited({ reason: "license_key_rate_limited" });
      const activated = await licenseOnline.activate(key);
      if (!activated.ok) throw new GcsConflict({ reason: `license_key_${activated.error}` });
      token = activated.token;
    }
    const result = verifyLicense(token, { domain: installDomain(), premiumApps: GCS_PREMIUM_APPS });
    if (!result.ok) throw new GcsConflict({ reason: `license_${result.error}` });
    // Licența de test a modului dev nu înlocuiește o licență reală.
    if (result.license.dev) throw new GcsConflict({ reason: "license_malformed" });
    if (!key && (await checkLicenseOnline(token, { domain: installDomain() })).status === "revoked") throw new GcsConflict({ reason: "license_revoked" });
    const state = installState();
    await state.saveLicense(token);
    await state.saveLicenseKey(key);
    if (!key) await licenseOnline.run().catch(() => null);
    await writeAudit(db, {
      actorId: actor.userId,
      action: "license.change",
      targetType: "license",
      targetId: result.license.id,
      after: { licensee: result.license.licensee, domains: result.license.domains, apps: result.license.apps, via: key ? "key" : "token" },
      ip: actor.ip,
    });
    return { licensee: result.license.licensee };
  });
}
