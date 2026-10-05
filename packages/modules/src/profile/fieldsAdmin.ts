import { GcsNotFound, GcsValidationError, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsEventBus } from "@gcs/core";
import type { FieldVisibility, PrismaClient, ProfileField, ProfileFieldSection, ProfileFieldType } from "@gcs/db";

export const PROFILES_ACP_SECTION = "members.profiles";

const TYPES: ProfileFieldType[] = ["TEXT", "TEXTAREA", "URL", "NUMBER", "SELECT"];
const SECTIONS: ProfileFieldSection[] = ["ABOUT", "GAMES"];
const VISIBILITIES: FieldVisibility[] = ["PUBLIC", "MEMBERS", "STAFF"];

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
};

/** ACP → Membri → Setări membri → Profiluri: câmpurile custom de profil (specul etapei 3, §9). */
export class GcsProfileFieldAdmin {
  constructor(private readonly deps: { db: PrismaClient; bus: GcsEventBus; acp: GcsAcpRoleService }) {}

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
    if (input.type === "SELECT" && options.length < 2) errors.options = "two_required";
    if (options.some((o) => o.length > 60)) errors.options = "too_long";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const data = {
      key: input.key,
      label,
      type: input.type,
      options: input.type === "SELECT" ? options : [],
      section: input.section,
      required: input.required,
      maxLength: input.maxLength,
      visibility: input.visibility,
      showOnCard: input.showOnCard,
      position: Number.isInteger(input.position) ? input.position : 0,
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
}
