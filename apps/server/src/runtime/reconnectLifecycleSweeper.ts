import { createNoopLogger, type StructuredLogger } from "../observability/logger.js";
import type { RuntimeOrchestrator } from "./orchestrator.js";
import type { ReconnectLifecycleSweepResult } from "./dispatchers.js";

export type ReconnectLifecycleSweeperOptions = {
  runtime: Pick<RuntimeOrchestrator, "runLifecycleSweep">;
  sweepIntervalMs: number;
  logger?: StructuredLogger;
};

function emptySweepResult(nowMs: number): ReconnectLifecycleSweepResult {
  return {
    nowMs,
    evaluatedSessionCount: 0,
    forfeitAppliedCount: 0,
    sessionPrunedCount: 0,
    gamePrunedCount: 0,
    lobbyPrunedCount: 0,
    checkpointRequested: false
  };
}

export class ReconnectLifecycleSweeper {
  private readonly runtime: Pick<RuntimeOrchestrator, "runLifecycleSweep">;
  private readonly sweepIntervalMs: number;
  private readonly logger: StructuredLogger;
  private timer: NodeJS.Timeout | null = null;
  private runningSweep: Promise<ReconnectLifecycleSweepResult> | null = null;
  private queued = false;
  private stopped = false;

  constructor(options: ReconnectLifecycleSweeperOptions) {
    this.runtime = options.runtime;
    this.sweepIntervalMs = options.sweepIntervalMs;
    this.logger = options.logger ?? createNoopLogger();
    if (!Number.isInteger(this.sweepIntervalMs) || this.sweepIntervalMs < 1) {
      throw new Error("sweepIntervalMs must be an integer >= 1.");
    }
  }

  start(): void {
    if (this.stopped || this.timer !== null) {
      return;
    }

    this.timer = setInterval(() => {
      void this.trigger();
    }, this.sweepIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  trigger(): Promise<ReconnectLifecycleSweepResult> {
    if (this.stopped) {
      return Promise.resolve(emptySweepResult(Date.now()));
    }

    if (this.runningSweep !== null) {
      this.queued = true;
      return this.runningSweep;
    }

    this.runningSweep = this.runLoop();
    return this.runningSweep;
  }

  private async runLoop(): Promise<ReconnectLifecycleSweepResult> {
    let lastResult = emptySweepResult(Date.now());
    try {
      while (!this.stopped) {
        this.queued = false;
        lastResult = await this.runtime.runLifecycleSweep();
        if (!this.queued) {
          break;
        }
      }
    } catch (error) {
      this.logger.logServerLifecycle({
        phase: "starting",
        message: "Reconnect lifecycle sweep failed.",
        metadata: {
          detail: error instanceof Error ? error.message : String(error)
        }
      });
    } finally {
      this.runningSweep = null;
    }

    return lastResult;
  }
}

