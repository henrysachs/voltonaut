import type { CompletedLocalRide } from "@voltonaut/shared";

import type { RideRecorder } from "../game/rideRecorder.js";

interface RecordingArchive {
  readonly list: () => Promise<readonly CompletedLocalRide[]>;
  readonly save: (ride: CompletedLocalRide) => Promise<void>;
}

interface RecordingOptions {
  readonly recorder: RideRecorder;
  readonly loadStore: () => Promise<RecordingArchive>;
  readonly distanceM: () => number | undefined;
  readonly exportRide: (ride: CompletedLocalRide) => {
    readonly filename: string;
    readonly xml: string;
  };
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Aufnahme fehlgeschlagen.";
}

function download(file: { readonly filename: string; readonly xml: string }): void {
  const url = URL.createObjectURL(new Blob([file.xml], { type: "application/vnd.garmin.tcx+xml" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function button(text: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = text;

  return element;
}

class RecordingPanel {
  readonly #options: RecordingOptions;
  readonly #status = document.createElement("p");
  readonly #start = button("Aufnahme starten");
  readonly #finish = button("Aufnahme beenden und speichern");
  readonly #discard = button("Laufende Aufnahme verwerfen");
  readonly #retry = button("Speichern erneut versuchen");
  readonly #history = document.createElement("ul");
  #busy = false;
  #stored: readonly CompletedLocalRide[] = [];

  constructor(options: Readonly<RecordingOptions>) {
    this.#options = options;
  }

  mount(): void {
    this.#status.setAttribute("role", "status");
    this.#status.dataset["testid"] = "recording-status";
    this.#status.textContent = "Bereit. Aufnahme wird nur beim Beenden gespeichert.";
    this.#finish.disabled = true;
    this.#discard.disabled = true;
    this.#retry.hidden = true;
    this.#history.setAttribute("aria-label", "Lokale Fahrten");
    document
      .querySelector("#ride-recording")
      ?.append(this.#start, this.#finish, this.#discard, this.#retry, this.#status, this.#history);
    this.#start.addEventListener("click", () => {
      this.start();
    });
    this.#finish.addEventListener("click", () => {
      this.finish();
    });
    this.#discard.addEventListener("click", () => {
      this.discard();
    });
    this.#retry.addEventListener("click", () => {
      void this.save();
    });
    setInterval(() => {
      this.sample();
    }, 250);
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.#stored = await (await this.#options.loadStore()).list();
      this.render();
    } catch (error) {
      this.#status.textContent = `${errorText(error)} Aufnahme und TCX im Tab bleiben möglich.`;
    }
  }

  private rideRow(ride: CompletedLocalRide): HTMLLIElement {
    const row = document.createElement("li");
    const last = ride.samples.at(-1);
    const label = document.createElement("p");
    label.textContent = `${ride.metadata.source === "sim" ? "Simulation" : "BLE"} · ${ride.startedAt} · ${Math.round((last?.elapsedMs ?? 0) / 1000)} s · ${Math.round(last?.distanceM ?? 0)} m virtuell`;
    const exportButton = button("TCX herunterladen");
    exportButton.addEventListener("click", () => {
      download(this.#options.exportRide(ride));
      const state = this.#options.recorder.state();

      if (!this.#busy && state.kind === "completed" && state.ride.rideId === ride.rideId) {
        this.#start.disabled = false;
      }
    });
    row.append(label, exportButton);

    return row;
  }

  private render(): void {
    this.#history.replaceChildren();
    const rides = new Map(this.#stored.map((ride) => [ride.rideId, ride]));
    const state = this.#options.recorder.state();

    if (state.kind === "completed") {
      rides.set(state.ride.rideId, state.ride);
    }

    for (const ride of [...rides.values()].toSorted((left, right) =>
      right.startedAt.localeCompare(left.startedAt),
    )) {
      this.#history.append(this.rideRow(ride));
    }
  }

  private async save(): Promise<void> {
    const state = this.#options.recorder.state();

    if (this.#busy || state.kind !== "completed") {
      return;
    }

    this.#busy = true;
    this.#start.disabled = true;
    this.#retry.hidden = true;
    this.#status.textContent = "Lokal speichern …";

    try {
      const store = await this.#options.loadStore();
      await store.save(state.ride);
      this.#stored = await store.list();
      this.#status.textContent = "Lokal gespeichert. Nicht servergeprüft, keine Belohnung.";
      this.#start.disabled = false;
    } catch (error) {
      this.#status.textContent = `${errorText(error)} Aufnahme bleibt in diesem Tab. Vor neuer Aufnahme TCX herunterladen.`;
      this.#retry.hidden = false;
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  private distanceM(): number {
    const distanceM = this.#options.distanceM();

    if (distanceM === undefined) {
      throw new Error("Noch kein Fahrtstand verfügbar. Kurz warten.");
    }

    return distanceM;
  }

  private start(): void {
    try {
      this.#options.recorder.start(this.distanceM());
      this.#start.disabled = true;
      this.#finish.disabled = false;
      this.#discard.disabled = false;
      this.#retry.hidden = true;
      this.#status.textContent =
        "Aufnahme läuft. Echte Zeit, virtuelle Distanz. Ohne Aufnahmepause.";
      this.render();
    } catch (error) {
      this.#status.textContent = errorText(error);
    }
  }

  private finish(): void {
    try {
      this.#options.recorder.finish(this.distanceM());
      this.#finish.disabled = true;
      this.#discard.disabled = true;
      this.render();
      void this.save();
    } catch (error) {
      this.#status.textContent = errorText(error);
    }
  }

  private sample(): void {
    try {
      const distanceM = this.#options.distanceM();

      if (distanceM !== undefined) {
        this.#options.recorder.sample(distanceM);
      }
    } catch (error) {
      this.#status.textContent = errorText(error);
    }
  }

  private discard(): void {
    if (
      this.#options.recorder.state().kind !== "recording" ||
      !window.confirm(
        "Ungespeicherte Aufnahme wirklich verwerfen? Gespeicherte Fahrten bleiben erhalten.",
      )
    ) {
      return;
    }

    this.#options.recorder.discard();
    this.#start.disabled = false;
    this.#finish.disabled = true;
    this.#discard.disabled = true;
    this.#status.textContent =
      "Laufende Aufnahme verworfen. Gespeicherte Fahrten bleiben erhalten.";
  }
}

export function mountRideRecording(options: Readonly<RecordingOptions>): void {
  const panel = new RecordingPanel(options);
  panel.mount();
}
