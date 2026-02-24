import type { ServerToClientEvent } from "@fun-euchre/protocol";
import {
  cloneClientRuntimeState,
  createInitialClientRuntimeState,
  reduceServerEvents,
  type ClientRuntimeState,
  type EventSource,
  type ReducerResult
} from "./reducer.js";

type GameStoreListener = (state: ClientRuntimeState) => void;

export type GameStore = {
  getState(): ClientRuntimeState;
  dispatchEvents(source: EventSource, events: readonly ServerToClientEvent[]): ReducerResult;
  subscribe(listener: GameStoreListener): () => void;
  reset(nextState?: ClientRuntimeState): void;
};

export function createGameStore(initialState?: ClientRuntimeState): GameStore {
  let state = initialState
    ? cloneClientRuntimeState(initialState)
    : createInitialClientRuntimeState();
  const listeners = new Set<GameStoreListener>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener(cloneClientRuntimeState(state));
    }
  };

  return {
    getState: () => cloneClientRuntimeState(state),
    dispatchEvents: (source, events) => {
      const reduced = reduceServerEvents(state, {
        source,
        events
      });
      if (reduced.state !== state) {
        state = reduced.state;
        notify();
      }
      return reduced;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset: (nextState) => {
      state = nextState
        ? cloneClientRuntimeState(nextState)
        : createInitialClientRuntimeState();
      notify();
    }
  };
}
