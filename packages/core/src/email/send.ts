import nodemailer from "nodemailer";
import { GcsValidationError } from "../errors";

/** Ce citește `sendEmail` din setări (`GcsSettingsService` o satisface). */
export type GcsEmailSettings = { get<T>(key: string): Promise<T> };

/** Un email de trimis. */
export type GcsMail = { to: string; subject: string; html: string; text?: string };
/** Trimiterea unui email: în producție prin SMTP (`sendEmail`), în teste într-un outbox. */
export type GcsMailer = (mail: GcsMail) => Promise<void>;

type GcsMailTransport = { sendMail(message: Record<string, unknown>): Promise<unknown> };
type GcsTransportFactory = (options: Record<string, unknown>) => GcsMailTransport;

const TIMEOUT_MS = 10_000;

/**
 * Site-ul poate trimite emailuri: serverul SMTP și expeditorul sunt completate (ACP → Setări → Email). Aceleași câmpuri
 * pe care `sendEmail` le cere; o setare care nu se poate citi înseamnă „nu”.
 */
export async function emailConfigured(settings: GcsEmailSettings): Promise<boolean> {
  const [host, from] = await Promise.all([settings.get<string>("email.smtp_host").catch(() => ""), settings.get<string>("email.from").catch(() => "")]);
  return typeof host === "string" && host.trim() !== "" && typeof from === "string" && from.trim() !== "";
}

/**
 * Trimite un email prin serverul SMTP din setări (ACP → Setări → Email). `createTransport` se poate
 * înlocui în teste. Fără server sau expeditor configurat → `GcsValidationError` pe câmpul lipsă.
 */
export async function sendEmail(
  opts: { to: string; subject: string; html: string; text?: string },
  settings: GcsEmailSettings,
  deps: { createTransport?: GcsTransportFactory } = {},
): Promise<void> {
  const [host, port, user, pass, from, siteName] = await Promise.all([
    settings.get<string>("email.smtp_host"),
    settings.get<number>("email.smtp_port"),
    settings.get<string>("email.smtp_user"),
    settings.get<string>("email.smtp_pass"),
    settings.get<string>("email.from"),
    settings.get<string>("site.name"),
  ]);
  const missing: Record<string, string> = {};
  if (!host) missing["email.smtp_host"] = "required";
  if (!from) missing["email.from"] = "required";
  if (Object.keys(missing).length > 0) throw new GcsValidationError(missing);

  const options: Record<string, unknown> = {
    host,
    port,
    // 465 = TLS direct; celelalte porturi (587, 25) pornesc în clar și trec la TLS prin STARTTLS.
    secure: port === 465,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  };
  if (user) options.auth = { user, pass };

  const create = deps.createTransport ?? (nodemailer.createTransport as unknown as GcsTransportFactory);
  const transport = create(options);
  await transport.sendMail({
    from: `"${siteName.replace(/"/g, "")}" <${from}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    ...(opts.text ? { text: opts.text } : {}),
  });
}
