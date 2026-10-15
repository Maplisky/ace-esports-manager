/** IndexedDB 存档（GDD §11.4，v1.0-9 全量）：自动档 + 3 手动槽 + 每日轮换备份（留 3 份）+ 导出/导入 JSON。
 *  迁移：旧版单一 'autosave' 键在 boot 时搬入自动档（搬完才删旧键——失败不丢档）。 */
import type { GameState, MatchRecord } from "../core/types.ts";

export interface SavedGame {
  state: GameState;
  /** 我的比赛回放（fixtureId → MatchRecord） */
  records: Record<string, MatchRecord>;
  savedAt: string;
  /** 槽位摘要（v1.0-9 起写入；旧档读取时动态补全） */
  meta?: SaveMeta;
}

export interface SaveMeta {
  year: number;
  day: number;
  teamTag: string;
  teamName: string;
  manager: string;
  difficulty: string;
  label: string;
}

export type SaveKey = "auto" | "slot1" | "slot2" | "slot3" | string; // 其余 = 每日备份 "bak-YYYY-MM-DD"

const DB_NAME = "ace-saves";
const STORE = "saves";
const LEGACY_KEY = "autosave";
const AUTO_KEY = "auto";
export const MANUAL_SLOTS = ["slot1", "slot2", "slot3"] as const;
const BACKUP_PREFIX = "bak-";
const BACKUP_KEEP = 3;

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

function metaOf(state: GameState, label: string): SaveMeta {
  const team = state.myTeamId ? state.teams[state.myTeamId] : undefined;
  const diff = state.difficulty ?? "normal";
  return {
    year: state.year,
    day: state.day,
    teamTag: team?.tag ?? "—",
    teamName: team?.name ?? "无俱乐部",
    manager: state.manager?.name ?? "经理",
    difficulty: diff === "pro" ? "职业" : diff === "hard" ? "困难" : "普通",
    label,
  };
}

function txPut(value: SavedGame, key: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function txGet<T>(key: string): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => reject(req.error);
      }),
  );
}

function txKeys(): Promise<string[]> {
  return openDb().then(
    (db) =>
      new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAllKeys();
        req.onsuccess = () => resolve((req.result as string[]) ?? []);
        req.onerror = () => reject(req.error);
      }),
  );
}

function txDelete(key: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

/** 旧档摘要补全：v1.0-9 前的存档无 meta，读取时从 state 推导（写回由下次保存完成） */
function withMeta(raw: SavedGame | null): SavedGame | null {
  if (!raw) return null;
  return { ...raw, meta: raw.meta ?? metaOf(raw.state, "旧档") };
}

/** 存档载荷校验（导入 JSON 的守门 + golden save 回归共用；纯函数可测） */
export function validateSavePayload(raw: unknown): SavedGame | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!o.state || typeof o.state !== "object") return null;
  const st = o.state as Record<string, unknown>;
  if (!Array.isArray(st.fixtures) || typeof st.day !== "number" || typeof st.year !== "number") return null;
  const savedAt = typeof o.savedAt === "string" ? o.savedAt : new Date().toISOString();
  if (o.records !== undefined && typeof o.records === "object" && !Array.isArray(o.records)) {
    return { state: o.state as GameState, records: o.records as Record<string, MatchRecord>, savedAt, meta: o.meta as SaveMeta | undefined };
  }
  if (o.records === undefined) {
    return { state: o.state as GameState, records: {}, savedAt, meta: o.meta as SaveMeta | undefined };
  }
  return null;
}

/** 自动档写入（推进/操作后 persist 调用） */
export async function saveGame(state: GameState, records: Record<string, MatchRecord>): Promise<void> {
  await txPut({ state, records, savedAt: new Date().toISOString(), meta: metaOf(state, "自动档") }, AUTO_KEY);
}

/** 手动槽写入 */
export async function saveSlot(state: GameState, records: Record<string, MatchRecord>, slot: string): Promise<void> {
  await txPut({ state, records, savedAt: new Date().toISOString(), meta: metaOf(state, `手动档 ${slot.replace("slot", "槽 ")}`) }, slot);
}

/** 每日轮换备份：当天首份持久化时复制当前存档；仅保留最近 3 份 */
export async function saveBackup(state: GameState, records: Record<string, MatchRecord>): Promise<void> {
  const key = BACKUP_PREFIX + new Date().toISOString().slice(0, 10);
  const exists = await txGet<SavedGame>(key);
  if (exists) return; // 当天已备份
  await txPut({ state, records, savedAt: new Date().toISOString(), meta: metaOf(state, "每日备份") }, key);
  const baks = (await txKeys()).filter((k) => k.startsWith(BACKUP_PREFIX)).sort();
  while (baks.length > BACKUP_KEEP) {
    await txDelete(baks.shift() as string);
  }
}

export async function loadGame(): Promise<SavedGame | null> {
  return withMeta(await txGet<SavedGame>(AUTO_KEY));
}

export async function loadKey(key: SaveKey): Promise<SavedGame | null> {
  return withMeta(await txGet<SavedGame>(key));
}

export async function deleteSave(key: SaveKey): Promise<void> {
  await txDelete(key);
}

export interface SaveEntry {
  key: string;
  savedAt: string;
  meta: SaveMeta | null;
}

/** 全部存档清单（自动/手动/备份）——系统页与开档界面共用 */
export async function listSaves(): Promise<SaveEntry[]> {
  const keys = await txKeys();
  const out: SaveEntry[] = [];
  for (const key of keys) {
    const raw = await txGet<SavedGame>(key);
    if (!raw) continue;
    out.push({ key, savedAt: raw.savedAt, meta: raw.meta ?? metaOf(raw.state, key.startsWith(BACKUP_PREFIX) ? "每日备份" : key) });
  }
  return out.sort((a, b) => (a.key === AUTO_KEY ? -1 : b.key === AUTO_KEY ? 1 : a.key.localeCompare(b.key)));
}

/** 旧版单键迁移：'autosave' → 'auto'（写入成功才删旧键，失败保留原档） */
export async function migrateLegacyAutosave(): Promise<void> {
  const legacy = await txGet<SavedGame>(LEGACY_KEY);
  if (!legacy) return;
  const current = await txGet<SavedGame>(AUTO_KEY);
  if (!current) {
    await txPut({ ...legacy, meta: legacy.meta ?? metaOf(legacy.state, "自动档（旧档迁移）") }, AUTO_KEY);
  }
  await txDelete(LEGACY_KEY);
}

/** 导出 JSON（信任玩家：永远可用，GDD §11.4） */
export function exportJson(state: GameState, records: Record<string, MatchRecord>): string {
  return JSON.stringify({ state, records, savedAt: new Date().toISOString(), meta: metaOf(state, "导出") });
}

/** 导入 JSON：校验通过返回载荷（由调用方落库/装载），失败返回 null */
export function importJson(text: string): SavedGame | null {
  try {
    return validateSavePayload(JSON.parse(text));
  } catch {
    return null;
  }
}
