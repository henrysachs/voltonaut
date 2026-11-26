import {
  FTMS_CONTROL_POINT_REF,
  ZWIFT_PLAY_COMMAND_RESPONSE,
  ZWIFT_PLAY_CONTROL_POINT,
  ZWIFT_PLAY_MEASUREMENT,
  labDeviceKind,
  zwiftControllerLink,
  type BlePreset,
} from "@voltonaut/ble";
import type { LabDevice } from "./device.js";

/**
 * Why `definition` cannot apply to the connected device at all, or `undefined` when it
 * may run. Session state (control granted, preset running) is checked when it runs.
 */
export function presetMismatch(
  device: Readonly<LabDevice>,
  definition: BlePreset,
): string | undefined {
  // A failed read leaves the link up; only a missing link blocks every preset.
  if (device.state.kind === "connecting" || device.state.kind === "disconnected") {
    return "Gerät zuerst verbinden.";
  }

  const kind = labDeviceKind(device.profile);

  if (definition.kind === "zwiftController") {
    return kind.kind === "controller"
      ? undefined
      : kind.kind === "trainer"
        ? "Nur für Zwift Play und Click v2. Der Zwift-Dienst eines Trainers bleibt ungenutzt (ADR-001)."
        : "Nur für Zwift Play und Click v2.";
  }

  return kind.kind === "trainer" && kind.ftmsControl
    ? undefined
    : "Nur für Trainer mit FTMS Control Point (Write und Indicate).";
}

async function controllerHandshake(device: Readonly<LabDevice>): Promise<void> {
  const link = zwiftControllerLink(device.profile);

  if (!link.ok) {
    throw new Error(link.failure.reason);
  }

  const { serviceUuid, handshake } = link.value;
  const session = device.session;
  await session.observe({ serviceUuid, characteristicUuid: ZWIFT_PLAY_MEASUREMENT });
  await session.observe({ serviceUuid, characteristicUuid: ZWIFT_PLAY_COMMAND_RESPONSE });
  await session.transport.write(
    { serviceUuid, characteristicUuid: ZWIFT_PLAY_CONTROL_POINT },
    handshake,
    "withoutResponse",
  );
}

export async function preset(device: Readonly<LabDevice>, definition: BlePreset): Promise<void> {
  if (definition.kind === "zwiftController") {
    await controllerHandshake(device);
  } else {
    const ftms = device.ftms;

    if (ftms === undefined) {
      throw new Error("Zuerst verbinden");
    }

    const refusal = ftms.refusal(definition);

    if (refusal !== undefined) {
      throw new Error(refusal);
    }

    // The capture keeps recording control-point rx after a failed procedure stops listening.
    await device.session.observe(FTMS_CONTROL_POINT_REF);
    await ftms.run(definition);
  }

  device.session.marker(`Preset abgeschlossen: ${definition.label}`);
}
