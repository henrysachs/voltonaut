/**
 * Scripted FTMS trainer peripheral for the sim transport: 0x2ACC features,
 * 0x2AD2 Indoor Bike Data from the sim script and a 0x2AD9 Control Point.
 * The production trainer adapter connects to it unchanged.
 */

import type { SimPeripheral } from "../sim/transport.js";
import type { SimScript } from "../sim/sample.js";
import type { TickSource } from "../sim/tick.js";
import {
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  INDOOR_BIKE_DATA,
} from "../uuids.js";
import { SimControlPoint } from "./controlSim.js";
import { encodeIndoorBikeData } from "./encode.js";
import { encodeFitnessMachineFeature } from "./feature.js";

export interface SimTrainerOptions {
  /** Paces Indoor Bike Data notifications. */
  readonly ticker: TickSource;
  readonly samples: SimScript;
}

const FEATURES = encodeFitnessMachineFeature({
  machineFeatures: ["cadence", "powerMeasurement"],
  targetFeatures: ["indoorBikeSimulationParameters"],
});

const CONTROL_POINT = {
  serviceUuid: FITNESS_MACHINE_SERVICE,
  characteristicUuid: FITNESS_MACHINE_CONTROL_POINT,
};

const BIKE_DATA = { serviceUuid: FITNESS_MACHINE_SERVICE, characteristicUuid: INDOOR_BIKE_DATA };

export function createSimTrainerPeripheral(options: SimTrainerOptions): SimPeripheral {
  const controlPoint = new SimControlPoint();
  let sampleIndex = 0;

  return {
    name: "Sim-Trainer",
    id: "sim-trainer",
    profile: {
      services: [
        {
          uuid: FITNESS_MACHINE_SERVICE,
          characteristics: [
            { uuid: FITNESS_MACHINE_FEATURE, properties: ["read"], descriptors: [] },
            { uuid: INDOOR_BIKE_DATA, properties: ["notify"], descriptors: [] },
            {
              uuid: FITNESS_MACHINE_CONTROL_POINT,
              properties: ["write", "indicate"],
              descriptors: [],
            },
          ],
        },
      ],
    },
    read: (ref) => (ref.characteristicUuid === FITNESS_MACHINE_FEATURE ? FEATURES : undefined),
    write(ref, payload, link) {
      if (ref.characteristicUuid === FITNESS_MACHINE_CONTROL_POINT) {
        link.notify(CONTROL_POINT, controlPoint.respond(payload));
      }
    },
    start(link) {
      controlPoint.reset();

      return options.ticker.start(() => {
        const sample = options.samples[sampleIndex] ?? options.samples[0];
        sampleIndex = (sampleIndex + 1) % options.samples.length;
        link.notify(
          BIKE_DATA,
          encodeIndoorBikeData({
            cadenceRaw: Math.round(sample.cadenceRpm * 2),
            powerW: Math.round(sample.powerW),
          }),
        );
      });
    },
  };
}
