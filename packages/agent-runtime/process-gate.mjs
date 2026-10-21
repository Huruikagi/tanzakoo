import { readSync } from "node:fs";

// Rust assigns this process to its Windows job before releasing the gate.
// Read exactly the preamble, leaving all ACP frames on stdin for the adapter.
export function waitForProcessJob() {
  const enabled = process.env.TANZAKOO_ACP_PROCESS_GATE === "1";
  delete process.env.TANZAKOO_ACP_PROCESS_GATE;
  if (!enabled) return;
  const expected = Buffer.from("tanzakoo-process-ready\n");
  const received = Buffer.alloc(expected.length);
  let offset = 0;
  while (offset < received.length) {
    const length = readSync(0, received, offset, received.length - offset, null);
    if (length === 0) throw new Error("Tanzakoo process owner disconnected before startup");
    offset += length;
  }
  if (!received.equals(expected)) throw new Error("Invalid Tanzakoo process startup preamble");
}
