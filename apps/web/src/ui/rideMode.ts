import type { RideMode } from "@voltonaut/shared";

import type { EngineLink } from "../game/engine-link.js";
import type { CaptureView, RecordingControls } from "../game/rideCaptureProtocol.js";

export const FUN_MODE_HINT =
  "Item-Boxen einsammeln und mit P oder der Power-up-Taste auslösen. Keine Aufnahme, keine Belohnungen.";

export const FUN_MODE_LOCKED_HINT = "Während einer Aufnahme ist der Spaß-Modus gesperrt.";

/** The mode picker as the binding sees it; the DOM adapter maps it onto radio buttons. */
export interface RideModeView {
  readonly select: (mode: RideMode) => void;
  readonly onChange: (listener: (mode: RideMode) => void) => () => void;
  readonly setFunEnabled: (enabled: boolean) => void;
  readonly setHint: (text: string) => void;
}

export interface RideModeLink {
  readonly setMode: EngineLink["setMode"];
  readonly recording: Pick<RecordingControls, "state" | "subscribe">;
}

/** A running or unreleased recording must not contain item effects (spec E9-01 AK8). */
function funLocked(view: CaptureView): boolean {
  return view.kind === "recording" || view.kind === "completed";
}

/**
 * Binds the in-ride mode picker to the engine. The ride keeps running while the
 * menu is open; the worker independently refuses fun mode during a recording.
 */
export function bindRideMode(view: RideModeView, link: RideModeLink): () => void {
  let mode: RideMode = "normal";

  const refresh = (capture: CaptureView): void => {
    const locked = funLocked(capture);

    view.setFunEnabled(!locked);

    if (mode === "fun") view.setHint(FUN_MODE_HINT);
    else view.setHint(locked ? FUN_MODE_LOCKED_HINT : "");
  };

  view.select(mode);
  refresh(link.recording.state());

  const stopChanges = view.onChange((requested) => {
    if (requested === "fun" && funLocked(link.recording.state())) {
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

/** DOM adapter for the in-menu mode picker; covered by apps/web/e2e/fun-mode.spec.ts. */
function domRideModeView(): RideModeView | undefined {
  const normal = document.querySelector("#ride-mode-normal");
  const fun = document.querySelector("#ride-mode-fun");
  const hint = document.querySelector("#ride-mode-hint");

  if (
    normal instanceof HTMLInputElement &&
    fun instanceof HTMLInputElement &&
    hint instanceof HTMLElement
  )
    return {
      select: (mode) => {
        normal.checked = mode === "normal";
        fun.checked = mode === "fun";
      },
      onChange: (listener) => {
        const changed = (): void => {
          listener(fun.checked ? "fun" : "normal");
        };

        normal.addEventListener("change", changed);
        fun.addEventListener("change", changed);

        return () => {
          normal.removeEventListener("change", changed);
          fun.removeEventListener("change", changed);
        };
      },
      setFunEnabled: (enabled) => {
        fun.disabled = !enabled;
      },
      setHint: (text) => {
        hint.textContent = text;
      },
    };

  return undefined;
}

/** Mounts the picker found in the game menu; does nothing when the markup is absent. */
export function mountRideMode(link: RideModeLink): void {
  const view = domRideModeView();

  if (view !== undefined) bindRideMode(view, link);
}
