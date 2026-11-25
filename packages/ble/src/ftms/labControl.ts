import type { SimClock } from "../sim/clock.js";
import type { TickSource } from "../sim/tick.js";
import type { CharacteristicRef, GattProfile } from "../transport.js";
import {
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
} from "../uuids.js";
import { ControlProcedure, type ControlTransport } from "./controlProcedure.js";
import type { FtmsPreset, FtmsPresetCommand } from "./presets.js";

export const FTMS_CONTROL_POINT_REF: CharacteristicRef = {
  serviceUuid: FITNESS_MACHINE_SERVICE,
  characteristicUuid: FITNESS_MACHINE_CONTROL_POINT,
};

export type LabControlAuthority =
  | { readonly kind: "unrequested" }
  | { readonly kind: "running" }
  | { readonly kind: "granted" }
  | { readonly kind: "unusable"; readonly reason: string };

export interface LabControlOptions {
  readonly transport: ControlTransport;
  readonly profile: GattProfile;
  readonly clock: SimClock;
  readonly ticker: TickSource;
}

function properties(profile: GattProfile, uuid: string): readonly string[] {
  return (
    profile.services
      .find((service) => service.uuid === FITNESS_MACHINE_SERVICE)
      ?.characteristics.find((characteristic) => characteristic.uuid === uuid)?.properties ?? []
  );
}

export function isFtmsControlPoint(ref: CharacteristicRef): boolean {
  return (
    ref.serviceUuid === FTMS_CONTROL_POINT_REF.serviceUuid &&
    ref.characteristicUuid === FTMS_CONTROL_POINT_REF.characteristicUuid
  );
}

/** Preset authority of one GATT session; only a new instance after reconnect may control again. */
export interface LabControl {
  readonly view: () => LabControlAuthority;
  /** Why `run(preset)` would refuse without writing, or `undefined` when it may start. */
  readonly refusal: (preset: FtmsPreset) => string | undefined;
  /** Rejects without any write when refused; rejects and blocks the session on any failure. */
  readonly run: (preset: FtmsPreset) => Promise<void>;
  /** Blocks control until reconnect; used after disconnect or raw control-point writes. */
  readonly invalidate: (reason: string) => void;
}

type ProcedureRunner = Readonly<Pick<ControlProcedure, "run">>;

/**
 * Every lab control-point write goes through `ControlProcedure` (exact opcode, one
 * pending procedure, 3-s deadline). Any failure leaves the session unusable for
 * control: an unacknowledged procedure cannot be told apart from a late reply on the
 * same connection (docs/02-bluetooth.md#e2-03-rollenschaltung).
 */
class FtmsLabControl {
  private authority: LabControlAuthority = { kind: "unrequested" };
  private procedure: ControlProcedure | undefined;

  constructor(private readonly options: LabControlOptions) {}

  view(): LabControlAuthority {
    return this.authority;
  }

  invalidate(reason: string): void {
    if (this.authority.kind === "unusable") return;
    this.authority = { kind: "unusable", reason };
    this.procedure?.dispose();
  }

  private open(): Promise<ProcedureRunner | undefined> {
    if (this.procedure !== undefined) return Promise.resolve(this.procedure);

    const procedure = new ControlProcedure(
      this.options.transport,
      this.options.clock,
      this.options.ticker,
      (reason) => {
        this.invalidate(reason);
      },
    );

    this.procedure = procedure;

    const statusNotifications = properties(this.options.profile, FITNESS_MACHINE_STATUS).includes(
      "notify",
    );

    return procedure.open(statusNotifications).then((opened) => (opened ? procedure : undefined));
  }

  private async runFrom(
    procedure: ProcedureRunner,
    commands: readonly FtmsPresetCommand[],
    index: number,
  ): Promise<boolean> {
    const next = commands[index];

    if (next === undefined) return true;

    const acknowledged = await procedure.run(next.opcode, next.bytes);

    return acknowledged && this.runFrom(procedure, commands, index + 1);
  }

  refusal(preset: FtmsPreset): string | undefined {
    const current = this.authority;

    if (current.kind === "unusable") return `FTMS-Presets gesperrt: ${current.reason}`;

    if (current.kind === "running") return "FTMS-Preset läuft bereits.";

    const controlPoint = properties(this.options.profile, FITNESS_MACHINE_CONTROL_POINT);

    if (!controlPoint.includes("write") || !controlPoint.includes("indicate")) {
      return "FTMS Control Point mit Write und Indicate fehlt.";
    }

    return preset.authority === "granted" && current.kind !== "granted"
      ? "Zuerst FTMS Request Control erfolgreich ausführen."
      : undefined;
  }

  async run(preset: FtmsPreset): Promise<void> {
    const refusal = this.refusal(preset);

    if (refusal !== undefined) throw new Error(refusal);

    const previous = this.authority;
    this.authority = { kind: "running" };
    const procedure = await this.open();

    const acknowledged =
      procedure !== undefined && (await this.runFrom(procedure, preset.commands, 0));

    // Read through view(): failure callbacks may have invalidated the session during the awaits.
    const settled = this.view();

    if (!acknowledged || settled.kind !== "running") {
      this.invalidate("FTMS-Verfahren fehlgeschlagen. Neu verbinden; Widerstand unbekannt.");
      const failed = this.view();

      throw new Error(
        failed.kind === "unusable" ? failed.reason : "FTMS-Verfahren fehlgeschlagen.",
      );
    }

    this.authority = preset.authority === "acquire" ? { kind: "granted" } : previous;
  }
}

export function createFtmsLabControl(options: LabControlOptions): LabControl {
  const control = new FtmsLabControl(options);

  return {
    view: () => control.view(),
    refusal: (preset) => control.refusal(preset),
    run: (preset) => control.run(preset),
    invalidate: (reason) => {
      control.invalidate(reason);
    },
  };
}
