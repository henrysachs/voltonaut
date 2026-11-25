import type { DeviceEvent, EventBus } from "@voltonaut/shared";
import type { GattProfile } from "../transport.js";
import {
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
} from "../uuids.js";
import type { FitnessMachineFeature } from "./feature.js";
import type { SimulationCommand } from "./controlCodec.js";
import {
  FRESH_S,
  type ControlOptions,
  type TrainerControl,
  type TrainerControlView,
  type TrainerEngineUpdate,
} from "./controlState.js";
import { FtmsControlSession } from "./controlSession.js";

export type { TrainerControl } from "./controlState.js";

type TrainerDataEvent = Extract<DeviceEvent, { readonly type: "trainer.data" }>;

function properties(profile: GattProfile, uuid: string): readonly string[] {
  return (
    profile.services
      .find((service) => service.uuid === FITNESS_MACHINE_SERVICE)
      ?.characteristics.find((characteristic) => characteristic.uuid === uuid)?.properties ?? []
  );
}

/**
 * Adapter-owned handle: GATT generation and parsed samples come from the trainer adapter
 * itself. Not exported from the package; consumers only see TrainerControl.
 */
export interface FtmsControlConnection extends TrainerControl {
  readonly attach: (profile: GattProfile, features?: FitnessMachineFeature) => void;
  readonly detach: () => void;
  /** The single path for parsed trainer samples: feeds control cadence, then the bus. */
  readonly publishData: (event: TrainerDataEvent) => void;
  readonly dispose: () => void;
}

class FtmsControl implements FtmsControlConnection {
  private session: FtmsControlSession | undefined;
  /** Latest engine target. The engine emits only changes, so it holds until replaced. */
  private engineTarget: SimulationCommand | undefined;
  /** Wall time of the last forwarded engine update; a stalled engine stops confirming. */
  private engineS = -Infinity;

  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly options: ControlOptions,
    private readonly bus: EventBus,
  ) {}

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  attach(profile: GattProfile, features?: FitnessMachineFeature): void {
    this.detach();
    const cp = properties(profile, FITNESS_MACHINE_CONTROL_POINT);

    if (
      features?.targetFeatures.includes("indoorBikeSimulationParameters") === true &&
      cp.includes("write") &&
      cp.includes("indicate")
    ) {
      this.session = new FtmsControlSession(
        this.options,
        properties(profile, FITNESS_MACHINE_STATUS).includes("notify"),
        () => {
          this.changed();
        },
      );
    }

    this.changed();
  }

  detach(): void {
    this.session?.dispose();
    this.session = undefined;
    this.changed();
  }

  private engineAlive(): boolean {
    const ageS = this.options.clock.nowS() - this.engineS;

    return Number.isFinite(ageS) && ageS >= 0 && ageS <= FRESH_S;
  }

  /**
   * The held engine target is offered to the session while the engine is alive. The session
   * alone decides "pedaling" (fresh device cadence > 0), authority and the transport rate.
   */
  private confirm(): void {
    if (this.engineTarget !== undefined && this.engineAlive())
      this.session?.submit(this.engineTarget);
  }

  publishData(event: TrainerDataEvent): void {
    if (event.cadenceRpm !== undefined) {
      this.session?.observeCadence(event.cadenceRpm);
      this.confirm();
    }

    this.bus.publish(event);
  }

  forward(update: TrainerEngineUpdate): void {
    for (const command of update.commands)
      if (command.type === "simulation") this.engineTarget = command;

    // An auto-paused engine discards the held target, so a first pedal stroke cannot write
    // a pre-pause target before the engine resumes; the engine's resume command sets it again.
    if (update.paused) this.engineTarget = undefined;
    this.engineS = this.options.clock.nowS();
    this.confirm();
  }

  async enable(): Promise<void> {
    await this.session?.enable(this.options.clockScale);
  }
  async disable(): Promise<void> {
    await this.session?.disable();
  }

  view(): TrainerControlView {
    return (
      this.session?.view() ?? {
        authority: {
          kind: "inactive",
          reason:
            "Nur Messwerte: FTMS-Simulation mit Write und Indicate erforderlich. Trainer verbinden.",
        },
        available: false,
        target: undefined,
        acknowledged: undefined,
        hardware: "unknown",
      }
    );
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.detach();
    this.engineTarget = undefined;
    this.listeners.clear();
  }
}

export function createFtmsControl(options: ControlOptions, bus: EventBus): FtmsControlConnection {
  return new FtmsControl(options, bus);
}
