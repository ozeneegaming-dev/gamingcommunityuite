"use server";

import type { GcsNameStyle, GcsResult } from "@gcs/core";
import { type Prisma, jsonInts } from "@gcs/db";
import { FRAMES_ACP_SECTION, NAME_STYLES_ACP_SECTION, type GcsFrameStyle } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const TIERS = "vip.tiers";
const SUBSCRIBERS = "vip.subscribers";

const ids = (fd: FormData, name: string) => fd.getAll(name).map(Number).filter(Number.isInteger);
const availability = (fd: FormData) => ({ allGroups: fd.get("allGroups") === "on", groupIds: ids(fd, "groupIds"), badgeIds: ids(fd, "badgeIds") });

/** Un nivel VIP nou: un grup `isVip`, cu setările (privilegiile) copiate de la un nivel existent. */
export async function createTier(fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(TIERS, "edit", async (actor) => {
    const { groups, db, permissions } = services();
    const source = intField(fd, "copyFrom");
    const from = Number.isInteger(source) ? await db.group.findUnique({ where: { id: source }, include: { settings: true } }) : null;
    const group = await groups.create(
      { name: field(fd, "name"), isVip: true, color: field(fd, "color") || (from?.color ?? null), nameStyle: (from?.nameStyle as GcsNameStyle | null) ?? null },
      actor,
    );
    if (from) {
      for (const s of from.settings) {
        await db.groupSetting.upsert({
          where: { groupId_key: { groupId: group.id, key: s.key } },
          create: { groupId: group.id, key: s.key, value: s.value as Prisma.InputJsonValue },
          update: { value: s.value as Prisma.InputJsonValue },
        });
      }
      await permissions.bumpVersion();
    }
    return { id: group.id };
  });
}

export async function extendSubscription(subscriptionId: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SUBSCRIBERS, "edit", async (actor) => {
    await services().vip.extend(actor, subscriptionId, intField(fd, "days"));
    return null;
  });
}

export async function revokeSubscription(subscriptionId: number): Promise<GcsResult<null>> {
  return runAcpAction(SUBSCRIBERS, "edit", async (actor) => {
    await services().vip.revoke(actor, subscriptionId, "acp");
    return null;
  });
}

/** Stil nou: cheia (`ns_*`), numele și disponibilitatea; stilul pornește de la un gradient auriu și se editează apoi. */
export async function createNameStyle(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(NAME_STYLES_ACP_SECTION, "edit", async (actor) => {
    await services().cosmetics.saveNameStyle(actor, null, {
      key: `ns_${field(fd, "key").trim().replace(/^ns_/, "")}`,
      name: field(fd, "name"),
      style: { gradient: ["#F4B740", "#FFF0B8", "#E8961C"], animated: true, bold: true },
      ...availability(fd),
    });
    return null;
  });
}

/** Numele și disponibilitatea unui stil existent (stilul propriu-zis se salvează din editor). */
export async function saveNameStyleMeta(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(NAME_STYLES_ACP_SECTION, "edit", async (actor) => {
    const { db, cosmetics } = services();
    const row = await db.nameStyle.findUniqueOrThrow({ where: { id } });
    await cosmetics.saveNameStyle(actor, id, { key: row.key, name: field(fd, "name"), style: row.style as GcsNameStyle, ...availability(fd) });
    return null;
  });
}

export async function saveNameStyleLook(id: number, style: GcsNameStyle): Promise<GcsResult<null>> {
  return runAcpAction(NAME_STYLES_ACP_SECTION, "edit", async (actor) => {
    const { db, cosmetics } = services();
    const row = await db.nameStyle.findUniqueOrThrow({ where: { id } });
    await cosmetics.saveNameStyle(actor, id, { key: row.key, name: row.name, style, allGroups: row.allGroups, groupIds: jsonInts(row.groupIds), badgeIds: jsonInts(row.badgeIds) });
    return null;
  });
}

export async function deleteNameStyle(id: number): Promise<GcsResult<null>> {
  return runAcpAction(NAME_STYLES_ACP_SECTION, "delete", async (actor) => {
    await services().cosmetics.deleteNameStyle(actor, id);
    return null;
  });
}

/** Ramă: CSS (2–6 culori, grosime, glow, rotire) sau imagine (PNG/APNG/WebP încărcată aici). */
export async function saveFrame(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(FRAMES_ACP_SECTION, "edit", async (actor) => {
    const { cosmetics, attachments, db } = services();
    const kind = field(fd, "kind") === "IMAGE" ? "IMAGE" : "CSS";
    let imageAttachmentId: string | null = id !== null ? ((await db.avatarFrame.findUnique({ where: { id } }))?.imageAttachmentId ?? null) : null;
    const file = fd.get("image");
    if (kind === "IMAGE" && file instanceof File && file.size > 0) {
      const att = await attachments.upload(actor, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { permission: "vip.manage" });
      imageAttachmentId = att.id;
    }
    const style: GcsFrameStyle = {
      colors: field(fd, "colors")
        .split(/[\s,]+/)
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
      width: intField(fd, "width"),
      spin: fd.get("spin") === "on",
      ...(field(fd, "glow").trim() ? { glow: field(fd, "glow").trim().toUpperCase() } : {}),
    };
    await cosmetics.saveFrame(actor, id, {
      key: field(fd, "key").trim(),
      name: field(fd, "name"),
      kind,
      style: kind === "CSS" ? style : { colors: [], width: style.width ?? 3 },
      imageAttachmentId: kind === "IMAGE" ? imageAttachmentId : null,
      ...availability(fd),
    });
    return null;
  });
}

export async function deleteFrame(id: number): Promise<GcsResult<null>> {
  return runAcpAction(FRAMES_ACP_SECTION, "delete", async (actor) => {
    await services().cosmetics.deleteFrame(actor, id);
    return null;
  });
}
