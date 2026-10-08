import { describe, expect, it } from "vitest";
import { parseAllowNets } from "../../net";
import { demoAddressAllowed, GcsDemoError, resolveDemoHost } from "./guard";

const allowLocal = parseAllowNets("127.0.0.1/32, 10.0.0.0/8");

/**
 * Garda SSRF a aducerii demo-urilor și a rcon-ului (specul 2026-10-08-servere-hltv §6): doar adrese publice; privat doar
 * în excepția operatorului; loopback doar în afara producției; link-local / multicast / metadatele niciodată.
 */
describe("garda adreselor demo-urilor", () => {
  it("adresele publice trec; cele private doar în excepția operatorului", () => {
    expect(demoAddressAllowed("217.156.22.86", { allow: null, production: true })).toBe(true);
    expect(demoAddressAllowed("2a00:1450:4001:80b::200e", { allow: null, production: true })).toBe(true);
    expect(demoAddressAllowed("10.1.2.3", { allow: null, production: false })).toBe(false);
    expect(demoAddressAllowed("10.1.2.3", { allow: allowLocal, production: true })).toBe(true);
    expect(demoAddressAllowed("192.168.1.5", { allow: allowLocal, production: true })).toBe(false);
  });

  it("loopback: doar cu excepția operatorului și doar în afara producției", () => {
    expect(demoAddressAllowed("127.0.0.1", { allow: null, production: false })).toBe(false);
    expect(demoAddressAllowed("127.0.0.1", { allow: allowLocal, production: false })).toBe(true);
    expect(demoAddressAllowed("127.0.0.1", { allow: allowLocal, production: true })).toBe(false);
    expect(demoAddressAllowed("::ffff:127.0.0.1", { allow: allowLocal, production: true })).toBe(false);
    expect(demoAddressAllowed("::1", { allow: parseAllowNets("::1/128"), production: true })).toBe(false);
  });

  it("link-local (metadatele cloud-ului), multicast, nespecificat: niciodată", () => {
    const all = parseAllowNets("0.0.0.0/0, ::/0");
    for (const ip of ["169.254.169.254", "fe80::1", "224.0.0.1", "0.0.0.0", "::", "fd00:ec2::254"]) {
      expect(demoAddressAllowed(ip, { allow: all, production: false }), ip).toBe(false);
    }
    expect(demoAddressAllowed("not-an-ip", { allow: all, production: false })).toBe(false);
  });

  it("numele se rezolvă o dată și toate adresele lui trebuie permise (fără DNS rebinding); IPv4 preferat", async () => {
    const lookup = async (host: string) => {
      if (host === "demos.exemplu.ro") return [{ address: "2a00:1450:4001:80b::200e", family: 6 as const }, { address: "217.156.22.86", family: 4 as const }];
      if (host === "mixt.exemplu.ro") return [{ address: "217.156.22.86", family: 4 as const }, { address: "10.0.0.5", family: 4 as const }];
      throw new Error("ENOTFOUND");
    };
    expect(await resolveDemoHost("demos.exemplu.ro", { lookup, allow: null, production: true })).toEqual({ address: "217.156.22.86", family: 4 });
    await expect(resolveDemoHost("mixt.exemplu.ro", { lookup, allow: null, production: true })).rejects.toMatchObject({ code: "blocked" });
    await expect(resolveDemoHost("lipsa.exemplu.ro", { lookup, allow: null, production: true })).rejects.toMatchObject({ code: "dns" });
    await expect(resolveDemoHost("10.0.0.5", { lookup, allow: null, production: true })).rejects.toBeInstanceOf(GcsDemoError);
    expect(await resolveDemoHost("10.0.0.5", { lookup, allow: allowLocal, production: true })).toEqual({ address: "10.0.0.5", family: 4 });
  });
});
