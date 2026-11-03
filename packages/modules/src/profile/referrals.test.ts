import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";
import { DEFAULT_REFERRAL, REFERRAL_NOTIFICATION, REFERRAL_SETTING, referrerFromCookie, type GcsReferralConfig } from "./referrals";

let w: GcsRemovalWorld;

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
});

const setConfig = (patch: Partial<GcsReferralConfig>) => w.s.settings.set(REFERRAL_SETTING, { ...DEFAULT_REFERRAL, ...patch }, w.system());
const points = async (id: string) => (await w.s.db.user.findUniqueOrThrow({ where: { id }, select: { points: true } })).points;

describe("recomandările", () => {
  test("cookie-ul: doar un id valid", () => {
    expect(referrerFromCookie("a=1; gcs_ref=clx9abcdefgh12; b=2")).toBe("clx9abcdefgh12");
    expect(referrerFromCookie("gcs_ref=<script>")).toBeNull();
    expect(referrerFromCookie(null)).toBeNull();
  });

  test("legarea la înregistrare: o singură dată, nu de sine, nu de pe IP-ul celui care invită, nu cu programul oprit", async () => {
    const ana = await w.user("Ana");
    await w.s.db.user.update({ where: { id: ana.userId! }, data: { registrationIp: "203.0.113.9" } });
    const bob = await w.user("Bob");
    const dan = await w.user("Dan");
    expect(await w.s.referrals.claim(bob.userId!, ana.userId!, "198.51.100.4")).toBe(true);
    expect(await w.s.referrals.claim(bob.userId!, ana.userId!, "198.51.100.4")).toBe(false);
    expect(await w.s.referrals.claim(ana.userId!, ana.userId!, null)).toBe(false);
    expect(await w.s.referrals.claim(dan.userId!, ana.userId!, "203.0.113.9")).toBe(false);
    expect(await w.s.referrals.claim(dan.userId!, "nu-exista-deloc", null)).toBe(false);
    await setConfig({ enabled: false });
    expect(await w.s.referrals.claim(dan.userId!, ana.userId!, "198.51.100.5")).toBe(false);
    expect(await w.s.db.referral.count()).toBe(1);
  });

  test("calificarea: după postări și email confirmat; punctele, notificarea și limita pe membru", async () => {
    await setConfig({ qualifyPosts: 2, requireVerified: true, rewardPoints: 25, maxPerMember: 1 });
    const ana = await w.user("AnaQ");
    const bob = await w.user("BobQ");
    const cip = await w.user("CipQ");
    await w.s.referrals.claim(bob.userId!, ana.userId!, null);
    await w.s.referrals.claim(cip.userId!, ana.userId!, null);

    await w.s.db.user.update({ where: { id: bob.userId! }, data: { postsCount: 2 } });
    expect(await w.s.referrals.qualifyDue()).toBe(0); // emailul nu e confirmat
    await w.s.db.user.updateMany({ where: { id: { in: [bob.userId!, cip.userId!] } }, data: { emailVerified: true, postsCount: 3 } });
    expect(await w.s.referrals.qualifyDue()).toBe(1); // limita: o singură recompensă
    expect(await points(ana.userId!)).toBe(25);
    expect(await w.s.db.notification.count({ where: { userId: ana.userId!, type: REFERRAL_NOTIFICATION } })).toBe(1);
    expect(await w.s.referrals.qualifyDue()).toBe(0);

    const mine = await w.s.referrals.mine(ana.userId!);
    expect(mine).toMatchObject({ total: 2, qualified: 1 });
    expect(mine.recent.map((r) => r.referred?.name).sort()).toEqual(["BobQ", "CipQ"]);
  });

  test("ACP: totalurile, topul și ștergerea; un membru fără drept e refuzat", async () => {
    const root = await w.user("RootRef", "root_admin");
    const ana = await w.user("AnaTop");
    for (const n of ["T1", "T2"]) await w.s.referrals.claim((await w.user(n)).userId!, ana.userId!, null);
    const o = await w.s.referrals.overview(root);
    expect(o).toMatchObject({ total: 2, qualified: 0, last30: 2 });
    expect(o.top[0]).toMatchObject({ user: { name: "AnaTop" }, count: 2, qualified: 0 });
    expect(o.list.items).toHaveLength(2);
    await expect(w.s.referrals.overview(ana)).rejects.toThrow();
    await w.s.referrals.remove(root, o.list.items[0]!.id);
    expect(await w.s.db.referral.count()).toBe(1);
  });
});
