export function withProfileSelection<T>(
  apply: () => Promise<T>,
  signal: Readonly<AbortSignal> = AbortSignal.timeout(8000),
): Promise<T> {
  if ("locks" in navigator)
    return navigator.locks.request("voltonaut-profile-selection", { signal }, apply);

  return Promise.reject(
    new Error("Browserweite Profilsperre nicht verfügbar. Kein Profil überschrieben."),
  );
}
