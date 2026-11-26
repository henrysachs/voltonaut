import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, httpServerOf } from "./testing/test-app.spec.js";
import type { TestApp } from "./testing/test-app.spec.js";

const ALLOWED_ORIGIN = "http://localhost:5173";

describe("CORS (spec AK10)", () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it("echoes an allowed origin exactly and lists the client headers", async () => {
    const response = await request(httpServerOf(testApp.app))
      .options("/v1/auth/magic-link")
      .set("Origin", ALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization, content-type, content-encoding")
      .expect(204);

    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(response.headers["access-control-allow-headers"]).toContain("Authorization");
    expect(response.headers["access-control-allow-headers"]).toContain("Content-Encoding");
  });

  it("lets the web client read how long a rate limit lasts", async () => {
    const response = await request(httpServerOf(testApp.app))
      .get("/healthz")
      .set("Origin", ALLOWED_ORIGIN)
      .expect(200);

    expect(response.headers["access-control-expose-headers"]).toBe("Retry-After");
  });

  it("answers no ACAO header for a foreign origin", async () => {
    const response = await request(httpServerOf(testApp.app))
      .options("/v1/auth/magic-link")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST")
      .expect(204);

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("keeps the production origin in the default config", () => {
    expect(testApp.config.cors.origins).toContain("https://voltonaut.stammkneipe.dev");
  });
});
