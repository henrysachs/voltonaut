import type { GattProfile } from "../transport.js";
import {
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
} from "../uuids.js";
import type { FitnessMachineFeature } from "./feature.js";
import type { SimulationCommand } from "./controlCodec.js";
import type { ControlOptions, TrainerControl, TrainerControlView } from "./controlState.js";
import { FtmsControlSession } from "./controlSession.js";

export type { TrainerControl, TrainerAuthority, TrainerControlView } from "./controlState.js";

function properties(profile: GattProfile, uuid: string): readonly string[] {
  return (
    profile.services
      .find((service) => service.uuid === FITNESS_MACHINE_SERVICE)
      ?.characteristics.find((characteristic) => characteristic.uuid === uuid)?.properties ?? []
  );
}

export interface FtmsControlConnection extends TrainerControl {
  readonly attach: (profile: GattProfile, features?: FitnessMachineFeature) => void;
  readonly detach: () => void;
  readonly observeCadence: (rpm: number) => void;
  readonly dispose: () => void;
}

class FtmsControl implements FtmsControlConnection {
  private session: FtmsControlSession | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: ControlOptions) {}

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
  observeCadence(rpm: number): void {
    this.session?.observeCadence(rpm);
  }
  async enable(clockScale = 1): Promise<void> {
    await this.session?.enable(clockScale);
  }
  async disable(): Promise<void> {
    await this.session?.disable();
  }
  submit(command: SimulationCommand): void {
    this.session?.submit(command);
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
    this.listeners.clear();
  }
}

export function createFtmsControl(options: ControlOptions): FtmsControlConnection {
  return new FtmsControl(options);
}
