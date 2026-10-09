import { createHash, randomBytes } from "node:crypto";
import {
  GCS_RICH_FIELDS,
  GcsForbidden,
  GcsNotFound,
  GcsRateLimited,
  GcsValidationError,
  isHexColor,
  isRichDoc,
  renderRichField,
  richFieldHtml,
  writeAudit,
  type GcsActor,
  type GcsAttachmentService,
  type GcsEventBus,
  type GcsMailer,
  type GcsPermissionService,
  type GcsRedisRateLimiter,
  type GcsSettingsService,
  type GcsUploadedFile,
} from "@gcs/core";
import { Prisma, type FieldVisibility, type PrismaClient, type ProfileField } from "@gcs/db";
import { RENDER_LABELS } from "../forums/labels";
import { emailChangeMail } from "./emails";
import { isValidPrivacy, normalizePrivacy, type GcsPrivacy } from "./privacy";

export const USER_AVATAR = "user.avatar";
export const USER_COVER = "user.cover";
/** Conturile create prin Steam nu au email; primesc unul placeholder (etapa 1). */
export const STEAM_PLACEHOLDER_DOMAIN = "@steam.invalid";

const BIO_MAX = 160;
const EMAIL_TOKEN_HOURS = 24;
const EMAIL_CHANGE_LIMIT = { window: 3600, max: 5 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type GcsVisibleField = {
  key: string;
  label: string;
  type: ProfileField["type"];
  section: ProfileField["section"];
  /** Textul simplu (postbit, card). */
  value: string;
  /** Câmpurile „Text lung”: HTML-ul sanitizat (formatat cu editorul, sau textul vechi ca paragrafe). */
  html?: string;
  showOnCard: boolean;
};

/** O valoare validată: textul simplu și, la câmpurile „Text lung” scrise în editor, documentul și HTML-ul. */
type FieldValue = { value: string; json?: Prisma.InputJsonValue; html?: string };

export type GcsProfileDeps = {
  db: PrismaClient;
  bus: GcsEventBus;
  permissions: GcsPermissionService;
  settings: GcsSettingsService;
  attachments: GcsAttachmentService;
  rateLimiter: GcsRedisRateLimiter;
  mailer: GcsMailer;
  /** Adresa publică a site-ului, pentru linkurile din emailuri. */
  baseUrl: () => Promise<string>;
};

const userTags = (id: string) => [`user:${id}`];
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Profilul membrului (specul etapei 3, §4, §6): câmpuri custom, bio, accent, avatar, cover, confidențialitate, email. */
export class GcsProfileService {
  constructor(private readonly deps: GcsProfileDeps) {
    deps.attachments.registerAccess(USER_AVATAR, async () => true);
    deps.attachments.registerAccess(USER_COVER, async () => true);
  }

  /** Staff-ul cu `profile.moderate` poate edita profilurile altora (și vede tot). */
  isModerator(actor: GcsActor): Promise<boolean> {
    return this.deps.permissions.can(actor, "profile.moderate");
  }

  /** Actorul își editează propriul profil sau e moderator; altfel `GcsForbidden`. */
  private async assertCanEdit(actor: GcsActor, userId: string): Promise<boolean> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (actor.userId === userId) return false;
    if (await this.isModerator(actor)) return true;
    throw new GcsForbidden({ permission: "profile.moderate" });
  }

  private async changed(userId: string, actor: GcsActor, asStaff: boolean, what: string, before?: unknown, after?: unknown): Promise<void> {
    if (asStaff) {
      await writeAudit(this.deps.db, { actorId: actor.userId, action: `profile.${what}`, targetType: "user", targetId: userId, before, after, ip: actor.ip });
    }
    await this.deps.bus.emit({ name: "profile.updated", payload: { userId, what }, tags: userTags(userId) });
  }

  // ─── Confidențialitate și vizibilitate ────────────────────────────────────

  async privacyOf(userId: string): Promise<GcsPrivacy> {
    const row = await this.deps.db.user.findUnique({ where: { id: userId }, select: { privacy: true } });
    if (!row) throw new GcsNotFound();
    return normalizePrivacy(row.privacy);
  }

  /** `true` dacă `ownerId` îl urmărește pe `viewerId` (regula `FOLLOWED`: „cei pe care îi urmăresc eu”). */
  async ownerFollows(ownerId: string, viewerId: string | null): Promise<boolean> {
    if (!viewerId) return false;
    return (await this.deps.db.follow.count({ where: { userId: ownerId, contentType: "user", contentId: viewerId } })) > 0;
  }

  /** Cine vede profilul (pagina, cardul, activitatea). Proprietarul și staff-ul văd mereu. */
  async canView(viewer: GcsActor, owner: { id: string; privacy: unknown }): Promise<boolean> {
    if (viewer.userId === owner.id) return true;
    if (!(await this.deps.permissions.can(viewer, "core.view_public"))) return false;
    if (viewer.userId && (await this.isModerator(viewer))) return true;
    const privacy = normalizePrivacy(owner.privacy);
    if (privacy.profile === "PUBLIC") return true;
    if (!viewer.userId) return false;
    if (privacy.profile === "MEMBERS") return true;
    return this.ownerFollows(owner.id, viewer.userId);
  }

  async updatePrivacy(actor: GcsActor, privacy: unknown): Promise<GcsPrivacy> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (!isValidPrivacy(privacy)) throw new GcsValidationError({ privacy: "invalid" });
    const value: GcsPrivacy = { profile: privacy.profile, messages: privacy.messages, wall: privacy.wall, showOnline: privacy.showOnline };
    await this.deps.db.user.update({ where: { id: actor.userId }, data: { privacy: value } });
    await this.changed(actor.userId, actor, false, "privacy");
    return value;
  }

  // ─── Câmpuri custom ───────────────────────────────────────────────────────

  fields(): Promise<ProfileField[]> {
    return this.deps.db.profileField.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
  }

  /** Câmpurile completate pe care `viewer` le poate vedea la `userId`. */
  async visibleFields(viewer: GcsActor, userId: string): Promise<GcsVisibleField[]> {
    const rows = await this.deps.db.profileFieldValue.findMany({ where: { userId }, include: { field: true } });
    const seeStaff = viewer.userId === userId || (viewer.userId !== null && (await this.deps.permissions.can(viewer, "profile.see_private_fields")));
    const allowed = (v: FieldVisibility) => v === "PUBLIC" || (v === "MEMBERS" && viewer.userId !== null) || (v === "STAFF" && seeStaff);
    return rows
      .filter((r) => r.value !== "" && (viewer.userId === userId || allowed(r.field.visibility)))
      .sort((a, b) => a.field.position - b.field.position || a.field.id - b.field.id)
      .map((r) => ({
        key: r.field.key,
        label: r.field.label,
        type: r.field.type,
        section: r.field.section,
        value: r.value,
        // Valorile vechi (fără HTML) se afișează ca paragrafe: conversie la citire.
        ...(r.field.type === "TEXTAREA" ? { html: r.html || richFieldHtml(r.value, GCS_RICH_FIELDS.profileText) } : {}),
        showOnCard: r.field.showOnCard,
      }));
  }

  /** Validează o valoare pentru tipul câmpului; întoarce valoarea curățată sau codul erorii. */
  private validate(field: ProfileField, raw: unknown): FieldValue | { error: string } {
    // „Text lung” scris în editor: documentul trece prin validatorul conținutului și prin profilul câmpului.
    if (field.type === "TEXTAREA" && isRichDoc(raw)) {
      try {
        const rendered = renderRichField(raw, GCS_RICH_FIELDS.profileText, { maxChars: field.maxLength, field: field.key });
        return { value: rendered.text, json: rendered.json as Prisma.InputJsonValue, html: rendered.html };
      } catch (error) {
        if (error instanceof GcsValidationError) return { error: Object.values(error.fields)[0] ?? "invalid" };
        throw error;
      }
    }
    if (typeof raw !== "string") return { error: "invalid" };
    // Fără caractere de control (în afară de rândul nou, doar la TEXTAREA).
    const value = (field.type === "TEXTAREA" ? raw.replace(/\r\n?/g, "\n") : raw.replace(/\s+/g, " "))
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
      .trim();
    if (value === "") return field.required ? { error: "required" } : { value };
    if (value.length > field.maxLength) return { error: "too_long" };
    switch (field.type) {
      case "URL": {
        if (!URL.canParse(value)) return { error: "invalid_url" };
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:" ? { value } : { error: "invalid_url" };
      }
      case "NUMBER":
        return /^-?\d{1,12}(\.\d{1,4})?$/.test(value) ? { value } : { error: "invalid_number" };
      case "SELECT":
      case "IMAGE_SELECT":
        return field.options.includes(value) ? { value } : { error: "invalid_choice" };
      default:
        return { value };
    }
  }

  /**
   * Salvează câmpurile trimise (cheie → valoare). O valoare goală șterge câmpul.
   * Câmpurile obligatorii trebuie să rămână completate (chiar dacă nu sunt trimise acum).
   */
  async updateFields(actor: GcsActor, userId: string, values: Record<string, unknown>): Promise<void> {
    const asStaff = await this.assertCanEdit(actor, userId);
    const fields = await this.fields();
    const byKey = new Map(fields.map((f) => [f.key, f]));
    const stored = new Map(
      (await this.deps.db.profileFieldValue.findMany({ where: { userId } })).map((v) => [v.fieldId, v.value]),
    );
    const errors: Record<string, string> = {};
    const writes: (FieldValue & { field: ProfileField })[] = [];
    for (const [key, raw] of Object.entries(values)) {
      const field = byKey.get(key);
      if (!field) {
        errors[key] = "unknown";
        continue;
      }
      const result = this.validate(field, raw);
      if ("error" in result) errors[key] = result.error;
      else writes.push({ field, ...result });
    }
    const written = new Map(writes.map((w) => [w.field.id, w.value]));
    for (const field of fields) {
      if (field.required && !errors[field.key] && !(written.get(field.id) ?? stored.get(field.id))) errors[field.key] = "required";
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);

    await this.deps.db.$transaction(async (tx) => {
      for (const { field, value, json, html } of writes) {
        // Un text simplu (fără editor) șterge formatarea veche: se afișează ca paragrafe.
        const rich = { json: json ?? Prisma.DbNull, html: html ?? "" };
        if (value === "") await tx.profileFieldValue.deleteMany({ where: { userId, fieldId: field.id } });
        else
          await tx.profileFieldValue.upsert({
            where: { userId_fieldId: { userId, fieldId: field.id } },
            create: { userId, fieldId: field.id, value, ...rich },
            update: { value, ...rich },
          });
      }
    });
    await this.changed(userId, actor, asStaff, "fields", undefined, Object.fromEntries(writes.map((w) => [w.field.key, w.value])));
  }

  // ─── Bio, accent, avatar, cover ──────────────────────────────────────────

  async updateBio(actor: GcsActor, userId: string, bio: string): Promise<void> {
    const asStaff = await this.assertCanEdit(actor, userId);
    const clean = bio.replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (clean.length > BIO_MAX) throw new GcsValidationError({ bio: "too_long" }, { max: String(BIO_MAX) });
    await this.deps.db.user.update({ where: { id: userId }, data: { bio: clean } });
    await this.changed(userId, actor, asStaff, "bio", undefined, clean);
  }

  /**
   * Ziua de naștere a membrului (`YYYY-MM-DD` sau `null` = ștearsă) și dacă e publică: pe profil (ziua și luna, fără an)
   * și în comanda `/zi-de-nastere` din Chat Pro. Anul trebuie să fie între 1900 și anul curent, data nu poate fi în viitor.
   */
  async setBirthday(actor: GcsActor, input: { date: string | null; visible: boolean }): Promise<void> {
    if (!actor.userId || actor.isBanned) throw new GcsForbidden({ reason: "guest" });
    let birthday: Date | null = null;
    if (input.date) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date);
      const d = m ? new Date(`${input.date}T00:00:00Z`) : null;
      const valid = d !== null && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === input.date && Number(m![1]) >= 1900 && d.getTime() <= Date.now();
      if (!valid) throw new GcsValidationError({ birthday: "invalid_date" });
      birthday = d;
    }
    await this.deps.db.user.update({ where: { id: actor.userId }, data: { birthday, birthdayVisible: birthday !== null && input.visible === true } });
    await this.changed(actor.userId, actor, false, "birthday");
  }

  // ─── Semnătura ────────────────────────────────────────────────────────────

  /**
   * Limitele semnăturii pentru actor: `profile.signature_max_chars` (0 = semnături oprite pe site) și setarea de grup
   * `signature.max_chars` (convenția grupurilor: `-1` = nelimitat, `0` / lipsă = interzis), se aplică cea mai strictă;
   * imaginile: `profile.signature_max_images`. `maxChars: 0` = actorul nu poate avea semnătură.
   */
  async signatureLimits(actor: GcsActor): Promise<{ maxChars: number; maxImages: number }> {
    const { settings, permissions } = this.deps;
    const [site, images, group] = await Promise.all([
      settings.get<number>("profile.signature_max_chars"),
      settings.get<number>("profile.signature_max_images"),
      actor.userId ? permissions.groupValue<number | boolean>(actor, "signature.max_chars") : Promise.resolve(0),
    ]);
    const groupMax = group === -1 || group === true ? Number.POSITIVE_INFINITY : typeof group === "number" && group > 0 ? group : 0;
    return { maxChars: Math.max(0, Math.min(site, groupMax)), maxImages: images };
  }

  /**
   * Semnătura de sub postări (Setări → Semnătură): documentul editorului trece prin validatorul conținutului și prin
   * profilul semnăturii (fără video, imagini doar din adrese https, limitele de mai sus); `null` o șterge.
   */
  async saveSignature(actor: GcsActor, content: unknown): Promise<void> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const { db, settings } = this.deps;
    if (content === null) {
      await db.user.update({ where: { id: actor.userId }, data: { signatureJson: Prisma.DbNull, signatureHtml: "" } });
      return;
    }
    const limits = await this.signatureLimits(actor);
    if (limits.maxChars <= 0) throw new GcsValidationError({ content: "signature_disabled" });
    const locale = await settings.get<string>("site.locale");
    const rendered = renderRichField(content, GCS_RICH_FIELDS.signature, { ...limits, render: { labels: RENDER_LABELS[locale] ?? RENDER_LABELS.ro! } });
    await db.user.update({ where: { id: actor.userId }, data: { signatureJson: rendered.json as Prisma.InputJsonValue, signatureHtml: rendered.html } });
  }

  /** Culoarea de accent: doar `#RRGGBB` (ajunge în CSS inline pe profil); `null` = implicită. */
  async setAccent(actor: GcsActor, accent: string | null): Promise<void> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (accent !== null && !isHexColor(accent)) throw new GcsValidationError({ accent: "invalid_color" });
    await this.deps.db.user.update({ where: { id: actor.userId }, data: { accentColor: accent } });
    await this.changed(actor.userId, actor, false, "accent");
  }

  async setAvatar(actor: GcsActor, file: GcsUploadedFile): Promise<string> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const maxMb = await this.deps.permissions.groupValue<number | boolean>(actor, "upload.max_mb");
    const att = await this.deps.attachments.uploadProfileImage(actor, file, {
      kind: "avatar",
      maxMb: typeof maxMb === "number" ? maxMb : 0,
      animated: false,
    });
    await this.deps.db.user.update({ where: { id: actor.userId }, data: { image: att.url } });
    await this.changed(actor.userId, actor, false, "avatar");
    return att.url;
  }

  /** Cover-ul: cere `profile.cover`; animat doar cu `profile.animated_cover`. `positionY` = 0–100 (%). */
  async setCover(actor: GcsActor, file: GcsUploadedFile, positionY = 50): Promise<string> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    await this.deps.permissions.assert(actor, "profile.cover");
    const [maxMb, animated] = await Promise.all([
      this.deps.settings.get<number>("profile.cover_max_mb"),
      this.deps.permissions.can(actor, "profile.animated_cover"),
    ]);
    const att = await this.deps.attachments.uploadProfileImage(actor, file, { kind: "cover", maxMb, animated });
    await this.deps.db.user.update({
      where: { id: actor.userId },
      data: { coverAttachmentId: att.id, coverPositionY: clampPercent(positionY) },
    });
    await this.changed(actor.userId, actor, false, "cover");
    return att.url;
  }

  async setCoverPosition(actor: GcsActor, positionY: number): Promise<void> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    await this.deps.db.user.update({ where: { id: actor.userId }, data: { coverPositionY: clampPercent(positionY) } });
    await this.changed(actor.userId, actor, false, "cover");
  }

  /** Șterge avatarul (propriul sau, pentru staff, al oricui). */
  async resetAvatar(actor: GcsActor, userId: string): Promise<void> {
    const asStaff = await this.assertCanEdit(actor, userId);
    await this.deps.attachments.deleteProfileImage(userId, "avatar");
    await this.deps.db.user.update({ where: { id: userId }, data: { image: null } });
    await this.changed(userId, actor, asStaff, "avatar_reset");
  }

  async resetCover(actor: GcsActor, userId: string): Promise<void> {
    const asStaff = await this.assertCanEdit(actor, userId);
    await this.deps.attachments.deleteProfileImage(userId, "cover");
    await this.deps.db.user.update({ where: { id: userId }, data: { coverAttachmentId: null, coverPositionY: 50 } });
    await this.changed(userId, actor, asStaff, "cover_reset");
  }

  // ─── Email ───────────────────────────────────────────────────────────────

  /** Contul are încă emailul placeholder de la Steam (trebuie să-și adauge unul real). */
  static needsRealEmail(email: string): boolean {
    return email.endsWith(STEAM_PLACEHOLDER_DOMAIN);
  }

  /**
   * Trimite un link de confirmare la adresa nouă. Emailul contului se schimbă doar la confirmare
   * (`confirmEmailChange`), deci o greșeală de tastare nu blochează contul.
   */
  async requestEmailChange(actor: GcsActor, email: string): Promise<void> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address) || address.endsWith(STEAM_PLACEHOLDER_DOMAIN) || address.length > 200) {
      throw new GcsValidationError({ email: "invalid_email" });
    }
    const limit = await this.deps.rateLimiter.consume(`email-change:${actor.userId}`, EMAIL_CHANGE_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    const user = await this.deps.db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true, email: true } });
    if (user.email === address) throw new GcsValidationError({ email: "same_email" });
    if (await this.deps.db.user.findUnique({ where: { email: address }, select: { id: true } })) {
      throw new GcsValidationError({ email: "taken" });
    }

    const token = randomBytes(32).toString("base64url");
    await this.deps.db.verification.deleteMany({ where: { identifier: { startsWith: `email-change:${actor.userId}:` } } });
    await this.deps.db.verification.create({
      data: {
        identifier: `email-change:${actor.userId}:${tokenHash(token)}`,
        value: address,
        expiresAt: new Date(Date.now() + EMAIL_TOKEN_HOURS * 3600_000),
      },
    });
    const [site, locale, base] = await Promise.all([
      this.deps.settings.get<string>("site.name"),
      this.deps.settings.get<string>("site.locale"),
      this.deps.baseUrl(),
    ]);
    await this.deps.mailer(
      emailChangeMail({ to: address, name: user.name, site, locale, link: `${base.replace(/\/$/, "")}/verify-email?token=${token}` }),
    );
  }

  /** Confirmă schimbarea emailului din link. Întoarce id-ul userului. Tokenul e de unică folosință. */
  async confirmEmailChange(token: string): Promise<string> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new GcsNotFound();
    const rows = await this.deps.db.verification.findMany({ where: { identifier: { endsWith: `:${tokenHash(token)}`, startsWith: "email-change:" } } });
    const row = rows[0];
    if (!row || row.expiresAt < new Date()) throw new GcsNotFound();
    const userId = row.identifier.split(":")[1]!;
    await this.deps.db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.verification.delete({ where: { id: row.id } });
      if (await tx.user.findUnique({ where: { email: row.value }, select: { id: true } })) {
        throw new GcsValidationError({ email: "taken" });
      }
      await tx.user.update({ where: { id: userId }, data: { email: row.value, emailVerified: true } });
    });
    await this.deps.bus.emit({ name: "profile.updated", payload: { userId, what: "email" }, tags: userTags(userId) });
    return userId;
  }
}

function clampPercent(v: number): number {
  return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 50;
}
