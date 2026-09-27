import { Ledger } from "./ledger.mjs";

const path = process.env.TANZAKOO_RELAY_DB;
if (!path) throw new Error("Set TANZAKOO_RELAY_DB");
const ledger = new Ledger(path);
try {
  const [action, ...args] = process.argv.slice(2);
  if (action === "issue" && args.length === 3) {
    // This explicit admin action prints the newly generated token exactly once.
    console.log(
      JSON.stringify(
        ledger.issue({
          model: args[0],
          expires: Date.parse(args[1]),
          maxRequests: Number(args[2]),
        }),
        null,
        2,
      ),
    );
  } else if (action === "revoke" && args.length === 1) {
    if (!ledger.revoke(args[0])) throw new Error("Grant not found");
    console.log("Revoked");
  } else if (action === "list" && args.length === 0)
    console.log(JSON.stringify(ledger.list(), null, 2));
  else throw new Error("Usage: issue <model> <ISO expiry> <max requests> | revoke <id> | list");
} finally {
  ledger.close();
}
