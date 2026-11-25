import type { EventBus } from "@voltonaut/shared";
import { bytesToDataView, type ReadOnlyBytes } from "../bytes.js";
import type { NotificationListener } from "../transport.js";
import { FITNESS_MACHINE_CONTROL_POINT, FITNESS_MACHINE_SERVICE } from "../uuids.js";
import { createFtmsControl } from "./controlConnection.js";
import type { ControlTransport } from "./controlProcedure.js";
import type { ControlOptions } from "./controlState.js";

class SimControlPoint {
  private phase: "unowned" | "owned" | "started" = "unowned";
  private receive: NotificationListener | undefined;
  readonly transport: ControlTransport = {
    subscribe: (_ref, listener) => {
      this.receive = listener;

      return Promise.resolve(() => {
        if (this.receive === listener) this.receive = undefined;
      });
    },
    write: (_ref, bytes, mode) => {
      if (mode === "withResponse") this.write(bytes);

      return Promise.resolve();
    },
  };

  reset(): void {
    this.phase = "unowned";
  }

  private write(bytes: ReadOnlyBytes): void {
    const opcode = bytes.at(0);
    let result = 5;

    if (opcode === 0 && bytes.length === 1 && this.phase === "unowned") {
      this.phase = "owned";
      result = 1;
    } else if (opcode === 7 && bytes.length === 1 && this.phase === "owned") {
      this.phase = "started";
      result = 1;
    } else if (opcode === 0x11 && bytes.length === 7 && this.phase === "started") result = 1;
    else if (opcode === 8 && bytes.length === 2 && bytes.at(1) === 1 && this.phase === "started") {
      this.phase = "owned";
      result = 1;
    }

    this.receive?.(bytesToDataView(Uint8Array.of(0x80, opcode ?? 0xff, result)));
  }
}

/** Protocol simulator, not a physical trainer model: uses the production ACK/authority path. */
export function createSimTrainerControl(options: Omit<ControlOptions, "transport">, bus: EventBus) {
  const io = new SimControlPoint();
  const control = createFtmsControl({ ...options, transport: io.transport }, bus);

  return {
    control,
    connect(): void {
      io.reset();
      control.attach(
        {
          services: [
            {
              uuid: FITNESS_MACHINE_SERVICE,
              characteristics: [
                {
                  uuid: FITNESS_MACHINE_CONTROL_POINT,
                  properties: ["write", "indicate"],
                  descriptors: [],
                },
              ],
            },
          ],
        },
        {
          machineDwordHex: "0x00000000",
          machineFeatures: [],
          targetFeatures: ["indoorBikeSimulationParameters"],
        },
      );
    },
  };
}
