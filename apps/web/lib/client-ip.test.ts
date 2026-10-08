import { describe, expect, test } from "vitest";
import { clientIp } from "./client-ip";

const h = (init: Record<string, string>) => new Headers(init);

describe("clientIp", () => {
  test("X-Real-IP pus de proxy are prioritate", () => {
    expect(clientIp(h({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
  });

  test("fără X-Real-IP: ultima adresă din X-Forwarded-For (cea adăugată de proxy), nu prima trimisă de client", () => {
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": " 203.0.113.7 " }))).toBe("203.0.113.7");
  });

  test("fără antete: 0.0.0.0", () => {
    expect(clientIp(h({}))).toBe("0.0.0.0");
    expect(clientIp(h({ "x-forwarded-for": " , " }))).toBe("0.0.0.0");
  });
});
