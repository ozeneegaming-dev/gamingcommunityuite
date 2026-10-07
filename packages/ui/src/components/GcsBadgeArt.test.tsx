import { render, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { GcsBadgeArt } from "./GcsBadgeArt";
import { GcsHoverCard, type GcsHoverCardData } from "./GcsHoverCard";

const art = "/badge-art/v1/medal-bronze-5ea2ff-i-solid-pen-nib.svg";

describe("GcsBadgeArt", () => {
  test("insigna generată, cu numele ca text alternativ și mărimea din scară", () => {
    const { container } = render(<GcsBadgeArt badge={{ name: "Primul post", art }} size={64} />);
    const img = within(container).getByRole("img", { name: "Primul post" });
    expect(img.getAttribute("src")).toBe(art);
    expect(img.getAttribute("width")).toBe("64");
    expect(img.className).toBe("gcs-badgeArt gcs-badgeArt--64");
  });

  test("imaginea proprie are prioritate; blocat și decorativ", () => {
    const { container } = render(<GcsBadgeArt badge={{ name: "VIP", art, image: "/files/abc" }} size={24} locked decorative />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/files/abc");
    expect(img.getAttribute("alt")).toBe("");
    expect(img.className).toBe("gcs-badgeArt gcs-badgeArt--24 gcs-badgeArt--image gcs-badgeArt--locked");
  });
});

describe("GcsHoverCard: insignele", () => {
  test("rândul de insigne arată imaginile, cu numele și descrierea în `title`", () => {
    const data: GcsHoverCardData = {
      user: {
        id: "u1",
        name: "Mara",
        image: null,
        nameKey: "member",
        frameKey: null,
        slug: "mara",
        bio: "",
        accentColor: null,
        cover: null,
        group: { name: "Membri", color: null },
        rank: null,
      },
      stats: { posts: 1, reputation: 0, followers: 0, joinedAt: "2026-01-01T00:00:00Z" },
      online: { online: false },
      badges: [{ key: "first_post", name: "Primul post", description: "Primul mesaj", art, image: null }],
      fields: [],
    };
    const { container } = render(<GcsHoverCard data={data} labels={{ posts: "P", reputation: "R", followers: "F", online: "O", joined: "J" }} format={{ number: String, year: (iso) => iso.slice(0, 4) }} />);
    const img = within(container).getByRole("img", { name: "Primul post" });
    expect(img.getAttribute("src")).toBe(art);
    expect(img.closest("li")?.getAttribute("title")).toBe("Primul post\nPrimul mesaj");
  });
});
