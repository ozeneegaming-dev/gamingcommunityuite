import { render, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { GcsHoverCard, type GcsHoverCardData, type GcsHoverCardV2Labels } from "./GcsHoverCard";

const data: GcsHoverCardData = {
  user: {
    id: "u1",
    name: "BL1NG",
    image: null,
    nameKey: "admin",
    frameKey: null,
    slug: "bl1ng",
    bio: "",
    accentColor: null,
    cover: null,
    group: { name: "Root Admin", color: "#FF4D57" },
    rank: null,
  },
  stats: { posts: 5120, reputation: 301, followers: 412, joinedAt: "2016-05-01T00:00:00.000Z" },
  online: { online: true },
  badges: [{ key: "b1", name: "Câștigător chat", art: "/badge-art/v1/medal-gold-ffd36a-i-solid-trophy.svg", image: null }],
  fields: [],
  clan: { tag: "GCS", name: "Fondatori", href: "/clans/1-fondatori", color: "#FF8A3D", color2: "#1B1E26", ink: "#0B0C10" },
};

const labels = { posts: "postări", reputation: "reputație", followers: "urmăritori", online: "Online", joined: "membru din" };
const v2Labels: GcsHoverCardV2Labels = {
  onlineNow: "Online acum",
  playing: (s) => `Joacă pe ${s}`,
  lastVisit: (t) => `Ultima vizită: ${t}`,
  level: (l, r) => (r ? `Nivel ${l} · ${r}` : `Nivel ${l}`),
  maxLevel: "Nivel maxim",
  nextLevel: (n) => `Progresul spre ${n}`,
  elo: (e, t) => `ELO ${e} · ${t}`,
  vip: "VIP",
  badges: "Insigne",
  allBadges: "toate",
};

const format = { number: (n: number) => String(n), year: (iso: string) => iso.slice(0, 4), relative: () => "acum 3 ore" };

const v2 = {
  level: { level: 40, rank: "Legendă", percent: 92, next: { level: 41, name: "Mit" }, xp: 9000 },
  status: { kind: "online" as const },
  chips: [
    { kind: "clan" as const, tag: "GCS", name: "Fondatori", color: "#FF8A3D", href: "/clans/1-fondatori" },
    { kind: "elo" as const, elo: 1450, tier: "Diamant", href: null },
    { kind: "vip" as const, name: "VIP Gold", color: "#FFD36A" },
  ],
  profileHref: "/members/u1-bl1ng",
};

describe("GcsHoverCard v2", () => {
  test("statusul, cipurile (clan, ELO, VIP), nivelul cu bara, 4 contoare, insignele cu „toate”, punctul online", () => {
    const { container } = render(<GcsHoverCard data={{ ...data, v2 }} labels={labels} v2Labels={v2Labels} format={format} actions={<button type="button">Mesaj</button>} />);
    const card = within(container).getByTestId("gcs-hover-card");
    expect(card.className).toContain("gcs-hoverCard--v2");
    expect(within(card).getByTestId("gcs-hover-status").textContent).toBe("Online acum");
    expect(within(card).getByTestId("gcs-hover-dot")).toBeTruthy();
    expect(within(card).getByTestId("gcs-hover-clan").textContent).toContain("GCS");
    expect(within(card).getByTestId("gcs-hover-chip-elo").textContent).toBe("ELO 1450 · Diamant");
    expect(within(card).getByTestId("gcs-hover-chip-vip").getAttribute("title")).toBe("VIP Gold");
    expect(within(card).getByTestId("gcs-hover-level").textContent).toContain("Nivel 40 · Legendă");
    expect(within(card).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("92");
    expect(card.querySelectorAll(".gcs-hoverCard__stats > div")).toHaveLength(4);
    expect(within(card).getByTestId("gcs-hover-badges").querySelector("a")?.getAttribute("href")).toBe("/members/u1-bl1ng?tab=badges");
    // Inelul avatarului are culoarea grupului; online-ul nu mai apare și ca pastilă.
    expect((card.querySelector(".gcs-hoverCard__avatar") as HTMLElement).style.getPropertyValue("--gcs-hoverCard-ring")).toBe("#FF4D57");
    expect(card.querySelector(".gcs-hoverCard__online")).toBeNull();
  });

  test("„Joacă pe <server>” e un link; ultima vizită e relativă; ascuns = fără linie", () => {
    const playing = render(<GcsHoverCard data={{ ...data, v2: { ...v2, status: { kind: "playing", server: "Public #1", href: "/servers/1-public" } } }} labels={labels} v2Labels={v2Labels} format={format} />);
    const link = within(playing.container).getByTestId("gcs-hover-status").querySelector("a")!;
    expect(link.textContent).toBe("Joacă pe Public #1");
    expect(link.getAttribute("href")).toBe("/servers/1-public");
    playing.unmount();
    const last = render(<GcsHoverCard data={{ ...data, v2: { ...v2, status: { kind: "lastVisit", at: "2026-10-16T08:00:00.000Z" } } }} labels={labels} v2Labels={v2Labels} format={format} />);
    expect(within(last.container).getByTestId("gcs-hover-status").textContent).toBe("Ultima vizită: acum 3 ore");
    expect(within(last.container).queryByTestId("gcs-hover-dot")).toBeNull();
    last.unmount();
    const hidden = render(<GcsHoverCard data={{ ...data, v2: { ...v2, status: { kind: "hidden" } } }} labels={labels} v2Labels={v2Labels} format={format} />);
    expect(within(hidden.container).queryByTestId("gcs-hover-status")).toBeNull();
  });

  test("fără date v2: cardul clasic (tagul clanului lângă nume, pastila online)", () => {
    const { container } = render(<GcsHoverCard data={data} labels={labels} format={format} />);
    const card = within(container).getByTestId("gcs-hover-card");
    expect(card.className).not.toContain("gcs-hoverCard--v2");
    expect(card.querySelector(".gcs-hoverCard__meta [data-testid=gcs-hover-clan]")).not.toBeNull();
    expect(card.querySelector(".gcs-hoverCard__online")).not.toBeNull();
    expect(within(container).queryByTestId("gcs-hover-level")).toBeNull();
  });
});
