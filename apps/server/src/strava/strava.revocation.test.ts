import request from "supertest";
import { expect, it } from "vitest";
import { bearer, bodyOf, getDatabase, httpServerOf } from "../testing/test-app.spec.js";
import {
  setupStrava,
  pendingStrava,
  confirmStrava,
  disconnectStrava,
  STRAVA_ORIGIN,
} from "../testing/strava-flow.spec.js";

it.each<"http" | "stall">(["http", "stall"])(
  "blocks locally and persists revocation_pending after %s then genuinely revokes on retry",
  async (fault) => {
    const context = await setupStrava();
    const flow = await pendingStrava(context);
    await confirmStrava(context, flow.code, flow.cookie).expect(200);
    context.provider.control.revokeFault = fault;
    expect(bodyOf(await disconnectStrava(context).expect(200))).toEqual({
      status: "revocation_pending",
    });
    const db = getDatabase(context.app);
    expect(
      db.$client.prepare("SELECT encrypted_tokens FROM strava_connections").get(),
    ).toBeDefined();
    await request(httpServerOf(context.app))
      .post("/v1/strava/connect-start")
      .set(bearer(context.owner.sessionToken))
      .set("Origin", STRAVA_ORIGIN)
      .send({ action: "connect", channel: "00000000-0000-4000-8000-000000000001" })
      .expect(409);
    context.provider.control.revokeFault = "none";
    expect(bodyOf(await disconnectStrava(context).expect(200))).toEqual({ status: "disconnected" });
    expect(db.$client.prepare("SELECT * FROM strava_connections").all()).toEqual([]);
    expect(context.provider.control.revokeCalls).toBe(2);
  },
);
