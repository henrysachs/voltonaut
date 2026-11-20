import request from "supertest";
import { expect, it } from "vitest";

import { RideListSchema } from "@voltonaut/shared";
import {
  bearer,
  bodyOf,
  createTestApp,
  httpServerOf,
  loginTestUser,
} from "../testing/test-app.spec.js";
import { recording } from "../testing/recording.spec.js";

it("defaults to 20 summaries and returns stable UUID-ordered cursor pages", async () => {
  const { app, mail } = await createTestApp();

  try {
    const owner = await loginTestUser(app, mail, "pages@example.com");
    const rides = Array.from({ length: 25 }, () => recording());

    await Promise.all(
      rides.map((ride) =>
        request(httpServerOf(app))
          .post("/v1/rides")
          .set(bearer(owner.sessionToken))
          .send(ride)
          .expect(200),
      ),
    );

    const first = await request(httpServerOf(app))
      .get("/v1/rides")
      .set(bearer(owner.sessionToken))
      .expect(200);

    const page = RideListSchema.parse(bodyOf(first));

    expect(page.rides).toHaveLength(20);
    expect(page.nextCursor).toBe(page.rides.at(-1)?.rideId);

    const second = await request(httpServerOf(app))
      .get(`/v1/rides?cursor=${page.nextCursor}`)
      .set(bearer(owner.sessionToken))
      .expect(200);

    const remaining = RideListSchema.parse(bodyOf(second));

    expect(remaining.rides).toHaveLength(5);
    expect(remaining.nextCursor).toBeNull();
    expect([...page.rides, ...remaining.rides].map((ride) => ride.rideId)).toEqual(
      rides.map((ride) => ride.rideId).toSorted(),
    );

    const maximum = await request(httpServerOf(app))
      .get("/v1/rides?limit=50")
      .set(bearer(owner.sessionToken))
      .expect(200);

    expect(RideListSchema.parse(bodyOf(maximum)).rides).toHaveLength(25);
  } finally {
    await app.close();
  }
});
