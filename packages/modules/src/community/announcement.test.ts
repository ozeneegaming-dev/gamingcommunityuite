import { describe, expect, test } from "vitest";
import {
  ANNOUNCEMENT_MAX_BARS,
  DEFAULT_ANNOUNCEMENT_CONFIG,
  announcementBarDefaults,
  announcementConfigError,
  announcementConfigIssue,
  announcementDay,
  announcementDismissed,
  announcementFromZonedInput,
  announcementOnPage,
  announcementPageBars,
  announcementPageKind,
  announcementPathMatch,
  announcementPlainText,
  announcementStatsFrom,
  announcementStatus,
  announcementUsedVariables,
  announcementZonedInput,
  normalizeAnnouncementConfig,
  parseAnnouncementDismissals,
  parseAnnouncementText,
  readAnnouncementConfig,
  upgradeAnnouncementConfig,
  visibleAnnouncementBars,
  type GcsAnnouncementBar,
  type GcsAnnouncementConfig,
} from "./announcement";

const bar = (over: Partial<GcsAnnouncementBar> = {}): GcsAnnouncementBar => ({
  ...announcementBarDefaults("cupa"),
  label: "ANUNȚ",
  text: "Cupa de toamnă CS 1.6: înscrierile sunt deschise până vineri",
  cta: { label: "Înscrie echipa", href: "/forum/turnee", style: "white", newTab: false },
  ...over,
});
const config = (bars: GcsAnnouncementBar[]): GcsAnnouncementConfig => ({ ...DEFAULT_ANNOUNCEMENT_CONFIG, bars });
const guest = { userId: null, groupIds: [] };
const member = { userId: "u1", groupIds: [5] };
const TZ = "Europe/Bucharest";

/** O configurație salvată de prima versiune a barei (fără poziție, aspect, program pe zile…). */
const legacy = {
  rotateSeconds: 10,
  bars: [
    {
      id: "vechi",
      enabled: true,
      label: "ANUNȚ",
      text: "Mentenanță joi",
      cta: { label: "Detalii", href: "https://example.com/x" },
      link: { label: "Regulament", href: "/forum/regulament" },
      style: "warning",
      pages: "forum",
      guests: true,
      members: true,
      groups: [3],
      startsAt: null,
      endsAt: "2030-01-01T00:00:00.000Z",
      dismissible: true,
      version: 4,
    },
  ],
};

describe("bara de anunț: configurațiile vechi", () => {
  test("prima versiune se citește în forma nouă, cu comportamentul de azi (în pagină, cât pagina)", () => {
    const up = upgradeAnnouncementConfig(legacy) as GcsAnnouncementConfig;
    expect(announcementConfigError(up)).toBeNull();
    expect(up).toMatchObject({ rotateSeconds: 10, multiple: "rotate", transition: "fade", dots: true, stats: true });
    const b = up.bars[0]!;
    expect(b).toMatchObject({ id: "vechi", position: "page", fullWidth: false, sticky: false, preset: "warning", pages: "forum", groups: [3], version: 4, reappearDays: 0, excludeGroups: [], days: [] });
    // Linkurile externe se deschideau în tab nou: la fel și acum.
    expect(b.cta).toEqual({ label: "Detalii", href: "https://example.com/x", style: "filled", newTab: true });
    expect("style" in b).toBe(false);
    expect(readAnnouncementConfig(legacy).bars).toHaveLength(1);
  });

  test("o valoare stricată sau lipsă → nicio bară; o bară nouă e sus, pe toată lățimea", () => {
    expect(readAnnouncementConfig(null)).toEqual(DEFAULT_ANNOUNCEMENT_CONFIG);
    expect(readAnnouncementConfig({ bars: [{ id: "x" }] })).toEqual(DEFAULT_ANNOUNCEMENT_CONFIG);
    expect(readAnnouncementConfig("text")).toEqual(DEFAULT_ANNOUNCEMENT_CONFIG);
    expect(announcementBarDefaults("n1")).toMatchObject({ position: "top", fullWidth: true, preset: "forja" });
  });
});

describe("bara de anunț: validarea", () => {
  test("o configurație corectă e validă; `null` = nicio bară", () => {
    expect(announcementConfigError(config([bar(), bar({ id: "b2", preset: "warning", pages: "home", cta: null, link: { label: "Detalii", href: "https://example.com/x" } })]))).toBeNull();
    expect(announcementConfigError(null)).toBeNull();
  });

  test("erorile, cu câmpul lor", () => {
    expect(announcementConfigIssue(config([bar({ text: "  " })]))).toEqual({ path: "bars.0.text", code: "required" });
    expect(announcementConfigIssue(config([bar({ cta: { label: "x", href: "javascript:alert(1)", style: "white", newTab: false } })]))).toEqual({ path: "bars.0.cta.href", code: "invalid_url" });
    expect(announcementConfigError(config([bar({ preset: "neon" as never })]))).toBe("invalid_choice");
    expect(announcementConfigError(config([bar({ startsAt: "2026-10-20T10:00:00Z", endsAt: "2026-10-19T10:00:00Z" })]))).toBe("invalid_range");
    expect(announcementConfigError(config(Array.from({ length: ANNOUNCEMENT_MAX_BARS + 1 }, (_, i) => bar({ id: `b${i}` }))))).toBe("too_many");
    expect(announcementConfigError(config(Array.from({ length: ANNOUNCEMENT_MAX_BARS }, (_, i) => bar({ id: `b${i}` }))))).toBeNull();
    expect(announcementConfigError(config([bar(), bar()]))).toBe("duplicate");
    expect(announcementConfigError({ ...config([]), rotateSeconds: 1 })).toBe("invalid_range");
    expect(announcementConfigIssue(config([bar({ fgColor: "red" })]))?.path).toBe("bars.0.fgColor");
    expect(announcementConfigIssue(config([bar({ preset: "custom", bgKind: "image", bgImage: null })]))).toEqual({ path: "bars.0.bgImage", code: "required" });
    expect(announcementConfigError(config([bar({ bgImage: "https://evil.example/x.png" })]))).toBe("invalid_image");
    expect(announcementConfigError(config([bar({ pages: "paths", paths: [] })]))).toBe("required");
    expect(announcementConfigError(config([bar({ excludePaths: ["clanuri"] })]))).toBe("invalid_path");
    expect(announcementConfigError(config([bar({ timeFrom: "18:00", timeTo: null })]))).toBe("required");
    expect(announcementConfigError(config([bar({ timeFrom: "25:00", timeTo: "26:00" })]))).toBe("invalid_value");
    expect(announcementConfigError(config([bar({ days: [0] })]))).toBe("invalid");
    expect(announcementConfigError(config([bar({ countdown: { at: "2026-11-08T18:00:00Z", onEnd: "text", endText: "" } })]))).toBe("required");
  });

  test("iconița: formatul Font Awesome și, pe server, una existentă", () => {
    expect(announcementConfigError(config([bar({ icon: "fa-solid fa-trophy" })]))).toBeNull();
    expect(announcementConfigError(config([bar({ icon: "<svg>" })]))).toBe("invalid_icon");
    expect(announcementConfigError(config([bar({ icon: "fa-solid fa-nu-exista" })]), { isIcon: () => false })).toBe("invalid_icon");
  });
});

describe("bara de anunț: versiunea (închiderile ținute minte)", () => {
  test("o bară neschimbată sau doar oprită își păstrează versiunea; una schimbată primește versiunea următoare", () => {
    const saved = normalizeAnnouncementConfig(config([bar({ version: 3 })]));
    expect(saved.bars[0]!.version).toBe(3);
    expect(normalizeAnnouncementConfig(config([bar({ version: 3 })]), saved).bars[0]!.version).toBe(3);
    expect(normalizeAnnouncementConfig(config([bar({ version: 3, enabled: false })]), saved).bars[0]!.version).toBe(3);
    expect(normalizeAnnouncementConfig(config([bar({ version: 3, text: "Alt text" })]), saved).bars[0]!.version).toBe(4);
  });

  test("normalizarea: imaginea doar la fundalul „imagine”, lipirea doar sus, toate zilele = fără filtru", () => {
    const n = normalizeAnnouncementConfig(config([bar({ bgImage: "/files/abc", sticky: true, position: "bottom", days: [1, 2, 3, 4, 5, 6, 7], paths: ["/x"], excludePaths: ["/clanuri/", "/clanuri"] })])).bars[0]!;
    expect(n).toMatchObject({ bgImage: null, sticky: false, days: [], paths: [], excludePaths: ["/clanuri"] });
  });
});

describe("bara de anunț: cine o vede", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  const visible = (b: GcsAnnouncementBar, viewer: Parameters<typeof visibleAnnouncementBars>[1] = guest, path = "/") => visibleAnnouncementBars(config([b]), viewer, path, now, TZ).length === 1;

  test("programarea: înainte de început și după sfârșit nu apare", () => {
    expect(visible(bar({ startsAt: "2026-10-17T00:00:00Z" }))).toBe(false);
    expect(visible(bar({ endsAt: "2026-10-16T11:00:00Z" }))).toBe(false);
    expect(visible(bar({ startsAt: "2026-10-16T00:00:00Z", endsAt: "2026-10-17T00:00:00Z" }))).toBe(true);
  });

  test("publicul: vizitatorii, membrii, grupurile incluse și excluse", () => {
    expect(visible(bar({ guests: false }))).toBe(false);
    expect(visible(bar({ members: false }), member)).toBe(false);
    expect(visible(bar({ groups: [7] }), member)).toBe(false);
    expect(visible(bar({ groups: [5, 7] }), member)).toBe(true);
    expect(visible(bar({ excludeGroups: [5] }), member)).toBe(false);
    expect(visible(bar({ groups: [5], excludeGroups: [5] }), member)).toBe(false);
    expect(visible(bar({ excludeGroups: [5] }), guest)).toBe(true);
  });

  test("membrii noi: doar în primele N zile de la înregistrare", () => {
    const fresh = { ...member, joinedAt: new Date("2026-10-12T12:00:00Z") };
    const old = { ...member, joinedAt: "2026-09-01T00:00:00Z" };
    expect(visible(bar({ newMembersDays: 7 }), fresh)).toBe(true);
    expect(visible(bar({ newMembersDays: 7 }), old)).toBe(false);
    expect(visible(bar({ newMembersDays: 7 }), member)).toBe(false);
    expect(visible(bar({ newMembersDays: 0 }), old)).toBe(true);
  });

  test("limba site-ului", () => {
    expect(visible(bar({ locales: ["en"] }), { ...guest, locale: "ro" })).toBe(false);
    expect(visible(bar({ locales: ["en", "ro"] }), { ...guest, locale: "ro" })).toBe(true);
  });

  test("bara oprită nu apare", () => {
    expect(visible(bar({ enabled: false }))).toBe(false);
  });
});

describe("bara de anunț: paginile", () => {
  test("toate / prima pagină / forum", () => {
    expect(announcementPageKind("/")).toBe("home");
    expect(announcementPageKind("/topic/12-x")).toBe("forum");
    expect(announcementPageKind("/members")).toBe("other");
    expect(announcementOnPage(bar({ pages: "home" }), "/members")).toBe(false);
    expect(announcementOnPage(bar({ pages: "forum" }), "/forum/anunturi")).toBe(true);
    expect(announcementOnPage(bar({ pages: "forum" }), "/clans")).toBe(false);
  });

  test("adresele alese, cu `*`, și cele excluse", () => {
    expect(announcementPathMatch("/clanuri/*", "/clanuri")).toBe(true);
    expect(announcementPathMatch("/clanuri/*", "/clanuri/turnee/3")).toBe(true);
    expect(announcementPathMatch("/clanuri/*", "/clanurix")).toBe(false);
    expect(announcementPathMatch("/", "/forum")).toBe(false);
    expect(announcementPathMatch("/forum", "/forum/")).toBe(true);
    expect(announcementPathMatch("/topic/*-cupa", "/topic/12-cupa")).toBe(true);
    expect(announcementPathMatch("/a.b", "/axb")).toBe(false);
    const chosen = bar({ pages: "paths", paths: ["/clanuri/*", "/"] });
    expect(announcementOnPage(chosen, "/")).toBe(true);
    expect(announcementOnPage(chosen, "/clanuri/7")).toBe(true);
    expect(announcementOnPage(chosen, "/forum")).toBe(false);
    expect(announcementOnPage(bar({ excludePaths: ["/servers/*"] }), "/servers/3")).toBe(false);
    expect(announcementOnPage(bar({ pages: "paths", paths: ["/clanuri/*"], excludePaths: ["/clanuri/admin"] }), "/clanuri/admin")).toBe(false);
  });
});

describe("bara de anunț: zilele și orele în fusul site-ului", () => {
  // Joi, 15 oct. 2026: 21:30 UTC = vineri 00:30 în România (UTC+3, ora de vară).
  const fridayRo = new Date("2026-10-15T21:30:00Z");
  test("zilele săptămânii după ora site-ului, nu după UTC", () => {
    expect(visibleAnnouncementBars(config([bar({ days: [5] })]), guest, "/", fridayRo, TZ)).toHaveLength(1);
    expect(visibleAnnouncementBars(config([bar({ days: [4] })]), guest, "/", fridayRo, TZ)).toHaveLength(0);
    expect(visibleAnnouncementBars(config([bar({ days: [4] })]), guest, "/", fridayRo, "UTC")).toHaveLength(1);
  });

  test("intervalul orar, și peste miezul nopții", () => {
    const at = (iso: string, from: string, to: string) => visibleAnnouncementBars(config([bar({ timeFrom: from, timeTo: to })]), guest, "/", new Date(iso), TZ).length === 1;
    // 15:00 UTC = 18:00 în România.
    expect(at("2026-10-16T15:00:00Z", "18:00", "23:59")).toBe(true);
    expect(at("2026-10-16T14:59:00Z", "18:00", "23:59")).toBe(false);
    expect(at("2026-10-16T21:30:00Z", "22:00", "02:00")).toBe(true);
    expect(at("2026-10-16T12:00:00Z", "22:00", "02:00")).toBe(false);
  });

  test("câmpurile de dată din ACP sunt în ora site-ului (și la trecerea la ora de iarnă)", () => {
    expect(announcementFromZonedInput("2026-11-08T20:00", TZ)).toBe("2026-11-08T18:00:00.000Z");
    expect(announcementFromZonedInput("2026-07-01T12:00", TZ)).toBe("2026-07-01T09:00:00.000Z");
    expect(announcementZonedInput("2026-11-08T18:00:00.000Z", TZ)).toBe("2026-11-08T20:00");
    expect(announcementFromZonedInput("", TZ)).toBeNull();
  });
});

describe("bara de anunț: numărătoarea, starea și barele trimise în pagină", () => {
  const now = new Date("2026-11-08T19:00:00Z");
  test("la final: „se ascunde” scoate bara, „arată textul” o păstrează", () => {
    expect(visibleAnnouncementBars(config([bar({ countdown: { at: "2026-11-08T18:00:00Z", onEnd: "hide", endText: "" } })]), guest, "/", now, TZ)).toHaveLength(0);
    expect(visibleAnnouncementBars(config([bar({ countdown: { at: "2026-11-08T18:00:00Z", onEnd: "text", endText: "A început!" } })]), guest, "/", now, TZ)).toHaveLength(1);
    expect(visibleAnnouncementBars(config([bar({ countdown: { at: "2026-11-08T20:00:00Z", onEnd: "hide", endText: "" } })]), guest, "/", now, TZ)).toHaveLength(1);
  });

  test("starea din ACP", () => {
    expect(announcementStatus(bar(), now)).toBe("active");
    expect(announcementStatus(bar({ enabled: false }), now)).toBe("off");
    expect(announcementStatus(bar({ startsAt: "2026-11-09T00:00:00Z" }), now)).toBe("scheduled");
    expect(announcementStatus(bar({ endsAt: "2026-11-08T00:00:00Z" }), now)).toBe("expired");
    expect(announcementStatus(bar({ countdown: { at: "2026-11-08T18:00:00Z", onEnd: "hide", endText: "" } }), now)).toBe("expired");
  });

  test("în pagină: și barele care încep curând (browserul le arată la timp), nu cele terminate sau îndepărtate", () => {
    const bars = [bar({ id: "a" }), bar({ id: "b", startsAt: "2026-11-08T21:00:00Z" }), bar({ id: "c", startsAt: "2026-11-10T00:00:00Z" }), bar({ id: "d", endsAt: "2026-11-08T10:00:00Z" })];
    expect(announcementPageBars(config(bars), guest, now).map((b) => b.id)).toEqual(["a", "b"]);
  });
});

describe("bara de anunț: închiderea și reapariția", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const today = announcementDay(now);
  test("aceeași versiune rămâne închisă; o versiune nouă reapare", () => {
    const map = parseAnnouncementDismissals(encodeURIComponent(`guest~cupa~2~${today}|u1~cupa~2~${today}`), "guest");
    expect(announcementDismissed(map, bar({ version: 2 }), now)).toBe(true);
    expect(announcementDismissed(map, bar({ version: 3 }), now)).toBe(false);
    expect(announcementDismissed(parseAnnouncementDismissals("u1~cupa~2", "guest"), bar({ version: 2 }), now)).toBe(false);
  });

  test("reapare după N zile; intrările vechi (fără zi) rămân închise", () => {
    const map = parseAnnouncementDismissals(`guest~cupa~1~${today - 3}`, "guest");
    expect(announcementDismissed(map, bar({ reappearDays: 3 }), now)).toBe(false);
    expect(announcementDismissed(map, bar({ reappearDays: 4 }), now)).toBe(true);
    expect(announcementDismissed(map, bar({ reappearDays: 0 }), now)).toBe(true);
    expect(announcementDismissed(parseAnnouncementDismissals("guest~cupa~1", "guest"), bar({ reappearDays: 3 }), now)).toBe(true);
    expect(announcementDismissed(map, bar({ dismissible: false }), now)).toBe(false);
    expect(parseAnnouncementDismissals("%E0%A4%A", "guest").size).toBe(0);
  });
});

describe("bara de anunț: textul formatat și variabilele", () => {
  test("gros, cursiv, linkuri sigure, variabile; HTML-ul rămâne text", () => {
    expect(parseAnnouncementText("**Cupa** · *sâmbătă* [Regulament](/forum/regulament)")).toEqual([
      { t: "b", c: [{ t: "text", v: "Cupa" }] },
      { t: "text", v: " · " },
      { t: "i", c: [{ t: "text", v: "sâmbătă" }] },
      { t: "text", v: " " },
      { t: "a", href: "/forum/regulament", c: [{ t: "text", v: "Regulament" }] },
    ]);
    expect(parseAnnouncementText("[x](javascript:alert(1))")).toEqual([{ t: "text", v: "x" }, { t: "text", v: ")" }]);
    expect(parseAnnouncementText("<b>hi</b>")).toEqual([{ t: "text", v: "<b>hi</b>" }]);
    expect(parseAnnouncementText("snake_case_word și 2*3*4")).toEqual([{ t: "text", v: "snake_case_word și 2*3*4" }]);
    expect(parseAnnouncementText("\\*nu\\* e cursiv")).toEqual([{ t: "text", v: "*nu* e cursiv" }]);
  });

  test("variabilele cunoscute se înlocuiesc, cele necunoscute dispar", () => {
    const nodes = parseAnnouncementText("Salut, {numele_tau}! {membri_online} online{necunoscut} · {CS2}");
    expect(announcementPlainText(nodes, { numele_tau: "Ștefan", membri_online: "42" })).toBe("Salut, Ștefan! 42 online · {CS2}");
    expect(announcementPlainText(nodes)).toBe("Salut, !  online · {CS2}");
    expect([...announcementUsedVariables([bar({ text: "**{jucatori_online}** pe servere", mobileText: "{numele_tau}" })])].sort()).toEqual(["jucatori_online", "numele_tau"]);
  });
});

describe("bara de anunț: statisticile", () => {
  test("hash-ul → cifrele fiecărei bare (lipsa = 0)", () => {
    expect(announcementStatsFrom({ "cupa:view": "12", "cupa:click": "3", "cupa:since": "2026-11-01T00:00:00.000Z", "alta:view": "x" }, ["cupa", "alta"])).toEqual({
      cupa: { views: 12, clicks: 3, dismissals: 0, since: "2026-11-01T00:00:00.000Z" },
      alta: { views: 0, clicks: 0, dismissals: 0, since: null },
    });
  });
});
