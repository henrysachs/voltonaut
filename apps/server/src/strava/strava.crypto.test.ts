import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { z } from "zod";
import { decryptTokens, encryptTokens } from "./strava.crypto.js";
import { parseServerConfig } from "../config.js";

it("encrypts with random authenticated nonces bound to exact owner, athlete and key", () => {
  const key = randomBytes(32).toString("hex");
  const tokens = { accessToken: "private-access-token", refreshToken: "private-refresh-token" };
  const first = encryptTokens(tokens, key, "owner", "42");
  const second = encryptTokens(tokens, key, "owner", "42");
  expect(first).not.toEqual(second);
  expect(first).not.toContain(tokens.accessToken);
  expect(first).not.toContain(tokens.refreshToken);
  expect(decryptTokens(first, key, "owner", "42")).toEqual(tokens);
  expect(() => decryptTokens(first, key, "other", "42")).toThrow(Error);
  expect(() => decryptTokens(first, key, "owner", "43")).toThrow(Error);
  expect(() => decryptTokens(first, randomBytes(32).toString("hex"), "owner", "42")).toThrow(Error);
  expect(() =>
    decryptTokens(first.replace('"keyId":"1"', '"keyId":"2"'), key, "owner", "42"),
  ).toThrow(Error);
  expect(() => decryptTokens(first.replace(/"tag":"./u, '"tag":"z'), key, "owner", "42")).toThrow(
    Error,
  );
  const envelope = z.object({ ciphertext: z.string() }).passthrough().parse(JSON.parse(first));
  const changed = Buffer.from(envelope.ciphertext, "hex");
  changed[0] = changed.readUInt8(0) ^ 1;
  const tampered = JSON.stringify({ ...envelope, ciphertext: changed.toString("hex") });
  expect(() => decryptTokens(tampered, key, "owner", "42")).toThrow("authenticate");
});

it("defaults disabled and rejects incomplete, noncanonical and production fake configuration", () => {
  expect(parseServerConfig({}, "test").strava).toEqual({ mode: "disabled" });

  const env = {
    AUTH_MODE: "disabled",
    STRAVA_MODE: "enabled",
    STRAVA_CLIENT_ID: "123",
    STRAVA_CLIENT_SECRET: "generated-only",
    STRAVA_REDIRECT_URI: "https://api.example.com/v1/strava/callback",
    CLIENT_ORIGIN: "https://example.com",
    CORS_ORIGINS: "https://example.com",
    STRAVA_TOKEN_KEY: randomBytes(32).toString("base64"),
    STRAVA_WEBHOOK_VERIFY_TOKEN: "b".repeat(64),
  };

  expect(parseServerConfig(env, "production").strava.mode).toBe("enabled");
  expect(() =>
    parseServerConfig({ ...env, STRAVA_TOKEN_KEY: `${env.STRAVA_TOKEN_KEY}\n` }, "production"),
  ).toThrow(Error);
  expect(() => parseServerConfig({ ...env, STRAVA_CLIENT_SECRET: undefined }, "test")).toThrow(
    Error,
  );
  expect(() =>
    parseServerConfig(
      { ...env, STRAVA_TEST_PROVIDER_ORIGIN: "http://127.0.0.1:1234" },
      "production",
    ),
  ).toThrow(Error);
  expect(() =>
    parseServerConfig({ ...env, STRAVA_TEST_PROVIDER_ORIGIN: "https://evil.example" }, "test"),
  ).toThrow(Error);
  expect(() =>
    parseServerConfig({ ...env, CORS_ORIGINS: "https://other.example" }, "production"),
  ).toThrow(Error);
  expect(() =>
    parseServerConfig(
      { ...env, STRAVA_REDIRECT_URI: "https://api.example.com/v1/strava/callback?x=1" },
      "production",
    ),
  ).toThrow(Error);
});
