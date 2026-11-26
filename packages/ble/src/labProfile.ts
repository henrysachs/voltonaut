/**
 * What the BLE lab can tell about a connected device from its GATT profile alone:
 * which kind of device it is, which characteristics to record and read right after
 * connecting, and which presets make sense. Display and capture only; no adapter
 * decision depends on it.
 */

import type { CharacteristicRef, GattProfile, GattProperty } from "./transport.js";
import {
  CYCLING_POWER_SERVICE,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
  HEART_RATE_SERVICE,
  ZWIFT_CLICK_V2_UNKNOWN_CHARACTERISTICS,
  ZWIFT_PLAY_LEGACY_SERVICE,
  ZWIFT_PLAY_V2_SERVICE,
} from "./uuids.js";
import { zwiftControllerLink, type ZwiftControllerFamily } from "./zwift-play/controller.js";

export type LabDeviceKind =
  | { readonly kind: "trainer"; readonly ftmsControl: boolean }
  | { readonly kind: "controller"; readonly family: ZwiftControllerFamily }
  | { readonly kind: "heartRate" }
  | { readonly kind: "unknown" };

export interface LabDeviceGuide {
  readonly device: LabDeviceKind;
  readonly title: string;
  /** Ordered steps for a complete capture of this device. */
  readonly steps: readonly string[];
}

function hasService(profile: GattProfile, uuid: string): boolean {
  return profile.services.some((service) => service.uuid === uuid);
}

function hasProperty(
  profile: GattProfile,
  serviceUuid: string,
  characteristicUuid: string,
  property: GattProperty,
): boolean {
  return profile.services.some(
    (service) =>
      service.uuid === serviceUuid &&
      service.characteristics.some(
        (characteristic) =>
          characteristic.uuid === characteristicUuid &&
          characteristic.properties.includes(property),
      ),
  );
}

export function labDeviceKind(profile: GattProfile): LabDeviceKind {
  if (hasService(profile, FITNESS_MACHINE_SERVICE) || hasService(profile, CYCLING_POWER_SERVICE)) {
    return {
      kind: "trainer",
      ftmsControl:
        hasProperty(profile, FITNESS_MACHINE_SERVICE, FITNESS_MACHINE_CONTROL_POINT, "write") &&
        hasProperty(profile, FITNESS_MACHINE_SERVICE, FITNESS_MACHINE_CONTROL_POINT, "indicate"),
    };
  }

  const controller = zwiftControllerLink(profile);

  if (controller.ok) return { kind: "controller", family: controller.value.family };

  return hasService(profile, HEART_RATE_SERVICE) ? { kind: "heartRate" } : { kind: "unknown" };
}

const MARKER_HINT =
  "Vor jeder Aktion einen Marker setzen, der genau beschreibt, was du gleich tust (z. B. „rechts + 3×“).";

function trainerGuide(ftmsControl: boolean): LabDeviceGuide {
  return {
    device: { kind: "trainer", ftmsControl },
    title: ftmsControl ? "Trainer mit FTMS-Steuerung" : "Trainer nur mit Messwerten",
    steps: [
      "Zwift, Wahoo-App und Uhren vom Trainer trennen. Nur eine App darf steuern.",
      "Firmware, Fähigkeiten (0x2ACC) und Bereiche liest das Labor beim Verbinden automatisch.",
      "Marker „locker treten“ setzen und 30 s gleichmäßig treten. Watt und Kadenz erscheinen dekodiert.",
      ...(ftmsControl
        ? [
            "„FTMS Request Control + Start + Sim 0 %“ einmal drücken. Erwartet: drei Antworten; Start darf „failed“ melden, wenn der Trainer schon läuft.",
            "Marker „Sim 5 %“ setzen, „FTMS Sim 5 %“ drücken und 30 s treten. Der Widerstand sollte steigen.",
            "Für einen neuen Steuerversuch erst „Erneut verbinden“. Nach einem Fehler sperrt das Labor die Presets.",
          ]
        : ["Dieser Trainer bietet keinen FTMS Control Point. Widerstandstests entfallen."]),
      "„Export“ beim Gerät drücken und die Datei an die Entwicklung geben.",
    ],
  };
}

function controllerGuide(family: ZwiftControllerFamily): LabDeviceGuide {
  const clickV2 = family === "clickV2";

  return {
    device: { kind: "controller", family },
    title: clickV2 ? "Zwift Click v2 (ein Puck)" : "Zwift Play (ein Griff)",
    steps: [
      "Zwift und Companion-App schließen. Controller durch Tastendruck aufwecken (LED blinkt).",
      "„Zwift-Controller-Handshake“ drücken. Erwartet: Antwort „RideOn…“ im Log.",
      "10 s nichts drücken. So sehen wir die Leerlauf-Nachrichten.",
      MARKER_HINT,
      clickV2
        ? "Jede Taste einzeln 3× drücken: rechter Puck A, B, Y, Z, +; linker Puck Steuerkreuz und −."
        : "Jede Taste einzeln 3× drücken, dann die Seitentaste und das Paddel langsam durchziehen.",
      ...(clickV2
        ? [
            "Kommen nach etwa einer Minute keine Tasten mehr an, ist der linke Puck gesperrt. Ihn einmal in der Zwift-App verbinden, Zwift schließen und erneut aufzeichnen.",
          ]
        : []),
      "„Export“ beim Gerät drücken. Jeder Griff oder Puck bekommt eine eigene Datei.",
    ],
  };
}

export function labDeviceGuide(profile: GattProfile): LabDeviceGuide {
  const device = labDeviceKind(profile);

  switch (device.kind) {
    case "trainer":
      return trainerGuide(device.ftmsControl);
    case "controller":
      return controllerGuide(device.family);
    case "heartRate":
      return {
        device,
        title: "Pulsgurt",
        steps: [
          "Gurt anfeuchten und anlegen. Andere Apps trennen; viele Gurte erlauben nur 1–2 Verbindungen.",
          "60 s ruhig sitzen, danach 60 s treten. Puls erscheint dekodiert.",
          "„Export“ beim Gerät drücken.",
        ],
      };
    case "unknown":
      return {
        device,
        title: "Unbekanntes Gerät",
        steps: [
          "Alle Notify- und Indicate-Kanäle laufen bereits mit.",
          MARKER_HINT,
          "Jede Bedienung am Gerät einzeln und mehrfach ausführen.",
          "Schreibzugriffe nur gezielt im GATT-Explorer und nur nach Absprache.",
          "„Export“ beim Gerät drücken.",
        ],
      };
    default: {
      const exhaustive: never = device;

      return exhaustive;
    }
  }
}

function refs(
  profile: GattProfile,
  keep: (
    serviceUuid: string,
    characteristicUuid: string,
    properties: readonly GattProperty[],
  ) => boolean,
): readonly CharacteristicRef[] {
  const found: CharacteristicRef[] = [];

  for (const service of profile.services) {
    for (const characteristic of service.characteristics) {
      if (keep(service.uuid, characteristic.uuid, characteristic.properties)) {
        found.push({ serviceUuid: service.uuid, characteristicUuid: characteristic.uuid });
      }
    }
  }

  return found;
}

function isZwiftService(serviceUuid: string): boolean {
  return serviceUuid === ZWIFT_PLAY_LEGACY_SERVICE || serviceUuid === ZWIFT_PLAY_V2_SERVICE;
}

/**
 * Every notify/indicate characteristic, recorded from connect on. Subscribing writes only
 * the CCCD. The Click v2 characteristics of unknown purpose stay manual. On a trainer the
 * proprietary Zwift service stays untouched (ADR-001): even enabling its indications might
 * switch a Zwift Hub into its own mode, which nobody has verified.
 */
export function labRecordedCharacteristics(profile: GattProfile): readonly CharacteristicRef[] {
  const trainer = labDeviceKind(profile).kind === "trainer";

  return refs(
    profile,
    (service, characteristic, properties) =>
      (properties.includes("notify") || properties.includes("indicate")) &&
      !ZWIFT_CLICK_V2_UNKNOWN_CHARACTERISTICS.includes(characteristic) &&
      (!trainer || !isZwiftService(service)),
  );
}

/** Every readable characteristic outside the proprietary Zwift services. */
export function labReadableCharacteristics(profile: GattProfile): readonly CharacteristicRef[] {
  return refs(
    profile,
    (service, _characteristic, properties) =>
      properties.includes("read") && !isZwiftService(service),
  );
}
