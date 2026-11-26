import request from "supertest";
import { expect, it } from "vitest";

import { bearer, bodyOf, getDatabase, httpServerOf } from "../testing/test-app.spec.js";
import {
  confirmStrava,
  pendingStrava,
  setupStrava,
  STRAVA_ORIGIN,
} from "../testing/strava-flow.spec.js";

async function connectedStrava() {
  const context = await setupStrava();
  const flow = await pendingStrava(context);

  await confirmStrava(context, flow.code, flow.cookie).expect(200);

  const remove = (confirmation: string) =>
    request(httpServerOf(context.app))
      .delete("/v1/me")
      .set(bearer(context.owner.sessionToken))
      .set("Origin", STRAVA_ORIGIN)
      .send({ confirmation });

  const connections = () =>
    getDatabase(context.app).$client.prepare("SELECT user_id FROM strava_connections").all();

  return { context, remove, connections };
}

it("revokes the Strava grant before deleting the account (issue #140)", async () => {
  const { context, remove, connections } = await connectedStrava();

  const deleted = await remove(context.owner.user.email).expect(200);

  expect(bodyOf(deleted)).toEqual({ stravaRevocation: "revoked" });
  expect(context.provider.control.revokeCalls).toBe(1);
  expect(connections()).toEqual([]);
});

it.each<"http" | "stall">(["http", "stall"])(
  "still deletes the account when Strava cannot revoke (%s) and reports it",
  async (fault) => {
    const { context, remove, connections } = await connectedStrava();

    context.provider.control.revokeFault = fault;

    const deleted = await remove(context.owner.user.email).expect(200);

    expect(bodyOf(deleted)).toEqual({ stravaRevocation: "failed" });
    expect(connections()).toEqual([]);
    await request(httpServerOf(context.app))
      .get("/v1/me")
      .set(bearer(context.owner.sessionToken))
      .expect(401);
  },
);

it("never touches Strava when the deletion confirmation is wrong", async () => {
  const { context, remove, connections } = await connectedStrava();

  await remove("someone-else@example.com").expect(403);

  expect(context.provider.control.revokeCalls).toBe(0);
  expect(connections()).toHaveLength(1);
});
