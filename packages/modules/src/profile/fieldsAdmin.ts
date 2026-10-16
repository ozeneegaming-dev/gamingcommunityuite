import { GcsNotFound, GcsValidationError, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsEventBus } from "@gcs/core";
import type { FieldVisibility, Prisma, PrismaClient, ProfileField, ProfileFieldGroup, ProfileFieldSection, ProfileFieldType } from "@gcs/db";
import { isGcsIcon } from "@gcs/ui/icon-registry";
import { isLinkTemplate } from "./fieldGroups";

export const PROFILES_ACP_SECTION = "members.profiles";

const TYPES: ProfileFieldType[] = ["TEXT", "TEXTAREA", "URL", "NUMBER", "SELECT", "IMAGE_SELECT", "SERVER_SELECT"];
/** Imaginea unei opțiuni: un fișier al site-ului sau o adresă https. */
const OPTION_IMAGE = /^(?:\/files\/[A-Za-z0-9_-]{1,40}|https:\/\/[^\s"'<>()]{1,300})$/;
const SECTIONS: ProfileFieldSection[] = ["ABOUT", "GAMES"];
const VISIBILITIES: FieldVisibility[] = ["PUBLIC", "MEMBERS", "STAFF"];
const HELPER_MAX = 300;

export type GcsProfileFieldInput = {
  key: string;
  label: string;
  type: ProfileFieldType;
  options: string[];
  section: ProfileFieldSection;
  required: boolean;
  maxLength: number;
  visibility: FieldVisibility;
  showOnCard: boolean;
  position: number;
  /** Etapa 5: iconița Font Awesome, afișarea în postbit și imaginile opțiunilor (`IMAGE_SELECT`). */
  icon?: string | null;
  showInPostbit?: boolean;
  optionImages?: Record<string, string>;
  /** Profil gaming v2: grupul, textul de ajutor și șablonul linkului de contact (`https://…/{handle}`, doar la „Text”). */
  groupId?: number | null;
  helper?: string;
  linkTemplate?: string | null;
};

export type GcsProfileFieldGroupInput = { key: string; label: string; helper: string; icon?: string | null; position: number };

/** ACP → Membri → Setări membri → Profiluri: câmpurile custom de profil (specul etapei 3, §9) și grupurile lor (v2). */
export class GcsProfileFieldAdmin {
  constructor(private readonly deps: { db: PrismaClient; bus: GcsEventBus; acp: GcsAcpRoleService }) {}

  groups(): Promise<ProfileFieldGroup[]> {
    return this.deps.db.profileFieldGroup.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
  }

  async save(actor: GcsActor, id: number | null, input: GcsProfileFieldInput): Promise<ProfileField> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, PROFILES_ACP_SECTION, "edit");
    const errors: Record<string, string> = {};
    if (!/^[a-z0-9_]{2,40}$/.test(input.key)) errors.key = "invalid";
    const label = input.label.trim();
    if (label.length < 1 || label.length > 60) errors.label = "required";
    if (!TYPES.includes(input.type)) errors.type = "invalid_choice";
    if (!SECTIONS.includes(input.section)) errors.section = "invalid_choice";
    if (!VISIBILITIES.includes(input.visibility)) errors.visibility = "invalid_choice";
    if (!Number.isInteger(input.maxLength) || input.maxLength < 1 || input.maxLength > 5000) errors.maxLength = "invalid_range";
    const options = [...new Set(input.options.map((o) => o.trim()).filter(Boolean))].slice(0, 50);
    const withOptions = input.type === "SELECT" || input.type === "IMAGE_SELECT";
    if (withOptions && options.length < 2) errors.options = "two_required";
    if (input.icon && !isGcsIcon(input.icon)) errors.icon = "invalid_choice";
    const optionImages = Object.fromEntries(
      Object.entries(input.optionImages ?? {}).filter(([option, url]) => input.type === "IMAGE_SELECT" && options.includes(option) && typeof url === "string" && url.trim() !== ""),
    );
    if (Object.values(optionImages).some((url) => !OPTION_IMAGE.test(url.trim()))) errors.optionImages = "invalid_url";
    if (options.some((o) => o.length > 60)) errors.options = "too_long";
    const helper = (input.helper ?? "").replace(/\s+/g, " ").trim();
    if (helper.length > HELPER_MAX) errors.helper = "too_long";
    const linkTemplate = input.linkTemplate?.trim() || null;
    if (linkTemplate && (input.type !== "TEXT" || !isLinkTemplate(linkTemplate))) errors.linkTemplate = "invalid_link_template";
    const groupId = input.groupId ?? null;
    if (groupId !== null && !(await db.profileFieldGroup.findUnique({ where: { id: groupId }, select: { id: true } }))) errors.groupId = "invalid_choice";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const data = {
      key: input.key,
      label,
      type: input.type,
      options: withOptions ? options : [],
      icon: input.icon || null,
      showInPostbit: input.showInPostbit ?? false,
      optionImages: Object.fromEntries(Object.entries(optionImages).map(([o, url]) => [o, url.trim()])) as Prisma.InputJsonValue,
      section: input.section,
      required: input.required,
      maxLength: input.maxLength,
      visibility: input.visibility,
      showOnCard: input.showOnCard,
      position: Number.isInteger(input.position) ? input.position : 0,
      groupId,
      helper,
      linkTemplate,
    };
    const before = id === null ? null : await db.profileField.findUnique({ where: { id } });
    if (id !== null && !before) throw new GcsNotFound();
    const row = await (id === null ? db.profileField.create({ data }) : db.profileField.update({ where: { id }, data })).catch((error: unknown) => {
      if ((error as { code?: string }).code === "P2002") throw new GcsValidationError({ key: "taken" });
      throw error;
    });
    await writeAudit(db, { actorId: actor.userId, action: id === null ? "profile_field.create" : "profile_field.update", targetType: "profile_field", targetId: String(row.id), before, after: row, ip: actor.ip });
    // Valorile pe card sunt cache-uite per user; invalidăm cardurile pe tag-ul comun.
    await bus.emit({ name: "profile_fields.updated", payload: { id: row.id }, tags: ["profile-fields", "cosmetics"] });
    return row;
  }

  async delete(actor: GcsActor, id: number): Promise<void> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, PROFILES_ACP_SECTION, "delete");
    const before = await db.profileField.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    await db.profileField.delete({ where: { id } });
    await writeAudit(db, { actorId: actor.userId, action: "profile_field.delete", targetType: "profile_field", targetId: String(id), before, ip: actor.ip });
    await bus.emit({ name: "profile_fields.updated", payload: { id }, tags: ["profile-fields", "cosmetics"] });
  }

  /** Un grup de câmpuri (nou sau editat): cheia stabilă, titlul, textul de ajutor din formular, iconița și ordinea. */
  async saveGroup(actor: GcsActor, id: number | null, input: GcsProfileFieldGroupInput): Promise<ProfileFieldGroup> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, PROFILES_ACP_SECTION, "edit");
    const errors: Record<string, string> = {};
    const before = id === null ? null : await db.profileFieldGroup.findUnique({ where: { id } });
    if (id !== null && !before) throw new GcsNotFound();
    const key = before?.key ?? input.key.trim();
    if (!/^[a-z0-9_]{2,40}$/.test(key)) errors.key = "invalid";
    const label = input.label.trim();
    if (label.length < 1 || label.length > 60) errors.label = "required";
    const helper = input.helper.replace(/\s+/g, " ").trim();
    if (helper.length > HELPER_MAX) errors.helper = "too_long";
    if (input.icon && !isGcsIcon(input.icon)) errors.icon = "invalid_choice";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const data = { key, label, helper, icon: input.icon || null, position: Number.isInteger(input.position) ? input.position : 0 };
    const row = await (id === null ? db.profileFieldGroup.create({ data }) : db.profileFieldGroup.update({ where: { id }, data })).catch((error: unknown) => {
      if ((error as { code?: string }).code === "P2002") throw new GcsValidationError({ key: "taken" });
      throw error;
    });
    await writeAudit(db, { actorId: actor.userId, action: id === null ? "profile_field_group.create" : "profile_field_group.update", targetType: "profile_field_group", targetId: String(row.id), before, after: row, ip: actor.ip });
    await bus.emit({ name: "profile_fields.updated", payload: { groupId: row.id }, tags: ["profile-fields"] });
    return row;
  }

  /** Șterge un grup; câmpurile lui rămân (fără grup, apar în grupul secțiunii lor). */
  async deleteGroup(actor: GcsActor, id: number): Promise<void> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, PROFILES_ACP_SECTION, "delete");
    const before = await db.profileFieldGroup.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    await db.profileFieldGroup.delete({ where: { id } });
    await writeAudit(db, { actorId: actor.userId, action: "profile_field_group.delete", targetType: "profile_field_group", targetId: String(id), before, ip: actor.ip });
    await bus.emit({ name: "profile_fields.updated", payload: { groupId: id }, tags: ["profile-fields"] });
  }
}
