import request from "supertest";
import { afterEach, expect, it } from "vitest";

import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";
import {
  LoadoutResponseSchema,
  VoltsGrantCommandSchema,
  type AvatarConfig,
} from "@voltonaut/shared";
import {
  bearer,
  bodyOf,
  createTestApp,
  getDatabase,
  httpServerOf,
  loginTestUser,
} from "../testing/test-app.spec.js";
import { OperatorGrants } from "../economy/economy.grant.js";
import { economyTables } from "../schema.js";

const NOW_MS = Date.parse("2026-11-25T12:00:00.000Z");
const cleanup = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

const STRIPE: AvatarConfig = {
  ...DEFAULT_AVATAR_CONFIG,
  rider: {
    ...DEFAULT_AVATAR_CONFIG.rider,
    jerseyId: "jersey.stripe",
    jerseyColors: ["#45c4b0", "#202830"],
  },
};

async function garage() {
  const testApp = await createTestApp({ clock: { nowMs: () => NOW_MS } });
  cleanup.add(() => testApp.app.close());
  const owner = await loginTestUser(testApp.app, testApp.mail, "owner@example.com");
  const other = await loginTestUser(testApp.app, testApp.mail, "other@example.com");
  const server = httpServerOf(testApp.app);
  const origin = testApp.config.clientOrigin;

  new OperatorGrants(getDatabase(testApp.app), economyTables, { nowMs: () => NOW_MS }).grant(
    owner.user.id,
    VoltsGrantCommandSchema.parse({
      idempotencyKey: "operator:test",
      refId: "test",
      amountVolts: 5000,
    }),
  );

  const save = (loadout: Readonly<AvatarConfig>, token = owner.sessionToken) =>
    request(server)
      .put("/v1/me/loadout")
      .set(bearer(token))
      .set("Origin", origin)
      .send({ loadout });

  const load = async (token = owner.sessionToken) =>
    LoadoutResponseSchema.parse(
      bodyOf(await request(server).get("/v1/me/loadout").set(bearer(token)).expect(200)),
    );

  const buy = (itemId: string, expectedPriceVolts: number) =>
    request(server)
      .post("/v1/shop/purchase")
      .set(bearer(owner.sessionToken))
      .send({ requestId: "20000000-0000-4000-8000-000000000001", itemId, expectedPriceVolts })
      .expect(200);

  return { server, owner, other, origin, save, load, buy, db: getDatabase(testApp.app).$client };
}

it("returns the default loadout without a stored row", async () => {
  const { server, owner, load } = await garage();

  expect(await load()).toEqual({ loadout: DEFAULT_AVATAR_CONFIG, updatedAt: null });

  const response = await request(server).get("/v1/me/loadout").set(bearer(owner.sessionToken));

  expect(response.headers["cache-control"]).toBe("no-store");
  await request(server).get("/v1/me/loadout").expect(401);
});

it("rejects an unowned item without writing and accepts it right after the purchase", async () => {
  const { save, load, buy, db } = await garage();

  const rejected = await save(STRIPE).expect(409);

  expect(bodyOf(rejected)).toMatchObject({ error: { code: "not_owned" } });
  expect(db.prepare("SELECT COUNT(*) AS count FROM avatar_loadouts").get()).toEqual({ count: 0 });

  await buy("jersey.stripe", 1500);

  const saved = LoadoutResponseSchema.parse(bodyOf(await save(STRIPE).expect(200)));

  expect(saved).toEqual({ loadout: STRIPE, updatedAt: "2026-11-25T12:00:00.000Z" });
  expect(await load()).toEqual(saved);
});

it("keeps loadouts per account and rejects foreign colors, origins and sessions", async () => {
  const { server, other, save, load } = await garage();

  const foreignColor = {
    ...DEFAULT_AVATAR_CONFIG,
    bike: { ...DEFAULT_AVATAR_CONFIG.bike, frameColor: "#123456" },
  };

  await save(foreignColor).expect(422);
  await request(server)
    .put("/v1/me/loadout")
    .set(bearer(other.sessionToken))
    .set("Origin", "https://evil.example")
    .send({ loadout: DEFAULT_AVATAR_CONFIG })
    .expect(403);
  await request(server).put("/v1/me/loadout").send({ loadout: DEFAULT_AVATAR_CONFIG }).expect(401);
  await save(
    { ...DEFAULT_AVATAR_CONFIG, rider: { ...DEFAULT_AVATAR_CONFIG.rider, helmetColor: "#202830" } },
    other.sessionToken,
  ).expect(200);

  expect((await load()).updatedAt).toBeNull();
  expect((await load(other.sessionToken)).loadout.rider.helmetColor).toBe("#202830");
});

it("rejects late loadout writes for a deleted account in SQLite itself", async () => {
  const { owner, db } = await garage();

  db.prepare("UPDATE users SET deleted_at = 1, email = 'gone@voltonaut.invalid' WHERE id = ?").run(
    owner.user.id,
  );

  expect(() =>
    db
      .prepare(
        "INSERT INTO avatar_loadouts (user_id, loadout_json, updated_at) VALUES (?, '{}', 1)",
      )
      .run(owner.user.id),
  ).toThrow("account is deleted");
});
