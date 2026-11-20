import { readFileSync } from "node:fs";

import request from "supertest";
import { HealthResponseSchema } from "@voltonaut/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SERVER_VERSION } from "../version.js";
import { createTestApp, httpServerOf } from "../testing/test-app.spec.js";
import type { TestApp } from "../testing/test-app.spec.js";

const fixtureUrl = new URL("../../../../fixtures/api/health.response.json", import.meta.url);

describe("GET /healthz", () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it("answers over real HTTP and matches the shared response schema", async () => {
    const response = await request(httpServerOf(testApp.app)).get("/healthz").expect(200);

    const body = HealthResponseSchema.parse(response.body);

    expect(body.status).toBe("ok");
    expect(body.version).toBe(SERVER_VERSION);
    expect(body.uptimeS).toBeGreaterThanOrEqual(0);
  });

  it("accepts the contract fixture", () => {
    const fixture = HealthResponseSchema.parse(JSON.parse(readFileSync(fixtureUrl, "utf8")));

    expect(fixture).toEqual({
      status: "ok",
      version: "0.1.0",
      uptimeS: 12.5,
    });
  });
});
