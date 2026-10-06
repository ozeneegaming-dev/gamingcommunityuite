/**
 * CLI-ul `gcs` (spec §17.1), rulat în containerul `web`: `docker compose exec web node apps/web/cli/gcs.mjs …`
 * (wrapper-ul `gcs` din rădăcina proiectului face asta). E un client subțire peste `/api/internal/cli`.
 * Codurile de ieșire: 0 = ok, 1 = eroare, 2 = utilizare greșită.
 */
import { CLI_TOKEN_HEADER, cliToken } from "../lib/cli-token";

export type GcsCliResponse = { status: number; body: Record<string, unknown> };

export type GcsCliPrompt = {
  input(message: string, opts?: { default?: string }): Promise<string>;
  password(message: string): Promise<string>;
  select(message: string, choices: { name: string; value: string }[]): Promise<string>;
};

export type GcsCliIo = {
  request(command: string, args?: Record<string, unknown>): Promise<GcsCliResponse>;
  out(line: string): void;
  err(line: string): void;
  env: Record<string, string | undefined>;
  prompt?: GcsCliPrompt;
};

export const HELP = `GamingCommunitySuite — consola de administrare

Folosire: gcs <comandă> [opțiuni]

Comenzi:
  status                         Starea instalării și a serviciilor
  install [--non-interactive]    Instalează platforma (aceiași pași ca /install)
                                 --non-interactive citește GCS_INSTALL_* din mediu
  reset-admin-password <nume>    Parolă nouă pentru un Root Admin (2FA se dezactivează)
  maintenance on|off             Pornește sau oprește modul mentenanță
  backup [--out <folder>]        Backup: baza de date, fișierele și configurarea
  restore <fișier>               Restaurează un backup
  help                           Acest ajutor

Coduri de ieșire: 0 = ok, 1 = eroare, 2 = utilizare greșită.`;

const ERROR_TEXT: Record<string, string> = {
  not_root: "Doar conturile Root Admin pot fi resetate din consolă.",
  not_found: "Utilizatorul nu există.",
  installed: "Platforma e deja instalată.",
  busy: "O instalare rulează deja.",
  forbidden: "Acces refuzat: GCS_SECRET lipsește sau e diferit.",
  validation: "Date invalide.",
};

const FIELD_TEXT: Record<string, string> = {
  required: "obligatoriu",
  invalid_url: "URL invalid",
  email_invalid: "email invalid",
  password_too_short: "minimum 8 caractere",
  username_too_short: "minimum 3 caractere",
  username_too_long: "maximum 24 de caractere",
  username_invalid_chars: "doar litere, cifre și _ . -",
};

/** Variabilele `gcs install --non-interactive`. */
export const INSTALL_ENV = {
  siteName: "GCS_INSTALL_SITE_NAME",
  siteUrl: "GCS_INSTALL_SITE_URL",
  locale: "GCS_INSTALL_LOCALE",
  timezone: "GCS_INSTALL_TIMEZONE",
  adminName: "GCS_INSTALL_ADMIN_NAME",
  adminEmail: "GCS_INSTALL_ADMIN_EMAIL",
  adminPassword: "GCS_INSTALL_ADMIN_PASSWORD",
  data: "GCS_INSTALL_DATA",
  smtpHost: "GCS_INSTALL_SMTP_HOST",
  smtpPort: "GCS_INSTALL_SMTP_PORT",
  smtpUser: "GCS_INSTALL_SMTP_USER",
  smtpPass: "GCS_INSTALL_SMTP_PASS",
  smtpFrom: "GCS_INSTALL_SMTP_FROM",
  databaseUrl: "GCS_INSTALL_DATABASE_URL",
} as const;
const REQUIRED_INSTALL: (keyof typeof INSTALL_ENV)[] = ["siteName", "adminName", "adminEmail", "adminPassword"];

function reportError(io: GcsCliIo, res: GcsCliResponse): number {
  const code = String(res.body.error ?? "internal");
  const params = (res.body.params ?? {}) as Record<string, string>;
  const reason = params.reason ?? code;
  io.err(`Eroare: ${ERROR_TEXT[reason] ?? ERROR_TEXT[code] ?? String(res.body.message ?? code)}`);
  const fields = (res.body.fields ?? {}) as Record<string, string>;
  for (const [field, fieldCode] of Object.entries(fields)) io.err(`  ${field}: ${FIELD_TEXT[fieldCode] ?? fieldCode}`);
  return 1;
}

async function interactiveInstall(prompt: GcsCliPrompt): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  values.siteName = await prompt.input("Numele site-ului", { default: "Comunitatea mea" });
  values.siteUrl = await prompt.input("Adresa site-ului (ex. https://forum.exemplu.ro)");
  values.locale = await prompt.select("Limba implicită", [
    { name: "Română", value: "ro" },
    { name: "English", value: "en" },
  ]);
  values.adminName = await prompt.input("Nume de utilizator Root Admin");
  values.adminEmail = await prompt.input("Email Root Admin");
  for (;;) {
    const password = await prompt.password("Parola Root Admin (minimum 8 caractere)");
    if ((await prompt.password("Confirmă parola")) === password) {
      values.adminPassword = password;
      break;
    }
  }
  values.data = await prompt.select("Date inițiale", [
    { name: "Date demo", value: "demo" },
    { name: "Fără date", value: "empty" },
  ]);
  return values;
}

export async function runCli(argv: string[], io: GcsCliIo): Promise<number> {
  const [command, ...rest] = argv;
  if (!command) {
    io.err(HELP);
    return 2;
  }

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      io.out(HELP);
      return 0;

    case "status": {
      const res = await io.request("status");
      if (res.status !== 200) return reportError(io, res);
      const health = (res.body.health ?? {}) as { db?: boolean; redis?: boolean };
      const yes = (v: unknown) => (v ? "ok" : "EROARE");
      io.out(`Versiune:     ${String(res.body.version)}`);
      io.out(`Instalat:     ${res.body.installed ? "da" : "nu (deschide /install sau rulează gcs install)"}`);
      io.out(`Baza de date: ${yes(health.db)}`);
      io.out(`Redis:        ${yes(health.redis)}`);
      return health.db && health.redis ? 0 : 1;
    }

    case "install": {
      const nonInteractive = rest.includes("--non-interactive");
      let values: Record<string, string>;
      if (nonInteractive) {
        values = Object.fromEntries(
          Object.entries(INSTALL_ENV)
            .map(([key, env]) => [key, io.env[env]] as const)
            .filter((entry): entry is readonly [string, string] => typeof entry[1] === "string" && entry[1] !== ""),
        );
        const missing = REQUIRED_INSTALL.filter((k) => !values[k]);
        if (missing.length > 0) {
          io.err(`Lipsesc variabilele: ${missing.map((k) => INSTALL_ENV[k]).join(", ")}`);
          return 2;
        }
      } else {
        if (!io.prompt) {
          io.err("Instalarea interactivă cere un terminal. Folosește --non-interactive.");
          return 2;
        }
        values = await interactiveInstall(io.prompt);
      }
      io.out("Instalez platforma…");
      const res = await io.request("install", values);
      if (res.status !== 200) return reportError(io, res);
      for (const step of (res.body.steps as string[] | undefined) ?? []) io.out(`  ✓ ${step}`);
      io.out("Instalare finalizată. Intră pe site, autentifică-te ca Root Admin și activează 2FA în ACP.");
      return 0;
    }

    case "reset-admin-password": {
      const name = rest[0];
      if (!name) {
        io.err("Folosire: gcs reset-admin-password <nume>");
        return 2;
      }
      const res = await io.request("reset-admin-password", { name });
      if (res.status !== 200) return reportError(io, res);
      io.out(`Parola nouă pentru ${name}: ${String(res.body.password)}`);
      io.out("Se afișează o singură dată. 2FA a fost dezactivat, iar sesiunile contului au fost închise.");
      return 0;
    }

    case "maintenance": {
      const mode = rest[0];
      if (mode !== "on" && mode !== "off") {
        io.err("Folosire: gcs maintenance on|off");
        return 2;
      }
      const res = await io.request("maintenance", { on: mode === "on" });
      if (res.status !== 200) return reportError(io, res);
      io.out(mode === "on" ? "Mentenanță pornită." : "Mentenanță oprită.");
      return 0;
    }

    case "site-name": {
      const res = await io.request("site-name");
      if (res.status !== 200) return reportError(io, res);
      io.out(String(res.body.siteName));
      return 0;
    }

    case "backup":
    case "restore":
      io.err(`„gcs ${command}” rulează pe server, prin wrapper-ul gcs din /opt/redline (are nevoie de docker compose).`);
      return 2;

    default:
      io.err(`Comandă necunoscută: ${command}\n\n${HELP}`);
      return 2;
  }
}

/** I/O real: HTTP către aplicația din același container, prompturi `@inquirer/prompts`. */
async function main(): Promise<void> {
  const secret = process.env.GCS_SECRET ?? "";
  const base = process.env.GCS_CLI_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  const io: GcsCliIo = {
    async request(command, args = {}) {
      try {
        const res = await fetch(`${base}/api/internal/cli`, {
          method: "POST",
          headers: { "Content-Type": "application/json", [CLI_TOKEN_HEADER]: cliToken(secret) },
          body: JSON.stringify({ command, args }),
        });
        return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
      } catch (error) {
        return { status: 503, body: { error: "unreachable", message: `Aplicația nu răspunde la ${base} (${String(error)})` } };
      }
    },
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    env: process.env,
  };
  if (process.stdin.isTTY) {
    const inquirer = await import("@inquirer/prompts");
    io.prompt = {
      input: (message, opts) => inquirer.input({ message, ...(opts?.default ? { default: opts.default } : {}) }),
      password: (message) => inquirer.password({ message, mask: "*" }),
      select: (message, choices) => inquirer.select({ message, choices }),
    };
  }
  process.exit(await runCli(process.argv.slice(2), io));
}

if (process.argv[1] && /gcs\.(m?js|ts)$/.test(process.argv[1])) void main();
