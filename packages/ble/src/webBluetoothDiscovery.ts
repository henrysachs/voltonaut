/**
 * GATT discovery helpers for the Web Bluetooth transport: profile assembly and
 * characteristic resolution from the connected server.
 */

// oxlint-disable typescript/prefer-readonly-parameter-types -- operates on the Web Bluetooth structural types with lib DataView members; the rule cannot express their readonly-ness. T6 friction, see docs/open-questions.md.
import type { CharacteristicRef, GattProfile, GattProperty } from "./transport.js";
import { normalizeUuid } from "./uuids.js";
import type {
  WebBluetoothCharacteristic,
  WebBluetoothCharacteristicProperties,
  WebBluetoothDescriptor,
  WebBluetoothServer,
  WebBluetoothService,
} from "./webBluetoothTypes.js";

export interface GattServices {
  readonly services: Map<string, WebBluetoothService>;
}

export function toGattProperties(
  properties: WebBluetoothCharacteristicProperties,
): readonly GattProperty[] {
  const gattProperties: GattProperty[] = [];

  if (properties.read === true) {
    gattProperties.push("read");
  }

  if (properties.write === true) {
    gattProperties.push("write");
  }

  if (properties.writeWithoutResponse === true) {
    gattProperties.push("writeWithoutResponse");
  }

  if (properties.notify === true) {
    gattProperties.push("notify");
  }

  if (properties.indicate === true) {
    gattProperties.push("indicate");
  }

  return gattProperties;
}

function toDescriptorUuids(descriptors: readonly WebBluetoothDescriptor[]): readonly string[] {
  const uuids: string[] = [];

  for (const descriptor of descriptors) {
    const uuid = normalizeUuid(descriptor.uuid);

    if (uuid !== undefined) {
      uuids.push(uuid);
    }
  }

  return uuids;
}

function emptyDescriptorUuids(): readonly string[] {
  return [];
}

function sequentially<T, U>(
  values: readonly T[],
  visit: (value: T) => Promise<U>,
): Promise<readonly U[]> {
  const results: U[] = [];

  const next = async (index: number): Promise<readonly U[]> => {
    const value = values[index];

    if (value === undefined) {
      return results;
    }

    results.push(await visit(value));

    return next(index + 1);
  };

  return next(0);
}

async function discoverService(
  state: GattServices,
  service: WebBluetoothService,
  signal: AbortSignal,
): Promise<GattProfile["services"][number]> {
  signal.throwIfAborted();
  const serviceUuid = normalizeUuid(service.uuid) ?? service.uuid;
  state.services.set(serviceUuid, service);

  const characteristics = await service.getCharacteristics();

  const profileCharacteristics = await sequentially(
    characteristics,
    async (characteristic: WebBluetoothCharacteristic) => {
      signal.throwIfAborted();

      const descriptors = await characteristic
        .getDescriptors()
        .then(toDescriptorUuids)
        .catch(emptyDescriptorUuids);

      signal.throwIfAborted();

      return {
        uuid: normalizeUuid(characteristic.uuid) ?? characteristic.uuid,
        properties: toGattProperties(characteristic.properties),
        descriptors,
      };
    },
  );

  return { uuid: serviceUuid, characteristics: profileCharacteristics };
}

export async function discoverProfile(
  state: GattServices,
  server: WebBluetoothServer,
  signal: AbortSignal,
): Promise<GattProfile> {
  const primaryServices = await server.getPrimaryServices();

  const services = await sequentially(primaryServices, (service) =>
    discoverService(state, service, signal),
  );

  return { services };
}

export function resolveCharacteristic(
  state: GattServices,
  ref: CharacteristicRef,
): Promise<WebBluetoothCharacteristic> {
  const serviceUuid = normalizeUuid(ref.serviceUuid) ?? ref.serviceUuid;
  const characteristicUuid = normalizeUuid(ref.characteristicUuid) ?? ref.characteristicUuid;
  const service = state.services.get(serviceUuid);

  if (service === undefined) {
    return Promise.reject(new Error(`service ${serviceUuid} is not connected`));
  }

  return service.getCharacteristic(characteristicUuid);
}
