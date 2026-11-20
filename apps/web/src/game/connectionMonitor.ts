import type { DeviceEvent, EventBus } from "@voltonaut/shared";

export interface ConnectionState {
  readonly connected: boolean;
}

export interface ConnectionMonitor {
  readonly state: () => ConnectionState;
  readonly dispose: () => void;
}

/** Tracks trainer readiness independently of keyboard and heart-rate connections. */
export function createConnectionMonitor(bus: EventBus): ConnectionMonitor {
  const readyDevices = new Set<string>();

  let connected = false;

  const unsubscribe = bus.subscribe("device.status", (event: DeviceEvent) => {
    if (event.type !== "device.status" || event.kind !== "trainer") {
      return;
    }

    if (event.status === "ready") {
      readyDevices.add(event.id);
    } else {
      readyDevices.delete(event.id);
    }

    connected = readyDevices.size > 0;
  });

  return {
    state: () => ({ connected }),
    dispose() {
      unsubscribe();
    },
  };
}
