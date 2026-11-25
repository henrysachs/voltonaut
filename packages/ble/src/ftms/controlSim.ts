import { readOnlyBytes, type ReadOnlyBytes } from "../bytes.js";

/**
 * Protocol simulator for the FTMS Control Point, not a physical trainer model:
 * it answers exactly the procedures the production session sends, so the sim
 * trainer exercises the real ACK/authority path behind BleTransport.
 */
export class SimControlPoint {
  private phase: "unowned" | "owned" | "started" = "unowned";

  /** A new GATT connection starts without control rights. */
  reset(): void {
    this.phase = "unowned";
  }

  /** Response indication (0x80, request opcode, result) for one write. */
  respond(bytes: ReadOnlyBytes): ReadOnlyBytes {
    const opcode = bytes.at(0);
    let result = 5;

    if (opcode === 0 && bytes.length === 1 && this.phase === "unowned") {
      this.phase = "owned";
      result = 1;
    } else if (opcode === 7 && bytes.length === 1 && this.phase === "owned") {
      this.phase = "started";
      result = 1;
    } else if (opcode === 0x11 && bytes.length === 7 && this.phase === "started") result = 1;
    else if (opcode === 8 && bytes.length === 2 && bytes.at(1) === 1 && this.phase === "started") {
      this.phase = "owned";
      result = 1;
    }

    return readOnlyBytes(Uint8Array.of(0x80, opcode ?? 0xff, result));
  }
}
