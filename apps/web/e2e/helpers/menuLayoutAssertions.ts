import type { LayoutSnapshot } from "./menuLayout.js";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

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
  check(
    snapshot.content.bottom <= snapshot.footer.top + 1,
    `${position}: content bottom ${snapshot.content.bottom} must be at or above footer top ${snapshot.footer.top} within 1px`,
  );
  check(
    fullyInside(snapshot.dialog, snapshot.footer),
    `${position}: footer must be inside the dialog`,
  );
  check(
    fullyInside(snapshot.viewport, snapshot.footer),
    `${position}: footer must be inside the viewport`,
  );
  check(
    snapshot.footerOverlaps.length === 0,
    `${position}: visible controls must not extend into the footer: ${JSON.stringify(snapshot.footerOverlaps)}`,
  );
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

  check(
    outside.length === 0,
    `Every tab must be fully inside the dialog and viewport: ${JSON.stringify(outside)}`,
  );

  const rows = new Set(snapshot.tabs.map((entry) => Math.round(entry.rect.top))).size;
  const expectedRows = snapshot.dialog.right - snapshot.dialog.left < 480 ? 2 : 1;

  check(rows === expectedRows, `Tabs must use ${expectedRows} rows at this container width`);

  check(
    snapshot.horizontalOverflow.length === 0,
    `Tablist, dialog and content must not overflow horizontally: ${JSON.stringify(snapshot.horizontalOverflow)}`,
  );
}

function assertMode(snapshot: Readonly<LayoutSnapshot>, selectedTab: string): void {
  check(snapshot.modeInsideProfile, "Spielmodus must belong to the profile panel");
  check(snapshot.modeInsideDialog, "Spielmodus must belong to the dialog");

  if (selectedTab === "Profil")
    check(
      fullyInside(snapshot.profile, snapshot.mode) && fullyInside(snapshot.dialog, snapshot.mode),
      "Visible Spielmodus must be inside the profile panel and dialog",
    );
  else check(!snapshot.modeVisible, "Spielmodus must be hidden outside the profile panel");
}

function assertScrollAndViewport(snapshot: Readonly<LayoutSnapshot>): void {
  check(
    snapshot.content.scrollable === String(snapshot.content.overflows),
    `data-scrollable must describe actual overflow: expected ${String(snapshot.content.overflows)}, received ${snapshot.content.scrollable}`,
  );

  if (snapshot.content.overflows)
    check(
      snapshot.content.boxShadow.includes("inset"),
      "Overflowing content needs a non-none inset shadow",
    );

  check(
    snapshot.document.scrollWidth <= snapshot.document.viewportWidth + 1 &&
      snapshot.document.scrollHeight <= snapshot.document.viewportHeight + 1,
    "The document must not scroll",
  );
  check(fullyInside(snapshot.viewport, snapshot.world), "The world must remain in the viewport");
  check(fullyInside(snapshot.viewport, snapshot.hud), "The HUD must remain in the viewport");
}

export function assertLayout(snapshot: Readonly<LayoutSnapshot>, selectedTab: string): void {
  assertFooterBoundary(snapshot, "top");
  assertTabs(snapshot);
  assertMode(snapshot, selectedTab);
  assertScrollAndViewport(snapshot);
}
