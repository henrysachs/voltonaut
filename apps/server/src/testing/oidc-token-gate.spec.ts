export function createOidcTokenGate(expectedCalls: number) {
  const events = new EventTarget();

  const ready = new Promise<void>((resolve) => {
    events.addEventListener(
      "ready",
      () => {
        resolve();
      },
      { once: true },
    );
  });

  const wait = new Promise<void>((resolve) => {
    events.addEventListener(
      "release",
      () => {
        resolve();
      },
      { once: true },
    );
  });

  let calls = 0;

  return {
    ready,
    wait,
    enter: () => {
      calls += 1;

      if (calls === expectedCalls) events.dispatchEvent(new Event("ready"));
    },
    release: () => {
      events.dispatchEvent(new Event("release"));
    },
  };
}
