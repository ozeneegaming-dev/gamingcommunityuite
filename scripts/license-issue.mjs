#!/usr/bin/env node
/**
 * Emite licența unui client GamingCommunitySuite (token `GCS1.…` semnat Ed25519), până există platforma-mamă.
 *
 *   pnpm license:issue -- --key <cheia privată de licență PEM> --licensee "Comunitatea X SRL" \
 *     --domain forum.exemplu.ro [--domain *.exemplu.ro] [--apps servers,chat_pro] [--expires 2027-10-23|never] \
 *     [--key-id gcs-lic-2026] [--id <id licență>] [--out <fișier>]
 *
 * Formatul și verificarea sunt cele din `packages/core/src/install/license.ts`: installer-ul clientului verifică tokenul
 * OFFLINE cu cheia publică inclusă în release (`pnpm release -- --license-key-file …pub.txt`). Cheia privată se citește
 * doar din fișierul dat și nu se afișează; înainte de afișare, tokenul e verificat cu cheia publică derivată din ea.
 */
import { createPrivateKey, createPublicKey, randomBytes, sign, verify } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "GCS1";
const SIGNED_HEADER = "GCS-LICENSE-V1\n";
/** Aplicațiile premium (catalogul installer-ului, `packages/core/src/install/apps.ts`). */
export const PREMIUM_APPS = ["servers", "shop", "vip_studio", "chat_pro", "groups_pro"];
const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
/** Un domeniu (`forum.exemplu.ro`) sau un wildcard de subdomenii (`*.exemplu.ro`), fără schemă, port sau cale. */
const DOMAIN = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$/;

/** Expirarea: `never` (fără) sau o dată `AAAA-LL-ZZ` (valabilă până la sfârșitul zilei, UTC), în viitor. */
function expiresAt(value, now) {
  if (value === undefined || value === "never") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const at = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T23:59:59.000Z`) : null;
  if (!at || Number.isNaN(at.getTime())) throw new Error(`expirarea trebuie să fie AAAA-LL-ZZ sau never (primit: ${value})`);
  if (at.getTime() <= now.getTime()) throw new Error(`expirarea e în trecut: ${value}`);
  return at.toISOString();
}

/** Emite o licență și întoarce tokenul și conținutul ei. */
export function issueLicense({ key, keyId = "gcs-lic-2026", licensee, domains = [], apps = [], expires = "never", id, now = new Date() }) {
  if (!key || !existsSync(key)) throw new Error("--key lipsește sau fișierul nu există (cheia privată de licență PEM)");
  if (!KEY_ID.test(keyId)) throw new Error("--key-id invalid");
  const name = String(licensee ?? "").trim();
  if (!name || name.length > 200) throw new Error("licențiatul (--licensee) e obligatoriu (cel mult 200 de caractere)");
  const hosts = [...new Set(domains.map((d) => String(d).trim().toLowerCase()).filter(Boolean))];
  if (hosts.length === 0) throw new Error("cel puțin un domeniu (--domain) e obligatoriu");
  for (const d of hosts) if (!DOMAIN.test(d)) throw new Error(`domeniu invalid: ${d} (ex. forum.exemplu.ro sau *.exemplu.ro)`);
  const premium = [...new Set(apps.map((a) => String(a).trim()).filter(Boolean))];
  for (const a of premium) if (!PREMIUM_APPS.includes(a)) throw new Error(`aplicație premium necunoscută: ${a} (sunt: ${PREMIUM_APPS.join(", ")})`);

  const license = {
    v: 1,
    kid: keyId,
    id: id ?? `lic-${now.toISOString().slice(0, 10)}-${randomBytes(4).toString("hex")}`,
    licensee: name,
    domains: hosts,
    package: "standard",
    apps: premium,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt(expires, now),
  };
  const privateKey = createPrivateKey(readFileSync(key, "utf8"));
  const body = Buffer.from(JSON.stringify(license), "utf8").toString("base64url");
  const message = Buffer.from(SIGNED_HEADER + body, "utf8");
  const signature = sign(null, message, privateKey);
  if (!verify(null, message, createPublicKey(privateKey), signature)) throw new Error("semnătura nu se verifică cu cheia publică derivată");
  return { token: `${PREFIX}.${body}.${signature.toString("base64url")}`, license };
}

/** Argumentele din linia de comandă (domeniile și aplicațiile: repetate sau separate prin virgulă). */
export function parseIssueArgs(argv) {
  const out = { keyId: "gcs-lic-2026", domains: [], apps: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--key") out.key = next();
    else if (a === "--key-id") out.keyId = next();
    else if (a === "--licensee") out.licensee = next();
    else if (a === "--domain") out.domains.push(...String(next()).split(","));
    else if (a === "--apps") out.apps.push(...String(next()).split(","));
    else if (a === "--expires") out.expires = next();
    else if (a === "--id") out.id = next();
    else if (a === "--out") out.out = next();
  }
  out.domains = out.domains.map((d) => d.trim()).filter(Boolean);
  out.apps = out.apps.map((d) => d.trim()).filter(Boolean);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseIssueArgs(process.argv.slice(2));
    const { token, license } = issueLicense(args);
    if (args.out) writeFileSync(args.out, `${token}\n`);
    console.log(`Licență ${license.id} pentru ${license.licensee}`);
    console.log(`  domenii:  ${license.domains.join(", ")}`);
    console.log(`  premium:  ${license.apps.length ? license.apps.join(", ") : "—"}`);
    console.log(`  expiră:   ${license.expiresAt ?? "niciodată"}`);
    console.log(`  cheia:    ${license.kid}`);
    console.log(args.out ? `Tokenul e în ${args.out}` : `\n${token}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
