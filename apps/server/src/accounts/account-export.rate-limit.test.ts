import { expect, it } from "vitest";
import request from "supertest";

import { bearer, bodyOf } from "../testing/test-app.spec.js";
import { accountDataFixture } from "./account-data.fixture.js";

it("allows one account export per minute and account (issue #141)", async () => {
  const f = await accountDataFixture();

  await request(f.server).get("/v1/me/export").expect(401);
  await request(f.server).get("/v1/me/export").set(bearer(f.owner.sessionToken)).expect(200);

  const again = await request(f.server)
    .get("/v1/me/export")
    .set(bearer(f.owner.sessionToken))
    .expect(429);

  expect(bodyOf(again)).toMatchObject({ error: { code: "rate_limited" } });
  expect(Number(again.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  await request(f.server).get("/v1/me/export").set(bearer(f.other.sessionToken)).expect(200);
});
