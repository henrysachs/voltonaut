// Must equal SKIP_WAITING_MESSAGE; the worker bundle cannot share modules with the app.
export const SKIP_WAITING = "voltonaut:skip-waiting";

// oxlint-disable typescript/prefer-readonly-parameter-types -- Service worker handles are browser-owned mutable objects.
export type ApplyUpdate = () => void;

export async function registerShell(
  container: ServiceWorkerContainer,
  onUpdateReady: (apply: ApplyUpdate) => void,
): Promise<void> {
  const registration = await container.register("/sw.js", { scope: "/" });
  let reloadRequested = false;

  const announce = (worker: ServiceWorker): void => {
    onUpdateReady(() => {
      reloadRequested = true;
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- ServiceWorker.postMessage has no targetOrigin parameter; that rule targets window.postMessage.
      worker.postMessage(SKIP_WAITING);
    });
  };

  // A reload loses the running recording, so it only follows an explicit user request.
  container.addEventListener("controllerchange", () => {
    if (reloadRequested) window.location.reload();
  });

  if (registration.waiting !== null && container.controller !== null) {
    announce(registration.waiting);
  }

  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;

    if (worker === null) return;

    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && container.controller !== null) announce(worker);
    });
  });
}
