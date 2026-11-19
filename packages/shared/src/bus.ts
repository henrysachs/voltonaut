import type { DeviceEvent } from "./events.js";

export type Unsubscribe = () => void;

export interface EventBus {
  publish(event: Readonly<DeviceEvent>): void;
  subscribe<Type extends DeviceEvent["type"]>(
    type: Type,
    listener: (event: Readonly<Extract<DeviceEvent, { type: Type }>>) => void,
  ): Unsubscribe;
}

type AnyEventListener = (event: Readonly<DeviceEvent>) => void;

function isDeviceEventType<Type extends DeviceEvent["type"]>(
  event: Readonly<DeviceEvent>,
  type: Type,
): event is Extract<DeviceEvent, { type: Type }> {
  return event.type === type;
}

export function createEventBus(): EventBus {
  const listeners = new Map<DeviceEvent["type"], Set<AnyEventListener>>();

  return {
    publish(event) {
      const typedListeners = listeners.get(event.type);

      if (typedListeners === undefined) {
        return;
      }

      for (const listener of typedListeners) {
        listener(event);
      }
    },

    subscribe(type, listener) {
      const typedListeners = listeners.get(type) ?? new Set<AnyEventListener>();
      listeners.set(type, typedListeners);

      const dispatch: AnyEventListener = (event) => {
        if (isDeviceEventType(event, type)) {
          listener(event);
        }
      };

      typedListeners.add(dispatch);

      return () => {
        typedListeners.delete(dispatch);

        if (typedListeners.size === 0) {
          listeners.delete(type);
        }
      };
    },
  };
}
