import request from "supertest";
import { afterEach, expect, it } from "vitest";

import {
  InventoryResponseSchema,
  PurchaseResponseSchema,
  VoltsGrantCommandSchema,
} from "@voltonaut/shared";
import { defaultInventoryItemIds } from "@voltonaut/rules";
import {
  bearer,
  bodyOf,
  createTestApp,
  getDatabase,
  httpServerOf,
  loginTestUser,
} from "../testing/test-app.spec.js";
import { OperatorGrants } from "../economy/economy.grant.js";
import { EconomyService } from "../economy/economy.service.js";
import { economyTables } from "../schema.js";

const NOW_MS = Date.parse("2026-11-25T12:00:00.000Z");
const REQUEST_ONE = "20000000-0000-4000-8000-000000000001";
const REQUEST_TWO = "20000000-0000-4000-8000-000000000002";
const cleanup = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

async function shop(creditVolts = 0) {
  const testApp = await createTestApp({ clock: { nowMs: () => NOW_MS } });
  cleanup.add(() => testApp.app.close());
  const owner = await loginTestUser(testApp.app, testApp.mail, "owner@example.com");
  const economy = testApp.app.get<EconomyService>(EconomyService);

  if (creditVolts > 0)
    new OperatorGrants(getDatabase(testApp.app), economyTables, { nowMs: () => NOW_MS }).grant(
      owner.user.id,
      VoltsGrantCommandSchema.parse({
        idempotencyKey: "operator:test",
        refId: "test",
        amountVolts: creditVolts,
        operatorUserId: owner.user.id,
      }),
    );

  const server = httpServerOf(testApp.app);
  const auth = bearer(owner.sessionToken);

  const purchase = (requestId: string, itemId: string, expectedPriceVolts: number) =>
    request(server)
      .post("/v1/shop/purchase")
      .set(auth)
      .send({ requestId, itemId, expectedPriceVolts });

  const inventory = async () =>
    InventoryResponseSchema.parse(
      bodyOf(await request(server).get("/v1/me/inventory").set(auth).expect(200)),
    );

  return {
    server,
    owner,
    economy,
    db: getDatabase(testApp.app).$client,
    purchase,
    inventory,
    testApp,
  };
}

function ownedIds(response: Readonly<{ items: readonly { readonly itemId: string }[] }>) {
  return response.items.map((item) => item.itemId);
}

it("lists default items for a new account without storing them", async () => {
  const f = await shop();

  const response = await request(f.server)
    .get("/v1/me/inventory")
    .set(bearer(f.owner.sessionToken))
    .expect(200);

  expect(response.headers["cache-control"]).toBe("no-store");
  expect(ownedIds(InventoryResponseSchema.parse(bodyOf(response)))).toEqual(
    defaultInventoryItemIds(),
  );
  expect(f.db.prepare("SELECT * FROM inventory").all()).toEqual([]);
  await request(f.server).get("/v1/me/inventory").expect(401);
  await request(f.server).post("/v1/shop/purchase").send({}).expect(401);
});

it("buys an item, debits its price and owns it in the same commit", async () => {
  const f = await shop(2000);

  const response = await f.purchase(REQUEST_ONE, "helmet.aero", 1500).expect(200);

  expect(PurchaseResponseSchema.parse(bodyOf(response))).toEqual({
    voltsBalance: 500,
    item: { itemId: "helmet.aero", source: "shop", acquiredAt: "2026-11-25T12:00:00.000Z" },
  });
  expect(ownedIds(await f.inventory())).toContain("helmet.aero");
  expect(f.db.prepare("SELECT item_id, source, purchase_request_id FROM inventory").all()).toEqual([
    { item_id: "helmet.aero", source: "shop", purchase_request_id: REQUEST_ONE },
  ]);
});

it("refuses a purchase without enough Volts and changes nothing", async () => {
  const f = await shop(1000);

  const response = await f.purchase(REQUEST_ONE, "helmet.aero", 1500).expect(409);

  expect(bodyOf(response)).toMatchObject({ error: { code: "insufficient_volts" } });
  expect(f.db.prepare("SELECT * FROM inventory").all()).toEqual([]);
  expect(f.economy.balance(f.owner.user.id)).toBe(1000);
});

it("replays the same request id without a second debit and refuses a second purchase", async () => {
  const f = await shop(5000);

  const first = bodyOf(await f.purchase(REQUEST_ONE, "helmet.aero", 1500).expect(200));

  expect(bodyOf(await f.purchase(REQUEST_ONE, "helmet.aero", 1500).expect(200))).toEqual(first);
  expect(bodyOf(await f.purchase(REQUEST_TWO, "helmet.aero", 1500).expect(409))).toMatchObject({
    error: { code: "already_owned" },
  });
  expect(bodyOf(await f.purchase(REQUEST_ONE, "glasses.clear", 1500).expect(409))).toMatchObject({
    error: { code: "ledger_conflict" },
  });
  expect(f.economy.balance(f.owner.user.id)).toBe(3500);
});

it("maps unknown, non-shop and repriced items to explicit errors", async () => {
  const f = await shop(50_000);

  expect(bodyOf(await f.purchase(REQUEST_ONE, "helmet.unknown", 1500).expect(404))).toMatchObject({
    error: { code: "not_found" },
  });
  expect(bodyOf(await f.purchase(REQUEST_ONE, "jersey.tempo", 1500).expect(409))).toMatchObject({
    error: { code: "item_not_for_sale" },
  });
  expect(bodyOf(await f.purchase(REQUEST_ONE, "helmet.aero", 1499).expect(409))).toMatchObject({
    error: { code: "price_changed" },
  });
  expect(bodyOf(await f.purchase(REQUEST_ONE, "jersey.classic", 1).expect(409))).toMatchObject({
    error: { code: "already_owned" },
  });
  expect(f.economy.balance(f.owner.user.id)).toBe(50_000);
  await f.purchase("not-a-uuid", "helmet.aero", 1500).expect(422);
});

it("sells level-gated items until progression exists (spec E7-02 transition)", async () => {
  const f = await shop(6000);

  await f.purchase(REQUEST_ONE, "wheels.carbon-flat", 6000).expect(200);
  expect(ownedIds(await f.inventory())).toContain("wheels.carbon-flat");
});

it("shows the same ownership to a second session of the same account", async () => {
  const f = await shop(2000);

  await f.purchase(REQUEST_ONE, "helmet.aero", 1500).expect(200);

  const second = await loginTestUser(
    f.testApp.app,
    f.testApp.mail,
    "owner@example.com",
    "127.0.0.2:1",
  );

  const other = InventoryResponseSchema.parse(
    bodyOf(
      await request(f.server).get("/v1/me/inventory").set(bearer(second.sessionToken)).expect(200),
    ),
  );

  expect(other).toEqual(await f.inventory());
});

it("rolls back the debit when the inventory write fails", async () => {
  const f = await shop(2000);

  f.db.exec(
    "CREATE TRIGGER fail_inventory BEFORE INSERT ON inventory BEGIN SELECT RAISE(ABORT, 'forced'); END;",
  );

  await f.purchase(REQUEST_ONE, "helmet.aero", 1500).expect(500);
  expect(f.economy.balance(f.owner.user.id)).toBe(2000);
  expect(f.db.prepare("SELECT * FROM volts_ledger WHERE reason = 'purchase'").all()).toEqual([]);
});

it("lets exactly one of two concurrent purchases of the same item win", async () => {
  const f = await shop(5000);

  const responses = await Promise.all([
    f.purchase(REQUEST_ONE, "helmet.aero", 1500),
    f.purchase(REQUEST_TWO, "helmet.aero", 1500),
  ]);

  const statuses: number[] = [];

  for (const response of responses) statuses.push(response.status);

  expect(statuses.toSorted((a, b) => a - b)).toEqual([200, 409]);
  expect(f.economy.balance(f.owner.user.id)).toBe(3500);
  expect(f.db.prepare("SELECT COUNT(*) AS n FROM inventory").get()).toEqual({ n: 1 });
});
