import type { StructuredLogger } from "../../observability/logger.js";
import type { RuntimeOrchestrator } from "../orchestrator.js";
import type { FileRuntimeSnapshotRepository } from "./fileSnapshotRepository.js";
import { createRuntimeSnapshot } from "./runtimeSnapshot.js";

export const DEFAULT_SNAPSHOT_CHECKPOINT_DEBOUNCE_MS = 75;

export type RuntimeSnapshotCheckpointerOptions = {
  repository: FileRuntimeSnapshotRepository;
  runtime: RuntimeOrchestrator;
  logger: StructuredLogger;
  debounceMs?: number;
  now?: () => number;
};

export class RuntimeSnapshotCheckpointer {
  private readonly repository: FileRuntimeSnapshotRepository;
  private readonly runtime: RuntimeOrchestrator;
  private readonly logger: StructuredLogger;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private flushing = false;
  private flushPending = false;
  private stopped = false;

  constructor(options: RuntimeSnapshotCheckpointerOptions) {
    this.repository = options.repository;
    this.runtime = options.runtime;
    this.logger = options.logger;
    this.debounceMs = options.debounceMs ?? DEFAULT_SNAPSHOT_CHECKPOINT_DEBOUNCE_MS;
    this.now = options.now ?? (() => Date.now());
  }

  schedule(): void {
    if (this.stopped) {
      return;
    }
    this.dirty = true;
    if (this.timer !== null) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
  }

  flushNow(): void {
    this.dirty = true;
    this.flush();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private flush(): void {
    if (this.stopped) {
      return;
    }
    if (this.flushing) {
      this.flushPending = true;
      return;
    }

    this.flushing = true;
    try {
      while (this.dirty || this.flushPending) {
        this.flushPending = false;
        if (!this.dirty) {
          continue;
        }

        this.dirty = false;
        const snapshot = createRuntimeSnapshot(this.runtime, this.now());
        const saveResult = this.repository.save(snapshot);
        if (!saveResult.ok) {
          this.logger.logServerLifecycle({
            phase: "stopping",
            message: "Runtime checkpoint write failed.",
            metadata: {
              sourcePath: saveResult.sourcePath,
              code: saveResult.code,
              detail: saveResult.message
            }
          });
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}
