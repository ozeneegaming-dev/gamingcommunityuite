import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bodyHash, canonicalString, generateBridgeKey, parseBridgeKey, signBridgeRequest, signingKeyOf, verifyBridgeSignature } from "./signing";

describe("cheile și semnarea cererilor (§5)", () => {
  it("cheia: gcs1.<keyId>.<secret>, keyId de 12 caractere [a-z0-9], secretul 32 de octeți base64url", () => {
    const key = generateBridgeKey();
    expect(key.keyId).toMatch(/^[a-z0-9]{12}$/);
    expect(Buffer.from(key.secret, "base64url")).toHaveLength(32);
    expect(key.token).toBe(`gcs1.${key.keyId}.${key.secret}`);
    expect(key.signingKey).toBe(createHash("sha256").update(key.secret).digest("hex"));
    expect(parseBridgeKey(key.token)).toEqual({ keyId: key.keyId, secret: key.secret });
    expect(parseBridgeKey("gcs2.abc.def")).toBeNull();
    expect(parseBridgeKey(`gcs1.${key.keyId}`)).toBeNull();
    expect(generateBridgeKey().keyId).not.toBe(key.keyId);
  });

  it("șirul canonic: METODĂ, CALE (cu query), TIMESTAMP, NONCE, hash-ul corpului (corpul gol = hash-ul șirului gol)", () => {
    const empty = createHash("sha256").update("").digest("hex");
    expect(bodyHash("")).toBe(empty);
    expect(canonicalString("get", "/sanctions?since=120", 1791460800, "nonce-123456789012", "")).toBe(`GET\n/sanctions?since=120\n1791460800\nnonce-123456789012\n${empty}`);
  });

  it("hmac-sha256 cu K (hex, ca octeți ASCII) și sha256-env = SHA-256(K \\n canonic \\n K)", () => {
    const K = signingKeyOf("secret");
    const canonical = canonicalString("POST", "/heartbeat", 1791460800, "abcdefghijklmnop", '{"a":1}');
    const hmac = createHmac("sha256", Buffer.from(K, "ascii")).update(canonical).digest("hex");
    const env = createHash("sha256").update(`${K}\n${canonical}\n${K}`).digest("hex");
    expect(verifyBridgeSignature(K, canonical, `hmac-sha256=${hmac}`)).toBe(true);
    expect(verifyBridgeSignature(K, canonical, `sha256-env=${env}`)).toBe(true);
    expect(verifyBridgeSignature(K, canonical, `sha256-env=${hmac}`)).toBe(false);
    expect(verifyBridgeSignature(signingKeyOf("alt"), canonical, `hmac-sha256=${hmac}`)).toBe(false);
    expect(verifyBridgeSignature(K, canonical, `hmac-sha256=${hmac.toUpperCase()}`)).toBe(true);
    expect(verifyBridgeSignature(K, canonical, "md5=abc")).toBe(false);
    expect(verifyBridgeSignature(K, canonical, `hmac-sha256=${hmac.slice(2)}`)).toBe(false);
  });

  it("signBridgeRequest dă anteturile complete, pe care verificarea le acceptă", () => {
    const key = generateBridgeKey();
    const headers = signBridgeRequest({ token: key.token, method: "POST", path: "/events", body: '{"events":[]}', timestamp: 1791460800, nonce: "n".repeat(16), alg: "sha256-env" });
    expect(headers).toMatchObject({ "X-GCS-Key": key.keyId, "X-GCS-Timestamp": "1791460800", "X-GCS-Nonce": "n".repeat(16) });
    const canonical = canonicalString("POST", "/events", 1791460800, "n".repeat(16), '{"events":[]}');
    expect(verifyBridgeSignature(key.signingKey, canonical, headers["X-GCS-Signature"])).toBe(true);
  });
});
