import { describe, expect, test } from "vitest";
import { catalogOf, changedGroups, checkLoadout, readLoadoutForm, toAppearance, type Loadout } from "../src/loadout";
import { parseItemData, type Access, type Item, type Kind } from "../src/model";
import { defaultPresets } from "../src/presets";

/** Catalogul implicit, ca rânduri (id-uri, planuri și stări controlate de test). */
function catalog(over: Partial<Record<string, Partial<Item>>> = {}) {
  const items: Item[] = defaultPresets().map((p, i) => {
    const parsed = parseItemData(p.kind, p.data);
    if (!parsed.ok) throw new Error(p.key);
    return { id: i + 1, kind: p.kind, key: p.key, name: p.name, categoryId: null, data: parsed.data, plans: [], enabled: true, retired: false, position: i, mediaIds: [], createdAt: new Date().toISOString(), ...over[`${p.kind}/${p.key}`] } as Item;
  });
  return catalogOf(items);
}

const gold: Access = { vip: true, plan: "vip_gold", planName: "VIP Gold", testAll: false };
const none: Access = { vip: false, plan: null, planName: null, testAll: false };
const staff: Access = { vip: false, plan: null, planName: null, testAll: true };
const opts = { allowCustomSong: { youtube: true, upload: false } };

describe("echipamentul din formular", () => {
  test("câmpurile se citesc; varianta contează doar pentru stilul ales", () => {
    const { loadout } = readLoadoutForm(
      {
        nameStyle: "neon",
        nameVariant: ["duo:red", "neon:cyan"],
        frame: "ember",
        banner: "gold_shine",
        bannerLabel: "  Legenda  ",
        card: "nebula",
        cardX: "20",
        cardY: "999",
        weapon: "rifle",
        quote: "Joc\r\npentru echipă",
        theme: "carbon",
        song: "",
        gcsp_mode: "mini",
      },
      {},
    );
    expect(loadout).toEqual({ nameStyle: "neon", nameVariant: "cyan", frame: "ember", banner: "gold_shine", bannerLabel: "Legenda", card: "nebula", cardX: 20, cardY: 100, weapon: "rifle", quote: "Joc pentru echipă", theme: "carbon", songAutoplay: false });
  });

  test("cheile nesigure și textele prea lungi se ignoră", () => {
    const { loadout } = readLoadoutForm({ nameStyle: "neon'><script>", frame: "../x", quote: "x".repeat(201), bannerLabel: "y".repeat(30) }, {});
    expect(loadout).toEqual({ songAutoplay: false });
  });

  test("melodia proprie: link YouTube validat, fișierul verificat de GCS", () => {
    expect(readLoadoutForm({ song: "custom", songTitle: "Tema mea", songYoutube: "https://youtu.be/dQw4w9WgXcQ" }, {}).loadout.customSong).toEqual({ title: "Tema mea", youtube: "dQw4w9WgXcQ" });
    expect(readLoadoutForm({ song: "custom", songYoutube: "https://evil.example/x" }, {}).uploadError).toBe("youtube_invalid");
    expect(readLoadoutForm({ song: "custom", songFile: { error: "too_large" } }, {}).uploadError).toBe("too_large");
    const file = { id: "ck2l0a1b2c3d4e5f", kind: "audio", url: "/plugins/gcs.vip_studio/media/ck2l0a1b2c3d4e5f.mp3" };
    expect(readLoadoutForm({ song: "custom", songFile: file }, {}).loadout.customSong).toEqual({ title: "", audio: file.url, audioId: file.id });
    expect(readLoadoutForm({ song: "custom", songFile: { ...file, kind: "image", url: "/plugins/gcs.vip_studio/media/ck2l0a1b2c3d4e5f.webp" } }, {}).uploadError).toBe("unsupported_type");
  });
});

describe("planurile și disponibilitatea", () => {
  test("un VIP cu planul potrivit poate salva tot; un ne-VIP nimic", () => {
    const l: Loadout = { nameStyle: "neon", frame: "ember", banner: "gold", quote: "Salut" };
    expect(checkLoadout(l, catalog(), gold, opts).problems).toEqual([]);
    const blocked = checkLoadout(l, catalog(), none, opts).problems;
    expect(blocked.map((p) => [p.group, p.code])).toEqual([
      ["name", "locked"],
      ["frame", "locked"],
      ["banner", "locked"],
      ["quote", "locked"],
    ]);
    expect(checkLoadout(l, catalog(), staff, opts).problems).toEqual([]);
  });

  test("un element rezervat altui plan e blocat, cu planurile lui", () => {
    const c = catalog({ "frame/crown": { plans: ["vip_legend"] } });
    expect(checkLoadout({ frame: "crown" }, c, gold, opts).problems).toEqual([{ group: "frame", code: "locked", plans: ["vip_legend"] }]);
    expect(checkLoadout({ frame: "crown" }, c, { ...gold, plan: "vip_legend" }, opts).problems).toEqual([]);
  });

  test("elementele retrase, dezactivate sau șterse cad din echipament", () => {
    const c = catalog({ "frame/ember": { retired: true }, "banner/gold": { enabled: false } });
    const { loadout, problems } = checkLoadout({ frame: "ember", banner: "gold", weapon: "nope" }, c, gold, opts);
    expect(loadout).toEqual({});
    expect(problems.map((p) => p.code)).toEqual(["unavailable", "unavailable", "unavailable"]);
  });

  test("melodia proprie cere un link sau un fișier permis de setări", () => {
    expect(checkLoadout({ song: "custom", customSong: { title: "x", audio: "/plugins/gcs.vip_studio/media/ck2l0a1b2c3d4e5f.mp3", audioId: "ck2l0a1b2c3d4e5f" } }, catalog(), gold, opts).problems).toEqual([{ group: "song", code: "invalid" }]);
    expect(checkLoadout({ song: "custom", customSong: { title: "x", youtube: "dQw4w9WgXcQ" } }, catalog(), gold, opts).problems).toEqual([]);
  });

  test("numărătoarea modificărilor: câte un grup", () => {
    expect(changedGroups({}, {})).toEqual([]);
    expect(changedGroups({ nameStyle: "neon", nameVariant: "red" }, { nameStyle: "neon", nameVariant: "cyan", quote: "x", cardX: 10 })).toEqual(["name", "card", "quote"]);
  });
});

describe("aspectul publicat", () => {
  test("VIP: numele, rama, banner-ul cu planul, cardul, arma și profilul", () => {
    const a = toAppearance(
      { nameStyle: "neon", nameVariant: "cyan", frame: "ember", banner: "gold_shine", card: "nebula", cardX: 30, cardY: 70, weapon: "rifle", background: "aurora", quote: "Salut", theme: "carbon" },
      catalog(),
      gold,
    );
    expect(a).toMatchObject({
      name: { fill: { colors: ["#22D3EE", "#0E7490"] }, effect: "neon", bold: true },
      frame: { image: "/plugins/gcs.vip_studio/assets/frames/ember.png", scale: 130 },
      banner: { fill: { animation: "shine" }, label: "VIP Gold" },
      card: { image: "/plugins/gcs.vip_studio/assets/cards/nebula.webp", x: 30, y: 70 },
      flair: { icon: "/plugins/gcs.vip_studio/assets/weapons/rifle.png", label: "Pușcă de asalt" },
      profile: { background: { image: "/plugins/gcs.vip_studio/assets/backgrounds/aurora.webp" }, quote: { text: "Salut" }, theme: { key: "carbon", accent: "#22D3EE" } },
    });
  });

  test("expirarea VIP: nimic publicat (alegerile rămân salvate)", () => {
    expect(toAppearance({ nameStyle: "neon", quote: "x" }, catalog(), none)).toBeNull();
  });

  test("un plan mai mic nu publică elementele rezervate", () => {
    const a = toAppearance({ frame: "crown", nameStyle: "duo" }, catalog({ "frame/crown": { plans: ["vip_legend"] } }), gold);
    expect(a?.frame).toBeUndefined();
    expect(a?.name).toBeDefined();
  });

  test("fiecare presetare produce un aspect publicabil (forma așteptată de GCS)", () => {
    const c = catalog();
    for (const kind of ["name_style", "banner", "frame", "card", "weapon", "background", "theme"] as Kind[]) {
      for (const item of c[kind].values()) {
        const field = { name_style: "nameStyle", banner: "banner", frame: "frame", card: "card", weapon: "weapon", background: "background", theme: "theme" }[kind as string]!;
        const a = toAppearance({ [field]: item.key } as Loadout, c, gold);
        expect([kind, item.key, a !== null]).toEqual([kind, item.key, true]);
      }
    }
  });
});
