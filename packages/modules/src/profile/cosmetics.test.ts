import { GcsForbidden, GcsValidationError, type GcsActor } from "@gcs/core";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { compileFramesCss } from "./cosmetics";

let w: GcsProfileWorld;
let admin: GcsActor;

beforeEach(async () => {
  w = await createProfileWorld();
  await w.grantAdmin(["vip.name_styles", "vip.frames"]);
  admin = await w.actorFor(await w.createUser("Admin", "admin"));
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

const frame = (key: string) => w.db.avatarFrame.findUniqueOrThrow({ where: { key } });
const keys = (items: { key: string }[]) => items.map((i) => i.key);
const user = (actor: GcsActor) => w.db.user.findUniqueOrThrow({ where: { id: actor.userId! } });

describe("compileFramesCss (Review Focus #5)", () => {
  test("valorile invalide nu ajung în CSS; animația se oprește sub prefers-reduced-motion", () => {
    const css = compileFramesCss([
      { key: "ok", kind: "CSS", imageAttachmentId: null, style: { colors: ["#FF0000", "#00FF00"], width: 4, glow: "#00FF00" } },
      { key: "bad key", kind: "CSS", imageAttachmentId: null, style: { colors: ["#FF0000", "#00FF00"] } },
      { key: "evil", kind: "CSS", imageAttachmentId: null, style: { colors: ["red;}body{display:none", "url(javascript:x)", "#00FF00"], width: 99, glow: "expression(1)" } },
      { key: "img", kind: "IMAGE", imageAttachmentId: "x) ;}*{color:red", style: null },
    ]);
    expect(css).toContain(".gcs-avatarFrame--ok{padding:4px}");
    expect(css).toContain("conic-gradient(#FF0000,#00FF00,#FF0000)");
    expect(css).toContain("drop-shadow(0 0 6px rgba(0,255,0,.6))");
    expect(css).not.toMatch(/bad key|body\{|javascript|expression|color:red/);
    // „evil” rămâne cu o singură culoare validă: nicio regulă de fundal.
    expect(css).not.toContain(".gcs-avatarFrame--evil::before");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  test("CSS-ul complet include stilurile grupurilor, stilurile alese și ramele implicite", async () => {
    const css = await w.cosmetics.css();
    expect(css).toContain(":is(.gcs-root,#gcs-names) .gcs-name--vip_gold{");
    expect(css).toContain(":is(.gcs-root,#gcs-names) .gcs-name--ns_neon{");
    expect(css).toContain(".gcs-avatarFrame--neon::before{");
  });
});

describe("disponibilitate și alegere", () => {
  test("VIP Bronze vede doar Fire; VIP Legend vede toate; un membru nu vede nimic", async () => {
    const bronze = await w.actorFor(await w.createUser("Bronze", "vip_bronze"));
    const legend = await w.actorFor(await w.createUser("Legend", "vip_legend"));
    expect(keys((await w.cosmetics.available(bronze.userId!)).frames)).toEqual(["fire"]);
    expect(keys((await w.cosmetics.available(legend.userId!)).frames)).toEqual(["fire", "gold", "neon"]);
    expect(keys((await w.cosmetics.available(legend.userId!)).styles)).toEqual(["ns_fire", "ns_ice", "ns_neon"]);
    expect(await w.cosmetics.available(w.member.userId!)).toEqual({ styles: [], frames: [] });
  });

  test("VIP Gold nu poate alege Neon (GcsForbidden), dar poate alege Gold", async () => {
    const gold = await w.actorFor(await w.createUser("Shadow", "vip_gold"));
    await expect(w.cosmetics.choose(gold, { avatarFrameId: (await frame("neon")).id })).rejects.toBeInstanceOf(GcsForbidden);
    await w.cosmetics.choose(gold, { avatarFrameId: (await frame("gold")).id });
    expect((await user(gold)).avatarFrameId).toBe((await frame("gold")).id);
  });

  test("o ramă disponibilă printr-un badge", async () => {
    const champion = await w.db.badge.findUniqueOrThrow({ where: { key: "tournament_champion" } });
    await w.db.avatarFrame.update({ where: { key: "neon" }, data: { badgeIds: [champion.id] } });
    const vip = await w.actorFor(await w.createUser("Bronze", "vip_bronze"));
    expect(keys((await w.cosmetics.available(vip.userId!)).frames)).toEqual(["fire"]);
    await w.db.userBadge.create({ data: { userId: vip.userId!, badgeId: champion.id } });
    expect(keys((await w.cosmetics.available(vip.userId!)).frames)).toEqual(["fire", "neon"]);
  });
});

describe("reconcile", () => {
  test("după ce userul pierde grupul VIP, rama și stilul sunt scoase (prin evenimentul user.groups_changed)", async () => {
    const legend = await w.actorFor(await w.createUser("Krypt", "member", ["vip_legend"]));
    const style = await w.db.nameStyle.findUniqueOrThrow({ where: { key: "ns_neon" } });
    await w.cosmetics.choose(legend, { avatarFrameId: (await frame("neon")).id, nameStyleId: style.id });

    await w.db.userGroup.deleteMany({ where: { userId: legend.userId! } });
    await w.membership.notify(legend.userId!, [w.groups.vip_legend!]);
    expect(await user(legend)).toMatchObject({ avatarFrameId: null, nameStyleId: null });
  });

  test("cover-ul animat devine static când membrul pierde `profile.animated_cover`", async () => {
    const frameImg = (color: string) => sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer();
    const gif = await sharp([await frameImg("#FF0000"), await frameImg("#00FF00")], { join: { animated: true } }).gif().toBuffer();
    const vip = await w.actorFor(await w.createUser("Shadow", "member", ["vip_gold"]));
    await w.profiles.setCover(vip, { name: "c.gif", bytes: gif });
    const animatedId = (await user(vip)).coverAttachmentId;

    await w.db.userGroup.deleteMany({ where: { userId: vip.userId! } });
    expect(await w.cosmetics.reconcile(vip.userId!)).toEqual({ style: false, frame: false, cover: true });
    const u = await user(vip);
    expect(u.coverAttachmentId).not.toBe(animatedId);
    expect(await w.db.attachment.findUnique({ where: { id: animatedId! } })).toBeNull();
  });
});

describe("ACP", () => {
  test("stilurile cer cheia `ns_*` și culori valide; editarea schimbă CSS-ul și versiunea", async () => {
    await expect(w.cosmetics.saveNameStyle(admin, null, { key: "admin", name: "x", style: { color: "#FF0000" }, allGroups: true, groupIds: [], badgeIds: [] })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.cosmetics.saveNameStyle(admin, null, { key: "ns_bad", name: "x", style: { color: "red" }, allGroups: true, groupIds: [], badgeIds: [] })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.cosmetics.saveNameStyle(w.member, null, { key: "ns_x", name: "x", style: { color: "#FF0000" }, allGroups: true, groupIds: [], badgeIds: [] })).rejects.toBeInstanceOf(GcsForbidden);

    const before = await w.cosmetics.version();
    await w.cosmetics.css();
    const fire = await w.db.nameStyle.findUniqueOrThrow({ where: { key: "ns_fire" } });
    await w.cosmetics.saveNameStyle(admin, fire.id, { key: "ns_fire", name: "Fire", style: { gradient: ["#111111", "#222222"], animated: true, bold: true }, allGroups: false, groupIds: fire.groupIds, badgeIds: [] });
    expect(await w.cosmetics.version()).toBeGreaterThan(before);
    expect(await w.cosmetics.css()).toContain("#111111,#222222,#111111");
  });

  test("ștergerea unei rame resetează userii care o foloseau", async () => {
    const gold = await w.actorFor(await w.createUser("Shadow", "vip_gold"));
    const goldFrame = await frame("gold");
    await w.cosmetics.choose(gold, { avatarFrameId: goldFrame.id });
    await w.cosmetics.deleteFrame(admin, goldFrame.id);
    expect((await user(gold)).avatarFrameId).toBeNull();
    expect(await w.cosmetics.css()).not.toContain("gcs-avatarFrame--gold");
  });

  test("restrângerea disponibilității unei rame o scoate celor care nu mai au voie", async () => {
    const bronze = await w.actorFor(await w.createUser("Bronze", "vip_bronze"));
    const fire = await frame("fire");
    await w.cosmetics.choose(bronze, { avatarFrameId: fire.id });
    await w.cosmetics.saveFrame(admin, fire.id, { key: "fire", name: "Fire", kind: "CSS", style: { colors: ["#FF3B3B", "#FFE066"] }, imageAttachmentId: null, allGroups: false, groupIds: [w.groups.vip_gold!], badgeIds: [] });
    expect((await user(bronze)).avatarFrameId).toBeNull();
  });
});
