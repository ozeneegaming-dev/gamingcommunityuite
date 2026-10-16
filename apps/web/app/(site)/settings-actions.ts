"use server";

import { GcsConflict, GcsForbidden, GcsRateLimited, GcsValidationError, verifyPassword } from "@gcs/core";
import { cookies, headers } from "next/headers";
import * as z from "zod";
import { verifyTwoFactorCode } from "@/lib/acp";
import { freshSignIn } from "@/lib/account-deletion";
import { gcsAction } from "@/lib/actions";
import { isTimeZone, TZ_COOKIE } from "@/lib/appearance";
import { getAuth } from "@/lib/auth";
import { services } from "@/lib/services";

/** Câmpurile de profil și bio-ul (Setări → Profil). */
export const saveProfile = gcsAction(
  // Câmpurile „Text lung” trimit documentul editorului; serviciul validează fiecare valoare după tipul câmpului.
  z.object({ bio: z.string().max(500), fields: z.record(z.string(), z.union([z.string().max(5000), z.record(z.string(), z.unknown())])) }),
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

/** Setări → Aspect → „Grupul afișat”: `null` = automat (după prioritatea grupurilor). */
export const saveDisplayGroup = gcsAction(z.object({ groupId: z.number().int().positive().nullable() }), async (input, { actor }) => {
  await services().groupDisplay.choose(actor, input.groupId);
});

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

/** Dezleagă Discord/Google/Steam, doar dacă rămâne o altă metodă de login. */
export const unlinkAccount = gcsAction(z.object({ providerId: z.enum(["discord", "google", "steam"]) }), async ({ providerId }, { actor }) => {
  if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
  const { db } = services();
  const accounts = await db.account.findMany({ where: { userId: actor.userId }, select: { providerId: true } });
  if (!accounts.some((a) => a.providerId === providerId)) return;
  if (accounts.length < 2) throw new GcsValidationError({ providerId: "last_login_method" });
  await db.account.deleteMany({ where: { userId: actor.userId, providerId } });
  // Fără contul Steam, identitatea de joc Steam legată prin el se dezleagă (puntea serverelor de joc).
  if (providerId === "steam") await services().bridge.players.syncSteam(actor.userId);
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

/**
 * Semnătura de sub postări: editorul compact; serverul validează documentul (validatorul conținutului + profilul
 * semnăturii, limitele site-ului și ale grupului). `null` = ștearsă.
 */
export const saveSignature = gcsAction(z.object({ content: z.unknown().nullable() }), async ({ content }, { actor }) => {
  await services().profiles.saveSignature(actor, content);
});

/** Id-ul sesiunii curente (Better Auth). */
async function currentSessionId(): Promise<string | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.session.id ?? null;
}

/**
 * Preferințele contului v2 (Vizualizarea conținutului, Semnătura, Dispozitivele, Steam / FACEIT, Confidențialitatea):
 * doar câmpurile trimise se schimbă.
 */
export const saveMemberPrefs = gcsAction(
  z
    .object({
      topicOpen: z.enum(["unread", "start", "last"]),
      showSignatures: z.boolean(),
      newDeviceEmail: z.boolean(),
      steamTab: z.boolean(),
      faceitTab: z.boolean(),
      showVisitors: z.boolean(),
      recordVisits: z.boolean(),
    })
    .partial(),
  async (input, { actor }) => {
    const prefs = await services().memberPrefs.set(actor, input);
    // Tabul Steam / FACEIT a devenit vizibil: datele se cer din nou.
    if (actor.userId && (input.steamTab || input.faceitTab)) await services().externalProfiles.requestRefresh(actor.userId, input.steamTab ? "steam" : "faceit").catch(() => {});
    return prefs;
  },
);

/** Autentificarea automată pe un dispozitiv (Setări → Dispozitive); oprită, sesiunile lui (în afară de cea curentă) se închid. */
export const setDeviceAutoLogin = gcsAction(z.object({ id: z.string().min(1).max(40), autoLogin: z.boolean() }), async ({ id, autoLogin }, { actor }) => {
  await services().devices.setAutoLogin(actor, id, autoLogin, await currentSessionId());
});

const DELETE_LIMIT = { window: 15 * 60, max: 5 };

/**
 * „Șterge contul meu” (specul 2026-10-09-stergere-unire-membri §5): parola (sau, fără parolă, o autentificare din ultimele
 * 15 minute) și codul 2FA, dacă e activ; apoi cererea, cu perioada de răzgândire. Încercările sunt limitate.
 */
export const requestAccountDeletion = gcsAction(
  z.object({ password: z.string().max(200), code: z.string().max(20), confirm: z.boolean() }),
  async ({ password, code, confirm }, { actor, ip }) => {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (!confirm) throw new GcsValidationError({ confirm: "required" });
    const { db, rateLimiter, memberRemoval } = services();
    const limit = await rateLimiter.consume(`delete-account:${actor.userId}`, DELETE_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    const [credential, user] = await Promise.all([
      db.account.findFirst({ where: { userId: actor.userId, providerId: "credential" }, select: { password: true } }),
      db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { twoFactorEnabled: true } }),
    ]);
    if (credential?.password) {
      if (!password || !(await verifyPassword(credential.password, password))) throw new GcsValidationError({ password: "invalid_password" });
    } else if (!(await freshSignIn())) {
      throw new GcsConflict({ reason: "reauth_required" });
    }
    if (user.twoFactorEnabled && !(await verifyTwoFactorCode(actor.userId, code))) throw new GcsValidationError({ code: "invalid_code" });
    const removal = await memberRemoval.requestSelf(actor.userId, ip);
    return { runAfter: removal.runAfter?.toISOString() ?? null };
  },
);

/** Membri v2: membrul intră într-un grup public (opt-in) sau iese din el (Setări → Grupuri). */
export const toggleOptInGroup = gcsAction(z.object({ groupId: z.number().int().positive(), join: z.boolean() }), async ({ groupId, join }, { actor }) => {
  const { optInGroups } = services();
  if (join) await optInGroups.join(actor, groupId);
  else await optInGroups.leave(actor, groupId);
});

/** Membrul își anulează cererea de ștergere (în perioada de răzgândire). */
export const cancelAccountDeletion = gcsAction(z.object({}), async (_input, { actor, ip }) => {
  if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
  await services().memberRemoval.cancelSelf(actor.userId, ip);
});
