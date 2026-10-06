import { generateSigningKey, packPlugin } from "@gcs/plugin-sdk/pack";
import { describe, expect, test } from "vitest";
import { testPluginFiles } from "../../test/pluginFixtures";
import { ed25519PublicKey, PLUGIN_SIGNATURE_FILE, trustedPluginKeys, verifyPluginSignature } from "./signature";
import { readPluginZip } from "./zip";

const market = generateSigningKey();
const other = generateSigningKey();
const trusted = trustedPluginKeys(`market=${market.publicKeyBase64}`).keys;
const signed = (files = testPluginFiles(), key = market) => readPluginZip(packPlugin(files, { sign: { keyId: "market", privateKey: key.privateKeyPem } }));

describe("semnătura Ed25519 a pachetelor", () => {
  test("pachetul semnat cu o cheie de încredere e valid", () => {
    expect(verifyPluginSignature(signed(), trusted)).toEqual({ status: "signed", keyId: "market" });
  });

  test("un fișier modificat după semnare invalidează pachetul", () => {
    const files = signed();
    files.set("server.mjs", Buffer.from("export default { widgets: { hello: () => '<p>altceva</p>' } };"));
    expect(verifyPluginSignature(files, trusted)).toEqual({ status: "invalid", keyId: "market", reason: "mismatch" });
  });

  test("un fișier adăugat sau șters invalidează pachetul", () => {
    const added = signed();
    added.set("assets/extra.js", Buffer.from("alert(1)"));
    expect(verifyPluginSignature(added, trusted).status).toBe("invalid");
    const removed = signed();
    removed.delete("lang/en.json");
    expect(verifyPluginSignature(removed, trusted).status).toBe("invalid");
  });

  test("semnat cu altă cheie sub același id → invalid; cheie necunoscută → nesemnat", () => {
    expect(verifyPluginSignature(signed(testPluginFiles(), other), trusted)).toMatchObject({ status: "invalid", reason: "mismatch" });
    const unknown = readPluginZip(packPlugin(testPluginFiles(), { sign: { keyId: "someone", privateKey: other.privateKeyPem } }));
    expect(verifyPluginSignature(unknown, trusted)).toEqual({ status: "unsigned", keyId: "someone" });
    expect(verifyPluginSignature(testPluginFiles(), trusted)).toEqual({ status: "unsigned" });
  });

  test("un fișier de semnătură stricat e invalid", () => {
    for (const content of ["nu e json", JSON.stringify({ algorithm: "rsa", keyId: "market", signature: "AA==" }), JSON.stringify({ algorithm: "ed25519", keyId: "market", signature: "AAAA" })]) {
      const files = signed();
      files.set(PLUGIN_SIGNATURE_FILE, Buffer.from(content));
      expect(verifyPluginSignature(files, trusted)).toMatchObject({ status: "invalid", reason: "malformed" });
    }
  });

  test("cheile de încredere din mediu: intrările invalide se ignoră", () => {
    const parsed = trustedPluginKeys(` a=${market.publicKeyBase64}, b=nu-e-cheie , fara-egal, c d=${other.publicKeyBase64}`);
    expect([...parsed.keys.keys()]).toEqual(["a"]);
    expect(parsed.invalid).toEqual(["b", "fara-egal", "c d"]);
    expect(ed25519PublicKey(Buffer.alloc(31).toString("base64"))).toBeNull();
  });
});
