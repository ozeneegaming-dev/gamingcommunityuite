import { createECDH, randomBytes } from "node:crypto";
import { GcsPushService, type GcsActor, type GcsEvent, type GcsPushRequest } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { doc } from "../../test/world";
import { GcsNotificationProducers } from "./producers";
import { GcsWeeklyDigestBuilder, weeklyHasContent, weeklyMail } from "./weekly";

let w: GcsProfileWorld;
let tree: Awaited<ReturnType<GcsProfileWorld["createTree"]>>;
let created: GcsEvent[];

beforeEach(async () => {
  w = await createProfileWorld();
  tree = await w.createTree();
  created = [];
  w.bus.on("notification.created", async (e) => {
    created.push(e);
  });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

async function member(name: string, group = "member"): Promise<GcsActor> {
  return w.actorFor(await w.createUser(name, group));
}

const mentionDoc = (user: { id: string; name: string }, text = "uite") => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: user.id, label: user.name } }, { type: "text", text: ` ${text}` }] }],
});

describe("livrarea pe canale (Notificări v2)", () => {
  test("membrul oprește toast-ul: notificarea apare în clopoțel, fără toast; emailul „săptămânal” nu pleacă în digestul zilnic", async () => {
    const a = await member("Ana");
    const b = await member("Bogdan");
    await w.notifications.setPreferences(a.userId!, { "profile.follower": { toast: "off", emailMode: "weekly" } });
    await w.social.follow(b, a.userId!);
    expect(created.at(-1)!.payload).toMatchObject({ userId: a.userId, site: true, toast: false, emailMode: "weekly" });
    expect((await w.notifications.list(a.userId!)).map((n) => n.type)).toEqual(["profile.follower"]);
    w.outbox.length = 0;
    expect(await w.producers.digest()).toBe(0);
    expect(w.outbox).toHaveLength(0);
  });

  test("o mențiune directă e importantă: trece prin canalele „doar important” (aici emailul imediat)", async () => {
    const a = await member("Ana");
    const b = await member("Bogdan");
    await w.notifications.setPreferences(a.userId!, { "forums.mention": { email: "important", emailMode: "instant" } });
    const t = await w.topics.create(w.root, { forumId: tree.forum.id, title: "Server nou", content: doc("x") });
    w.outbox.length = 0;
    await w.posts.reply(b, { topicId: t.topicId, content: mentionDoc({ id: a.userId!, name: "Ana" }) });
    const [n] = await w.notifications.list(a.userId!);
    expect(n).toMatchObject({ type: "forums.mention", important: true });
    const mails = w.outbox.filter((m) => m.to.startsWith("ana"));
    expect(mails).toHaveLength(1);
    // Linkul din email trece prin notificare (citită + deschiderea numărată pe canalul email).
    expect(mails[0]!.html).toContain(`/notifications/${n!.id}?via=email`);
    expect((await w.notifications.stats(1)).channels.find((c) => c.channel === "email")).toMatchObject({ sent: 1 });
  });

  test("„Oprește toate emailurile” (ACP): fără email imediat și fără digest, notificarea rămâne pe site", async () => {
    const a = await member("Ana");
    await w.notifications.setEmailsOff(w.root, a.userId!, true);
    w.outbox.length = 0;
    await w.warnings.warn({ userId: a.userId!, points: 1, reason: "limbaj" }, w.root);
    expect((await w.notifications.list(a.userId!)).map((n) => n.type)).toEqual(["core.warning"]);
    expect(await w.producers.digest()).toBe(0);
    expect(w.outbox).toHaveLength(0);
  });
});

describe("rezumatul săptămânal „Ce ai ratat”", () => {
  test("constructorul: topicurile populare pe care membrul le vede (fără ale lui), mențiunile necitite", async () => {
    const a = await member("Ana");
    const b = await member("Bogdan");
    const hot = await w.topics.create(b, { forumId: tree.forum.id, title: "Mix în seara asta", content: doc("cine vine?") });
    for (const text of ["eu", "și eu"]) {
      await w.clearFlood(w.root);
      await w.posts.reply(w.root, { topicId: hot.topicId, content: doc(text) });
    }
    await w.topics.create(a, { forumId: tree.forum.id, title: "Topicul Anei", content: doc("al meu") });
    // Un forum ascuns pentru membri: topicul lui nu apare.
    const staff = await w.forums.create({ parentId: tree.category.id, type: "FORUM", name: "Staff" }, w.root);
    await w.groupService.setContainerInherit("forum", String(staff.id), { inherits: false, parentId: null }, w.root);
    await w.groupService.setContainerPermissions("forum", String(staff.id), { [w.groups.root_admin!]: ["forums.view", "forums.read", "forums.reply", "forums.create"] }, w.root);
    await w.topics.create(w.root, { forumId: staff.id, title: "Secret", content: doc("x") });
    await w.clearFlood(b);
    await w.posts.reply(b, { topicId: hot.topicId, content: mentionDoc({ id: a.userId!, name: "Ana" }) });

    const digest = await w.producers.weekly.forUser(a.userId!, "ro");
    expect(digest.topics.map((t) => t.title)).toEqual(["Mix în seara asta"]);
    expect(digest.topics[0]!.replies).toBe(3);
    expect(digest.mentions.count).toBe(1);
    expect(digest.mentions.items[0]!.text).toContain("Bogdan te-a menționat");
    expect(digest.servers).toEqual([]);
    expect(weeklyHasContent(digest)).toBe(true);

    const mail = weeklyMail({ to: "ana@x.ro", name: "Ana", site: "Comunitatea", siteUrl: "https://forum.test", locale: "ro", digest, items: [] });
    expect(mail.subject).toBe("Ce ai ratat săptămâna aceasta — Comunitatea");
    expect(mail.html).toContain("Mix în seara asta");
    expect(mail.html).toContain("O mențiune necitită");
    expect(mail.html).toContain("https://forum.test/settings/notifications");
  });

  test("momentele serverelor: vârful de jucători din săptămână și meciurile terminate (doar cu aplicația activă)", async () => {
    const server = await w.db.gameServer.create({ data: { game: "cs16", host: "1.2.3.4", port: 27015, name: "Arena Mix", slug: "arena-mix" } });
    const quiet = await w.db.gameServer.create({ data: { game: "cs16", host: "1.2.3.5", port: 27015, name: "Gol", slug: "gol" } });
    const now = new Date();
    await w.db.serverSnapshot.createMany({
      data: [
        { serverId: server.id, at: new Date(now.getTime() - 86_400_000), online: true, players: 18, peak: 24, maxPlayers: 32 },
        { serverId: server.id, at: new Date(now.getTime() - 20 * 86_400_000), online: true, players: 32, peak: 32, maxPlayers: 32 },
        { serverId: quiet.id, at: new Date(now.getTime() - 86_400_000), online: true, players: 0, peak: 0, maxPlayers: 32 },
      ],
    });
    await w.db.gameMatch.create({ data: { serverId: server.id, externalId: "m1", status: "ENDED", endedAt: new Date(now.getTime() - 3600_000) } });
    const on = new GcsWeeklyDigestBuilder({ db: w.db, notifications: w.notifications, serversEnabled: async () => true });
    expect(await on.serverHighlights(new Date(now.getTime() - 7 * 86_400_000))).toEqual([{ id: server.id, name: "Arena Mix", href: `/servers/${server.id}-arena-mix`, peak: 24, maxPlayers: 32, matches: 1 }]);
    const off = new GcsWeeklyDigestBuilder({ db: w.db, notifications: w.notifications, serversEnabled: async () => false });
    expect(await off.serverHighlights(new Date(now.getTime() - 7 * 86_400_000))).toEqual([]);
  });

  test("rularea: emailul cu rezumatul și notificările „săptămânale”, rândul din clopoțel; opțiunea oprită → doar notificările", async () => {
    const a = await member("Ana");
    const b = await member("Bogdan");
    await w.db.user.update({ where: { id: a.userId! }, data: { lastActiveAt: new Date() } });
    await w.notifications.setPreferences(a.userId!, { "profile.follower": { emailMode: "weekly" } });
    await w.social.follow(b, a.userId!);
    await w.topics.create(b, { forumId: tree.forum.id, title: "Turneu", content: doc("înscrieri") });
    w.outbox.length = 0;
    const toAna = () => w.outbox.filter((m) => m.to.startsWith("ana"));

    expect(await w.producers.weeklyRun()).toBeGreaterThanOrEqual(1);
    expect(toAna()).toHaveLength(1);
    const mail = toAna()[0]!;
    expect(mail.subject).toContain("Ce ai ratat");
    expect(mail.html).toContain("Turneu");
    expect(mail.html).toContain("Bogdan te urmărește");
    const bell = await w.notifications.list(a.userId!, { types: ["core.weekly_digest"] });
    expect(bell).toHaveLength(1);
    expect(bell[0]!.data).toMatchObject({ href: "/notifications/weekly", topics: 1 });
    // Autorul topicului nu are ce rata (topicul lui nu intră în rezumatul lui).
    expect(w.outbox.some((m) => m.to.startsWith("bogdan"))).toBe(false);

    // Rezumatul oprit și notificările „săptămânale” deja trimise: nimic.
    w.outbox.length = 0;
    await w.notifications.setPreferences(a.userId!, { "core.weekly_digest": { email: "off" } });
    await w.producers.weeklyRun();
    expect(toAna()).toHaveLength(0);

    // Rezumatul oprit, dar o notificare „săptămânală” nouă: pleacă digestul simplu.
    // (Grupul deja trimis pe email nu se retrimite: Ana îl citește, iar urmăritorul nou începe un grup nou.)
    await w.notifications.markRead(a.userId!, "all");
    const c = await member("Cezar");
    await w.social.follow(c, a.userId!);
    await w.producers.weeklyRun();
    expect(toAna()).toHaveLength(1);
    expect(toAna()[0]!.subject).toContain("O notificare nouă");
  });

  test("weeklyIfDue: o dată, în ziua și după ora setate (implicit luni, 10:00, în fusul site-ului)", async () => {
    // 2026-10-19 e luni; 07:30 UTC = 10:30 în București (ora de vară).
    expect(await w.producers.weeklyIfDue(new Date("2026-10-18T08:00:00Z"))).toBe(false);
    expect(await w.producers.weeklyIfDue(new Date("2026-10-19T06:00:00Z"))).toBe(false);
    expect(await w.producers.weeklyIfDue(new Date("2026-10-19T07:30:00Z"))).toBe(true);
    expect(await w.producers.weeklyIfDue(new Date("2026-10-19T09:00:00Z"))).toBe(false);
  });
});

describe("web push", () => {
  function device() {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    return { endpoint: `https://fcm.example.com/send/${randomBytes(6).toString("hex")}`, p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
  }

  test("un mesaj privat (important) pleacă pe dispozitivele membrului, cu textul în limba lui și linkul prin notificare", async () => {
    const sent: GcsPushRequest[] = [];
    const push = new GcsPushService({
      db: w.db,
      sender: async (req) => {
        sent.push(req);
        return { status: 201 };
      },
    });
    await push.ensureKeys();
    // Un al doilea set de producători, doar pentru trimitere (ascultătorii rămân ai lumii de test).
    const delivery = new GcsNotificationProducers({
      db: w.db,
      kv: w.kv,
      notifications: w.notifications,
      actors: w.actors,
      posting: w.posting,
      forumQueries: w.queries,
      conversations: w.conversations,
      settings: w.settings,
      mailer: w.mailer,
      realtime: w.realtime,
      jobs: null,
      baseUrl: async () => "https://forum.test",
      push,
    });
    const a = await member("Ana");
    const b = await member("Bogdan");
    await w.db.user.update({ where: { id: a.userId! }, data: { locale: "en" } });
    await push.subscribe(a.userId!, device());
    await w.conversations.start(b, { to: [a.userId!], title: "Salut", content: doc("hey") });
    const [n] = await w.notifications.list(a.userId!);
    expect(created.find((e) => e.payload.notificationId === n!.id)!.payload).toMatchObject({ push: true });
    expect(await delivery.sendPush(n!.id)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.urgency).toBe("high");
    expect((await w.notifications.stats(1)).channels.find((c) => c.channel === "push")).toMatchObject({ sent: 1 });

    // Fără canalul push (ex. o reacție obișnuită, „doar important”), nimic.
    await w.social.follow(b, a.userId!);
    const follower = (await w.notifications.list(a.userId!)).find((x) => x.type === "profile.follower")!;
    expect(await delivery.sendPush(follower.id)).toBe(0);
    expect(sent).toHaveLength(1);
  });
});
