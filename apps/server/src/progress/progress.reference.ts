import { isWorldPathReference, type RideReference } from "@voltonaut/shared";

import type { RideProgressJournalRow } from "./progress.schema.js";
import { progressError } from "./progress.validation.js";

type JournalReferenceColumns = Pick<
  RideProgressJournalRow,
  "routeId" | "routeRevision" | "worldId" | "worldRevision" | "pathId"
>;

/** Journal columns of a ride reference; the other form stays null (ADR-033 §7). */
export function journalReferenceColumns(reference: RideReference): JournalReferenceColumns {
  return isWorldPathReference(reference)
    ? {
        routeId: null,
        routeRevision: null,
        worldId: reference.worldId,
        worldRevision: reference.worldRevision,
        pathId: reference.pathId,
      }
    : {
        routeId: reference.routeId,
        routeRevision: reference.routeRevision,
        worldId: null,
        worldRevision: null,
        pathId: null,
      };
}

/** The stored reference of a journal row; stored single-route journals stay single-route. */
export function storedRideReference(row: Readonly<JournalReferenceColumns>): RideReference {
  if (row.worldId !== null && row.worldRevision !== null && row.pathId !== null) {
    return { worldId: row.worldId, worldRevision: row.worldRevision, pathId: row.pathId };
  }

  if (row.routeId !== null && row.routeRevision !== null) {
    return { routeId: row.routeId, routeRevision: row.routeRevision };
  }

  throw progressError(500, "internal_error", "corrupt progress journal reference");
}
