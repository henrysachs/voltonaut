import { expect, it } from "vitest";
import { parseServerConfig } from "./config.js";
import { createMailSender } from "./mail/mail-sender.js";
import { InMemoryMailSender } from "./mail/in-memory.mail.sender.js";
import { CloudflareEmailSender } from "./mail/cloudflare-email.sender.js";
import { ResendSender } from "./mail/resend.sender.js";

it("defaults development/test to memory and refuses incomplete production mail configuration", () => {
  expect(createMailSender(parseServerConfig({}, "development"))).toBeInstanceOf(InMemoryMailSender);
  expect(parseServerConfig({}, "test").database.path).toBe(":memory:");

  for (const env of [
    {},
    { MAIL_PROVIDER: "memory" },
    { MAIL_PROVIDER: "invalid" },
    { MAIL_PROVIDER: "resend" },
    { CLOUDFLARE_EMAIL_API_TOKEN: "token" },
  ]) {
    expect(() => parseServerConfig({ AUTH_MODE: "magic-link", ...env }, "production")).toThrow(
      /.+/u,
    );
  }

  const cloudflare = parseServerConfig(
    {
      AUTH_MODE: "magic-link",
      CLOUDFLARE_EMAIL_API_TOKEN: "test-token",
      CLOUDFLARE_EMAIL_ACCOUNT_ID: "test-account",
    },
    "production",
  );

  const resend = parseServerConfig(
    { AUTH_MODE: "magic-link", MAIL_PROVIDER: "resend", RESEND_API_KEY: "test-key" },
    "production",
  );

  expect(createMailSender(cloudflare)).toBeInstanceOf(CloudflareEmailSender);
  expect(createMailSender(resend)).toBeInstanceOf(ResendSender);
  expect(cloudflare.mail.clientOrigin).toBe("https://voltonaut.stammkneipe.dev");
});

it("rejects unsafe origins and malformed runtime limits before startup", () => {
  for (const origin of [
    "*",
    "https://*.pages.dev",
    "https://example.com/path",
    "https://name:secret@example.com",
    "javascript:alert(1)",
    "",
  ]) {
    expect(() => parseServerConfig({ CLIENT_ORIGIN: origin }, "test")).toThrow(/.+/u);
    expect(() => parseServerConfig({ CORS_ORIGINS: origin }, "test")).toThrow(/.+/u);
  }

  for (const key of ["PORT", "SESSION_TTL_DAYS", "THROTTLER_MAGIC_LINK_EMAIL_PER_HOUR"]) {
    expect(() => parseServerConfig({ [key]: "NaN" }, "test")).toThrow(/.+/u);
    expect(() => parseServerConfig({ [key]: "-1" }, "test")).toThrow(/.+/u);
  }

  expect(() => parseServerConfig({ PORT: "65536" }, "test")).toThrow(/.+/u);
  expect(() => parseServerConfig({ MAIL_FROM: "invalid" }, "test")).toThrow(/.+/u);
  expect(() => parseServerConfig({ DATABASE_PATH: "" }, "test")).toThrow(/.+/u);
});
