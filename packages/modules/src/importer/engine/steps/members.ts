import { legacyPasswordHash, normalizeEmail, normalizeUsername, type GcsActor } from "@gcs/core";
import type { Prisma } from "@gcs/db";
import { readFirst } from "../../source/files";
import type { GcsSourceRole, SrcMember } from "../../types";
import type { GcsStepContext } from "../context";

type Tx = Prisma.TransactionClient;

/** Grupul GCS pentru fiecare rol al sursei; `other` → grup nou. */
const ROLE_GROUP: Record<Exclude<GcsSourceRole, "other">, string> = {
  admin: "admin",
  moderator: "super_moderator",
  member: "member",
  guest: "guest",
  banned: "banned",
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BIRTHDAY_FIELD = "__birthday";

/** Pasul 1: grupurile, după rol; restul devin grupuri noi (cu drepturile grupului „Membru”). */
export async function importGroups(s: GcsStepContext): Promise<void> {
  const { db, groups } = s.deps;
  const source = await s.adapter.groups();
  s.state.total = source.length;
  const mapped = await s.map.all("group");
  const byKey = new Map((await db.group.findMany({ select: { id: true, key: true } })).map((g) => [g.key, g.id]));
  for (const g of source) {
    s.state.done++;
    if (mapped.has(g.id)) {
      s.state.skipped++;
      continue;
    }
    try {
      let targetId: number;
      if (g.role !== "other") targetId = byKey.get(ROLE_GROUP[g.role])!;
      else {
        const created = await groups.create({ name: g.name, color: g.color, nameStyle: g.color ? { color: g.color } : null }, s.actor);
        targetId = created.id;
      }
      await s.map.set(db, "group", g.id, targetId);
      s.state.imported++;
    } catch (error) {
      s.state.errors++;
      await s.log("error", `grup: ${(error as Error).message}`, g.id);
    }
  }
}

/** Un nume liber, cât mai aproape de cel vechi (cel vechi rămâne dacă e liber; altfel `nume_2`, `nume_3`…). */
async function freeName(tx: Tx, wanted: string, fallback: string): Promise<string> {
  const base = wanted.replace(/\s+/g, " ").trim().slice(0, 36) || fallback;
  for (let i = 1; i < 200; i++) {
    const candidate = i === 1 ? base : `${base}_${i}`;
    if (!(await tx.user.findUnique({ where: { nameNormalized: normalizeUsername(candidate) }, select: { id: true } }))) return candidate;
  }
  return `${base}_${Date.now().toString(36)}`;
}

/** Câmpul „Zi de naștere” (creat la primul membru care o arată public). */
async function birthdayField(s: GcsStepContext): Promise<number> {
  const existing = await s.map.one("profile_field", BIRTHDAY_FIELD);
  if (existing) return Number(existing);
  const { db } = s.deps;
  const last = await db.profileField.aggregate({ _max: { position: true } });
  const field = await db.$transaction(async (tx) => {
    const row = await tx.profileField.upsert({
      where: { key: "imported_birthday" },
      create: { key: "imported_birthday", label: "Zi de naștere", type: "TEXT", maxLength: 20, position: (last._max.position ?? 0) + 1, icon: "fa-solid fa-cake-candles" },
      update: {},
    });
    await s.map.set(tx, "profile_field", BIRTHDAY_FIELD, row.id);
    return row;
  });
  return field.id;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Pasul 2: membrii. Un email existent în GCS → contul se leagă (nu se modifică). Altfel: cont nou cu grupurile
 * potrivite, data înscrierii, IP-ul, reputația, titlul, semnătura convertită, parola veche marcată și banul.
 * Avatarul și cover-ul se copiază după commit (fișierele nu țin tranzacția deschisă).
 */
export async function importMembers(s: GcsStepContext): Promise<void> {
  const { db, attachments } = s.deps;
  const groupMap = await s.map.all("group");
  const memberGroup = (await db.group.findUniqueOrThrow({ where: { key: "member" }, select: { id: true } })).id;
  const lookups = s.newLookups();
  let birthdayFieldId: number | null = null;

  await s.batches(
    (c, l) => s.adapter.members(c, l),
    300,
    async (rows) => {
      // Și membrii cu contul șters între timp: legătura rămâne, deci nu se recreează.
      const existing = await s.map.get("member", rows.map((r) => r.id), { includeDeleted: true });
      if (rows.some((r) => r.birthday && !existing.has(r.id))) birthdayFieldId ??= await birthdayField(s);
      await lookups.load(s.collectRefs(lookups, rows.map((r) => r.signature)));
      const created: { member: SrcMember; userId: string }[] = [];
      let pending: typeof created = [];
      await s.rows(
        rows,
        (r) => r.id,
        async (tx, m) => {
          if (existing.has(m.id)) return "skipped";
          const raw = normalizeEmail(m.email);
          const email = EMAIL.test(raw) && raw.length <= 200 ? raw : `member-${m.id}@import.invalid`;
          const linked = await tx.user.findUnique({ where: { email }, select: { id: true } });
          if (linked) {
            await s.map.set(tx, "member", m.id, linked.id);
            await s.log("info", `legat de contul existent cu același email`, m.id);
            return "imported";
          }
          const name = await freeName(tx, m.name, `membru${m.id}`);
          const primaryGroupId = Number(groupMap.get(m.primaryGroupId) ?? memberGroup);
          const signature = m.signature.trim() ? s.convert(lookups, m.signature) : null;
          if (signature?.unrecognized) s.state.unrecognized++;
          const user = await tx.user.create({
            data: {
              name,
              nameNormalized: normalizeUsername(name),
              email,
              emailVerified: m.emailConfirmed,
              primaryGroupId,
              createdAt: m.joinedAt,
              lastActiveAt: m.lastVisitAt,
              registrationIp: m.registrationIp,
              reputation: m.reputation,
              customTitle: m.title ? m.title.slice(0, 50) : null,
              ...(signature ? { signatureJson: signature.rendered.json as Prisma.InputJsonValue, signatureHtml: signature.rendered.html } : {}),
            },
            select: { id: true },
          });
          const secondary = [...new Set(m.secondaryGroupIds.map((g) => Number(groupMap.get(g))).filter((g) => Number.isInteger(g) && g !== primaryGroupId))];
          if (secondary.length > 0) await tx.userGroup.createMany({ data: secondary.map((groupId) => ({ userId: user.id, groupId, source: "import" })), skipDuplicates: true });
          if (m.password) {
            let stored: string | null = null;
            try {
              stored = legacyPasswordHash(m.password);
            } catch {
              await s.log("warn", "parola veche are un format necunoscut; contul nu primește parolă", m.id);
            }
            if (stored) await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: stored } });
          }
          if (m.ban) {
            await tx.ban.create({ data: { type: "ACCOUNT", value: user.id, userId: user.id, reason: (m.ban.reason || "Ban importat").slice(0, 500), expiresAt: m.ban.expiresAt } });
          }
          if (m.birthday && birthdayFieldId !== null) {
            const { day, month, year } = m.birthday;
            await tx.profileFieldValue.create({ data: { userId: user.id, fieldId: birthdayFieldId, value: year ? `${pad(day)}.${pad(month)}.${year}` : `${pad(day)}.${pad(month)}` } });
          }
          await s.map.set(tx, "member", m.id, user.id);
          pending.push({ member: m, userId: user.id });
          return "imported";
        },
        {
          onCommit: () => {
            created.push(...pending);
            pending = [];
          },
          onRollback: () => {
            pending = [];
          },
        },
      );
      if (!s.files) return;
      for (const { member, userId } of created) {
        const actor: GcsActor = { userId, groupIds: [], primaryGroupId: 0, isBanned: false, ip: "" };
        for (const kind of ["avatar", "cover"] as const) {
          const paths = kind === "avatar" ? member.avatarPaths : member.coverPaths;
          if (paths.length === 0) continue;
          try {
            const file = await readFirst(s.files, paths);
            if (!file) {
              await s.log("warn", `${kind === "avatar" ? "avatarul" : "cover-ul"} lipsește din fișierele vechi`, member.id);
              continue;
            }
            const att = await attachments.uploadProfileImage(actor, { name: file.path.split("/").pop() ?? kind, bytes: file.bytes }, { kind, maxMb: 20, animated: true }, { skipRateLimit: true });
            await db.user.update({ where: { id: userId }, data: kind === "avatar" ? { image: att.url } : { coverAttachmentId: att.id } });
          } catch (error) {
            await s.log("warn", `${kind}: ${(error as Error).message.slice(0, 200)}`, member.id);
          }
        }
      }
    },
  );
}

/** Pasul 3: câmpurile de profil (definițiile, apoi valorile; cele existente nu se suprascriu). */
export async function importProfileFields(s: GcsStepContext): Promise<void> {
  const { db } = s.deps;
  const fields = await s.adapter.profileFields();
  const mapped = await s.map.all("profile_field");
  const last = await db.profileField.aggregate({ _max: { position: true } });
  let position = (last._max.position ?? 0) + 1;
  for (const f of fields) {
    if (mapped.has(f.id)) continue;
    try {
      const keyBase = `imported_${f.id.toLowerCase().replace(/[^a-z0-9_]+/g, "_")}`.slice(0, 50);
      await db.$transaction(async (tx) => {
        let key = keyBase;
        for (let i = 2; await tx.profileField.findUnique({ where: { key }, select: { id: true } }); i++) key = `${keyBase}_${i}`;
        const row = await tx.profileField.create({
          data: { key, label: f.name, type: f.type, options: f.type === "SELECT" ? f.options : [], visibility: f.visibility, maxLength: f.maxLength, position: position++ },
        });
        await s.map.set(tx, "profile_field", f.id, row.id);
      });
    } catch (error) {
      s.state.errors++;
      await s.log("error", `câmp: ${(error as Error).message}`, f.id);
    }
  }
  const fieldMap = await s.map.all("profile_field");
  const defs = new Map((await db.profileField.findMany({ select: { id: true, maxLength: true, type: true } })).map((f) => [f.id, f]));
  /** Aceleași reguli ca la editarea profilului: un câmp URL primește doar adrese http(s), unul numeric doar numere. */
  const valid = (type: string, value: string) => {
    if (type === "URL") return URL.canParse(value) && ["http:", "https:"].includes(new URL(value).protocol);
    if (type === "NUMBER") return /^-?\d+(\.\d+)?$/.test(value);
    return true;
  };
  await s.batches(
    (c, l) => s.adapter.profileValues(c, l),
    1000,
    async (rows) => {
      const members = await s.map.get("member", rows.map((r) => r.memberId));
      const data: Prisma.ProfileFieldValueCreateManyInput[] = [];
      for (const r of rows) {
        const userId = members.get(r.memberId);
        const fieldId = Number(fieldMap.get(r.fieldId));
        const def = defs.get(fieldId);
        if (!userId || !def || !valid(def.type, r.value)) {
          s.state.skipped++;
          continue;
        }
        data.push({ userId, fieldId, value: r.value.slice(0, def.maxLength) });
      }
      const res = await db.profileFieldValue.createMany({ data, skipDuplicates: true });
      s.state.imported += res.count;
      s.state.skipped += data.length - res.count;
    },
  );
}
