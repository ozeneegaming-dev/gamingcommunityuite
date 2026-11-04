import { createHmac, randomBytes } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { checkFetchUrl, GcsNotFound, GcsValidationError, isPublicAddress, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsEvent, type GcsEventBus, type GcsJobQueue, type GcsKv, type GcsSettingsService } from "@gcs/core";
import type { PrismaClient, WebhookEndpoint } from "@gcs/db";
import { plainPayload } from "../plugins/host";

/** Secțiunea ACP (ACP › Sistem › Funcții site › Webhooks). */
export const WEBHOOKS_ACP_SECTION = "system.webhooks";
/** Jobul care trimite o livrare (cu reîncercările cozii). */
export const WEBHOOK_JOB = "webhooks.deliver";
const LOG_MAX = 50;
const logKey = (id: number) => `gcs:webhooks:log:${id}`;

/** Evenimentele care pot pleca spre un webhook (subsetul public al bus-ului, fără datele private). */
export const WEBHOOK_EVENTS = ["topic.created", "post.created", "post.approved", "user.registered", "user.banned", "user.warned", "report.created", "badge.awarded", "vip.granted", "vip.expired"] as const;
export type GcsWebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "ping";
export type GcsWebhookFormat = "json" | "discord";

export type GcsWebhookInput = { name: string; url: string; format: GcsWebhookFormat; events: string[]; enabled: boolean };
export type GcsWebhookDelivery = { at: number; event: string; status: number; ms: number; error?: string };
export type GcsWebhookView = Omit<WebhookEndpoint, "events"> & { events: string[]; log: GcsWebhookDelivery[] };

const eventsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((e): e is string => typeof e === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(e)) : []);

/** Cât așteaptă rezolvarea DNS a unei adrese (salvarea din ACP nu rămâne blocată). */
const DNS_TIMEOUT_MS = 5000;

/** IP-urile unui domeniu; nimic dacă nu se rezolvă în `DNS_TIMEOUT_MS`. */
async function resolveHost(host: string): Promise<string[]> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<[]>((resolve) => {
    timer = setTimeout(() => resolve([]), DNS_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([dnsLookup(host, { all: true }).catch(() => []), timeout])).map((a) => a.address);
  } finally {
    clearTimeout(timer);
  }
}

/** Adresa e publică (fără rețele interne): schema, portul, apoi fiecare IP rezolvat. */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = checkFetchUrl(raw);
  } catch {
    throw new GcsValidationError({ url: "invalid_url" });
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) !== 0 ? [host] : await resolveHost(host);
  if (addresses.length === 0) throw new GcsValidationError({ url: "unresolvable" });
  if (addresses.some((a) => !isPublicAddress(a))) throw new GcsValidationError({ url: "blocked_address" });
  return url;
}

/**
 * Webhook-urile: la evenimentele alese, o livrare intră în coadă (worker-ul VPS sau cron-ul Lite) și pleacă spre adresa
 * endpointului — JSON semnat (HMAC SHA-256 cu secretul, antetele `X-GCS-Event` și `X-GCS-Signature`) sau un mesaj
 * Discord cu titlul și linkul. Doar adrese publice; redirecturile nu se urmează. Jurnalul păstrează ultimele 50.
 */
export class GcsWebhookService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      kv: GcsKv;
      jobs: Pick<GcsJobQueue, "enqueue">;
      acp: Pick<GcsAcpRoleService, "assert">;
      settings: Pick<GcsSettingsService, "get">;
      baseUrl: () => Promise<string>;
      fetch?: typeof fetch;
      resolveUrl?: (raw: string) => Promise<URL>;
    },
  ) {}

  /** Abonarea la bus: evenimentele din `WEBHOOK_EVENTS` pun o livrare în coadă pentru fiecare endpoint abonat. */
  listen(bus: Pick<GcsEventBus, "on">): void {
    for (const name of WEBHOOK_EVENTS) bus.on(name, (e) => this.onEvent(e));
  }

  private async onEvent(e: GcsEvent): Promise<void> {
    const targets = await this.deps.db.webhookEndpoint.findMany({ where: { enabled: true }, select: { id: true, events: true } }).catch(() => []);
    for (const t of targets) {
      if (eventsOf(t.events).includes(e.name)) await this.deps.jobs.enqueue(WEBHOOK_JOB, { id: t.id, event: e.name, payload: plainPayload(e.payload), at: Date.now() }).catch(() => {});
    }
  }

  async list(actor: GcsActor): Promise<GcsWebhookView[]> {
    await this.deps.acp.assert(actor, WEBHOOKS_ACP_SECTION, "view");
    const rows = await this.deps.db.webhookEndpoint.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return Promise.all(rows.map(async (r) => ({ ...r, events: eventsOf(r.events), log: await this.log(r.id, 10) })));
  }

  async log(id: number, count = LOG_MAX): Promise<GcsWebhookDelivery[]> {
    const raw = await this.deps.kv.listRange(logKey(id), count).catch(() => [] as string[]);
    return raw.flatMap((line) => {
      try {
        return [JSON.parse(line) as GcsWebhookDelivery];
      } catch {
        return [];
      }
    });
  }

  private async valid(input: GcsWebhookInput): Promise<GcsWebhookInput> {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 60) throw new GcsValidationError({ name: "length" });
    if (input.format !== "json" && input.format !== "discord") throw new GcsValidationError({ format: "invalid_choice" });
    const events = [...new Set(eventsOf(input.events))];
    if (events.length === 0) throw new GcsValidationError({ events: "required" });
    const url = await (this.deps.resolveUrl ?? assertPublicUrl)(input.url.trim());
    if (input.format === "discord" && !/^(?:canary\.|ptb\.)?discord(?:app)?\.com$/.test(url.hostname)) throw new GcsValidationError({ url: "invalid_url" });
    return { ...input, name, url: url.toString(), events };
  }

  async save(actor: GcsActor, id: number | null, input: GcsWebhookInput): Promise<{ id: number }> {
    await this.deps.acp.assert(actor, WEBHOOKS_ACP_SECTION, "edit");
    const v = await this.valid(input);
    const data = { name: v.name, url: v.url, format: v.format, events: v.events, enabled: v.enabled };
    const row =
      id === null
        ? await this.deps.db.webhookEndpoint.create({ data: { ...data, secret: randomBytes(24).toString("base64url") }, select: { id: true } })
        : await this.deps.db.webhookEndpoint.update({ where: { id }, data, select: { id: true } }).catch(() => null);
    if (!row) throw new GcsNotFound({ entity: "webhook" });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: id === null ? "webhooks.create" : "webhooks.update", targetType: "webhook", targetId: String(row.id), after: { name: v.name, format: v.format, events: v.events }, ip: actor.ip });
    return row;
  }

  async rotateSecret(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, WEBHOOKS_ACP_SECTION, "edit");
    const { count } = await this.deps.db.webhookEndpoint.updateMany({ where: { id }, data: { secret: randomBytes(24).toString("base64url") } });
    if (count === 0) throw new GcsNotFound({ entity: "webhook" });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "webhooks.rotate", targetType: "webhook", targetId: String(id), ip: actor.ip });
  }

  async remove(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, WEBHOOKS_ACP_SECTION, "delete");
    const { count } = await this.deps.db.webhookEndpoint.deleteMany({ where: { id } });
    if (count === 0) throw new GcsNotFound({ entity: "webhook" });
    await this.deps.kv.del(logKey(id)).catch(() => 0);
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "webhooks.delete", targetType: "webhook", targetId: String(id), ip: actor.ip });
  }

  /** „Trimite un test”: evenimentul `ping`, trimis acum (nu prin coadă); întoarce livrarea. */
  async test(actor: GcsActor, id: number): Promise<GcsWebhookDelivery> {
    await this.deps.acp.assert(actor, WEBHOOKS_ACP_SECTION, "edit");
    return this.deliver(id, "ping", { message: "test" }, Date.now(), false);
  }

  /** Textul mesajului Discord pentru un eveniment (cu titlul și linkul, când există). */
  private async discordText(event: string, payload: Record<string, unknown>, site: string, base: string): Promise<string> {
    const { db } = this.deps;
    const topicId = typeof payload.topicId === "number" ? payload.topicId : null;
    const userId = typeof payload.userId === "string" ? payload.userId : null;
    const topic = topicId ? await db.topic.findUnique({ where: { id: topicId }, select: { id: true, title: true, slug: true } }) : null;
    const user = userId ? await db.user.findUnique({ where: { id: userId }, select: { name: true } }) : null;
    const link = topic ? `${base}/topic/${topic.id}-${topic.slug}` : "";
    const lines: Record<string, string> = {
      ping: `✅ ${site}: webhook-ul funcționează.`,
      "topic.created": topic ? `📝 Topic nou: **${topic.title}**\n${link}` : "📝 Topic nou",
      "post.created": topic ? `💬 Răspuns nou în **${topic.title}**\n${link}` : "💬 Răspuns nou",
      "post.approved": topic ? `✔️ Postare aprobată în **${topic.title}**\n${link}` : "✔️ Postare aprobată",
      "user.registered": user ? `👋 Membru nou: **${user.name}**` : "👋 Membru nou",
      "user.banned": user ? `⛔ ${user.name} a fost banat.` : "⛔ Un membru a fost banat.",
      "user.warned": user ? `⚠️ ${user.name} a primit un avertisment.` : "⚠️ Avertisment nou.",
      "report.created": "🚩 Raport nou în coada de moderare.",
      "badge.awarded": user ? `🏅 ${user.name} a primit un badge.` : "🏅 Badge nou acordat.",
      "vip.granted": user ? `👑 ${user.name} a devenit VIP.` : "👑 VIP nou.",
      "vip.expired": user ? `⌛ VIP-ul lui ${user.name} a expirat.` : "⌛ Un VIP a expirat.",
    };
    return (lines[event] ?? event).slice(0, 1900);
  }

  /**
   * Trimite o livrare: corpul (JSON sau Discord), semnătura, timeout 10 s, fără redirecturi. Notează rezultatul în
   * jurnal; cu `throwOnFail` (jobul), un eșec aruncă, ca coada să reîncerce.
   */
  async deliver(id: number, event: string, payload: Record<string, unknown>, at: number, throwOnFail = true): Promise<GcsWebhookDelivery> {
    const hook = await this.deps.db.webhookEndpoint.findUnique({ where: { id } });
    if (!hook) throw new GcsNotFound({ entity: "webhook" });
    const [site, base] = await Promise.all([this.deps.settings.get<string>("site.name").catch(() => ""), this.deps.baseUrl()]);
    const body =
      hook.format === "discord"
        ? JSON.stringify({ username: site || "GamingCommunitySuite", content: await this.discordText(event, payload, site, base.replace(/\/$/, "")), allowed_mentions: { parse: [] } })
        : JSON.stringify({ event, at: new Date(at).toISOString(), site: { name: site, url: base }, data: payload });
    const signature = `sha256=${createHmac("sha256", hook.secret).update(body).digest("hex")}`;
    const started = Date.now();
    let status = 0;
    let error: string | undefined;
    try {
      await (this.deps.resolveUrl ?? assertPublicUrl)(hook.url);
      const res = await (this.deps.fetch ?? fetch)(hook.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", "User-Agent": "GamingCommunitySuite-Webhooks/1.0", "X-GCS-Event": event, "X-GCS-Signature": signature },
        body,
      });
      status = res.status;
      if (status < 200 || status >= 300) error = `HTTP ${status}`;
    } catch (e) {
      error = e instanceof GcsValidationError ? "blocked_address" : e instanceof Error ? e.message.slice(0, 200) : "error";
    }
    const delivery: GcsWebhookDelivery = { at: Date.now(), event, status, ms: Date.now() - started, ...(error ? { error } : {}) };
    await this.deps.kv.listPush(logKey(id), JSON.stringify(delivery), LOG_MAX).catch(() => {});
    if (error && throwOnFail) throw new Error(`webhook ${id}: ${error}`);
    return delivery;
  }
}
