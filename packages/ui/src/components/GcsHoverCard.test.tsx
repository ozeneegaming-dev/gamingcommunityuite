import { render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { GcsButton } from "./GcsButton";
import { GcsHoverCard, GcsHoverCardActions, GcsHoverCardIconAction, type GcsHoverCardData, type GcsHoverCardV2Labels } from "./GcsHoverCard";

const crown = { width: 576, height: 512, path: "M0 0h576v512H0z" };

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
    group: { id: 4, name: "Root Admin", color: "#FF4D57", href: "/members?group=4", icon: crown },
    rank: null,
  },
  stats: { posts: 5120, reputation: 301, followers: 412, joinedAt: "2016-05-01T00:00:00.000Z", badges: 9 },
  online: { online: true },
  badges: [{ key: "b1", name: "Câștigător chat", art: "/badge-art/v1/medal-gold-ffd36a-i-solid-trophy.svg", image: null, color: "#FFD36A", awardedAt: "2026-09-25T10:00:00.000Z" }],
  fields: [],
  clan: { tag: "GCS", name: "Fondatori", href: "/clans/1-fondatori", color: "#FF8A3D", color2: "#1B1E26", ink: "#0B0C10" },
};

const labels = { posts: "Postări", reputation: "Reputație", followers: "urmăritori", online: "Online", joined: "membru din" };
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
  allBadges: "Toate insignele",
  registered: (d) => `Înregistrat pe ${d}`,
  otherGroups: "Alte grupuri",
  rank: "Rang",
  badgeEarned: (d) => `Obținută pe ${d}`,
};

const format = { number: (n: number) => String(n), year: (iso: string) => iso.slice(0, 4), relative: () => "acum 3 ore", date: (iso: string) => iso.slice(0, 10) };

const v2 = {
  level: { level: 40, rank: "Legendă", percent: 92, next: { level: 41, name: "Mit" }, xp: 9000 },
  status: { kind: "online" as const },
  chips: [
    { kind: "clan" as const, tag: "GCS", name: "Fondatori", color: "#FF8A3D", href: "/clans/1-fondatori" },
    { kind: "elo" as const, elo: 1450, tier: "Diamant", href: null },
    { kind: "vip" as const, name: "VIP Gold", color: "#FFD36A" },
  ],
  profileHref: "/members/u1-bl1ng",
  rankEmblem: { art: "/badge-art/v1/rosette-custom-ff5a5f-i-solid-chevron-up.svg", image: null },
};

const secondary = { id: 7, name: "Clan [ARC]", color: "#4D9BE6", href: "/members?group=7", tooltip: ["3 membri"], ariaLabel: "Membrii grupului Clan [ARC]", icon: crown };

const card = (patch: Partial<GcsHoverCardData> = {}, actions?: ReactNode) =>
  render(<GcsHoverCard data={{ ...data, v2, ...patch }} labels={labels} v2Labels={v2Labels} format={format} {...(actions ? { actions } : {})} />);

describe("cardul de membru v3 (macheta aprobată pe 2026-11-03)", () => {
  test("fără copertă: degradeul din culoarea grupului; avatarul centrat cu punctul online; numele, grupul cu iconița, data înregistrării, statusul", () => {
    const { container } = card();
    const el = within(container).getByTestId("gcs-hover-card");
    expect(el.className).toContain("gcs-hoverCard--v3");
    expect(el.getAttribute("role")).toBe("dialog");
    // Coperta-degrade e desenată din CSS, din culoarea grupului pusă pe card (fără stil inline pe copertă).
    expect(el.dataset.banner).toBe("tone");
    expect(el.style.getPropertyValue("--gcs-hoverCard-tone")).toBe("#FF4D57");
    expect(within(el).getByTestId("gcs-hover-cover").getAttribute("style")).toBeNull();
    // Ordinea: coperta, apoi avatarul (cu punctul online), apoi identitatea.
    const avatar = el.querySelector(".gcs-hoverCard__body > .gcs-hoverCard__avatar")!;
    expect(avatar.querySelector(".gcs-avatar")?.getAttribute("data-avatar-user")).toBe("u1");
    expect(within(el).getByTestId("gcs-hover-dot").parentElement).toBe(avatar);
    expect(el.querySelector(".gcs-hoverCard__name")?.textContent).toBe("BL1NG");
    const group = within(el).getByTestId("gcs-hover-group");
    expect(group.textContent).toBe("Root Admin");
    expect(group.getAttribute("href")).toBe("/members?group=4");
    expect(group.querySelector("svg.gcs-hoverCard__groupIcon path")?.getAttribute("d")).toBe(crown.path);
    expect(group.style.getPropertyValue("--gcs-hoverCard-group")).toBe("#FF4D57");
    expect(within(el).getByTestId("gcs-hover-joined").textContent).toBe("Înregistrat pe 2016-05-01");
    expect(within(el).getByTestId("gcs-hover-status").textContent).toBe("Online acum");
    // Cipurile aplicațiilor rămân, sub status.
    expect(within(el).getByTestId("gcs-hover-clan").textContent).toContain("GCS");
    expect(within(el).getByTestId("gcs-hover-chip-elo").textContent).toBe("ELO 1450 · Diamant");
    expect(within(el).getByTestId("gcs-hover-chip-vip").getAttribute("title")).toBe("VIP Gold");
  });

  test("cu copertă: imaginea profilului (cu voalul de jos); poziția salvată e verificată în browser (hovercard.spec)", () => {
    const { container } = card({ user: { ...data.user, cover: "/files/cover1", coverPositionY: 30 } });
    const el = within(container).getByTestId("gcs-hover-card");
    expect(el.dataset.banner).toBe("image");
    const cover = within(el).getByTestId("gcs-hover-cover");
    expect(cover.className).toBe("gcs-hoverCard__cover gcs-hoverCard__cover--image");
    // Coperta e sub avatar și sub identitate, nu peste ele.
    expect(cover.nextElementSibling?.className).toBe("gcs-hoverCard__body");
  });

  test("avatarul: rama VIP a membrului (aceeași componentă ca în profil și postbit) și punctul online; offline = fără punct", () => {
    const { container, unmount } = card({ user: { ...data.user, image: "/files/a1", frameKey: "gold" } });
    const frame = container.querySelector(".gcs-hoverCard__avatar > .gcs-avatarFrame");
    expect(frame?.classList.contains("gcs-avatarFrame--gold")).toBe(true);
    // Avatarul din ramă poartă id-ul membrului: și rama publicată de un plugin (Studio VIP) se pune peste el.
    expect(frame?.querySelector(".gcs-avatar")?.getAttribute("data-avatar-user")).toBe("u1");
    expect(frame?.querySelector("img")?.getAttribute("src")).toBe("/files/a1");
    expect(container.querySelector(".gcs-hoverCard__avatar > [data-testid=gcs-hover-dot]")).not.toBeNull();
    unmount();
    const away = render(<GcsHoverCard data={{ ...data, v2: { ...v2, status: { kind: "lastVisit", at: "2026-10-16T08:00:00.000Z" } } }} labels={labels} v2Labels={v2Labels} format={format} />);
    expect(within(away.container).queryByTestId("gcs-hover-dot")).toBeNull();
    expect(away.container.querySelector(".gcs-hoverCard__avatar .gcs-avatarFrame")).toBeNull();
    expect(within(away.container).getByTestId("gcs-hover-status").textContent).toBe("Ultima vizită: acum 3 ore");
  });

  test("„Joacă pe <server>” e un link; ascuns = fără linie", () => {
    const playing = render(<GcsHoverCard data={{ ...data, v2: { ...v2, status: { kind: "playing", server: "Public #1", href: "/servers/1-public" } } }} labels={labels} v2Labels={v2Labels} format={format} />);
    const link = within(playing.container).getByTestId("gcs-hover-status").querySelector("a")!;
    expect(link.textContent).toBe("Joacă pe Public #1");
    expect(link.getAttribute("href")).toBe("/servers/1-public");
    expect(within(playing.container).getByTestId("gcs-hover-dot")).toBeTruthy();
    playing.unmount();
    const hidden = render(<GcsHoverCard data={{ ...data, v2: { ...v2, status: { kind: "hidden" } } }} labels={labels} v2Labels={v2Labels} format={format} />);
    expect(within(hidden.container).queryByTestId("gcs-hover-status")).toBeNull();
    expect(within(hidden.container).queryByTestId("gcs-hover-dot")).toBeNull();
  });

  test("cutia contoarelor: Postări / Reputație / Insigne (numărul tuturor insignelor); arma Studio VIP, a patra", () => {
    const { container, unmount } = card();
    const stats = within(container).getByTestId("gcs-hover-stats");
    expect([...stats.children].map((c) => [c.querySelector("strong")?.textContent, c.querySelector("span")?.textContent])).toEqual([
      ["5120", "Postări"],
      ["+301", "Reputație"],
      ["9", "Insigne"],
    ]);
    unmount();
    // Fără numărătoare (o intrare veche din cache): câte insigne au venit.
    const old = card({ stats: { ...data.stats, badges: undefined }, look: { banner: null, card: null, flair: { icon: "/plugins/x/ak.svg", label: "AK-47" } } });
    const oldStats = within(old.container).getByTestId("gcs-hover-stats");
    expect(within(oldStats).getByTestId("gcs-hover-badge-count").textContent).toBe("1");
    expect(oldStats.children).toHaveLength(4);
    expect(within(oldStats).getByTestId("gcs-hover-weapon").getAttribute("title")).toBe("AK-47");
  });

  test("„Alte grupuri” apare doar când membrul are grupuri secundare, cu iconița fiecăruia în culoarea lui", () => {
    const without = card();
    expect(within(without.container).queryByTestId("gcs-hover-other-groups")).toBeNull();
    without.unmount();
    const { container } = card({ secondaryGroups: [secondary] });
    const row = within(container).getByTestId("gcs-hover-other-groups");
    expect(row.querySelector(".gcs-hoverCard__rowTitle")?.textContent).toBe("Alte grupuri");
    const pill = within(row).getByTestId("gcs-hover-secondary-group");
    expect(pill.textContent).toBe("Clan [ARC]");
    expect(pill.getAttribute("href")).toBe("/members?group=7");
    expect(pill.style.getPropertyValue("--gcs-hoverCard-group")).toBe("#4D9BE6");
    expect(pill.querySelector("svg.gcs-hoverCard__groupIcon")).not.toBeNull();
  });

  test("rândul rangului: emblema, numele, nivelul cu bara; în dreapta ultimele insigne (cercuri colorate) spre tabul „Insigne”", () => {
    const { container } = card({ user: { ...data.user, rank: { name: "Veteran", icon: null } } });
    const row = within(container).getByTestId("gcs-hover-achievement");
    expect(row.querySelector(".gcs-hoverCard__tile img")?.getAttribute("src")).toBe(v2.rankEmblem.art);
    expect(within(row).getByTestId("gcs-hover-rank").textContent).toBe("Veteran");
    const level = within(row).getByTestId("gcs-hover-level");
    expect(level.textContent).toContain("Nivel 40 · 92%");
    expect(within(level).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("92");
    expect(within(level).getByRole("progressbar").getAttribute("aria-label")).toBe("Progresul spre Mit");
    const stack = within(row).getByTestId("gcs-hover-badges");
    expect(stack.getAttribute("href")).toBe("/members/u1-bl1ng?tab=badges");
    expect(stack.getAttribute("aria-label")).toBe("Toate insignele");
    const badge = stack.querySelector<HTMLElement>(".gcs-hoverCard__badge")!;
    expect(badge.classList.contains("gcs-badgeArt__item")).toBe(true);
    expect(badge.getAttribute("title")).toBe("Câștigător chat");
    expect(badge.style.getPropertyValue("--gcs-hoverCard-badge")).toBe("#FFD36A");
  });

  test("fără rang: ultima insignă (cu data obținerii); fără rang și fără insigne: rândul lipsește", () => {
    const latest = card({ v2: { ...v2, level: { level: 0, rank: null, percent: 0, next: null, xp: 0 }, rankEmblem: null } });
    const row = within(latest.container).getByTestId("gcs-hover-achievement");
    expect(within(row).getByTestId("gcs-hover-latest-badge").textContent).toBe("Câștigător chat");
    expect(row.textContent).toContain("Obținută pe 2026-09-25");
    expect(within(row).queryByTestId("gcs-hover-level")).toBeNull();
    latest.unmount();
    const none = card({ badges: [], v2: { ...v2, level: { level: 0, rank: null, percent: 0, next: null, xp: 0 }, rankEmblem: null } });
    expect(within(none.container).queryByTestId("gcs-hover-achievement")).toBeNull();
    expect(none.container.querySelector(".gcs-hoverCard__rows")).toBeNull();
  });

  test("Studio VIP: banner-ul înlocuiește rândul grupului când e același plan; fundalul copertei", () => {
    const look = { banner: { label: "Root Admin", style: { color: "#FFD36A" } }, card: { background: "linear-gradient(90deg, #111, #222)" }, flair: null };
    const { container } = card({ look });
    const el = within(container).getByTestId("gcs-hover-card");
    expect(within(el).queryByTestId("gcs-hover-group")).toBeNull();
    expect(within(el).getByTestId("gcs-hover-vip-banner").textContent).toBe("Root Admin");
    expect(within(el).getByTestId("gcs-hover-cover").getAttribute("data-vip")).toBe("card");
    expect(el.dataset.banner).toBe("image");
  });

  test("câmpurile „pe card”: rânduri cu eticheta în stânga și valoarea în dreapta", () => {
    const { container } = card({ fields: [{ label: "Țară", value: "România" }] });
    const field = within(container).getByTestId("gcs-hover-field");
    expect(field.querySelector(".gcs-hoverCard__rowTitle")?.textContent).toBe("Țară");
    expect(field.querySelector(".gcs-hoverCard__rowValue")?.getAttribute("title")).toBe("România");
  });
});

describe("cardul clasic (fără datele bogate): markup-ul șablonului implicit", () => {
  test("tagul clanului lângă nume, pastila online, cele 4 contoare", () => {
    const { container } = render(<GcsHoverCard data={data} labels={labels} format={format} />);
    const el = within(container).getByTestId("gcs-hover-card");
    expect(el.className).toBe("gcs-card gcs-hoverCard");
    expect(el.querySelector(".gcs-hoverCard__meta [data-testid=gcs-hover-clan]")).not.toBeNull();
    expect(el.querySelector(".gcs-hoverCard__online")).not.toBeNull();
    expect(el.querySelectorAll(".gcs-hoverCard__stats > div")).toHaveLength(4);
    expect(within(container).queryByTestId("gcs-hover-level")).toBeNull();
    expect(within(container).queryByTestId("gcs-hover-joined")).toBeNull();
  });
});

describe("acțiunile cardului (încap în card la orice lățime)", () => {
  const icon = <svg />;

  test("Mesaj cu eticheta, Urmărește / Ignoră ca iconițe pe același rând; „Găsește conținutul lui” pe toată lățimea; moderarea pe rândul ei", () => {
    const { container } = card(
      {},
      <GcsHoverCardActions
        primary={
          <GcsButton variant="primary" size="sm" asChild className="gcs-hoverCard__primary" icon={icon}>
            <a href="/messages/new?to=u1" data-testid="msg">
              <span className="gcs-hoverCard__label">Mesaj</span>
            </a>
          </GcsButton>
        }
        tools={[
          <GcsHoverCardIconAction key="follow" label="Urmărește" icon={icon} aria-pressed={false} data-testid="follow" />,
          <GcsHoverCardIconAction key="ignore" label="Ignoră" icon={icon} aria-pressed={false} data-testid="ignore" />,
        ]}
        wide={
          <GcsButton variant="ghost" size="sm" asChild className="gcs-hoverCard__wide" icon={icon}>
            <a href="/members/u1-bl1ng?tab=activity" data-testid="content">
              <span className="gcs-hoverCard__label">Găsește conținutul lui</span>
            </a>
          </GcsButton>
        }
        extra={
          <span className="gcs-hoverCard__chatMod" role="group" aria-label="Moderare chat" data-testid="staff">
            {["Mute", "Kick din chat", "Avertisment"].map((l) => (
              <GcsHoverCardIconAction key={l} label={l} icon={icon} />
            ))}
          </span>
        }
      />,
    );
    const actions = container.querySelector<HTMLElement>(".gcs-hoverCard__actions")!;
    // Ordinea: rândul membrului, butonul lat, rândul de moderare — toate direct în zona acțiunilor.
    expect([...actions.children].map((c) => c.getAttribute("data-testid"))).toEqual(["gcs-hover-actions", "content", "staff"]);
    const row = within(actions).getByTestId("gcs-hover-actions");
    expect(row.className).toBe("gcs-hoverCard__actionRow");
    expect([...row.children].map((c) => c.getAttribute("data-testid"))).toEqual(["msg", "follow", "ignore"]);
    expect(within(row).getByTestId("msg").textContent).toBe("Mesaj");
    expect(within(row).getByTestId("msg").className).toContain("gcs-hoverCard__primary");
    for (const [id, label] of [
      ["follow", "Urmărește"],
      ["ignore", "Ignoră"],
    ] as const) {
      const b = within(row).getByTestId(id);
      expect(b.className).toContain("gcs-hoverCard__iconBtn");
      expect(b.getAttribute("aria-label")).toBe(label);
      expect(b.getAttribute("data-tip")).toBe(label);
      // Fără text vizibil: doar iconița, ascunsă cititoarelor de ecran.
      expect(b.textContent).toBe("");
      expect(b.querySelector(".gcs-btn__icon")?.getAttribute("aria-hidden")).toBe("true");
    }
    expect(within(row).getByRole("button", { name: "Urmărește" }).getAttribute("aria-pressed")).toBe("false");
    const wide = within(actions).getByRole("link", { name: "Găsește conținutul lui" });
    expect(wide.className).toContain("gcs-hoverCard__wide");
    expect(wide.getAttribute("href")).toBe("/members/u1-bl1ng?tab=activity");
    const staff = within(actions).getByRole("group", { name: "Moderare chat" });
    expect(within(staff).getAllByRole("button").map((b) => [b.getAttribute("aria-label"), b.getAttribute("data-tip"), b.textContent])).toEqual([
      ["Mute", "Mute", ""],
      ["Kick din chat", "Kick din chat", ""],
      ["Avertisment", "Avertisment", ""],
    ]);
  });

  test("fără acțiunile membrului nu rămâne un rând gol (vizitatorul: doar butonul lat și extensiile)", () => {
    const { container } = card({}, <GcsHoverCardActions primary={null} tools={[false, null]} wide={<a href="/x" data-testid="wide" />} extra={<span data-testid="ext" />} />);
    expect(container.querySelector(".gcs-hoverCard__actionRow")).toBeNull();
    expect(within(container).getByTestId("wide").parentElement?.className).toBe("gcs-hoverCard__actions");
    expect(within(container).getByTestId("ext").parentElement?.className).toBe("gcs-hoverCard__actions");
  });
});
