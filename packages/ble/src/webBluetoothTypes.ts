/**
 * Minimal structural Web Bluetooth surface used by the transport.
 *
 * The repo deliberately does not depend on @types/web-bluetooth (it is not
 * registered in docs/dependencies.md); this module declares only the members
 * the transport calls, as readonly function properties per the repo's
 * anti-slop conventions.
 */

import { isWebBluetoothCentral } from "./webBluetoothGuards.js";

// oxlint-disable typescript/prefer-readonly-parameter-types -- these types mirror Web Bluetooth's runtime shape (Map-valued advertisement members and DataView values); the rule cannot express lib Map/typed-array readonly-ness. T6 friction, see docs/open-questions.md.
export interface WebBluetoothCharacteristicProperties {
  readonly read?: boolean;
  readonly write?: boolean;
  readonly writeWithoutResponse?: boolean;
  readonly notify?: boolean;
  readonly indicate?: boolean;
}

export interface WebBluetoothCharacteristicValueChangedEvent {
  readonly target: WebBluetoothCharacteristic;
}

export interface WebBluetoothDescriptor {
  readonly uuid: string;
}

export interface WebBluetoothCharacteristic {
  readonly uuid: string;
  readonly properties: WebBluetoothCharacteristicProperties;
  readonly value: DataView | null;
  readonly readValue: () => Promise<DataView>;
  readonly writeValue: (value: BufferSource) => Promise<void>;
  readonly writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
  readonly startNotifications: () => Promise<void>;
  readonly stopNotifications: () => Promise<void>;
  readonly getDescriptors: () => Promise<readonly WebBluetoothDescriptor[]>;
  readonly addEventListener: {
    (
      type: "characteristicvaluechanged",
      listener: (event: WebBluetoothCharacteristicValueChangedEvent) => void,
    ): void;
  };
  readonly removeEventListener: {
    (
      type: "characteristicvaluechanged",
      listener: (event: WebBluetoothCharacteristicValueChangedEvent) => void,
    ): void;
  };
}

export interface WebBluetoothService {
  readonly uuid: string;
  readonly getCharacteristic: (characteristicUuid: string) => Promise<WebBluetoothCharacteristic>;
  readonly getCharacteristics: () => Promise<readonly WebBluetoothCharacteristic[]>;
}

export interface WebBluetoothServer {
  readonly connected: boolean;
  readonly connect: () => Promise<WebBluetoothServer>;
  readonly disconnect: () => void;
  readonly getPrimaryServices: () => Promise<readonly WebBluetoothService[]>;
}

export interface WebBluetoothAdvertisementEvent {
  readonly rssi?: number;
  readonly txPower?: number;
  readonly manufacturerData: ReadonlyMap<number, DataView>;
  readonly serviceData: ReadonlyMap<string, DataView>;
}

export interface WebBluetoothDevice {
  readonly id: string;
  readonly name: string | null;
  readonly gatt: WebBluetoothServer | null;
  readonly addEventListener: {
    (type: "gattserverdisconnected", listener: () => void): void;
    (
      type: "advertisementreceived",
      listener: (event: WebBluetoothAdvertisementEvent) => void,
    ): void;
  };
  readonly removeEventListener: {
    (type: "gattserverdisconnected", listener: () => void): void;
    (
      type: "advertisementreceived",
      listener: (event: WebBluetoothAdvertisementEvent) => void,
    ): void;
  };
  readonly watchAdvertisements?: (options?: { readonly signal?: AbortSignal }) => Promise<void>;
}

export interface WebBluetoothRequestOptions {
  readonly acceptAllDevices?: boolean;
  readonly filters?: readonly {
    readonly services: readonly string[];
    readonly namePrefix?: string;
  }[];
  readonly optionalServices?: readonly string[];
}

export interface WebBluetoothCentral {
  readonly requestDevice: (options: WebBluetoothRequestOptions) => Promise<WebBluetoothDevice>;
}

/** Structural view of Navigator that may carry a bluetooth member. */
interface NavigatorBluetoothView {
  readonly userAgent: string;
  readonly bluetooth?: unknown;
}

/** navigator.bluetooth when the browser exposes Web Bluetooth; undefined otherwise. */
export function createNavigatorBluetoothCentral(): WebBluetoothCentral | undefined {
  const view: NavigatorBluetoothView = navigator;

  if (view.bluetooth === undefined) {
    return undefined;
  }

  const central: WebBluetoothCentral | undefined = isWebBluetoothCentral(view.bluetooth)
    ? view.bluetooth
    : undefined;

  return central;
}
