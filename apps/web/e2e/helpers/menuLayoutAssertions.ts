import { expect } from "@playwright/test";

import type { LayoutSnapshot } from "./menuLayout.js";

function fullyInside(
  outer: Readonly<LayoutSnapshot["viewport"]>,
  inner: Readonly<LayoutSnapshot["viewport"]>,
): boolean {
  return (
    inner.left >= outer.left - 1 &&
    inner.top >= outer.top - 1 &&
    inner.right <= outer.right + 1 &&
    inner.bottom <= outer.bottom + 1
  );
}

export function assertFooterBoundary(snapshot: Readonly<LayoutSnapshot>, position: string): void {
  expect
    .soft(
      snapshot.content.bottom,
      `${position}: content bottom ${snapshot.content.bottom} must be at or above footer top ${snapshot.footer.top} within 1px`,
    )
    .toBeLessThanOrEqual(snapshot.footer.top + 1);
  expect
    .soft(fullyInside(snapshot.dialog, snapshot.footer), `${position}: footer inside dialog`)
    .toBe(true);
  expect
    .soft(fullyInside(snapshot.viewport, snapshot.footer), `${position}: footer inside viewport`)
    .toBe(true);
  expect
    .soft(snapshot.footerOverlaps, `${position}: visible controls must not extend into footer`)
    .toEqual([]);
}

function assertTabs(snapshot: Readonly<LayoutSnapshot>): void {
  const outside = snapshot.tabs.flatMap((entry) => {
    const containers: string[] = [];

    if (!fullyInside(snapshot.dialog, entry.rect)) containers.push("dialog");

    if (!fullyInside(snapshot.viewport, entry.rect)) containers.push("viewport");

    return containers.length === 0
      ? []
      : [{ name: entry.name, outside: containers, rect: entry.rect }];
  });

  expect.soft(outside, "every tab must be fully inside the dialog and viewport").toEqual([]);
  const rows = new Set(snapshot.tabs.map((entry) => Math.round(entry.rect.top))).size;
  const expectedRows = snapshot.dialog.right - snapshot.dialog.left < 480 ? 2 : 1;

  expect
    .soft(rows, `tabs must use ${expectedRows} rows at this container width`)
    .toBe(expectedRows);
  expect
    .soft(snapshot.horizontalOverflow, "tablist, dialog and content must not overflow horizontally")
    .toEqual([]);
}

function assertMode(snapshot: Readonly<LayoutSnapshot>, selectedTab: string): void {
  expect.soft(snapshot.modeInsideProfile, "Spielmodus must belong to the profile panel").toBe(true);
  expect.soft(snapshot.modeInsideDialog, "Spielmodus must belong to the dialog").toBe(true);

  if (selectedTab === "Profil")
    expect
      .soft(
        fullyInside(snapshot.profile, snapshot.mode) && fullyInside(snapshot.dialog, snapshot.mode),
        "visible Spielmodus must be inside profile and dialog",
      )
      .toBe(true);
  else
    expect
      .soft(snapshot.modeVisible, "Spielmodus must be hidden outside the profile panel")
      .toBe(false);
}

function assertScrollAndViewport(snapshot: Readonly<LayoutSnapshot>): void {
  expect
    .soft(snapshot.content.scrollable, "data-scrollable must describe actual overflow")
    .toBe(String(snapshot.content.overflows));

  if (snapshot.content.overflows)
    expect
      .soft(snapshot.content.boxShadow, "overflowing content needs a non-none inset shadow")
      .toContain("inset");

  expect
    .soft(
      snapshot.document.scrollWidth <= snapshot.document.viewportWidth + 1 &&
        snapshot.document.scrollHeight <= snapshot.document.viewportHeight + 1,
      "document must not scroll",
    )
    .toBe(true);
  expect
    .soft(fullyInside(snapshot.viewport, snapshot.world), "world must remain in viewport")
    .toBe(true);
  expect
    .soft(fullyInside(snapshot.viewport, snapshot.hud), "HUD must remain in viewport")
    .toBe(true);
}

export function assertLayout(snapshot: Readonly<LayoutSnapshot>, selectedTab: string): void {
  assertFooterBoundary(snapshot, "top");
  assertTabs(snapshot);
  assertMode(snapshot, selectedTab);
  assertScrollAndViewport(snapshot);
}
