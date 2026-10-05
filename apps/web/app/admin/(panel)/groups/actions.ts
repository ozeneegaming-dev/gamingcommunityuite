"use server";

import { GcsValidationError, type GcsNameStyle, type GcsResult } from "@gcs/core";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const SECTION = "members.groups";

export async function createGroup(fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    const group = await services().groups.create({ name: field(fd, "name") }, actor);
    return { id: group.id };
  });
}

export async function reorderGroups(order: number[]): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    await services().groups.reorder(order.map(Number), actor);
    return null;
  });
}

export async function updateGroupDetails(groupId: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    await services().groups.update(
      groupId,
      { name: field(fd, "name"), title: field(fd, "title"), isVip: fd.get("isVip") === "on" },
      actor,
    );
    return null;
  });
}

/** Stilul numelui: culoarea (și ca `Group.color`), gradientul, strălucirea, grosimea, înclinarea și iconița. */
export async function updateGroupStyle(groupId: number, style: GcsNameStyle): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    const color = typeof style.color === "string" ? style.color.toUpperCase() : null;
    const nameStyle: GcsNameStyle = {};
    if (color) nameStyle.color = color;
    if (Array.isArray(style.gradient) && style.gradient.length >= 2) {
      nameStyle.gradient = style.gradient.map((c) => String(c).toUpperCase());
      if (style.animated) nameStyle.animated = true;
    }
    if (typeof style.glow === "string" && style.glow) nameStyle.glow = style.glow.toUpperCase();
    if (style.bold) nameStyle.bold = true;
    if (style.italic) nameStyle.italic = true;
    if (typeof style.icon === "string" && style.icon.trim()) nameStyle.icon = style.icon.trim();
    await services().groups.update(groupId, { color, nameStyle }, actor);
    return null;
  });
}

/** Setările de grup: câmpurile `setting:<cheie>`; checkbox-urile lipsă înseamnă `false`. */
export async function updateGroupSettings(groupId: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    const { groups, registry, db } = services();
    const group = await db.group.findUnique({ where: { id: groupId }, include: { settings: true } });
    const stored = new Map(group?.settings.map((s) => [s.key, s.value]) ?? []);
    const errors: Record<string, string> = {};
    for (const def of registry.permissionDefs()) {
      if (def.scope !== "group") continue;
      const name = `setting:${def.key}`;
      const kind = field(fd, `kind:${def.key}`);
      if (!kind) continue;
      const value = kind === "number" ? intField(fd, name) : fd.get(name) === "on";
      if (typeof value === "number" && !Number.isInteger(value)) {
        errors[def.key] = "invalid_type";
        continue;
      }
      // Scriem (și jurnalizăm) doar valorile schimbate față de cea efectivă (salvată sau implicită).
      const current = stored.has(def.key) ? stored.get(def.key) : group ? def.default[group.key] : undefined;
      const effective = current ?? (kind === "number" ? 0 : false);
      if (effective === value) continue;
      await groups.setSetting(groupId, def.key, value, actor);
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    return null;
  });
}

export async function deleteGroup(groupId: number): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "delete", async (actor) => {
    await services().groups.delete(groupId, actor);
    return null;
  });
}
