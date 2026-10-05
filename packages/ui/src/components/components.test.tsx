import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { GcsAvatar } from "./GcsAvatar";
import { GcsBadge } from "./GcsBadge";
import { GcsButton } from "./GcsButton";
import { GcsCard } from "./GcsCard";
import { GcsField } from "./GcsField";
import { GcsTable } from "./GcsTable";
import { GcsUserLink } from "./GcsUserLink";

afterEach(() => {
  cleanup();
});

describe("GcsButton", () => {
  test('variant="primary" → clasa gcs-btn--primary și rolul button', () => {
    render(<GcsButton variant="primary">Salvează</GcsButton>);
    const button = screen.getByRole("button", { name: "Salvează" });
    expect(button.classList.contains("gcs-btn")).toBe(true);
    expect(button.classList.contains("gcs-btn--primary")).toBe(true);
    expect(button.getAttribute("type")).toBe("button");
  });

  test('size="sm" și asChild randează copilul cu clasele butonului', () => {
    render(
      <GcsButton variant="ghost" size="sm" asChild>
        <a href="/x">Link</a>
      </GcsButton>,
    );
    const link = screen.getByRole("link", { name: "Link" });
    expect(link.className).toContain("gcs-btn--ghost");
    expect(link.className).toContain("gcs-btn--sm");
  });
});

describe("GcsCard și GcsBadge", () => {
  test("GcsCard randează elementul cerut cu clasa gcs-card", () => {
    const { container } = render(<GcsCard as="section">x</GcsCard>);
    expect(container.querySelector("section.gcs-card")).not.toBeNull();
  });

  test("GcsBadge are clasa tonului", () => {
    render(<GcsBadge tone="vip">VIP</GcsBadge>);
    expect(screen.getByText("VIP").className).toBe("gcs-badge gcs-badge--vip");
  });
});

describe("GcsField", () => {
  test("leagă eticheta de input", () => {
    render(
      <GcsField label="Email">
        <input type="email" />
      </GcsField>,
    );
    const input = screen.getByLabelText("Email");
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  test('cu error → aria-invalid="true" și o descriere care conține textul erorii', () => {
    render(
      <GcsField label="Nume" error="Numele e deja folosit" hint="3–24 caractere">
        <input />
      </GcsField>,
    );
    const input = screen.getByLabelText("Nume");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby")?.split(" ") ?? [];
    const descriptions = describedBy.map((id) => document.getElementById(id)?.textContent);
    expect(descriptions).toContain("Numele e deja folosit");
    expect(descriptions).toContain("3–24 caractere");
  });
});

describe("GcsAvatar", () => {
  test("fără src afișează inițiala", () => {
    render(<GcsAvatar name="Krypt" size="m" />);
    expect(screen.getByText("K")).toBeTruthy();
  });

  test('cu frame="neon" are clasele gcs-avatarFrame gcs-avatarFrame--neon', () => {
    const { container } = render(<GcsAvatar name="Krypt" size="l" frame="neon" />);
    const frame = container.querySelector(".gcs-avatarFrame");
    expect(frame?.classList.contains("gcs-avatarFrame--neon")).toBe(true);
    expect((frame as HTMLElement).style.width).toBe("104px");
  });

  test("cu src afișează imaginea, cu numele ca text alternativ", () => {
    render(<GcsAvatar name="Krypt" size="s" src="https://cdn.example/k.png" />);
    expect(screen.getByRole("img", { name: "Krypt" }).getAttribute("src")).toBe("https://cdn.example/k.png");
  });
});

describe("GcsUserLink", () => {
  test('groupKey="vip_gold" → clasa gcs-name--vip_gold', () => {
    render(<GcsUserLink userId="u1" name="ShadowRO" groupKey="vip_gold" href="/members/u1-shadowro" />);
    const link = screen.getByRole("link", { name: "ShadowRO" });
    expect(link.className).toBe("gcs-userLink gcs-name--vip_gold");
    expect(link.getAttribute("href")).toBe("/members/u1-shadowro");
    expect(link.getAttribute("data-user-id")).toBe("u1");
  });
});

describe("GcsTable", () => {
  type Row = { id: number; name: string };
  const columns = [
    { key: "id" as const, header: "ID" },
    { key: "name" as const, header: "Nume", render: (r: Row) => <strong>{r.name}</strong> },
  ];

  test("rows=[] → afișează textul din empty", () => {
    render(<GcsTable<Row> columns={columns} rows={[]} empty="Niciun membru" />);
    expect(screen.getByText("Niciun membru")).toBeTruthy();
  });

  test("randează antetul și rândurile, cu render custom", () => {
    render(<GcsTable<Row> columns={columns} rows={[{ id: 1, name: "Krypt" }]} empty="-" />);
    expect(screen.getByRole("columnheader", { name: "Nume" })).toBeTruthy();
    expect(screen.getByText("Krypt").tagName).toBe("STRONG");
  });
});
