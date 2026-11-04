import { createHash } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { downloadMarketPackage, fetchMarketCatalog, fetchMarketOrderStatus, parseMarketItem, placeMarketOrder } from "./marketplace";

const opts = (fetchImpl: typeof fetch) => ({ token: "GCS1.a.b", domain: "forum.exemplu.ro", server: "https://dc.test", fetch: fetchImpl });
const reply = (body: unknown, init: ResponseInit = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init })) as unknown as typeof fetch;
const ORDER = "a".repeat(32);

const item = (over: Record<string, unknown> = {}) => ({
  id: 3,
  slug: "chat-pro",
  category: "application",
  kind: "app",
  key: "chat_pro",
  name: "Chat Pro",
  short: "Seven layouts.",
  description: "Para",
  changelog: "",
  vendor: "GamingCommunitySuite",
  official: true,
  version: "1.2.0",
  minGcs: null,
  price: { cents: 1999, currency: "EUR" },
  icon: "https://dc.test/marketplace-media/a.png",
  cover: "https://dc.test/marketplace-media/b.png",
  screenshots: ["https://dc.test/marketplace-media/c.png"],
  package: null,
  featured: true,
  updatedAt: "2026-11-04T10:00:00Z",
  owned: false,
  included: false,
  order: null,
  ...over,
});

describe("parseMarketItem", () => {
  test("un element bun trece neschimbat", () => {
    expect(parseMarketItem(item())).toMatchObject({ id: 3, kind: "app", key: "chat_pro", price: { cents: 1999, currency: "EUR" }, screenshots: ["https://dc.test/marketplace-media/c.png"] });
  });
  test("adresele care nu sunt https cad (imaginile din pagina ACP)", () => {
    const parsed = parseMarketItem(item({ icon: "javascript:alert(1)", cover: "http://dc.test/x.png", screenshots: ["data:image/png;base64,AA", "https://dc.test/ok.png", 5] }));
    expect(parsed).toMatchObject({ icon: null, cover: null, screenshots: ["https://dc.test/ok.png"] });
  });
  test("prețul, moneda și tipul greșite cad pe valori sigure", () => {
    expect(parseMarketItem(item({ price: { cents: -5, currency: "euro" }, kind: "x" }))).toMatchObject({ price: { cents: 0, currency: "EUR" }, kind: "package" });
  });
  test("o comandă cu id greșit sau pagină de plată pe http e ignorată", () => {
    expect(parseMarketItem(item({ order: { id: "x", status: "pending", checkoutUrl: "https://dc.test/c" } }))?.order).toBeNull();
    expect(parseMarketItem(item({ order: { id: ORDER, status: "pending", checkoutUrl: "http://dc.test/c" } }))?.order).toBeNull();
    expect(parseMarketItem(item({ order: { id: ORDER, status: "pending", checkoutUrl: "https://dc.test/c" } }))?.order).toEqual({ id: ORDER, status: "pending", checkoutUrl: "https://dc.test/c" });
  });
  test("fără id sau nume: aruncat", () => {
    expect(parseMarketItem({ name: "x" })).toBeNull();
    expect(parseMarketItem(null)).toBeNull();
  });
});

describe("fetchMarketCatalog", () => {
  test("trimite tokenul și domeniul și întoarce catalogul", async () => {
    const f = reply({ ok: true, items: [item(), { bad: true }], categories: { application: "Applications", "BAD KEY": "x" }, payments: { card: true }, token: "GCS1.new.sig" });
    const res = await fetchMarketCatalog(opts(f));
    expect(res).toMatchObject({ ok: true, card: true, categories: { application: "Applications" }, token: "GCS1.new.sig" });
    if (res.ok) expect(res.items).toHaveLength(1);
    const [url, init] = (f as unknown as { mock: { calls: [URL, RequestInit][] } }).mock.calls[0]!;
    expect(String(url)).toBe("https://dc.test/api/marketplace/catalog");
    expect(JSON.parse(String(init.body))).toEqual({ token: "GCS1.a.b", domain: "forum.exemplu.ro" });
  });
  test("erorile licenței trec mai departe; cele necunoscute devin unreachable", async () => {
    expect(await fetchMarketCatalog(opts(reply({ ok: false, error: "licence_unmanaged" })))).toEqual({ ok: false, error: "licence_unmanaged" });
    expect(await fetchMarketCatalog(opts(reply({ ok: false, error: "<script>" })))).toEqual({ ok: false, error: "unreachable" });
    expect(await fetchMarketCatalog(opts(reply({}, { status: 503 })))).toEqual({ ok: false, error: "unreachable" });
    expect(await fetchMarketCatalog(opts(vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch))).toEqual({ ok: false, error: "unreachable" });
  });
  test("fără server (GCS_LICENSE_SERVER=off) → disabled", async () => {
    expect(await fetchMarketCatalog({ ...opts(reply({})), server: "" })).toEqual({ ok: false, error: "disabled" });
  });
});

describe("placeMarketOrder / fetchMarketOrderStatus", () => {
  test("comanda în așteptare are pagina de plată", async () => {
    const res = await placeMarketOrder(3, opts(reply({ ok: true, status: "pending", order: { id: ORDER, status: "pending", checkoutUrl: "https://dc.test/marketplace/checkout?o=" + ORDER } })));
    expect(res).toEqual({ ok: true, status: "pending", order: { id: ORDER, status: "pending", checkoutUrl: "https://dc.test/marketplace/checkout?o=" + ORDER } });
  });
  test("în așteptare fără pagină de plată validă → unreachable", async () => {
    expect(await placeMarketOrder(3, opts(reply({ ok: true, status: "pending" })))).toEqual({ ok: false, error: "unreachable" });
  });
  test("gratuit: paid, cu tokenul nou", async () => {
    expect(await placeMarketOrder(3, opts(reply({ ok: true, status: "paid", token: "GCS1.n.s" })))).toEqual({ ok: true, status: "paid", token: "GCS1.n.s" });
  });
  test("starea: id greșit nu pleacă la Data Center", async () => {
    const f = reply({ ok: true, status: "paid" });
    expect(await fetchMarketOrderStatus("../x", opts(f))).toEqual({ ok: false, error: "not_found" });
    expect(f).not.toHaveBeenCalled();
    expect(await fetchMarketOrderStatus(ORDER, opts(f))).toEqual({ ok: true, status: "paid" });
  });
});

describe("downloadMarketPackage", () => {
  const zip = Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(100, 7)]);
  const sha = createHash("sha256").update(zip).digest("hex");
  const zipReply = (data: Buffer, headers: Record<string, string> = {}) => vi.fn(async () => new Response(new Uint8Array(data), { status: 200, headers: { "Content-Type": "application/zip", ...headers } })) as unknown as typeof fetch;
  test("pachetul cu amprenta din catalog", async () => {
    const res = await downloadMarketPackage(3, sha, opts(zipReply(zip)));
    expect(res.ok && res.data.equals(zip)).toBe(true);
  });
  test("altă amprentă → bad_package", async () => {
    expect(await downloadMarketPackage(3, "0".repeat(64), opts(zipReply(zip)))).toEqual({ ok: false, error: "bad_package" });
  });
  test("prea mare (antetul) → bad_package", async () => {
    expect(await downloadMarketPackage(3, sha, opts(zipReply(zip, { "Content-Length": String(65 * 1024 * 1024) })))).toEqual({ ok: false, error: "bad_package" });
  });
  test("răspuns JSON cu eroarea", async () => {
    expect(await downloadMarketPackage(3, sha, opts(reply({ ok: false, error: "not_owned" })))).toEqual({ ok: false, error: "not_owned" });
  });
});
