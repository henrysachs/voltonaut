/* oxlint-disable typescript/prefer-readonly-parameter-types -- History views hold readonly journals with Zod brands; the panel updates owned DOM nodes. */
import type { ProgressHistoryJournal } from "@voltonaut/shared";

import type { ProgressHistoryView } from "../sync/progressHistory.js";

const VOLTS = new Intl.NumberFormat("de-DE");

function volts(value: number): string {
  return `${VOLTS.format(value)} ⚡`;
}

/** One confirmed journal: day, period, confirmed and withheld Volts (spec E6-11 AK5). */
export function historyJournalText(
  journal: Readonly<ProgressHistoryJournal>,
  timeZone?: string,
): string {
  const day = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone });
  const time = new Intl.DateTimeFormat("de-DE", { timeStyle: "short", timeZone });
  const started = new Date(journal.startedAt);
  const confirmed = new Date(journal.lastConfirmedAt);

  const withheld =
    journal.withheldVolts > 0 ? ` · ${volts(journal.withheldVolts)} über Tageslimit` : "";

  const ranges = journal.rangeCount === 1 ? "1 Abschnitt" : `${journal.rangeCount} Abschnitte`;

  return `${day.format(started)}, ${time.format(started)}–${time.format(confirmed)} · ${volts(journal.awardedVolts)} bestätigt${withheld} · ${ranges}`;
}

/** Heading line of the history; never shows a number without a server answer. */
export function historyStatusText(view: ProgressHistoryView): string {
  switch (view.kind) {
    case "guest":
      return "Bestätigte Fahrten erscheinen nach der Anmeldung.";
    case "loading":
      return "Historie wird geladen …";
    case "failed":
      return view.message;
    case "ready": {
      const empty = view.journals.length === 0 ? " Noch keine bestätigten Fahrten." : "";
      const more = view.truncated ? " Gezeigt werden die neuesten Fahrten." : "";

      return `Kontostand laut Server: ${volts(view.voltsBalance)}.${empty}${more}`;
    }

    default: {
      const exhausted: never = view;

      return exhausted;
    }
  }
}

export interface ProgressHistoryPanelPort {
  readonly subscribe: (listener: (view: ProgressHistoryView) => void) => () => void;
  readonly refresh: () => Promise<void>;
}

export function mountProgressHistoryPanel(port: Readonly<ProgressHistoryPanelPort>): void {
  const host = document.querySelector("#progress-history");

  if (host === null) return;
  const title = document.createElement("h2");
  title.textContent = "Bestätigte Fahrten";

  const status = document.createElement("p");
  status.dataset["testid"] = "progress-history-status";
  status.setAttribute("role", "status");

  const list = document.createElement("ol");
  list.dataset["testid"] = "progress-history-list";

  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "btn btn--secondary";
  reload.textContent = "Historie neu laden";
  reload.addEventListener("click", () => {
    void port.refresh();
  });
  host.append(title, status, list, reload);

  port.subscribe((view) => {
    status.textContent = historyStatusText(view);
    reload.hidden = view.kind === "guest";
    list.replaceChildren(
      ...(view.kind === "ready" ? view.journals : []).map((journal) => {
        const item = document.createElement("li");
        item.textContent = historyJournalText(journal);

        return item;
      }),
    );
  });
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */
