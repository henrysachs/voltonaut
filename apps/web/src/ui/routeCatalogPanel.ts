import { TEST_ROUTES, type RouteData } from "@voltonaut/engine";

import { formatRouteLength, routeElevationGainM, routePreviewPath } from "./routePreview.js";

/** Catalog fields the panel needs; structurally satisfied by RoutePresentation. */
export interface RouteCardSource {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

/** Header identity line: "TEST LOOP / 10 KM". */
export function routeIdentityText(name: string, lengthM: number): string {
  return `${name.toUpperCase()} / ${formatRouteLength(lengthM).toUpperCase()}`;
}

/** Sets the route URL parameter while keeping sim, clock, debug and friends. */
export function selectRoute(routeId: string): void {
  const params = new URLSearchParams(window.location.search);

  params.set("route", routeId);
  window.location.search = params.toString();
}

function svgPreview(pathD: string, title: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

  svg.setAttribute("viewBox", "0 0 132 84");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Streckenvorschau: ${title}`);
  svg.classList.add("route-card__preview");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

  path.setAttribute("d", pathD);
  path.classList.add("route-card__path");
  svg.append(path);

  return svg;
}

function routeMeta(data: Readonly<RouteData>): HTMLParagraphElement {
  const meta = document.createElement("p");
  const elevationGainM = routeElevationGainM(data.profileSamples);

  meta.className = "route-card__meta";
  meta.dataset["lengthKm"] = formatRouteLength(data.lengthM);
  meta.dataset["elevationGainM"] = String(elevationGainM);
  meta.textContent = `${formatRouteLength(data.lengthM)} · ${elevationGainM} hm`;

  return meta;
}

function routeSelect(presentation: Readonly<RouteCardSource>, current: boolean): HTMLButtonElement {
  const select = document.createElement("button");

  select.type = "button";
  select.className = "route-card__select";
  select.dataset["testid"] = `route-select-${presentation.id}`;
  select.textContent = current ? "Aktuelle Strecke" : `${presentation.title} fahren`;
  select.disabled = current;
  select.addEventListener("click", () => {
    selectRoute(presentation.id);
  });

  return select;
}

function routeCard(
  presentation: Readonly<RouteCardSource>,
  data: Readonly<RouteData>,
  current: boolean,
): HTMLElement {
  const card = document.createElement("article");

  card.className = "route-card";
  card.dataset["routeId"] = presentation.id;
  card.dataset["current"] = String(current);

  if (current) card.setAttribute("aria-current", "true");

  const heading = document.createElement("h3");

  heading.textContent = presentation.title;

  const description = document.createElement("p");

  description.className = "route-card__description";
  description.textContent = presentation.description;

  card.append(
    svgPreview(routePreviewPath(data.centerline), presentation.title),
    heading,
    routeMeta(data),
    description,
    routeSelect(presentation, current),
  );

  return card;
}

/**
 * Populates the Strecke tab from the route catalog (#75): one card per
 * presentable route with its 2D centerline preview, length, elevation gain
 * and a select action that reloads with the new route parameter.
 */
export function mountRouteCatalog(
  presentations: readonly RouteCardSource[],
  currentRouteId: string,
): void {
  const host = document.querySelector("#route-catalog");

  if (host instanceof HTMLElement) {
    for (const presentation of presentations) {
      const data = TEST_ROUTES[presentation.id];

      if (data === undefined) continue;

      host.append(routeCard(presentation, data, presentation.id === currentRouteId));
    }
  }
}

/** Writes the selected route's name and length into the header identity. */
export function updateRouteIdentity(routeId: string): void {
  const data = TEST_ROUTES[routeId];
  const identity = document.querySelector("#ride-route-identity");

  if (data !== undefined && identity instanceof HTMLElement) {
    identity.textContent = routeIdentityText(data.name, data.lengthM);
  }
}
