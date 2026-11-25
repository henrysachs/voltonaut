/** Scripted Heart Rate Service peripheral (0x180D, 0x2A37) for the sim transport. */

import type { SimPeripheral } from "../sim/transport.js";
import type { SimScript } from "../sim/sample.js";
import type { TickSource } from "../sim/tick.js";
import { HEART_RATE_MEASUREMENT, HEART_RATE_SERVICE } from "../uuids.js";
import { encodeHeartRateMeasurement } from "./encode.js";

export interface SimStrapOptions {
  /** Paces measurement notifications. */
  readonly ticker: TickSource;
  readonly samples: SimScript;
}

const MEASUREMENT = { serviceUuid: HEART_RATE_SERVICE, characteristicUuid: HEART_RATE_MEASUREMENT };

export function createSimStrapPeripheral(options: SimStrapOptions): SimPeripheral {
  let sampleIndex = 0;

  return {
    name: "Sim-Pulsgurt",
    id: "sim-heart-rate",
    profile: {
      services: [
        {
          uuid: HEART_RATE_SERVICE,
          characteristics: [
            { uuid: HEART_RATE_MEASUREMENT, properties: ["notify"], descriptors: [] },
          ],
        },
      ],
    },
    start(link) {
      return options.ticker.start(() => {
        const sample = options.samples[sampleIndex] ?? options.samples[0];
        sampleIndex = (sampleIndex + 1) % options.samples.length;
        link.notify(MEASUREMENT, encodeHeartRateMeasurement({ bpm: sample.heartRateBpm }));
      });
    },
  };
}
