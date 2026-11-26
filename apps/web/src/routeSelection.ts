import { mountRouteCatalog, updateRouteIdentity } from "./ui/routeCatalogPanel.js";
import type { EnvironmentSettings } from "./world/environment.js";
import { resolveRouteId, routeEnvironmentSettings, ROUTE_CATALOG } from "./world/routeCatalog.js";

/** The route the URL selects, with the atmosphere the ride starts in (#75). */
export interface RouteSelection {
  readonly routeId: string;
  readonly environment: EnvironmentSettings;
  /** Header identity and the Strecke tab cards; runs once the ride views are mounted. */
  readonly mount: () => void;
}

export function selectRouteFromUrl(params: Readonly<URLSearchParams>): RouteSelection {
  const routeId = resolveRouteId(params.get("route"));

  return {
    routeId,
    environment: routeEnvironmentSettings(params, routeId),
    mount() {
      updateRouteIdentity(routeId);
      mountRouteCatalog(ROUTE_CATALOG, routeId);
    },
  };
}
