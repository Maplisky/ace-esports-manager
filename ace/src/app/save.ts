/** IndexedDB 存档（GDD §11.4）：key-value 单库，自动档 'autosave' */
import type { GameState, MatchRecord } from "../core/types.ts";

export interface SavedGame {
  state: GameState;
  /** 我的比赛回放（fixtureId → MatchRecord） */
  records: Record<string, MatchRecord>;
  savedAt: string;
}

const DB_NAME = "ace-saves";
const STORE = "saves";
const KEY = "autosave";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveGame(state: GameState, records: Record<string, MatchRecord>): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ state, records, savedAt: new Date().toISOString() } satisfies SavedGame, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadGame(): Promise<SavedGame | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as SavedGame) ?? null);
    req.onerror = () => reject(req.error);
  });
}
