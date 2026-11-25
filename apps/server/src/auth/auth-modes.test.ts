import { Test } from "@nestjs/testing";
import request from "supertest";
import { expect, it } from "vitest";
import { AuthConfigResponseSchema } from "@voltonaut/shared";
import { AppModule } from "../app.module.js";
import { SERVER_CONFIG } from "../config.module.js";
import { parseServerConfig } from "../config.js";
import { MAIL_SENDER } from "../mail/mail-sender.js";
import { httpServerOf, bodyOf, createTestApp } from "../testing/test-app.spec.js";
import { oidcBindingCookie } from "./oidc-cookie.js";

const PRODUCTION_OIDC = {
  AUTH_MODE: "oidc",
  OIDC_PROVIDERS: "test",
  OIDC_TEST_ISSUER: "https://identity.example/oidc/app",
  OIDC_TEST_CLIENT_ID: "test-client",
  OIDC_TEST_CLIENT_SECRET: "test-secret",
  OIDC_TEST_REDIRECT_URI: "https://api.example/v1/auth/oidc/test/callback",
  DATABASE_PATH: ":memory:",
  AUTH_TOMBSTONE_HMAC_KEY: "a".repeat(64),
};

it.each(["oidc", "disabled"])(
  "boots real production providers in %s mode without mail or discovery",
  async (mode) => {
    const config = parseServerConfig({ ...PRODUCTION_OIDC, AUTH_MODE: mode }, "production");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SERVER_CONFIG)
      .useValue(config)
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      expect(app.get(MAIL_SENDER)).toBeNull();
      await request(httpServerOf(app)).get("/healthz").expect(200);
      const response = await request(httpServerOf(app)).get("/v1/auth/config").expect(200);
      expect(AuthConfigResponseSchema.parse(bodyOf(response))).toMatchObject({ mode });
      await request(httpServerOf(app))
        .post("/v1/auth/magic-link")
        .send({ email: "rider@example.com" })
        .expect(404);
      await request(httpServerOf(app))
        .post("/v1/auth/session")
        .send({ loginToken: "legacy" })
        .expect(404);
      await request(httpServerOf(app)).get("/v1/me").expect(401);
      await request(httpServerOf(app)).post("/v1/auth/logout").expect(401);
    } finally {
      await app.close();
    }
  },
);

it.each(["disabled", "magic-link"])(
  "does not expose working OIDC routes in %s mode",
  async (mode) => {
    const { app } = await createTestApp({ config: parseServerConfig({ AUTH_MODE: mode }, "test") });

    try {
      const capability = await request(httpServerOf(app)).get("/v1/auth/config").expect(200);
      expect(AuthConfigResponseSchema.parse(bodyOf(capability))).toEqual({ mode });
      await request(httpServerOf(app)).get("/v1/auth/oidc/test/start").expect(404);
      await request(httpServerOf(app)).get("/v1/auth/oidc/test/callback").expect(404);
      await request(httpServerOf(app))
        .post("/v1/auth/oidc/exchange")
        .set("Origin", "http://localhost:5173")
        .send({ code: "a".repeat(43) })
        .expect(404);
    } finally {
      await app.close();
    }
  },
);

it("requires explicit production mode and complete secure OIDC configuration", () => {
  expect(() => parseServerConfig({}, "production")).toThrow(/.+/u);
  expect(() => parseServerConfig({ AUTH_MODE: "unknown" }, "test")).toThrow(/.+/u);
  expect(() => parseServerConfig({}, "staging")).toThrow(/.+/u);

  for (const key of [
    "OIDC_TEST_ISSUER",
    "OIDC_TEST_CLIENT_ID",
    "OIDC_TEST_CLIENT_SECRET",
    "OIDC_TEST_REDIRECT_URI",
  ]) {
    expect(() => parseServerConfig({ ...PRODUCTION_OIDC, [key]: "" }, "production")).toThrow(/.+/u);
  }

  for (const url of [
    "http://127.0.0.1:3000",
    "http://remote.example",
    "https://name:secret@example.com",
    "https://example.com/#fragment",
    "https://example.com/.well-known/openid-configuration",
  ]) {
    expect(() =>
      parseServerConfig({ ...PRODUCTION_OIDC, OIDC_TEST_ISSUER: url }, "production"),
    ).toThrow(/.+/u);
  }

  for (const url of [
    "http://127.0.0.1:3000/v1/auth/oidc/test/callback",
    "https://api.example/wrong",
    "https://api.example/v1/auth/oidc/test/callback?redirect=evil",
  ]) {
    expect(() =>
      parseServerConfig({ ...PRODUCTION_OIDC, OIDC_TEST_REDIRECT_URI: url }, "production"),
    ).toThrow(/.+/u);
  }

  expect(() =>
    parseServerConfig({ ...PRODUCTION_OIDC, CLIENT_ORIGIN: "http://localhost:5173" }, "production"),
  ).toThrow(/.+/u);
  expect(() =>
    parseServerConfig({ ...PRODUCTION_OIDC, CORS_ORIGINS: "https://other.example" }, "production"),
  ).toThrow(/.+/u);
  expect(oidcBindingCookie("opaque", true, false)).toBe(
    "__Host-voltonaut-oidc=opaque; Path=/; HttpOnly; SameSite=Lax; Max-Age=360; Secure",
  );
});

it("allows HTTP only for development/test loopback and keeps legacy production mail mandatory", () => {
  for (const nodeEnv of ["test", "development"]) {
    expect(
      parseServerConfig({ ...PRODUCTION_OIDC, OIDC_TEST_ISSUER: "http://127.0.0.1:9000" }, nodeEnv)
        .auth.mode,
    ).toBe("oidc");
    expect(() =>
      parseServerConfig({ ...PRODUCTION_OIDC, OIDC_TEST_ISSUER: "http://remote.example" }, nodeEnv),
    ).toThrow(/.+/u);
    expect(() =>
      parseServerConfig(
        {
          ...PRODUCTION_OIDC,
          OIDC_TEST_REDIRECT_URI: "http://remote.example/v1/auth/oidc/test/callback",
        },
        nodeEnv,
      ),
    ).toThrow(/.+/u);
  }

  for (const env of [
    {},
    { MAIL_PROVIDER: "memory" },
    { MAIL_PROVIDER: "disabled" },
    { MAIL_PROVIDER: "resend" },
  ]) {
    expect(() => parseServerConfig({ ...env, AUTH_MODE: "magic-link" }, "production")).toThrow(
      /.+/u,
    );
  }
});
