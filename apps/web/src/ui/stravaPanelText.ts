import type { StravaDelivery } from "@voltonaut/shared";
import type { StravaSync } from "../sync/stravaSync.js";

export function accountAction(
  sync: Readonly<StravaSync>,
  account: { readonly userId: string; readonly generation: number },
  action: () => void,
): () => void {
  return () => {
    const current = sync.view();

    if (
      current.kind === "account" &&
      current.userId === account.userId &&
      current.generation === account.generation
    )
      action();
  };
}

export function text(value: string): HTMLParagraphElement {
  const node = document.createElement("p");
  node.textContent = value;

  return node;
}

export function button(label: string, action: () => void, disabled = false): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = label;
  node.disabled = disabled;
  node.addEventListener("click", action);

  return node;
}

export function stravaDeliveryText(delivery: StravaDelivery): string {
  const stopped = delivery.authority.kind === "stopped" ? "Lokal gestoppt. " : "";
  const progress = delivery.progress;

  switch (progress.kind) {
    case "queued":
      return `${stopped}Freigabe dauerhaft vorgemerkt. Noch kein Anbieter-POST.`;
    case "preparing":
      return `${stopped}Versand wird vorbereitet. Noch kein Anbieter-POST freigegeben.`;
    case "submitting":
      return `${stopped}Einmaliger Versand freigegeben. Ergebnis noch nicht bestätigt.`;
    case "submission_unknown":
      return `${stopped}Ergebnis unbekannt. Aktivität kann bei Strava vorhanden sein. Kein erneuter automatischer Versand.`;
    case "processing":
      return `${stopped}Strava verarbeitet Upload ${progress.receipt.uploadId}.${progress.issue === "none" ? "" : " Statusabfrage nicht bestätigt. Upload-ID bleibt erhalten."}`;
    case "delivered":
      return `${stopped}Verarbeitung bestätigt. Aktivität ${progress.activityId}.`;
    case "submission_rejected":
      return `${stopped}Anbieter hat den Sendeversuch abgelehnt. Kein erneuter Upload für diese Fahrt.`;
    case "processing_rejected":
      return `${stopped}Verarbeitung fehlgeschlagen. Upload ${progress.receipt.uploadId} bleibt bekannt. Kein erneuter Upload.`;
    default: {
      const exhaustive: never = progress;

      return exhaustive;
    }
  }
}
