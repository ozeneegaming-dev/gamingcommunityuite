import type { PrismaClient, Report } from "@gcs/db";
import type { GcsRedisRateLimiter } from "../auth/rateLimit";
import { writeAudit } from "../audit";
import { GcsConflict, GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsActor } from "../permissions/types";

/** Ce trebuie să știe serviciul despre un tip de conținut raportabil. */
export type GcsReportableContent = {
  canView: (actor: GcsActor, contentId: string) => Promise<boolean>;
  canModerate: (actor: GcsActor, contentId: string) => Promise<boolean>;
  /** Ascunde conținutul (închiderea cu „ascunde”). */
  hide: (actor: GcsActor, contentId: string, reason: string) => Promise<void>;
};

const REPORT_LIMIT = { window: 3600, max: 10 };

/** Rapoartele (spec §5, §12.4): orice conținut înregistrat de un modul poate fi raportat; moderatorii le închid. */
export class GcsReportService {
  private readonly contents = new Map<string, GcsReportableContent>();

  constructor(private readonly deps: { db: PrismaClient; bus: GcsEventBus; rateLimiter: GcsRedisRateLimiter }) {}

  registerContent(contentType: string, content: GcsReportableContent): void {
    this.contents.set(contentType, content);
  }

  async report(actor: GcsActor, input: { contentType: string; contentId: string; reason: string }): Promise<Report> {
    const { db, bus, rateLimiter } = this.deps;
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const reason = input.reason.replace(/\s+/g, " ").trim();
    if (reason.length < 3 || reason.length > 500) throw new GcsValidationError({ reason: "invalid" });
    const content = this.contents.get(input.contentType);
    if (!content || !(await content.canView(actor, input.contentId))) throw new GcsNotFound();

    const open = await db.report.count({
      where: { contentType: input.contentType, contentId: input.contentId, reporterId: actor.userId, status: "OPEN" },
    });
    if (open > 0) throw new GcsConflict({ reason: "already_reported" });
    const limit = await rateLimiter.consume(`report:${actor.userId}`, REPORT_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });

    const row = await db.report.create({
      data: { contentType: input.contentType, contentId: input.contentId, reporterId: actor.userId, reason },
    });
    await bus.emit({ name: "report.created", payload: { reportId: row.id, contentType: row.contentType }, tags: ["reports"] });
    return row;
  }

  /**
   * Închide un raport. Cu `hide`, conținutul e ascuns și se închid toate rapoartele deschise pe el.
   * Doar cine poate modera conținutul.
   */
  async close(actor: GcsActor, reportId: string, opts: { action: "none" | "hide" }): Promise<void> {
    const { db, bus } = this.deps;
    const report = await db.report.findUnique({ where: { id: reportId } });
    if (!report) throw new GcsNotFound();
    const content = this.contents.get(report.contentType);
    if (!content || !(await content.canModerate(actor, report.contentId))) throw new GcsForbidden({ reason: "moderate" });

    if (opts.action === "hide") await content.hide(actor, report.contentId, report.reason);
    const where = opts.action === "hide" ? { contentType: report.contentType, contentId: report.contentId, status: "OPEN" as const } : { id: reportId };
    await db.$transaction(async (tx) => {
      await tx.report.updateMany({ where, data: { status: "CLOSED", handledById: actor.userId, handledAt: new Date() } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "mod.report.close",
        targetType: report.contentType,
        targetId: report.contentId,
        after: { reportId, action: opts.action },
        ip: actor.ip,
      });
    });
    await bus.emit({ name: "report.closed", payload: { reportId }, tags: ["reports"] });
  }
}
