/* oxlint-disable typescript/prefer-readonly-parameter-types -- Native browser events are read-only here. */
import type { AvatarConfig } from "@voltonaut/shared";

import { garageButton as button } from "./garageItems.js";
import { downloadPreviewPng } from "./previewDownload.js";
import { createGaragePreviewView, type GaragePreviewView } from "./preview.js";
import {
  DEFAULT_PREVIEW_ORBIT,
  normalizePreviewOrbit,
  orbitBy,
  type PreviewOrbit,
} from "./previewOrbit.js";
import type { GarageState } from "./state.js";

const KEYBOARD_YAW_STEP_RAD = Math.PI / 12;
const KEYBOARD_PITCH_STEP_RAD = Math.PI / 32;
const DRAG_YAW_RAD_PER_PX = 0.008;
const DRAG_PITCH_RAD_PER_PX = 0.006;

const KEYBOARD_ORBIT: ReadonlyMap<string, Readonly<PreviewOrbit>> = new Map([
  ["ArrowLeft", { yawRad: -KEYBOARD_YAW_STEP_RAD, pitchRad: 0 }],
  ["ArrowRight", { yawRad: KEYBOARD_YAW_STEP_RAD, pitchRad: 0 }],
  ["ArrowUp", { yawRad: 0, pitchRad: KEYBOARD_PITCH_STEP_RAD }],
  ["ArrowDown", { yawRad: 0, pitchRad: -KEYBOARD_PITCH_STEP_RAD }],
]);

export class GaragePreviewPanel {
  readonly section = document.createElement("section");
  readonly #host = document.createElement("div");
  readonly #note = document.createElement("p");
  readonly #rotateLeft = button("Links drehen");
  readonly #rotateRight = button("Rechts drehen");
  readonly #rotateToggle = button("Drehung pausieren");
  readonly #photoButton = button("Fotomodus");
  readonly #photoDownload = button("PNG herunterladen");
  readonly #photoExit = button("Fotomodus beenden");
  readonly #photoStatus = document.createElement("p");
  readonly #controls = document.createElement("div");
  readonly #photoControls = document.createElement("div");
  readonly #view: GaragePreviewView | null;
  readonly #dialog: HTMLDialogElement | null;
  readonly #reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  #autoRotate = !this.#reducedMotion.matches;
  #autoRotateBeforePhoto = false;
  #orbit: Readonly<PreviewOrbit> = DEFAULT_PREVIEW_ORBIT;
  #kind: GarageState["kind"] = "preview";
  #photoMode = false;
  #pointerId: number | undefined;
  #lastPointerX = 0;
  #lastPointerY = 0;

  /** `unavailable` fires when the preview worker fails after a successful start (ADR-032). */
  constructor(wheelCircM: number, unavailable: () => void) {
    this.#dialog = document.querySelector<HTMLDialogElement>("#game-menu");
    this.#build();
    this.#dialog?.addEventListener("cancel", this.#onCancel);
    this.#dialog?.addEventListener("close", () => {
      this.#leavePhotoMode(false);
    });
    this.#reducedMotion.addEventListener("change", this.#onReducedMotionChange);
    this.#view = createGaragePreviewView(this.#host, wheelCircM, () => {
      this.#leavePhotoMode(false, false);
      unavailable();
    });
    this.#view?.setAutoRotate(this.#autoRotate);
    this.#applyOrbit(DEFAULT_PREVIEW_ORBIT);
    this.#wireButtons();
    this.#host.addEventListener("pointerdown", this.#onPointerDown);
    this.#host.addEventListener("pointermove", this.#onPointerMove);
    this.#host.addEventListener("pointerup", this.#endPointer);
    this.#host.addEventListener("pointercancel", this.#endPointer);
    this.#host.addEventListener("lostpointercapture", this.#endPointer);
    this.#host.addEventListener("keydown", this.#onKeyDown);
    this.render("preview");
  }

  get available(): boolean {
    return this.#view !== null && this.#kind === "preview";
  }

  setLook(config: Readonly<AvatarConfig>): void {
    this.#view?.setLook(config);
  }

  render(kind: GarageState["kind"]): void {
    this.#kind = kind;
    const available = kind === "preview" && this.#view !== null;

    this.#host.dataset["previewState"] = kind;
    this.#host.tabIndex = available ? 0 : -1;
    this.#host.setAttribute("aria-disabled", String(!available));
    this.#note.textContent = available
      ? "Provisorische Fahrer- und Radgeometrie. Finale Blender-Assets ersetzen sie später."
      : "3D nicht verfügbar. Item-Auswahl, Farben und Informationen bleiben nutzbar.";
    this.#rotateLeft.disabled = !available;
    this.#rotateRight.disabled = !available;
    this.#photoButton.disabled = !available || this.#dialog === null;
    this.#photoDownload.disabled = !available;

    if (!available) this.#leavePhotoMode(false, false);
    this.#renderToggle();
  }

  #renderToggle(): void {
    this.#rotateToggle.textContent = this.#autoRotate ? "Drehung pausieren" : "Drehung starten";
    this.#rotateToggle.setAttribute("aria-pressed", String(this.#autoRotate));
    this.#rotateToggle.disabled =
      this.#kind !== "preview" || this.#view === null || this.#reducedMotion.matches;
  }

  #wireButtons(): void {
    this.#rotateLeft.addEventListener("click", () => {
      this.#changeOrbit({ yawRad: -Math.PI / 6, pitchRad: 0 });
    });
    this.#rotateRight.addEventListener("click", () => {
      this.#changeOrbit({ yawRad: Math.PI / 6, pitchRad: 0 });
    });
    this.#rotateToggle.addEventListener("click", () => {
      if (this.#reducedMotion.matches) return;
      this.#autoRotate = !this.#autoRotate;
      this.#view?.setAutoRotate(this.#autoRotate);
      this.#renderToggle();
    });
    this.#photoButton.addEventListener("click", this.#enterPhotoMode);
    this.#photoExit.addEventListener("click", () => {
      this.#leavePhotoMode(true);
    });
    this.#photoDownload.addEventListener("click", () => {
      void this.#downloadPhoto();
    });
  }

  readonly #onPointerDown = (event: Readonly<PointerEvent>): void => {
    if (!event.isPrimary || event.button !== 0 || !this.available) return;

    event.preventDefault();
    this.#host.focus({ preventScroll: true });
    this.#pointerId = event.pointerId;
    this.#lastPointerX = event.clientX;
    this.#lastPointerY = event.clientY;
    this.#host.setPointerCapture(event.pointerId);
    this.#host.classList.add("is-dragging");
  };

  readonly #onPointerMove = (event: Readonly<PointerEvent>): void => {
    if (event.pointerId !== this.#pointerId) return;

    event.preventDefault();
    this.#changeOrbit({
      yawRad: -(event.clientX - this.#lastPointerX) * DRAG_YAW_RAD_PER_PX,
      pitchRad: -(event.clientY - this.#lastPointerY) * DRAG_PITCH_RAD_PER_PX,
    });
    this.#lastPointerX = event.clientX;
    this.#lastPointerY = event.clientY;
  };

  readonly #endPointer = (event: Readonly<PointerEvent>): void => {
    if (event.pointerId !== this.#pointerId) return;

    this.#pointerId = undefined;
    this.#host.classList.remove("is-dragging");

    if (this.#host.hasPointerCapture(event.pointerId)) {
      this.#host.releasePointerCapture(event.pointerId);
    }
  };

  readonly #onKeyDown = (event: Readonly<KeyboardEvent>): void => {
    if (!this.available || event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      this.#applyOrbit(DEFAULT_PREVIEW_ORBIT);

      return;
    }

    const delta = KEYBOARD_ORBIT.get(event.key);

    if (delta === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    this.#changeOrbit(delta);
  };

  #changeOrbit(delta: Readonly<PreviewOrbit>): void {
    this.#applyOrbit(orbitBy(this.#orbit, delta));
  }

  #applyOrbit(next: Readonly<PreviewOrbit>): void {
    if (!Number.isFinite(next.yawRad) || !Number.isFinite(next.pitchRad)) return;
    this.#orbit = normalizePreviewOrbit(next);
    this.#host.dataset["orbitYawRad"] = String(this.#orbit.yawRad);
    this.#host.dataset["orbitPitchRad"] = String(this.#orbit.pitchRad);
    this.#view?.setOrbit(this.#orbit);
  }

  readonly #onReducedMotionChange = (): void => {
    if (this.#reducedMotion.matches) {
      this.#autoRotate = false;
      this.#view?.setAutoRotate(false);
    }

    this.#renderToggle();
  };

  readonly #enterPhotoMode = (): void => {
    if (!this.available || this.#dialog === null || this.#photoMode) return;

    this.#autoRotateBeforePhoto = this.#autoRotate;
    this.#autoRotate = false;
    this.#view?.setAutoRotate(false);
    this.#photoMode = true;
    this.#photoStatus.textContent = "";
    this.#photoDownload.disabled = false;
    this.#photoControls.hidden = false;
    this.#dialog.dataset["photoMode"] = "true";
    document.body.classList.add("garage-photo-mode");
    this.#photoExit.focus();
  };

  #leavePhotoMode(restoreFocus: boolean, restoreRotation = true): void {
    const wasPhotoMode = this.#photoMode;

    this.#photoMode = false;
    this.#photoControls.hidden = true;

    if (this.#dialog !== null) delete this.#dialog.dataset["photoMode"];
    document.body.classList.remove("garage-photo-mode");

    if (wasPhotoMode && restoreRotation && !this.#reducedMotion.matches) {
      this.#autoRotate = this.#autoRotateBeforePhoto;
      this.#view?.setAutoRotate(this.#autoRotate);
    }

    this.#renderToggle();

    if (restoreFocus && wasPhotoMode && this.#dialog?.open === true) this.#photoButton.focus();
  }

  readonly #onCancel = (event: Readonly<Event>): void => {
    if (!this.#photoMode) return;

    event.preventDefault();
    this.#leavePhotoMode(true);
  };

  readonly #downloadPhoto = async (): Promise<void> => {
    if (!this.#photoMode || this.#view === null) return;

    this.#photoStatus.textContent = "PNG wird erstellt …";
    this.#photoDownload.disabled = true;

    try {
      const blob = await this.#view.capture();
      downloadPreviewPng(blob);

      if (this.#photoMode) this.#photoStatus.textContent = "PNG heruntergeladen.";
    } catch {
      if (this.#photoMode)
        this.#photoStatus.textContent = "PNG konnte nicht heruntergeladen werden.";
    } finally {
      this.#photoDownload.disabled = !this.#photoMode || !this.available;
    }
  };

  #build(): void {
    this.section.className = "garage__preview";
    this.section.setAttribute("aria-labelledby", "garage-preview-title");

    const title = document.createElement("h3");
    title.id = "garage-preview-title";
    title.className = "garage__preview-title";
    title.textContent = "Vorschau";

    this.#host.className = "garage__preview-host";
    this.#host.dataset["testid"] = "garage-preview";
    this.#host.tabIndex = 0;
    this.#host.setAttribute("role", "group");
    this.#host.setAttribute(
      "aria-label",
      "3D-Vorschau. Mit Maus, Touch oder Stift ziehen. Pfeiltasten drehen und neigen. Home setzt die Ansicht zurück.",
    );
    this.#note.className = "garage__preview-note";

    this.#controls.className = "garage__preview-controls";
    this.#controls.append(this.#rotateLeft, this.#rotateRight);
    this.#controls.append(this.#rotateToggle, this.#photoButton);
    this.#photoControls.className = "garage__photo-controls";
    this.#photoControls.hidden = true;
    this.#photoStatus.className = "garage__photo-status";
    this.#photoStatus.setAttribute("role", "status");
    this.#photoControls.append(this.#photoStatus, this.#photoDownload, this.#photoExit);
    this.section.append(title, this.#host, this.#note, this.#controls, this.#photoControls);
  }
}
