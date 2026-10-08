import dns from "node:dns";
import { BlockList, isIP } from "node:net";
import { isPublicAddress } from "@gcs/core";
import { serversAllowNets, type GcsResolvedAddress } from "../../net";

/**
 * Garda SSRF a demo-urilor (specul 2026-10-08-servere-hltv §6): aducerea (FTP / FTPS / SFTP / HTTP), „Testează
 * conexiunea” și rcon-ul HLTV merg doar la host-ul configurat, rezolvat o singură dată și verificat: adrese publice;
 * private doar în excepția operatorului (`GCS_SERVERS_ALLOW_NETS`, ca interogările); loopback doar în afara producției
 * (dezvoltarea, testele); link-local (metadatele cloud-urilor), multicast și nespecificat niciodată.
 */

/** O eroare a fluxului demo-urilor, cu un cod stabil (afișat în ACP, fără detalii sensibile). */
export class GcsDemoError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GcsDemoError";
  }
}

const HARD_V4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["169.254.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  HARD_V4.addSubnet(address, prefix, "ipv4");
}
const HARD_V6 = new BlockList();
for (const [address, prefix] of [
  ["::", 128],
  ["fe80::", 10],
  ["ff00::", 8],
  ["fd00:ec2::254", 128],
] as const) {
  HARD_V6.addSubnet(address, prefix, "ipv6");
}
const LOOPBACK_V4 = new BlockList();
LOOPBACK_V4.addSubnet("127.0.0.0", 8, "ipv4");

/** Producția: `NODE_ENV=production`, mai puțin instanțele de test (`GCS_TEST_ROUTES=1`). */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" && process.env.GCS_TEST_ROUTES !== "1";
}

export type GcsDemoGuardOptions = { allow: BlockList | null; production: boolean };

/** Opțiunile din mediul procesului. */
export function demoGuardOptions(): GcsDemoGuardOptions {
  return { allow: serversAllowNets(), production: isProductionRuntime() };
}

/** Adresa (IP) se poate folosi pentru demo-uri / rcon. */
export function demoAddressAllowed(ip: string, opts: GcsDemoGuardOptions): boolean {
  const address = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1] ?? ip;
  const family = isIP(address);
  if (family === 0) return false;
  const type = family === 6 ? "ipv6" : "ipv4";
  if ((family === 4 ? HARD_V4 : HARD_V6).check(address, type)) return false;
  if (isPublicAddress(address)) return true;
  const loopback = family === 4 ? LOOPBACK_V4.check(address, "ipv4") : address === "::1";
  if (loopback && opts.production) return false;
  return opts.allow?.check(address, type) ?? false;
}

export type GcsDemoLookup = (host: string) => Promise<GcsResolvedAddress[]>;

const systemLookup: GcsDemoLookup = async (host) =>
  (await dns.promises.lookup(host, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));

/**
 * Adresa la care se conectează: un IP scris direct se verifică pe loc; un nume se rezolvă o dată și **toate** adresele
 * lui trebuie permise (altfel `blocked`). Conexiunea merge apoi la IP-ul întors (fără a doua rezolvare). Se preferă IPv4.
 */
export async function resolveDemoHost(host: string, opts: GcsDemoGuardOptions & { lookup?: GcsDemoLookup }): Promise<GcsResolvedAddress> {
  const family = isIP(host);
  if (family !== 0) {
    if (!demoAddressAllowed(host, opts)) throw new GcsDemoError("blocked");
    return { address: host, family: family === 6 ? 6 : 4 };
  }
  let list: GcsResolvedAddress[];
  try {
    list = await (opts.lookup ?? systemLookup)(host);
  } catch {
    throw new GcsDemoError("dns");
  }
  if (list.length === 0) throw new GcsDemoError("dns");
  if (list.some((a) => !demoAddressAllowed(a.address, opts))) throw new GcsDemoError("blocked");
  return list.find((a) => a.family === 4) ?? list[0]!;
}
