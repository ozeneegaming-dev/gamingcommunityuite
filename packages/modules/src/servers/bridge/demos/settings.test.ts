import { describe, expect, it } from "vitest";
import { hostKeyError, httpFolderUrl, httpTemplateError, parseTvAddress, prefixError, privateKeyError, rconPasswordError, remoteDirError, steamConnectUrl, usernameError } from "./settings";

/** Validarea setărilor „HLTV / GOTV și demo-uri” (specul 2026-10-08-servere-hltv §2.1, §3, §4). */
describe("setările HLTV / GOTV", () => {
  it("adresa de vizionare: host:port (IPv4 sau nume public), port 1–65535; legătura steam://connect", () => {
    expect(parseTvAddress("")).toBeNull();
    expect(parseTvAddress(" 217.156.22.86:27020 ")).toEqual({ host: "217.156.22.86", port: 27020, value: "217.156.22.86:27020" });
    expect(parseTvAddress("TV.Exemplu.ro:27020")).toEqual({ host: "tv.exemplu.ro", port: 27020, value: "tv.exemplu.ro:27020" });
    for (const bad of ["217.156.22.86", "217.156.22.86:0", "217.156.22.86:70000", "localhost:27020", "http://x.ro:27020", "x.ro:27020/a", "[::1]:27020", "a b.ro:1", "x.ro:27020;quit"]) {
      expect(parseTvAddress(bad), bad).toBe("invalid");
    }
    expect(steamConnectUrl("217.156.22.86:27020")).toBe("steam://connect/217.156.22.86:27020");
  });

  it("șablonul HTTP: http(s), `{file}` = ultimul segment al căii, fără nume / parolă, query sau spații; folderul = șablonul fără `{file}`", () => {
    expect(httpTemplateError("https://demos.exemplu.ro/cs/{file}")).toBeNull();
    expect(httpTemplateError("http://198.51.100.5:8080/hltv/{file}")).toBeNull();
    const bad = ["", "ftp://x.ro/{file}", "https://x.ro/demos/", "https://{file}.x.ro/", "https://x.ro/{file}/{file}", "https://x.ro/mix-{file}", "https://x.ro/{file}/a", "https://u:p@x.ro/{file}"];
    bad.push("https://x.ro/a b/{file}", "https://x.ro/?f={file}", "https://x.ro/d/{file}?x=1", `https://x.ro/${"a".repeat(500)}/{file}`, "https://x.ro/\"/{file}");
    for (const b of bad) expect(httpTemplateError(b), b).not.toBeNull();
    expect(httpFolderUrl("https://demos.exemplu.ro/cs/{file}")).toBe("https://demos.exemplu.ro/cs/");
    expect(httpFolderUrl("http://198.51.100.5:8080/{file}")).toBe("http://198.51.100.5:8080/");
  });

  it("folderul, prefixul, utilizatorul, amprenta SFTP, cheia privată, parola rcon", () => {
    expect(remoteDirError("/cstrike/demos")).toBeNull();
    expect(remoteDirError("demos")).toBeNull();
    for (const bad of ["/a/../b", "..", "/a\nb", `/${"a".repeat(300)}`, "/a\"b"]) expect(remoteDirError(bad), bad).not.toBeNull();
    expect(prefixError("")).toBeNull();
    expect(prefixError("mix_tv-1")).toBeNull();
    expect(prefixError("mix tv")).not.toBeNull();
    expect(prefixError("a".repeat(33))).not.toBeNull();
    expect(usernameError("hltv")).toBeNull();
    expect(usernameError("")).not.toBeNull();
    expect(usernameError("a\tb")).not.toBeNull();
    expect(hostKeyError("")).toBeNull();
    expect(hostKeyError("SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8")).toBeNull();
    expect(hostKeyError("MD5:aa:bb")).not.toBeNull();
    expect(privateKeyError("-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n")).toBeNull();
    expect(privateKeyError("ssh-ed25519 AAAA… public")).not.toBeNull();
    expect(privateKeyError(`-----BEGIN RSA PRIVATE KEY-----\n${"A".repeat(17_000)}\n-----END RSA PRIVATE KEY-----`)).not.toBeNull();
    expect(rconPasswordError("parola-hltv")).toBeNull();
    for (const bad of ["", "a\"b", "a\nb", "a".repeat(65)]) expect(rconPasswordError(bad), JSON.stringify(bad)).not.toBeNull();
  });
});
