import crypto from "crypto";
import os from "os";

export function getMachineId() {
  const data = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || "",
    os.totalmem()
  ].join("|");

  return crypto
    .createHash("sha256")
    .update(data)
    .digest("hex");
}