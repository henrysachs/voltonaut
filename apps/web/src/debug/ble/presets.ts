import {
  runBlePreset,
  ZWIFT_PLAY_LEGACY_SERVICE,
  ZWIFT_PLAY_V2_SERVICE,
  type BlePreset,
} from "@voltonaut/ble";
import type { LabDevice } from "./device.js";

function devicePreset(device: Readonly<LabDevice>, definition: BlePreset): BlePreset {
  const playService = device.profile.services.find(
    (service) =>
      service.uuid === ZWIFT_PLAY_LEGACY_SERVICE || service.uuid === ZWIFT_PLAY_V2_SERVICE,
  );

  return definition.id === "zwift-play-handshake" && playService !== undefined
    ? {
        ...definition,
        steps: definition.steps.map((step) => ({
          ...step,
          ref: { ...step.ref, serviceUuid: playService.uuid },
        })),
      }
    : definition;
}

export async function preset(
  device: Readonly<LabDevice>,
  definition: BlePreset,
  timing: Pick<Parameters<typeof runBlePreset>[0], "clock" | "ticker">,
): Promise<void> {
  if (definition.id === "ftms-sim-five" && device.control !== "granted") {
    throw new Error("Zuerst FTMS Request Control + Sim 0 % erfolgreich ausführen");
  }

  const session = device.session;

  const selectedPreset = devicePreset(device, definition);

  if (definition.id === "zwift-play-handshake") {
    await Promise.all(
      selectedPreset.steps.map((step) =>
        step.kind === "subscribe" ? session.observe(step.ref) : Promise.resolve(),
      ),
    );
  }

  const ok = await runBlePreset({
    transport: session.transport,
    preset: selectedPreset,
    ...timing,
  });

  if (!ok) {
    throw new Error("Preset timeout: keine erfolgreiche Control-Point-Antwort");
  }

  if (definition.id === "ftms-request-control-sim-zero") {
    device.grantControl();
  }

  session.marker(`Preset abgeschlossen: ${definition.label}`);
}
