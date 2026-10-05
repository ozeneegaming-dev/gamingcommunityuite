import { describe, expect, test, vi } from "vitest";
import { GcsValidationError } from "../errors";
import { sendEmail, type GcsEmailSettings } from "./send";

function settings(values: Record<string, unknown>): GcsEmailSettings {
  const defaults: Record<string, unknown> = {
    "email.smtp_host": "smtp.example.com",
    "email.smtp_port": 587,
    "email.smtp_user": "user",
    "email.smtp_pass": "pass",
    "email.from": "noreply@example.com",
    "site.name": "RED-LINE",
  };
  return { get: async <T,>(key: string) => ({ ...defaults, ...values })[key] as T };
}

describe("sendEmail", () => {
  test("transportul primește from = email.from și configurarea SMTP din setări", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "1" }));
    const createTransport = vi.fn(() => ({ sendMail }));

    await sendEmail({ to: "admin@example.com", subject: "Test", html: "<p>Salut</p>" }, settings({}), { createTransport });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.example.com", port: 587, secure: false, auth: { user: "user", pass: "pass" } }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: '"RED-LINE" <noreply@example.com>', to: "admin@example.com", subject: "Test", html: "<p>Salut</p>" }),
    );
  });

  test("portul 465 folosește TLS direct; fără utilizator nu trimite auth", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "1" }));
    const createTransport = vi.fn(() => ({ sendMail }));
    await sendEmail({ to: "a@b.c", subject: "x", html: "x" }, settings({ "email.smtp_port": 465, "email.smtp_user": "" }), { createTransport });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 465, secure: true }));
    expect(createTransport.mock.calls[0]).toBeDefined();
    expect((createTransport.mock.calls[0] as unknown[])[0]).not.toHaveProperty("auth");
  });

  test("fără server SMTP sau fără expeditor → GcsValidationError", async () => {
    const createTransport = vi.fn();
    await expect(
      sendEmail({ to: "a@b.c", subject: "x", html: "x" }, settings({ "email.smtp_host": "" }), { createTransport }),
    ).rejects.toBeInstanceOf(GcsValidationError);
    await expect(
      sendEmail({ to: "a@b.c", subject: "x", html: "x" }, settings({ "email.from": "" }), { createTransport }),
    ).rejects.toBeInstanceOf(GcsValidationError);
    expect(createTransport).not.toHaveBeenCalled();
  });
});
