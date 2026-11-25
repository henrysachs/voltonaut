import {
  FTMS_CONTROL_POINT_REF,
  ZWIFT_PLAY_LEGACY_SERVICE,
  ZWIFT_PLAY_V2_SERVICE,
  type BlePreset,
  type CharacteristicRef,
} from "@voltonaut/ble";
import type { LabDevice } from "./device.js";

type PlayPreset = Extract<BlePreset, { readonly kind: "zwiftPlay" }>;

async function playHandshake(device: Readonly<LabDevice>, definition: PlayPreset): Promise<void> {
  const playService = device.profile.services.find(
    (service) =>
      service.uuid === ZWIFT_PLAY_LEGACY_SERVICE || service.uuid === ZWIFT_PLAY_V2_SERVICE,
  );

  const onDevice = (ref: CharacteristicRef): CharacteristicRef =>
    playService === undefined ? ref : { ...ref, serviceUuid: playService.uuid };

  const session = device.session;
  await Promise.all(definition.observe.map((ref) => session.observe(onDevice(ref))));
  await session.transport.write(onDevice(definition.write.ref), definition.write.bytes);
}

export async function preset(device: Readonly<LabDevice>, definition: BlePreset): Promise<void> {
  if (definition.kind === "zwiftPlay") {
    await playHandshake(device, definition);
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
