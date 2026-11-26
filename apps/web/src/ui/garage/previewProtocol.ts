import type { AvatarConfig } from "@voltonaut/shared";

/** CSS size of the preview host; zero while the menu is closed, and then nothing is drawn. */
export interface PreviewViewport {
  readonly widthCssPx: number;
  readonly heightCssPx: number;
  readonly devicePixelRatio: number;
}

export function isVisibleViewport(viewport: Readonly<PreviewViewport>): boolean {
  return viewport.widthCssPx > 0 && viewport.heightCssPx > 0;
}

export type PreviewControl =
  | { readonly type: "preview.look"; readonly look: AvatarConfig }
  | { readonly type: "preview.autoRotate"; readonly enabled: boolean }
  | { readonly type: "preview.rotate"; readonly angleRad: number }
  | { readonly type: "preview.resize"; readonly viewport: PreviewViewport }
  | { readonly type: "preview.dispose" };

export type PreviewCommand =
  | PreviewControl
  | {
      readonly type: "preview.init";
      readonly canvas: OffscreenCanvas;
      readonly wheelCircM: number;
      readonly viewport: PreviewViewport;
    };

export type PreviewFailure =
  | "initialization"
  | "context-lost"
  | "worker-error"
  | "render-error"
  | "invalid-look";

export interface PreviewDraw {
  readonly calls: number;
  readonly triangles: number;
}

export type PreviewReply =
  | { readonly type: "preview.ready" }
  /** A real draw plus a following worker task; the browser still owns visible presentation. */
  | { readonly type: "preview.drawn"; readonly draw: PreviewDraw }
  | { readonly type: "preview.failed"; readonly reason: PreviewFailure }
  | { readonly type: "preview.disposed" };

export interface PreviewTimer {
  readonly schedule: (callback: () => void, delayMs: number) => number;
  readonly cancel: (id: number) => void;
}
