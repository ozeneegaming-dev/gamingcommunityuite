import { describe, expect, test } from "vitest";
import {
  ANNOUNCEMENT_MAX_BARS,
  announcementConfigError,
  announcementPageKind,
  normalizeAnnouncementConfig,
  visibleAnnouncementBars,
  type GcsAnnouncementBar,
  type GcsAnnouncementConfig,
} from "./announcement";

const bar = (over: Partial<GcsAnnouncementBar> = {}): GcsAnnouncementBar => ({
  id: "cupa",
  enabled: true,
  label: "ANUNȚ",
  text: "Cupa de toamnă CS 1.6: înscrierile sunt deschise până vineri",
  cta: { label: "Înscrie echipa", href: "/forum/turnee" },
  link: null,
  style: "accent",
  pages: "all",
  guests: true,
  members: true,
  groups: [],
  startsAt: null,
  endsAt: null,
  dismissible: true,
  version: 1,
  ...over,
});
const config = (bars: GcsAnnouncementBar[]): GcsAnnouncementConfig => ({ rotateSeconds: 8, bars });
const guest = { userId: null, groupIds: [] };
const member = { userId: "u1", groupIds: [5] };

describe("bara de anunț: validarea", () => {
  test("o configurație corectă e validă; `null` = nicio bară", () => {
    expect(announcementConfigError(config([bar(), bar({ id: "b2", style: "warning", pages: "home", cta: null, link: { label: "Detalii", href: "https://example.com/x" } })]))).toBeNull();
    expect(announcementConfigError(null)).toBeNull();
  });

  test("erorile: text gol, adresă greșită, stil necunoscut, interval inversat, prea multe bare, id dublat", () => {
    expect(announcementConfigError(config([bar({ text: "  " })]))).toBe("required");
    expect(announcementConfigError(config([bar({ cta: { label: "x", href: "javascript:alert(1)" } })]))).toBe("invalid_url");
    expect(announcementConfigError(config([bar({ style: "neon" as never })]))).toBe("invalid_choice");
    expect(announcementConfigError(config([bar({ startsAt: "2026-10-20T10:00:00Z", endsAt: "2026-10-19T10:00:00Z" })]))).toBe("invalid_range");
    expect(announcementConfigError(config(Array.from({ length: ANNOUNCEMENT_MAX_BARS + 1 }, (_, i) => bar({ id: `b${i}` }))))).toBe("too_many");
    expect(announcementConfigError(config([bar(), bar()]))).toBe("duplicate");
    expect(announcementConfigError({ rotateSeconds: 1, bars: [] })).toBe("invalid_range");
  });
});

describe("bara de anunț: versiunea (închiderile ținute minte)", () => {
  test("o bară neschimbată își păstrează versiunea; una schimbată primește versiunea următoare", () => {
    const saved = normalizeAnnouncementConfig(config([bar({ version: 3 })]));
    expect(saved.bars[0]!.version).toBe(3);
    expect(normalizeAnnouncementConfig(config([bar({ version: 3 })]), saved).bars[0]!.version).toBe(3);
    expect(normalizeAnnouncementConfig(config([bar({ version: 3, text: "Alt text" })]), saved).bars[0]!.version).toBe(4);
  });
});

describe("bara de anunț: cine o vede și unde", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  test("programarea: înainte de început și după sfârșit nu apare", () => {
    expect(visibleAnnouncementBars(config([bar({ startsAt: "2026-10-17T00:00:00Z" })]), guest, "/", now)).toEqual([]);
    expect(visibleAnnouncementBars(config([bar({ endsAt: "2026-10-16T11:00:00Z" })]), guest, "/", now)).toEqual([]);
    expect(visibleAnnouncementBars(config([bar({ startsAt: "2026-10-16T00:00:00Z", endsAt: "2026-10-17T00:00:00Z" })]), guest, "/", now)).toHaveLength(1);
  });

  test("publicul: vizitatorii, membrii, grupurile alese", () => {
    expect(visibleAnnouncementBars(config([bar({ guests: false })]), guest, "/", now)).toEqual([]);
    expect(visibleAnnouncementBars(config([bar({ members: false })]), member, "/", now)).toEqual([]);
    expect(visibleAnnouncementBars(config([bar({ groups: [7] })]), member, "/", now)).toEqual([]);
    expect(visibleAnnouncementBars(config([bar({ groups: [5, 7] })]), member, "/", now)).toHaveLength(1);
  });

  test("paginile: toate / prima pagină / forum; bara oprită nu apare", () => {
    expect(announcementPageKind("/")).toBe("home");
    expect(announcementPageKind("/topic/12-x")).toBe("forum");
    expect(announcementPageKind("/members")).toBe("other");
    expect(visibleAnnouncementBars(config([bar({ pages: "home" })]), guest, "/members", now)).toEqual([]);
    expect(visibleAnnouncementBars(config([bar({ pages: "forum" })]), guest, "/forum/anunturi", now)).toHaveLength(1);
    expect(visibleAnnouncementBars(config([bar({ pages: "forum" })]), guest, "/clans", now)).toEqual([]);
    expect(visibleAnnouncementBars(config([bar({ enabled: false })]), guest, "/", now)).toEqual([]);
  });
});
