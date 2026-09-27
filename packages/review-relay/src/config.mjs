import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, sep } from "node:path";

export function databasePath(env = process.env) {
  const path = env.TANZAKOO_RELAY_DB;
  if (!path || !isAbsolute(path))
    throw new Error("Set TANZAKOO_RELAY_DB to an absolute persistent database path");
  if (env.RAILWAY_SERVICE_ID || env.RAILWAY_ENVIRONMENT_ID) {
    if (!env.RAILWAY_VOLUME_MOUNT_PATH)
      throw new Error("Attach a Railway volume before starting the review relay");
    const mount = realpathSync(env.RAILWAY_VOLUME_MOUNT_PATH);
    const parent = realpathSync(dirname(path));
    const fromMount = relative(mount, parent);
    if (isAbsolute(fromMount) || fromMount === ".." || fromMount.startsWith(`..${sep}`))
      throw new Error("TANZAKOO_RELAY_DB must be inside the Railway volume");
  }
  return path;
}
