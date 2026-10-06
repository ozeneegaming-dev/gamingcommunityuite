"use server";

import { GcsForbidden, GcsValidationError } from "@gcs/core";
import { Prisma } from "@gcs/db";
import { cookies, headers } from "next/headers";
import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { isTimeZone, TZ_COOKIE } from "@/lib/appearance";
import { getAuth } from "@/lib/auth";
import { services } from "@/lib/services";

/** Câmpurile de profil și bio-ul (Setări → Profil). */
export const saveProfile = gcsAction(
  z.object({ bio: z.string().max(500), fields: z.record(z.string(), z.string().max(5000)) }),
  async ({ bio, fields }, { actor }) => {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const { profiles } = services();
    await profiles.updateBio(actor, actor.userId, bio);
    await profiles.updateFields(actor, actor.userId, fields);
  },
);

export const setCoverPosition = gcsAction(z.object({ positionY: z.number().min(0).max(100) }), async ({ positionY }, { actor }) => {
  await services().profiles.setCoverPosition(actor, positionY);
});

export const removeImage = gcsAction(z.object({ kind: z.enum(["avatar", "cover"]) }), async ({ kind }, { actor }) => {
  if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
  const { profiles } = services();
  if (kind === "avatar") await profiles.resetAvatar(actor, actor.userId);
  else await profiles.resetCover(actor, actor.userId);
});

/** Aspect: rama, stilul numelui și culoarea de accent. `null` = fără. */
export const saveAppearance = gcsAction(
  z.object({
    avatarFrameId: z.number().int().positive().nullable(),
    nameStyleId: z.number().int().positive().nullable(),
    accentColor: z.string().nullable(),
  }),
  async (input, { actor }) => {
    const { cosmetics, profiles } = services();
    await cosmetics.choose(actor, { avatarFrameId: input.avatarFrameId, nameStyleId: input.nameStyleId });
    await profiles.setAccent(actor, input.accentColor);
  },
);

export const savePrivacy = gcsAction(
  z.object({
    profile: z.enum(["PUBLIC", "MEMBERS", "FOLLOWED"]),
    messages: z.enum(["MEMBERS", "FOLLOWED", "NOBODY"]),
    wall: z.enum(["MEMBERS", "FOLLOWED", "NOBODY"]),
    showOnline: z.boolean(),
  }),
  async (input, { actor }) => {
    await services().profiles.updatePrivacy(actor, input);
  },
);

/** Ignoră un membru după nume (Setări → Ignorați). */
export const ignoreByName = gcsAction(
  z.object({ name: z.string().min(1).max(60), posts: z.boolean(), messages: z.boolean() }),
  async ({ name, posts, messages }, { actor }) => {
    const { db, social } = services();
    const user = await db.user.findFirst({ where: { name: { equals: name.trim(), mode: "insensitive" } }, select: { id: true } });
    if (!user) throw new GcsValidationError({ name: "unknown_user" });
    await social.ignore(actor, user.id, { posts, messages });
  },
);

export const unignore = gcsAction(z.object({ userId: z.string().min(8).max(40) }), async ({ userId }, { actor }) => {
  await services().social.unignore(actor, userId);
});

export const requestEmailChange = gcsAction(z.object({ email: z.string().max(200) }), async ({ email }, { actor }) => {
  await services().profiles.requestEmailChange(actor, email);
});

/** Parola: prin Better Auth (verifică parola curentă și deconectează celelalte sesiuni). */
export const changePassword = gcsAction(
  z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(8, "password_too_short").max(200) }),
  async ({ currentPassword, newPassword }, { actor }) => {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const auth = await getAuth();
    try {
      await auth.api.changePassword({ body: { currentPassword, newPassword, revokeOtherSessions: true }, headers: await headers() });
    } catch {
      throw new GcsValidationError({ currentPassword: "invalid_password" });
    }
  },
);

/** Dezleagă Discord/Steam, doar dacă rămâne o altă metodă de login. */
export const unlinkAccount = gcsAction(z.object({ providerId: z.enum(["discord", "steam"]) }), async ({ providerId }, { actor }) => {
  if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
  const { db } = services();
  const accounts = await db.account.findMany({ where: { userId: actor.userId }, select: { providerId: true } });
  if (!accounts.some((a) => a.providerId === providerId)) return;
  if (accounts.length < 2) throw new GcsValidationError({ providerId: "last_login_method" });
  await db.account.deleteMany({ where: { userId: actor.userId, providerId } });
});

/** Fusul orar (Setări → Limbă și fus orar): în cont și în cookie (formatarea datelor îl citește la fiecare request). */
export const setTimezone = gcsAction(z.object({ timezone: z.string().min(1).max(64) }), async ({ timezone }, { actor }) => {
  if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
  if (!isTimeZone(timezone)) throw new GcsValidationError({ timezone: "invalid_choice" });
  await services().db.user.update({ where: { id: actor.userId }, data: { timezone } });
  (await cookies()).set(TZ_COOKIE, timezone, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
});

/** Toast-urile și sunetul notificărilor (Setări → Notificări); implicit ambele pornite. */
export const saveAlertPrefs = gcsAction(z.object({ toasts: z.boolean(), sound: z.boolean() }), async ({ toasts, sound }, { actor }) => {
  if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
  await services().db.$executeRaw`UPDATE users SET prefs = prefs || jsonb_build_object('toasts', ${toasts}::boolean, 'sound', ${sound}::boolean) WHERE id = ${actor.userId}`;
});

/** Închide o altă sesiune a contului (Setări → Securitate); sesiunea curentă se închide cu „Ieșire”. */
export const revokeSession = gcsAction(z.object({ id: z.string().min(1).max(64) }), async ({ id }, { actor }) => {
  if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
  const current = await currentSessionId();
  if (id === current) throw new GcsValidationError({ id: "current_session" });
  await services().db.session.deleteMany({ where: { id, userId: actor.userId } });
});

/** Închide toate celelalte sesiuni ale contului. */
export const revokeOtherSessions = gcsAction(z.object({}), async (_input, { actor }) => {
  if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
  const current = await currentSessionId();
  const { count } = await services().db.session.deleteMany({ where: { userId: actor.userId, ...(current ? { NOT: { id: current } } : {}) } });
  return { count };
});

/** Semnătura de sub postări: același editor și același renderer ca postările, fără imagini și video; `null` = ștearsă. */
export const saveSignature = gcsAction(z.object({ content: z.unknown().nullable() }), async ({ content }, { actor }) => {
  if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
  const { db, posting, settings } = services();
  if (content === null) {
    await db.user.update({ where: { id: actor.userId }, data: { signatureJson: Prisma.DbNull, signatureHtml: "" } });
    return;
  }
  if (hasNode(content, ["image", "embed"])) throw new GcsValidationError({ content: "signature_media" });
  const rendered = await posting.render(content);
  const max = await settings.get<number>("profile.signature_max_chars");
  if (rendered.text.length > max) throw new GcsValidationError({ content: "too_long" }, { max: String(max) });
  await db.user.update({ where: { id: actor.userId }, data: { signatureJson: rendered.json as Prisma.InputJsonValue, signatureHtml: rendered.html } });
});

/** Documentul conține un nod de tipul dat (căutare limitată în adâncime). */
function hasNode(doc: unknown, types: string[], depth = 0): boolean {
  if (depth > 30 || typeof doc !== "object" || doc === null) return false;
  const node = doc as { type?: unknown; content?: unknown };
  if (typeof node.type === "string" && types.includes(node.type)) return true;
  return Array.isArray(node.content) && node.content.some((c) => hasNode(c, types, depth + 1));
}

/** Id-ul sesiunii curente (Better Auth). */
async function currentSessionId(): Promise<string | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.session.id ?? null;
}
