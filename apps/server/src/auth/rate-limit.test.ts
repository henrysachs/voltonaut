import request from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestApp, httpServerOf, bodyOf } from "../testing/test-app.spec.js";
import type { TestApp } from "../testing/test-app.spec.js";
import { ErrorEnvelopeSchema } from "@voltonaut/shared";

let testApp: TestApp;

beforeAll(async () => {
  testApp = await createTestApp({
    config: { throttling: { magicLinkEmailPerHour: 2, magicLinkIpPerHour: 2, sessionIpPerMin: 2 } },
  });
});

afterAll(async () => {
  await testApp.app.close();
});

it("limits normalized emails across IPs", async () => {
  const server = httpServerOf(testApp.app);

  await request(server)
    .post("/v1/auth/magic-link")
    .set("X-Forwarded-For", "10.0.0.1")
    .send({ email: "limited@example.com" })
    .expect(204);
  await request(server)
    .post("/v1/auth/magic-link")
    .set("X-Forwarded-For", "10.0.0.2")
    .send({ email: " LIMITED@EXAMPLE.COM " })
    .expect(204);

  const limited = await request(server)
    .post("/v1/auth/magic-link")
    .set("X-Forwarded-For", "10.0.0.3")
    .send({ email: "limited@example.com" })
    .expect(429);

  expect(ErrorEnvelopeSchema.parse(bodyOf(limited)).error.code).toBe("rate_limited");
  expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(3590);
  expect(Number(limited.headers["retry-after"])).toBeLessThanOrEqual(3600);
});

it("limits magic-link requests per IP and session exchanges", async () => {
  const server = httpServerOf(testApp.app);

  await Promise.all(
    [0, 1].flatMap((index) => [
      request(server)
        .post("/v1/auth/magic-link")
        .set("X-Forwarded-For", "10.0.1.1")
        .send({ email: `ip${index}@example.com` })
        .expect(204),
      request(server)
        .post("/v1/auth/session")
        .set("X-Forwarded-For", "10.0.2.1")
        .send({ loginToken: "invalid" })
        .expect(401),
    ]),
  );

  const ipLimited = await request(server)
    .post("/v1/auth/magic-link")
    .set("X-Forwarded-For", "10.0.1.1")
    .send({ email: "overflow@example.com" })
    .expect(429);

  expect.soft(Number(ipLimited.headers["retry-after"])).toBeGreaterThanOrEqual(3590);
  expect.soft(Number(ipLimited.headers["retry-after"])).toBeLessThanOrEqual(3600);

  const sessionLimited = await request(server)
    .post("/v1/auth/session")
    .set("X-Forwarded-For", "10.0.2.1")
    .send({ loginToken: "invalid" })
    .expect(429);

  expect(Number(sessionLimited.headers["retry-after"])).toBeGreaterThanOrEqual(55);
  expect(Number(sessionLimited.headers["retry-after"])).toBeLessThanOrEqual(60);
  await request(server).get("/healthz").expect(200);
});
