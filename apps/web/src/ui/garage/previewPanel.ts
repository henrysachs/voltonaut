import type { AvatarConfig } from "@voltonaut/shared";

import { garageButton as button } from "./garageItems.js";
import { createGaragePreviewView, type GaragePreviewView } from "./preview.js";
import {
  DEFAULT_PREVIEW_ORBIT,
  normalizePreviewOrbit,
  orbitBy,
  type PreviewOrbit,
} from "./previewOrbit.js";
import type { GarageState } from "./state.js";

/** The garage's 3D preview with its rotate controls; without WebGL it explains the fallback. */
export class GaragePreviewPanel {
  readonly section = document.createElement("section");
  readonly #host = document.createElement("div");
  readonly #note = document.createElement("p");
  readonly #rotateLeft = button("Links drehen");
  readonly #rotateRight = button("Rechts drehen");
  readonly #rotateToggle = button("Drehung pausieren");
  readonly #view: GaragePreviewView | null;
  #autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  #orbit: Readonly<PreviewOrbit> = DEFAULT_PREVIEW_ORBIT;

  /** `unavailable` fires when the preview worker fails after a successful start (ADR-032). */
  constructor(wheelCircM: number, unavailable: () => void) {
    this.#build();
    this.#view = createGaragePreviewView(this.#host, wheelCircM, unavailable);
    this.#view?.setAutoRotate(this.#autoRotate);
    this.#applyOrbit(DEFAULT_PREVIEW_ORBIT);
    this.#rotateLeft.addEventListener("click", () => {
      this.#changeOrbit({ yawRad: -Math.PI / 6, pitchRad: 0 });
    });
    this.#rotateRight.addEventListener("click", () => {
      this.#changeOrbit({ yawRad: Math.PI / 6, pitchRad: 0 });
    });
    this.#rotateToggle.addEventListener("click", () => {
      this.#autoRotate = !this.#autoRotate;
      this.#view?.setAutoRotate(this.#autoRotate);
      this.#renderToggle();
    });
  }

  get available(): boolean {
    return this.#view !== null;
  }

  setLook(config: Readonly<AvatarConfig>): void {
    this.#view?.setLook(config);
  }

  render(kind: GarageState["kind"]): void {
    const available = kind === "preview";

    this.#host.dataset["previewState"] = kind;
    this.#note.textContent = available
      ? "Provisorische Fahrer- und Radgeometrie. Finale Blender-Assets ersetzen sie später."
      : "3D nicht verfügbar. Item-Auswahl, Farben und Informationen bleiben nutzbar.";
    this.#rotateLeft.disabled = !available;
    this.#rotateRight.disabled = !available;
    this.#rotateToggle.disabled = !available;
    this.#renderToggle();
  }

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

  #renderToggle(): void {
    this.#rotateToggle.textContent = this.#autoRotate ? "Drehung pausieren" : "Drehung starten";
    this.#rotateToggle.setAttribute("aria-pressed", String(this.#autoRotate));
  }

  #build(): void {
    this.section.className = "garage__preview";
    this.section.setAttribute("aria-labelledby", "garage-preview-title");

    const title = document.createElement("h3");
    title.id = "garage-preview-title";
    title.textContent = "Vorschau";

    this.#host.className = "garage__preview-host";
    this.#host.dataset["testid"] = "garage-preview";
    this.#host.setAttribute("aria-live", "polite");
    this.#note.className = "garage__preview-note";

    const controls = document.createElement("div");
    controls.className = "garage__preview-controls";
    controls.append(this.#rotateLeft, this.#rotateRight, this.#rotateToggle);
    this.section.append(title, this.#host, this.#note, controls);
  }
}
