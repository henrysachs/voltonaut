import type { LeaseBinding } from "./apiRoute.js";

/** A step of work that is still allowed to publish its result. */
export interface AccountTurn {
  readonly current: () => boolean;
}

/**
 * Orders competing work inside one binding. `begin` starts a turn and ends every earlier one;
 * `join` takes part in the running turn. A turn also ends with the binding of its lease.
 */
export class AccountLane {
  #turn = 0;

  begin(lease: Readonly<Pick<LeaseBinding, "current">>): AccountTurn {
    this.#turn += 1;

    return this.join(lease);
  }

  join(lease: Readonly<Pick<LeaseBinding, "current">>): AccountTurn {
    const turn = this.#turn;

    return { current: () => turn === this.#turn && lease.current() };
  }
}
