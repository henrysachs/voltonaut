import type { ControllerButton } from "@voltonaut/shared";
import type { ByteReader } from "../bytes.js";
import { clickV2Side, parseClickV2Input } from "./clickV2.js";
import type { ZwiftControllerFamily } from "./controller.js";
import { parsePlayInput, type PlaySide } from "./parse.js";

export type ShiftButton = Extract<ControllerButton, "shiftUp" | "shiftDown">;

export const SIDE_TEXT: Readonly<Record<PlaySide, string>> = { left: "links", right: "rechts" };

/** One decoded frame: the proven side (once a button shows it) and the held shift buttons. */
export interface ControllerFrame {
  readonly side: PlaySide | undefined;
  readonly held: ReadonlySet<ShiftButton>;
}

function playFrame(data: ByteReader): ControllerFrame | undefined {
  const parsed = parsePlayInput(data);

  if (!parsed.ok) return undefined;

  const { side, buttons } = parsed.value;
  const held = new Set<ShiftButton>();

  if (buttons.shift) held.add(side === "right" ? "shiftUp" : "shiftDown");

  return { side, held };
}

// UNVERIFIED: docs/02-bluetooth.md#zwift-click-v2 – + up, − down, B down on the right puck.
function clickV2Frame(data: ByteReader): ControllerFrame | undefined {
  const parsed = parseClickV2Input(data);

  if (!parsed.ok) return undefined;

  const { pressed } = parsed.value;
  const first = pressed[0];
  const held = new Set<ShiftButton>();

  if (pressed.includes("plus")) held.add("shiftUp");

  if (pressed.includes("minus") || pressed.includes("b")) held.add("shiftDown");

  return { side: first === undefined ? undefined : clickV2Side(first), held };
}

export function controllerFrame(
  family: ZwiftControllerFamily,
  data: ByteReader,
): ControllerFrame | undefined {
  return family === "clickV2" ? clickV2Frame(data) : playFrame(data);
}

export function controllerName(family: ZwiftControllerFamily): string {
  return family === "clickV2" ? "Click-v2-Puck" : "Griff";
}

/** Which buttons shift on the confirmed side, for the connect dialog. */
export function shiftHint(family: ZwiftControllerFamily, side: PlaySide): string {
  if (family === "play") return `Seitentaste schaltet ${side === "left" ? "runter" : "hoch"}.`;

  return side === "left" ? "− schaltet runter." : "+ schaltet hoch, B schaltet runter.";
}
