import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";

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

const base = { kind: "image" as const, imageUrl: "/files/abc123", linkUrl: "https://sponsor.example.com", alt: "Sponsor", html: "", enabled: true, hideGroups: [] as number[], startsAt: null, endsAt: null };

describe("reclamele", () => {
  test("validarea, HTML-ul curățat, grupurile ascunse, programarea, afișările și click-urile", async () => {
    const root = await w.user("RootAds", "root_admin");
    const vip = w.group("vip_gold");
    await expect(w.s.ads.save(root, null, { ...base, name: "x" })).rejects.toMatchObject({ fields: { name: "length" } });
    await expect(w.s.ads.save(root, null, { ...base, name: "Rea", imageUrl: "javascript:alert(1)" })).rejects.toMatchObject({ fields: { imageUrl: "invalid_url" } });

    const banner = await w.s.ads.save(root, null, { ...base, name: "Banner sponsor", hideGroups: [vip] });
    const html = await w.s.ads.save(root, null, { ...base, kind: "html", name: "Bloc HTML", html: `<p>Salut</p><script>alert(1)</script><img src=x onerror="alert(1)">` });
    const stored = await w.s.db.adUnit.findUniqueOrThrow({ where: { id: html.id } });
    expect(stored.html).toContain("<p>Salut</p>");
    expect(stored.html).not.toContain("script");
    expect(stored.html).not.toContain("onerror");

    // Un VIP vede doar blocul HTML; un membru le poate vedea pe amândouă.
    for (let i = 0; i < 5; i++) expect((await w.s.ads.pick([vip], null))?.id).toBe(html.id);
    expect(await w.s.ads.pick([vip], banner.id)).toBeNull();
    expect((await w.s.ads.pick([w.group("member")], banner.id))?.id).toBe(banner.id);

    // Programarea: încheiată → nu se mai arată.
    await w.s.ads.save(root, banner.id, { ...base, name: "Banner sponsor", endsAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 86_400_000) });
    expect(await w.s.ads.pick([w.group("member")], banner.id)).toBeNull();

    expect(await w.s.ads.click(banner.id)).toBe("https://sponsor.example.com");
    expect(await w.s.ads.click(html.id)).toBeNull();
    const list = await w.s.ads.list(root);
    const b = list.find((u) => u.id === banner.id)!;
    expect(b).toMatchObject({ impressions: 1, clicks: 1, live: false });
    expect(list.find((u) => u.id === html.id)!.impressions).toBeGreaterThanOrEqual(5);

    await w.s.ads.resetStats(root, banner.id);
    expect((await w.s.ads.list(root)).find((u) => u.id === banner.id)).toMatchObject({ impressions: 0, clicks: 0 });
    await w.s.ads.remove(root, banner.id);
    await expect(w.s.ads.list(await w.user("FaraDreptAds"))).rejects.toThrow();
  });
});
