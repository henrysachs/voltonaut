import {
  parseHex,
  type CharacteristicRef,
  type GattProfile,
  type CharacteristicInfo,
  type BleTransport,
} from "@voltonaut/ble";
import { element } from "./dom.js";
import type { SnifferSession } from "./session.js";

export type RunOperation = (operation: () => Promise<void>) => void;

function action(
  label: string,
  run: RunOperation,
  operation: () => Promise<void>,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = label;
  button.addEventListener("click", () => {
    run(operation);
  });

  return button;
}

function writeControls(
  ref: CharacteristicRef,
  transport: BleTransport,
  run: RunOperation,
): HTMLElement {
  const group = document.createElement("span");
  const input = document.createElement("input");
  const encoding = document.createElement("select");
  input.setAttribute("aria-label", `Payload ${ref.characteristicUuid}`);
  encoding.setAttribute("aria-label", `Encoding ${ref.characteristicUuid}`);

  for (const name of ["Hex", "ASCII"]) {
    const option = document.createElement("option");
    option.textContent = name;
    encoding.append(option);
  }

  group.append(
    input,
    encoding,
    action("Write", run, async () => {
      if (
        encoding.value === "ASCII" &&
        Array.from(input.value).some((char) => (char.codePointAt(0) ?? 0) > 127)
      ) {
        throw new Error("Ungültiges ASCII: nur Zeichen 0–127 erlaubt");
      }

      const bytes =
        encoding.value === "ASCII" ? new TextEncoder().encode(input.value) : parseHex(input.value);

      if (bytes === undefined) {
        throw new Error("Ungültige Hex-Bytes");
      }

      await transport.write(ref, bytes);
    }),
  );

  return group;
}

function characteristicRow(
  info: CharacteristicInfo,
  ref: CharacteristicRef,
  session: SnifferSession,
  run: RunOperation,
  registerUpdate: (update: () => void) => void,
): HTMLElement {
  const row = document.createElement("section");
  const transport = session.transport;
  const title = document.createElement("p");
  title.textContent = `${info.uuid} [${info.properties.join(", ")}] Descriptors: ${info.descriptors.join(", ") || "–"}`;
  row.append(title);

  if (info.properties.includes("read")) {
    row.append(
      action("Read", run, async () => {
        await transport.read(ref);
      }),
    );
  }

  if (info.properties.includes("notify") || info.properties.includes("indicate")) {
    const subscribe = action("Subscribe", run, async () => {
      await session.observe(ref);
      update();
    });

    const unsubscribe = action("Unsubscribe", run, async () => {
      session.unobserve(ref);
      update();
      await Promise.resolve();
    });

    const update = (): void => {
      subscribe.disabled = session.isObserving(ref);
      unsubscribe.disabled = !session.isObserving(ref);
    };

    update();
    registerUpdate(update);
    row.append(subscribe, unsubscribe);
  }

  if (info.properties.includes("write") || info.properties.includes("writeWithoutResponse")) {
    row.append(writeControls(ref, transport, run));
  }

  return row;
}

export function renderExplorer(
  rootId: string,
  profile: GattProfile,
  session: SnifferSession,
  run: RunOperation,
): () => void {
  const root = element(rootId);
  const updates: (() => void)[] = [];
  root.replaceChildren();

  for (const service of profile.services) {
    const heading = document.createElement("h3");
    heading.textContent = service.uuid;
    root.append(heading);

    for (const info of service.characteristics) {
      root.append(
        characteristicRow(
          info,
          { serviceUuid: service.uuid, characteristicUuid: info.uuid },
          session,
          run,
          (update) => {
            updates.push(update);
          },
        ),
      );
    }
  }

  return () => {
    for (const update of updates) {
      update();
    }
  };
}
