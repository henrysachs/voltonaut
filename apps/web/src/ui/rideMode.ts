import { DEFAULT_RIDE_MODE, RIDE_MODE_IDS, RIDE_MODES, type RideMode } from "@voltonaut/shared";

import type { EngineLink } from "../game/engine-link.js";
import type { CaptureView, RecordingControls } from "../game/rideCaptureProtocol.js";

/** Menu copy per ride mode; an empty hint shows nothing. */
export const RIDE_MODE_COPY: Readonly<
  Record<RideMode, { readonly label: string; readonly hint: string }>
> = Object.freeze({
  normal: Object.freeze({ label: "Normal", hint: "" }),
  fun: Object.freeze({
    label: "Spaß (Item-Boxen)",
    hint: "Item-Boxen einsammeln und mit P auslösen. Keine Aufnahme, keine Belohnungen. Spätere Aufnahmen dieser Sitzung bleiben nur lokal.",
  }),
});

export const UNRECORDABLE_LOCKED_HINT = "Während einer Aufnahme sind Modi ohne Aufnahme gesperrt.";

/** The mode picker as the binding sees it; the DOM adapter maps it onto radio buttons. */
export interface RideModeView {
  readonly select: (mode: RideMode) => void;
  readonly onChange: (listener: (mode: RideMode) => void) => () => void;
  readonly setEnabled: (mode: RideMode, enabled: boolean) => void;
  readonly setHint: (text: string) => void;
}

export interface RideModeLink {
  readonly setMode: EngineLink["setMode"];
  readonly recording: Pick<RecordingControls, "state" | "subscribe">;
}

/** A running or unreleased recording must not contain unreplayable mode effects (ADR-028). */
function recordingLocked(view: CaptureView): boolean {
  return view.kind === "recording" || view.kind === "completed";
}

function available(mode: RideMode, locked: boolean): boolean {
  return !locked || RIDE_MODES[mode].recordable;
}

/**
 * Binds the in-ride mode picker to the engine. The ride keeps running while the
 * menu is open; the worker independently refuses unrecordable modes during a recording.
 */
export function bindRideMode(view: RideModeView, link: RideModeLink): () => void {
  let mode: RideMode = DEFAULT_RIDE_MODE;

  const refresh = (capture: CaptureView): void => {
    const locked = recordingLocked(capture);

    // A recording that reached the worker first made it ignore the request: follow the worker.
    if (!available(mode, locked)) {
      mode = DEFAULT_RIDE_MODE;
      view.select(mode);
      link.setMode(mode);
    }

    for (const id of RIDE_MODE_IDS) view.setEnabled(id, available(id, locked));

    const hint = RIDE_MODE_COPY[mode].hint;
    const anyLocked = RIDE_MODE_IDS.some((id) => !available(id, locked));

    view.setHint(hint === "" && anyLocked ? UNRECORDABLE_LOCKED_HINT : hint);
  };

  view.select(mode);
  refresh(link.recording.state());

  const stopChanges = view.onChange((requested) => {
    if (!available(requested, recordingLocked(link.recording.state()))) {
      view.select(mode);
      refresh(link.recording.state());

      return;
    }

    mode = requested;
    link.setMode(requested);
    refresh(link.recording.state());
  });

  const stopRecording = link.recording.subscribe(refresh);

  return () => {
    stopChanges();
    stopRecording();
  };
}

interface ModeOption {
  readonly label: HTMLLabelElement;
  readonly input: HTMLInputElement;
}

function modeOption(mode: RideMode): ModeOption {
  const label = document.createElement("label");
  const input = document.createElement("input");

  input.type = "radio";
  input.name = "ride-mode";
  input.id = `ride-mode-${mode}`;
  input.value = mode;
  label.append(input, ` ${RIDE_MODE_COPY[mode].label}`);

  return { label, input };
}

/** DOM adapter: renders one radio per mode into the menu fieldset; covered by apps/web/e2e/fun-mode.spec.ts. */
function domRideModeView(): RideModeView | undefined {
  const fieldset = document.querySelector("#ride-mode");
  const hint = document.querySelector("#ride-mode-hint");

  if (fieldset instanceof HTMLFieldSetElement && hint instanceof HTMLElement)
    return modeView(fieldset, hint);

  return undefined;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The adapter owns these DOM nodes and appends the mode radios to them.
function modeView(fieldset: HTMLFieldSetElement, hint: HTMLElement): RideModeView {
  const inputs = new Map<RideMode, HTMLInputElement>();

  for (const id of RIDE_MODE_IDS) {
    const option = modeOption(id);

    hint.before(option.label);
    inputs.set(id, option.input);
  }

  return {
    select: (mode) => {
      for (const [id, input] of inputs) input.checked = id === mode;
    },
    onChange: (listener) => {
      const changed = (): void => {
        const checked = RIDE_MODE_IDS.find((id) => inputs.get(id)?.checked === true);

        if (checked !== undefined) listener(checked);
      };

      fieldset.addEventListener("change", changed);

      return () => {
        fieldset.removeEventListener("change", changed);
      };
    },
    setEnabled: (mode, enabled) => {
      const input = inputs.get(mode);

      if (input !== undefined) input.disabled = !enabled;
    },
    setHint: (text) => {
      hint.textContent = text;
    },
  };
}

/** Mounts the picker found in the game menu; does nothing when the markup is absent. */
export function mountRideMode(link: RideModeLink): void {
  const view = domRideModeView();

  if (view !== undefined) bindRideMode(view, link);
}
