import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { expect, it } from "vitest";

import {
  DEFAULT_RIDER_PROFILE,
  ProfileStateSchema,
  RideDetailSchema,
  RideReceiptSchema,
} from "@voltonaut/shared";
import {
  bearer,
  bodyOf,
  createTestApp,
  getDatabase,
  httpServerOf,
  loginTestUser,
} from "../testing/test-app.spec.js";
import { recording } from "../testing/recording.spec.js";

async function writeBeforeRestart(path: string) {
  const first = await createTestApp({ config: { database: { path, migrationsDir: "drizzle" } } });

  try {
    const session = await loginTestUser(first.app, first.mail, "durable@example.com");
    const ride = recording();

    const upload = await request(httpServerOf(first.app))
      .post("/v1/rides")
      .set(bearer(session.sessionToken))
      .send(ride)
      .expect(200);

    const profile = await request(httpServerOf(first.app))
      .put("/v1/me/profile")
      .set(bearer(session.sessionToken))
      .send(DEFAULT_RIDER_PROFILE)
      .expect(200);

    const receipt = RideReceiptSchema.parse(bodyOf(upload));
    const storedProfile = ProfileStateSchema.parse(bodyOf(profile));

    const stored = getDatabase(first.app)
      .$client.prepare("SELECT * FROM rides WHERE id = ?")
      .get(ride.rideId);

    return { session, ride, receipt, storedProfile, stored };
  } finally {
    await first.app.close();
  }
}

it("keeps the original receipt, immutable recording, profile and owner after SQLite reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-owned-rides-"));
  const path = join(directory, "rides.db");

  try {
    const { session, ride, receipt, storedProfile, stored } = await writeBeforeRestart(path);
    const config = { database: { path, migrationsDir: "drizzle" } };
    const second = await createTestApp({ config });

    try {
      const retry = await request(httpServerOf(second.app))
        .post("/v1/rides")
        .set(bearer(session.sessionToken))
        .send(ride)
        .expect(200);

      const detail = await request(httpServerOf(second.app))
        .get(`/v1/rides/${ride.rideId}`)
        .set(bearer(session.sessionToken))
        .expect(200);

      const reloaded = await request(httpServerOf(second.app))
        .get("/v1/me/profile")
        .set(bearer(session.sessionToken))
        .expect(200);

      expect(RideReceiptSchema.parse(bodyOf(retry))).toEqual(receipt);
      expect(RideDetailSchema.parse(bodyOf(detail))).toEqual({
        recording: ride,
        assessment: receipt.assessment,
      });
      expect(ProfileStateSchema.parse(bodyOf(reloaded))).toEqual(storedProfile);
      expect(
        getDatabase(second.app)
          .$client.prepare("SELECT * FROM rides WHERE id = ?")
          .get(ride.rideId),
      ).toEqual(stored);
    } finally {
      await second.app.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("rate limits uploads per account, including retries, without blocking another account", async () => {
  const { app, mail } = await createTestApp();

  try {
    const owner = await loginTestUser(app, mail, "rate-owner@example.com");
    const other = await loginTestUser(app, mail, "rate-other@example.com");
    const ride = recording();

    await Promise.all(
      Array.from({ length: 30 }, () =>
        request(httpServerOf(app))
          .post("/v1/rides")
          .set(bearer(owner.sessionToken))
          .send(ride)
          .expect(200),
      ),
    );

    const blocked = await request(httpServerOf(app))
      .post("/v1/rides")
      .set(bearer(owner.sessionToken))
      .send(ride)
      .expect(429);

    expect(bodyOf(blocked)).toMatchObject({ error: { code: "rate_limited" } });
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);

    const independent = await request(httpServerOf(app))
      .post("/v1/rides")
      .set(bearer(other.sessionToken))
      .send(recording())
      .expect(200);

    expect(RideReceiptSchema.parse(bodyOf(independent)).assessment.status).toBe("unverified");
  } finally {
    await app.close();
  }
});
