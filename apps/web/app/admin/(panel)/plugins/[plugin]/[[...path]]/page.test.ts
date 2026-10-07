import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Pagina ACP a unui plugin, cu dependențele de request (cookie-ul modului sigur, sesiunea, traducerile) înlocuite.
const mocks = vi.hoisted(() => ({
  safeMode: false,
  renderPage: vi.fn(),
  pluginHost: vi.fn(),
  requireAcpSection: vi.fn(),
}));

vi.mock("@/lib/plugins", () => ({
  safeModeActive: async () => mocks.safeMode,
  pluginHost: mocks.pluginHost,
  pluginKeyParam: (raw: string) => raw,
  pluginQuery: () => ({}),
}));
vi.mock("@/lib/acp", () => ({ requireAcpSection: mocks.requireAcpSection }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => "ro" }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not_found");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("@gcs/ui", () => ({ GcsCard: "section" }));
vi.mock("@gcs/ui/icons", () => ({ GcsIcon: "i" }));
vi.mock("../../../_components/GcsAcpTitle", () => ({ GcsAcpTitle: "h1" }));

const { default: AcpPluginPage, generateMetadata } = await import("./page");

const props = { params: Promise.resolve({ plugin: "demo", path: ["setari"] }), searchParams: Promise.resolve({}) };

beforeEach(() => {
  mocks.safeMode = false;
  mocks.renderPage.mockReset().mockResolvedValue({ status: 200, title: "Demo", icon: "fa-solid fa-puzzle-piece", html: "<p>x</p>", styles: ["/p-assets/demo/a.css"] });
  mocks.pluginHost.mockReset().mockResolvedValue({ renderPage: mocks.renderPage });
  mocks.requireAcpSection.mockReset().mockResolvedValue({ actor: { userId: "root" } });
});

describe("pagina ACP a unui plugin", () => {
  test("în modul sigur nu rulează codul pluginului și nu încarcă CSS-ul lui: doar anunțul modului sigur", async () => {
    mocks.safeMode = true;
    const page = (await AcpPluginPage(props)) as ReactElement<Record<string, unknown>>;
    expect(page.props["data-testid"]).toBe("gcs-plugin-safe-mode");
    expect(JSON.stringify(page)).not.toContain("a.css");
    expect(await generateMetadata(props)).toEqual({ title: undefined });
    expect(mocks.pluginHost).not.toHaveBeenCalled();
    expect(mocks.renderPage).not.toHaveBeenCalled();
    // Dreptul ACP pe secțiunea pluginului se verifică și în modul sigur.
    expect(mocks.requireAcpSection).toHaveBeenCalledWith("plugin.demo");
  });

  test("fără modul sigur, pagina e randată de plugin, cu stilurile lui", async () => {
    const page = (await AcpPluginPage(props)) as ReactElement<{ children: unknown }>;
    expect(mocks.renderPage).toHaveBeenCalledWith("demo", "/setari", expect.objectContaining({ area: "acp" }));
    expect(JSON.stringify(page)).toContain("/p-assets/demo/a.css");
  });
});
