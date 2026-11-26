export type DeliveryMode = "manual" | "resume";

/**
 * Delivery state of the account outbox for one binding (ADR-005/018). Only one run delivers at a
 * time; requests during a run are coalesced into one follow-up run, where a manual request wins
 * over a resume. A rejected session stops further runs until the next binding.
 */
export class AccountOutboxRun {
  #running = false;
  #queued: DeliveryMode | undefined;
  #reauth = false;

  get reauth(): boolean {
    return this.#reauth;
  }

  /** Marks that the server asked for a new login. */
  rejectSession(): void {
    this.#reauth = true;
  }

  /** True when the caller may deliver now; otherwise the request is queued. */
  claim(mode: DeliveryMode): boolean {
    if (!this.#running) {
      this.#running = true;

      return true;
    }

    if (mode === "manual" || this.#queued === undefined) this.#queued = mode;

    return false;
  }

  /** Ends the running delivery and hands out the coalesced follow-up request, if any. */
  release(): DeliveryMode | undefined {
    const queued = this.#queued;
    this.#running = false;
    this.#queued = undefined;

    return queued;
  }
}
