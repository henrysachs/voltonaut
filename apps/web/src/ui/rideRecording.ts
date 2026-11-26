import {
  archivedRideTrack,
  type ArchivedRide,
  type CapturedRide,
  type RideTrack,
} from "@voltonaut/shared";

import type { CaptureView, RecordingControls } from "../game/rideCaptureProtocol.js";

import { button } from "./button.js";

interface RecordingArchive {
  readonly list: () => Promise<readonly ArchivedRide[]>;
  readonly save: (ride: CapturedRide) => Promise<void>;
}

interface RecordingOptions {
  readonly recorder: RecordingControls;
  readonly loadStore: () => Promise<RecordingArchive>;
  readonly exportRide: (ride: RideTrack) => { readonly filename: string; readonly xml: string };
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Aufnahme fehlgeschlagen.";
}

function archiveId(ride: ArchivedRide): string {
  return ride.kind === "local_only" ? ride.track.rideId : ride.recording.rideId;
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

class RecordingPanel {
  readonly #status = document.createElement("p");
  readonly #start = button("Aufnahme starten");
  readonly #finish = button("Aufnahme beenden und speichern");
  readonly #discard = button("Laufende Aufnahme verwerfen");
  readonly #retry = button("Speichern erneut versuchen");
  readonly #continue = button("Mit heruntergeladener TCX fortfahren");
  readonly #history = document.createElement("ul");
  #busy = false;
  #stored: readonly ArchivedRide[] = [];
  #completed: CapturedRide | undefined;
  #saveFailed = false;
  #downloadedId: string | undefined;
  #lastRecordingStatus: string | undefined;

  constructor(private readonly options: RecordingOptions) {}

  mount(): void {
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Browser owns BeforeUnloadEvent; preventing navigation requires its native contract.
    window.addEventListener("beforeunload", (event) => {
      const state = this.options.recorder.state();

      if (state.kind === "recording" || state.kind === "completed" || this.#completed !== undefined)
        event.preventDefault();
    });
    this.#status.setAttribute("role", "status");
    this.#status.dataset["testid"] = "recording-status";
    this.#status.textContent = "Bereit. Aufnahme wird nur beim Beenden gespeichert.";
    this.#history.setAttribute("aria-label", "Lokale Fahrten");
    document
      .querySelector("#ride-recording")
      ?.append(
        this.#start,
        this.#finish,
        this.#discard,
        this.#retry,
        this.#continue,
        this.#status,
        this.#history,
      );
    this.#start.addEventListener("click", () => {
      void this.start();
    });
    this.#finish.addEventListener("click", () => {
      void this.finish();
    });
    this.#discard.addEventListener("click", () => {
      void this.discard();
    });
    this.#retry.addEventListener("click", () => {
      void this.save();
    });
    this.#continue.addEventListener("click", () => {
      void this.continueAfterDownload();
    });
    this.options.recorder.subscribe((view) => {
      this.update(view);
    });
    this.controls();
    void this.load();
  }

  private update(view: CaptureView): void {
    this.controls();

    if (view.kind === "unavailable") this.#status.textContent = view.message;
    else if (view.kind === "recording") {
      const status = `Aufnahme läuft. Echte Zeit, virtuelle Distanz. ${view.availability.kind === "local_only" ? `Nur lokaler TCX-Export (${view.availability.reason}). Vollständiges Journal nicht verfügbar; neue Aufnahmen bleiben in dieser Sitzung lokal.` : "Ohne Aufnahmepause."}`;

      if (status !== this.#lastRecordingStatus) {
        this.#lastRecordingStatus = status;
        this.#status.textContent = status;
      }
    }
  }

  private controls(): void {
    const state = this.options.recorder.state();
    this.#start.disabled = this.#busy || state.kind !== "idle" || this.#completed !== undefined;
    this.#finish.disabled = this.#busy || state.kind !== "recording";
    this.#discard.disabled = this.#busy || state.kind !== "recording";
    this.#retry.hidden = !this.#saveFailed;
    this.#retry.disabled = this.#busy;
    this.#continue.hidden = this.#completed === undefined || this.#downloadedId === undefined;
    this.#continue.disabled = this.#busy;

    for (const control of [this.#start, this.#finish, this.#discard, this.#retry, this.#continue])
      control.setAttribute("aria-busy", String(this.#busy));
  }

  private async load(): Promise<void> {
    try {
      this.#stored = await (await this.options.loadStore()).list();
      this.render();
    } catch (error) {
      this.#status.textContent = `${errorText(error)} Aufnahme und TCX im Tab bleiben möglich.`;
    }
  }

  private rideRow(ride: ArchivedRide, track: RideTrack): HTMLLIElement {
    const row = document.createElement("li");
    const last = track.samples.at(-1);
    const label = document.createElement("p");
    label.textContent = `${track.metadata.source === "sim" ? "Simulation" : "BLE"} · ${track.startedAt} · ${Math.round((last?.elapsedMs ?? 0) / 1000)} s · ${Math.round(last?.distanceM ?? 0)} m virtuell${ride.kind === "local_only" ? ` · Nur lokal (${ride.reason}), kein vollständiges Journal` : ride.kind === "legacy" ? " · Historische Aufnahme ohne Journal" : " · Journal, nicht servergeprüft"}`;
    const exportButton = button("TCX herunterladen");
    exportButton.addEventListener("click", () => {
      download(this.options.exportRide(track));

      if (this.#completed !== undefined && archiveId(this.#completed) === track.rideId) {
        this.#downloadedId = track.rideId;
        this.#status.textContent =
          "TCX-Download angefordert. Datei prüfen; danach ausdrücklich mit heruntergeladener TCX fortfahren oder Speichern erneut versuchen.";
        this.controls();
      }
    });
    row.append(label, exportButton);

    return row;
  }

  private render(): void {
    const rides = new Map<string, { readonly ride: ArchivedRide; readonly track: RideTrack }>();

    for (const ride of this.#stored) {
      const track = archivedRideTrack(ride);
      rides.set(track.rideId, { ride, track });
    }

    if (this.#completed !== undefined) {
      const track = archivedRideTrack(this.#completed);
      rides.set(track.rideId, { ride: this.#completed, track });
    }

    this.#history.replaceChildren(
      ...[...rides.values()]
        .toSorted((left, right) => right.track.startedAt.localeCompare(left.track.startedAt))
        .map(({ ride, track }) => this.rideRow(ride, track)),
    );
    this.controls();
  }

  private async save(): Promise<void> {
    const capture = this.#completed;

    if (this.#busy || capture === undefined) return;
    this.#busy = true;
    this.#saveFailed = false;
    this.controls();
    this.#status.textContent = "Lokal speichern …";

    try {
      const store = await this.options.loadStore();
      await store.save(capture);
      await this.options.recorder.release(archiveId(capture));
      this.#stored = this.#stored
        .filter((ride) => archiveId(ride) !== archiveId(capture))
        .concat(capture);
      this.#completed = undefined;
      this.#status.textContent = `Lokal gespeichert. Nicht servergeprüft, keine Belohnung.${capture.kind === "local_only" ? ` Nur lokal (${capture.reason}).` : ""}`;
      void this.load();
    } catch (error) {
      this.#saveFailed = this.#completed !== undefined;
      this.#status.textContent = `${errorText(error)} Aufnahme bleibt in diesem Tab. Vor neuer Aufnahme TCX herunterladen und ausdrücklich fortfahren.`;
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  private async start(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    this.#lastRecordingStatus = undefined;
    this.controls();

    try {
      await this.options.recorder.start();
      this.#downloadedId = undefined;
    } catch (error) {
      this.#status.textContent = errorText(error);
    } finally {
      this.#busy = false;
      this.controls();
    }
  }

  private async finish(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    this.controls();

    try {
      this.#completed = await this.options.recorder.finish();
      this.render();
    } catch (error) {
      this.#status.textContent = errorText(error);
    } finally {
      this.#busy = false;
      this.controls();
    }

    if (this.#completed !== undefined) await this.save();
  }

  private async continueAfterDownload(): Promise<void> {
    const capture = this.#completed;

    if (this.#busy || capture === undefined || this.#downloadedId !== archiveId(capture)) return;
    this.#busy = true;
    this.controls();

    try {
      await this.options.recorder.release(this.#downloadedId);
      this.#completed = undefined;
      this.#saveFailed = false;
      this.#downloadedId = undefined;
      this.#status.textContent =
        "Ungespeicherten Abschluss nach ausdrücklicher TCX-Entscheidung freigegeben.";
    } catch (error) {
      this.#status.textContent = errorText(error);
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  private async discard(): Promise<void> {
    if (
      this.#busy ||
      !window.confirm(
        "Ungespeicherte Aufnahme wirklich verwerfen? Gespeicherte Fahrten bleiben erhalten. Vorlaufdaten eines vorhandenen Journals bleiben ebenfalls erhalten.",
      )
    )
      return;
    this.#busy = true;
    this.controls();

    try {
      await this.options.recorder.discard();
      this.#status.textContent =
        "Laufende Aufnahme verworfen. Gespeicherte Fahrten bleiben erhalten.";
    } catch (error) {
      this.#status.textContent = errorText(error);
    } finally {
      this.#busy = false;
      this.controls();
    }
  }
}

export function mountRideRecording(options: RecordingOptions): void {
  new RecordingPanel(options).mount();
}
