import { createEventBus } from "@voltonaut/shared";
import { expect, it } from "vitest";
import { createManualClock } from "../sim/clock.js";
import { createManualTicker } from "../sim/tick.js";
import { createTestCentral } from "../testdata/webCentral.js";
import { CYCLING_POWER_SERVICE, FITNESS_MACHINE_SERVICE } from "../uuids.js";
import { createWebBluetoothTransport } from "../webBluetoothTransport.js";
import { createTrainerAdapter } from "./adapter.js";

it("requests FTMS or CPS devices with both services authorized at the browser picker", async () => {
  const fake = createTestCentral();

  const adapter = createTrainerAdapter({
    bus: createEventBus(),
    clock: createManualClock(),
    ticker: createManualTicker(),
    transport: createWebBluetoothTransport({ central: fake.central }),
  });

  await adapter.connect();
  expect(fake.requests()).toEqual([
    JSON.stringify({
      filters: [{ services: [FITNESS_MACHINE_SERVICE] }, { services: [CYCLING_POWER_SERVICE] }],
      optionalServices: [FITNESS_MACHINE_SERVICE, CYCLING_POWER_SERVICE],
    }),
  ]);
});
