import { describe, expect, test } from "vitest";
import { isQueryableAddress, normalizeHost, parseAllowNets, resolveTarget } from "./net";

describe("host-ul scris de admin", () => {
  test("IP-uri și nume de domeniu publice, normalizate", () => {
    expect(normalizeHost(" Play.Example.COM. ")).toBe("play.example.com");
    expect(normalizeHost("203.0.113.10")).toBe("203.0.113.10");
    expect(normalizeHost("[2001:DB8::1]")).toBe("2001:db8::1");
    expect(normalizeHost("xn--crcium-zsa.ro")).toBe("xn--crcium-zsa.ro");
  });

  test("refuză schema, calea, portul, spațiile, numele dintr-o etichetă, terminațiile interne și IP-urile scrise greșit", () => {
    for (const bad of ["http://a.com", "a.com/x", "a.com:27015", "a b.com", "localhost", "server", "db.internal", "nas.local", "x.localhost", "10.0.1", "-a.com", "a..com", "", 42, "a".repeat(254)]) {
      expect(normalizeHost(bad), String(bad)).toBeNull();
    }
  });
});

describe("adresele interogate (garda anti-SSRF)", () => {
  test("internetul public trece; loopback, private, link-local, CGNAT, multicast, IPv4 mapat nu", () => {
    expect(isQueryableAddress("8.8.8.8")).toBe(true);
    expect(isQueryableAddress("2606:4700:4700::1111")).toBe(true);
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.5", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "nu-e-ip"]) {
      expect(isQueryableAddress(ip), ip).toBe(false);
    }
  });

  test("excepția operatorului (CIDR-uri) permite rețele private, dar niciodată link-local sau multicast", () => {
    const allow = parseAllowNets("127.0.0.1/32, 10.0.0.0/8 169.254.0.0/16 224.0.0.0/4 fe80::/10 nu-e-retea 300.1.1.1/8 10.0.0.0/99");
    expect(isQueryableAddress("127.0.0.1", allow)).toBe(true);
    expect(isQueryableAddress("::ffff:127.0.0.1", allow)).toBe(true);
    expect(isQueryableAddress("10.20.30.40", allow)).toBe(true);
    expect(isQueryableAddress("127.0.0.2", allow)).toBe(false);
    expect(isQueryableAddress("192.168.0.1", allow)).toBe(false);
    expect(isQueryableAddress("169.254.169.254", allow)).toBe(false);
    expect(isQueryableAddress("224.0.0.1", allow)).toBe(false);
    expect(isQueryableAddress("fe80::1", allow)).toBe(false);
    expect(parseAllowNets("")).toBeNull();
    expect(parseAllowNets("nimic valid")).toBeNull();
  });

  test("numele se rezolvă o dată și toate adresele trebuie permise; IPv4 are prioritate", async () => {
    const lookup = (map: Record<string, { address: string; family: 4 | 6 }[]>) => async (host: string) => {
      if (!map[host]) throw new Error("ENOTFOUND");
      return map[host]!;
    };
    const dns = lookup({
      "ok.example.com": [
        { address: "2606:4700::1", family: 6 },
        { address: "93.184.216.34", family: 4 },
      ],
      "mixt.example.com": [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
      "gol.example.com": [],
    });
    await expect(resolveTarget("ok.example.com", { lookup: dns })).resolves.toEqual({ address: "93.184.216.34", family: 4 });
    await expect(resolveTarget("mixt.example.com", { lookup: dns })).rejects.toThrow("blocked");
    await expect(resolveTarget("gol.example.com", { lookup: dns })).rejects.toThrow("dns");
    await expect(resolveTarget("lipsa.example.com", { lookup: dns })).rejects.toThrow("dns");
    await expect(resolveTarget("192.168.0.10", { lookup: dns })).rejects.toThrow("blocked");
    await expect(resolveTarget("127.0.0.1", { allow: parseAllowNets("127.0.0.1") })).resolves.toEqual({ address: "127.0.0.1", family: 4 });
  });
});
