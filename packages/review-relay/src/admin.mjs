import { Ledger } from "./ledger.mjs";
import { databasePath } from "./config.mjs";
import { isAbsolute } from "node:path";

process.umask(0o077);
const ledger = new Ledger(databasePath());
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
  else if (action === "backup" && args.length === 1) {
    if (!isAbsolute(args[0])) throw new Error("Use an absolute path for the backup");
    // SQLite takes a consistent snapshot, including committed WAL pages. Refuses
    // a nonempty destination; never copy just the live .sqlite file.
    ledger.db.prepare("VACUUM INTO ?").run(args[0]);
    console.log("Backup created");
  } else
    throw new Error(
      "Usage: issue <model> <ISO expiry> <max requests> | revoke <id> | list | backup <absolute path>",
    );
} finally {
  ledger.close();
}
