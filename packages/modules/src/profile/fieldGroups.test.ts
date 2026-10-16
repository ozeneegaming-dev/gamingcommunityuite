import { describe, expect, test } from "vitest";
import { cleanHandle, contactLink, DEFAULT_FIELD_GROUPS, DEFAULT_GROUP_FIELDS, groupFields, isLinkTemplate, profileCompletion, type GcsFieldGroupDef } from "./fieldGroups";

const groups: GcsFieldGroupDef[] = [
  { id: 1, key: "basic", label: "De bază", helper: "", icon: null, position: 0 },
  { id: 2, key: "about_me", label: "Despre mine", helper: "", icon: null, position: 1 },
  { id: 5, key: "contact", label: "Contact", helper: "", icon: null, position: 4 },
];

describe("grupurile câmpurilor de profil", () => {
  test("ordinea grupurilor, apoi a câmpurilor; grupurile goale nu apar", () => {
    const out = groupFields(
      groups,
      [
        { key: "x", groupId: 5, section: "ABOUT" as const, position: 2 },
        { key: "country", groupId: 1, section: "ABOUT" as const, position: 1 },
        { key: "yt", groupId: 5, section: "ABOUT" as const, position: 1 },
      ],
      () => "?",
    );
    expect(out.map((g) => [g.group.key, g.fields.map((f) => f.key)])).toEqual([
      ["basic", ["country"]],
      ["contact", ["yt", "x"]],
    ]);
  });

  test("un câmp fără grup (sau cu grupul șters) intră în grupul secțiunii; „Jocuri” devine un grup virtual la final", () => {
    const out = groupFields(
      groups,
      [
        { key: "old_about", groupId: null, section: "ABOUT" as const },
        { key: "orphan", groupId: 99, section: "ABOUT" as const },
        { key: "twitch", section: "GAMES" as const },
      ],
      (s) => (s === "GAMES" ? "Jocuri" : "Despre"),
    );
    expect(out.map((g) => [g.group.key, g.group.label, g.fields.map((f) => f.key)])).toEqual([
      ["about_me", "Despre mine", ["old_about", "orphan"]],
      ["games", "Jocuri", ["twitch"]],
    ]);
  });

  test("seed-ul: cele 5 grupuri din brief, cu câmpurile echipamentului și contactele cu șabloane valide", () => {
    expect(DEFAULT_FIELD_GROUPS.map((g) => g.key)).toEqual(["basic", "about_me", "gear", "description", "contact"]);
    expect(DEFAULT_GROUP_FIELDS.filter((f) => f.group === "gear").map((f) => f.key)).toEqual(["gear_cpu", "gear_gpu", "gear_ram", "gear_phone", "gear_os", "gear_laptop"]);
    expect(DEFAULT_GROUP_FIELDS.find((f) => f.key === "favorite_server")?.type).toBe("SERVER_SELECT");
    for (const f of DEFAULT_GROUP_FIELDS.filter((f) => f.group === "contact")) expect(isLinkTemplate(f.linkTemplate!), f.key).toBe(true);
  });
});

describe("handle-urile de contact", () => {
  test("membrul scrie handle-ul; linkul se construiește (și din @handle sau din linkul copiat)", () => {
    expect(contactLink("https://www.tiktok.com/@{handle}", "gamer_ro")).toBe("https://www.tiktok.com/@gamer_ro");
    expect(contactLink("https://x.com/{handle}", "@GcsNews")).toBe("https://x.com/GcsNews");
    expect(contactLink("https://www.instagram.com/{handle}", "https://instagram.com/foto.ro/?hl=ro")).toBe("https://www.instagram.com/foto.ro");
    expect(cleanHandle("https://www.youtube.com/@CanalulMeu")).toBe("CanalulMeu");
  });

  test("handle-urile cu caractere periculoase sau șabloanele invalide nu dau link", () => {
    expect(cleanHandle('a"><script>')).toBeNull();
    expect(cleanHandle("două cuvinte")).toBeNull();
    expect(contactLink("javascript:{handle}", "x")).toBeNull();
    expect(contactLink("https://a.com/{handle}/{handle}", "x")).toBeNull();
    expect(contactLink(null, "x")).toBeNull();
    expect(isLinkTemplate("https://twitch.tv/{handle}")).toBe(true);
    expect(isLinkTemplate("http://twitch.tv/{handle}")).toBe(false);
  });
});

describe("completarea profilului", () => {
  const empty = { avatar: false, cover: false, bio: false, birthday: false, signature: false, linkedAccount: false, fields: [] };

  test("gol = 0 %, tot = 100 %; pașii lipsă în ordine", () => {
    expect(profileCompletion(empty)).toMatchObject({ percent: 0, missing: ["avatar", "bio", "cover", "birthday", "signature", "linkedAccount"] });
    expect(profileCompletion({ avatar: true, cover: true, bio: true, birthday: true, signature: true, linkedAccount: true, fields: [{ key: "a", filled: true }] }).percent).toBe(100);
  });

  test("avatarul și bio-ul contează dublu; câmpurile împreună valorează 8 puncte", () => {
    // 2 + 2 din 8 (fără câmpuri) = 50 %.
    expect(profileCompletion({ ...empty, avatar: true, bio: true }).percent).toBe(50);
    // 4 din 16, plus 2 câmpuri din 4 completate = (4 + 4) / 16 = 50 %.
    const fields = [
      { key: "a", filled: true },
      { key: "b", filled: true },
      { key: "c", filled: false },
      { key: "d", filled: false },
    ];
    expect(profileCompletion({ ...empty, avatar: true, bio: true, fields })).toMatchObject({ percent: 50, total: 16, missing: ["cover", "birthday", "signature", "linkedAccount", "fields"] });
  });
});
