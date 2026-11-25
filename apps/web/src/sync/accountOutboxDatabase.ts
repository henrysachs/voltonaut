import {
  OutboxRowSchema,
  outboxKey,
  type AccountOutbox,
  type OutboxOwner,
  type OutboxRow,
} from "./accountOutbox.js";
import { withProfileSelection } from "./profileSelection.js";
import { deletionOwnerKey } from "./accountDeletion.js";
import type { DeletionOwner } from "./accountDeletion.js";

const STORE = "outbox";
const DELETED_OWNERS = "deleted-owners";
const MAX_ENTRIES = 20;
const DATABASE_VERSION = 2;

function existingAction(
  row: OutboxRow,
  previous: OutboxRow,
  operation: "claim" | "update",
): "keep" | "write" {
  if (previous.userId !== row.userId)
    throw new Error(
      "Fahrt ist bereits einem anderen Konto zugeordnet. Keine Neuzuordnung möglich.",
    );

  if (operation === "update" && previous.revision !== row.revision)
    throw new Error("Warteschlangeneintrag wurde inzwischen geändert. Bitte aktualisieren.");
  const equal = JSON.stringify(previous.payload) === JSON.stringify(row.payload);

  if (!equal && (row.kind === "ride" || previous.state.kind !== "stored"))
    throw new Error("ID bereits mit einem anderen unveränderlichen Snapshot vorgemerkt.");

  return operation === "claim" && equal && (row.kind === "ride" || previous.state.kind !== "stored")
    ? "keep"
    : "write";
}

class OutboxDatabase implements AccountOutbox {
  readonly #database: Readonly<Pick<IDBDatabase, "transaction">>;

  constructor(database: Readonly<Pick<IDBDatabase, "transaction">>) {
    this.#database = database;
  }

  claim(row: OutboxRow): Promise<void> {
    return row.kind === "profile"
      ? withProfileSelection(() => this.write(row, "claim"))
      : this.write(row, "claim");
  }
  update(row: OutboxRow): Promise<void> {
    return this.write(row, "update");
  }

  private write(input: OutboxRow, operation: "claim" | "update"): Promise<void> {
    const row = OutboxRowSchema.parse(input);

    return new Promise((resolve, reject) => {
      const transaction = this.#database.transaction([STORE, DELETED_OWNERS], "readwrite");
      const store = transaction.objectStore(STORE);
      const deleted = transaction.objectStore(DELETED_OWNERS).get(deletionOwnerKey(row));
      const existing = store.get([...outboxKey(row)]);
      const count = store.count();
      let message = "Speicherfehler. Änderung nicht dauerhaft bestätigt.";
      count.addEventListener("success", () => {
        try {
          if (deleted.result !== undefined)
            throw new Error("Konto wurde gelöscht. Kein neuer Warteschlangeneintrag.");
          const raw: unknown = existing.result;

          if (raw !== undefined) {
            const previous = OutboxRowSchema.safeParse(raw);

            if (!previous.success)
              throw new Error("Kontowarteschlange beschädigt. Keine Daten geändert.");

            if (existingAction(row, previous.data, operation) === "keep") return;
          } else if (operation === "update") throw new Error("Warteschlangeneintrag fehlt.");
          else if (count.result >= MAX_ENTRIES)
            throw new Error("Kontowarteschlange voll (20 Einträge). Keine Daten gelöscht.");
          store.put(row, [...outboxKey(row)]);
        } catch (error) {
          message = error instanceof Error ? error.message : message;
          transaction.abort();
        }
      });
      transaction.addEventListener("complete", () => {
        resolve();
      });
      transaction.addEventListener("abort", () => {
        reject(new Error(message));
      });
      transaction.addEventListener("error", () => {
        reject(new Error(message));
      });
    });
  }

  purgeOwner(owner: DeletionOwner): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.#database.transaction([STORE, DELETED_OWNERS], "readwrite");
      const rows = transaction.objectStore(STORE).getAll(undefined, MAX_ENTRIES + 1);
      let message = "Gelöschte Kontodaten konnten nicht lokal bereinigt werden.";
      rows.addEventListener("success", () => {
        try {
          const raw: unknown = rows.result;
          const parsed = OutboxRowSchema.array().max(MAX_ENTRIES).safeParse(raw);

          if (!parsed.success)
            throw new Error("Kontowarteschlange beschädigt. Keine Daten geändert.");
          const store = transaction.objectStore(STORE);

          for (const row of parsed.data) {
            if (row.userId === owner.userId && row.apiOrigin === owner.apiOrigin)
              store.delete([...outboxKey(row)]);
          }

          transaction
            .objectStore(DELETED_OWNERS)
            .put(deletionOwnerKey(owner), deletionOwnerKey(owner));
        } catch (error) {
          message = error instanceof Error ? error.message : message;
          transaction.abort();
        }
      });
      transaction.addEventListener("complete", () => {
        resolve();
      });
      transaction.addEventListener("abort", () => {
        reject(new Error(message));
      });
      transaction.addEventListener("error", () => {
        reject(new Error(message));
      });
    });
  }

  list(owner: OutboxOwner): Promise<readonly OutboxRow[]> {
    return new Promise((resolve, reject) => {
      const transaction = this.#database.transaction([STORE, DELETED_OWNERS], "readonly");
      const deleted = transaction.objectStore(DELETED_OWNERS).get(deletionOwnerKey(owner));
      const rows = transaction.objectStore(STORE).getAll(undefined, MAX_ENTRIES + 1);
      let result: readonly OutboxRow[] = [];
      rows.addEventListener("success", () => {
        if (deleted.result !== undefined) return;
        const raw: unknown = rows.result;
        const parsed = OutboxRowSchema.array().max(MAX_ENTRIES).safeParse(raw);

        if (!parsed.success) {
          transaction.abort();

          return;
        }

        result = parsed.data.filter(
          (row) => row.userId === owner.userId && row.apiOrigin === owner.apiOrigin,
        );
      });
      transaction.addEventListener("complete", () => {
        resolve(result);
      });
      transaction.addEventListener("abort", () => {
        reject(new Error("Kontowarteschlange beschädigt. Keine Daten geändert."));
      });
      transaction.addEventListener("error", () => {
        reject(new Error("Kontowarteschlange nicht lesbar."));
      });
    });
  }
}

export function openAccountOutbox(): Promise<AccountOutbox> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("voltonaut-account-outbox", DATABASE_VERSION);
    let expired = false;

    const timeout = setTimeout(() => {
      fail();
    }, 1000);

    function fail(): void {
      expired = true;
      clearTimeout(timeout);
      reject(new Error("Kontowarteschlange nicht verfügbar. Nicht dauerhaft vorgemerkt."));
    }

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);

      if (!database.objectStoreNames.contains(DELETED_OWNERS))
        database.createObjectStore(DELETED_OWNERS);
    });
    request.addEventListener("error", fail);
    request.addEventListener("blocked", fail);
    request.addEventListener("success", () => {
      clearTimeout(timeout);
      const database = request.result;

      if (expired) {
        database.close();

        return;
      }

      database.addEventListener("versionchange", () => {
        database.close();
      });
      resolve(new OutboxDatabase(database));
    });
  });
}
