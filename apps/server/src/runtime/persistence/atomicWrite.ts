import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export function writeFileAtomic(targetPath: string, contents: string): void {
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  let wroteTempFile = false;

  try {
    writeFileSync(tempPath, contents, {
      encoding: "utf8"
    });
    wroteTempFile = true;
    renameSync(tempPath, targetPath);
    wroteTempFile = false;
  } finally {
    if (wroteTempFile) {
      try {
        unlinkSync(tempPath);
      } catch {
        // best-effort cleanup only
      }
    }
  }
}
