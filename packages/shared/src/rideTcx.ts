import type { RideTrack, LocalRidePoint } from "./localRide.js";

const TCX_NS = "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2";
const ACTIVITY_NS = "http://www.garmin.com/xmlschemas/ActivityExtension/v2";

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function trackpoint(startMs: number, point: LocalRidePoint): string {
  const time = new Date(startMs + point.elapsedMs).toISOString();

  const hr =
    point.hrBpm === undefined
      ? ""
      : `<HeartRateBpm><Value>${Math.round(point.hrBpm)}</Value></HeartRateBpm>`;

  const cadence =
    point.cadenceRpm === undefined ? "" : `<Cadence>${Math.round(point.cadenceRpm)}</Cadence>`;

  const watts =
    point.powerW === undefined
      ? ""
      : `<Extensions><ax:TPX><ax:Watts>${Math.round(point.powerW)}</ax:Watts></ax:TPX></Extensions>`;

  return `<Trackpoint><Time>${time}</Time><DistanceMeters>${point.distanceM}</DistanceMeters>${hr}${cadence}${watts}</Trackpoint>`;
}

/** Original serializer for Garmin TCX v2 and ActivityExtension v2. No GPS projection. */
export function serializeRideTcx(ride: RideTrack): string {
  const last = ride.samples.at(-1);

  if (last === undefined) {
    throw new Error("Keine abgeschlossene Aufnahme vorhanden.");
  }

  const startMs = Date.parse(ride.startedAt);
  const tracks: string[] = ["<Track>"];
  const gaps: number[] = [];

  for (const [index, point] of ride.samples.entries()) {
    if (point.gap) {
      gaps.push(point.elapsedMs);

      if (index > 0) {
        tracks.push("</Track><Track>");
      }
    }

    tracks.push(trackpoint(startMs, point));
  }

  tracks.push("</Track>");

  const source =
    ride.metadata.source === "sim"
      ? "Voltonaut simulation, not a real workout."
      : "Voltonaut indoor recording. Sensor data not server verified.";

  const notes = escapeXml(
    `${source} Virtual distance from game physics, not GPS. Real elapsed recording time, independent of physics clock scale ${ride.metadata.physicsClockScale}. Calories 0 means unavailable. Route ${ride.metadata.routeId}, revision ${ride.metadata.routeRevision}. Ride ${ride.rideId}. Gaps at elapsed ms: ${gaps.join(", ") || "none"}. Missing sensors omitted; no interpolated samples.`,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>\n<TrainingCenterDatabase xmlns="${TCX_NS}" xmlns:ax="${ACTIVITY_NS}"><Activities><Activity Sport="Biking"><Id>${ride.startedAt}</Id><Lap StartTime="${ride.startedAt}"><TotalTimeSeconds>${last.elapsedMs / 1000}</TotalTimeSeconds><DistanceMeters>${last.distanceM}</DistanceMeters><Calories>0</Calories><Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>${tracks.join("")}</Lap><Notes>${notes}</Notes></Activity></Activities></TrainingCenterDatabase>\n`;
}

export function rideTcxFilename(ride: RideTrack): string {
  return `voltonaut-${ride.metadata.source}-${ride.rideId}.tcx`;
}
