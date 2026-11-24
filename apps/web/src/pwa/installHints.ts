export type Platform = "ios" | "android" | "desktop";

export interface InstallHint {
  readonly platform: Platform;
  readonly title: string;
  readonly steps: string;
  readonly bluetooth: string;
}

export const INSTALL_HINTS: readonly InstallHint[] = [
  {
    platform: "desktop",
    title: "Desktop (Chrome, Edge)",
    steps:
      "Auf „App installieren“ klicken oder das Installationssymbol in der Adressleiste nutzen. Voltonaut startet danach in einem eigenen Fenster.",
    bluetooth: "Web Bluetooth funktioniert in Chrome und Edge, auch in der installierten App.",
  },
  {
    platform: "android",
    title: "Android (Chrome)",
    steps:
      "Auf „App installieren“ tippen oder im Browsermenü „Zum Startbildschirm hinzufügen“ bzw. „App installieren“ wählen.",
    bluetooth:
      "Web Bluetooth funktioniert in Chrome für Android. Standortfreigabe und Bluetooth müssen am Gerät aktiv sein.",
  },
  {
    platform: "ios",
    title: "iPhone und iPad (Safari)",
    steps:
      "Teilen-Menü öffnen und „Zum Home-Bildschirm“ wählen. iOS bietet keinen Installationsdialog der Seite.",
    bluetooth:
      "Unter iOS und iPadOS gibt es in keinem Browser Web Bluetooth. Dort ist nur der Sim-Modus nutzbar, keine Trainerverbindung.",
  },
];

export function detectPlatform(userAgent: string, maxTouchPoints: number): Platform {
  if (/iPhone|iPad|iPod/u.test(userAgent)) return "ios";

  // iPadOS reports a Mac user agent but has touch points.
  if (/Macintosh/u.test(userAgent) && maxTouchPoints > 1) return "ios";

  if (/Android/u.test(userAgent)) return "android";

  return "desktop";
}
