import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "./atomicWrite.js";
import {
  parseRuntimeSnapshot,
  type RuntimeSnapshot
} from "./runtimeSnapshot.js";

export type RuntimeSnapshotLoadResult =
  | {
      ok: true;
      snapshot: RuntimeSnapshot | null;
      sourcePath: string;
    }
  | {
      ok: false;
      code: "IO_ERROR" | "INVALID_SNAPSHOT";
      message: string;
      sourcePath: string;
    };

export type RuntimeSnapshotSaveResult =
  | {
      ok: true;
      sourcePath: string;
    }
  | {
      ok: false;
      code: "IO_ERROR";
      message: string;
      sourcePath: string;
    };

export type FileRuntimeSnapshotRepositoryOptions = {
  filePath: string;
};

export class FileRuntimeSnapshotRepository {
  private readonly filePath: string;

  constructor(options: FileRuntimeSnapshotRepositoryOptions) {
    this.filePath = options.filePath;
  }

  load(): RuntimeSnapshotLoadResult {
    if (!existsSync(this.filePath)) {
      return {
        ok: true,
        snapshot: null,
        sourcePath: this.filePath
      };
    }

    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (error) {
      return {
        ok: false,
        code: "IO_ERROR",
        message: `Unable to read runtime snapshot: ${(error as Error).message}`,
        sourcePath: this.filePath
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        code: "INVALID_SNAPSHOT",
        message: `Runtime snapshot JSON is invalid: ${(error as Error).message}`,
        sourcePath: this.filePath
      };
    }

    const snapshot = parseRuntimeSnapshot(parsed);
    if (!snapshot.ok) {
      return {
        ok: false,
        code: "INVALID_SNAPSHOT",
        message: snapshot.message,
        sourcePath: this.filePath
      };
    }

    return {
      ok: true,
      snapshot: snapshot.snapshot,
      sourcePath: this.filePath
    };
  }

  save(snapshot: RuntimeSnapshot): RuntimeSnapshotSaveResult {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileAtomic(this.filePath, `${JSON.stringify(snapshot, null, 2)}\n`);
      return {
        ok: true,
        sourcePath: this.filePath
      };
    } catch (error) {
      return {
        ok: false,
        code: "IO_ERROR",
        message: `Unable to persist runtime snapshot: ${(error as Error).message}`,
        sourcePath: this.filePath
      };
    }
  }
}
