import { chunkKey } from '../world/chunkCoords';
import { SAVE_CONFIG } from '../config/constants';
import type { SaveBackend } from './gameSave';
import type { SaveSnapshot } from './saveFormat';

/**
 * Thin IndexedDB adapter (browser only; everything it stores is built and
 * validated by the pure modules in this folder). Schema (database version
 * `SAVE_CONFIG.databaseVersion`), all stores with out-of-line keys:
 * - `meta`   key 'world'  -> WorldMetaRecord
 * - `player` key 'player' -> PlayerRecord
 * - `chests` key 'chests' -> ChestsRecord
 * - `chunkEdits` key chunkKey(cx, cz) -> ChunkEditsRecord (one per edited chunk)
 * TypedArrays are stored as-is (structured clone).
 */
const STORES = { meta: 'meta', player: 'player', chests: 'chests', chunkEdits: 'chunkEdits' } as const;
const META_KEY = 'world';
const PLAYER_KEY = 'player';
const CHESTS_KEY = 'chests';
const ALL_STORES = [STORES.meta, STORES.player, STORES.chests, STORES.chunkEdits];

export class IndexedDbSaveStore implements SaveBackend {
  private constructor(private readonly db: IDBDatabase) {}

  /** Opens (creating/upgrading) the save database. Rejects if blocked, failing or too slow. */
  static open(factory: IDBFactory = indexedDB): Promise<IndexedDbSaveStore> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      };
      const timeout = setTimeout(
        () => fail(new Error(`IndexedDB open timed out after ${SAVE_CONFIG.openTimeoutMs} ms.`)),
        SAVE_CONFIG.openTimeoutMs,
      );
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(SAVE_CONFIG.databaseName, SAVE_CONFIG.databaseVersion);
      } catch (error) {
        fail(error);
        return;
      }
      request.onupgradeneeded = (): void => {
        const db = request.result;
        for (const name of ALL_STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name);
          }
        }
      };
      request.onblocked = (): void => fail(new Error('IndexedDB open blocked by another connection.'));
      request.onerror = (): void => fail(request.error ?? new Error('IndexedDB open failed.'));
      request.onsuccess = (): void => {
        if (settled) {
          // Timed out already: the game runs without saving; release the late connection.
          request.result.close();
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(new IndexedDbSaveStore(request.result));
      };
    });
  }

  /** Assembles the stored records into the raw save shape, or null when no world is stored. */
  load(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(ALL_STORES, 'readonly');
      const meta = tx.objectStore(STORES.meta).get(META_KEY);
      const player = tx.objectStore(STORES.player).get(PLAYER_KEY);
      const chests = tx.objectStore(STORES.chests).get(CHESTS_KEY);
      const chunks = tx.objectStore(STORES.chunkEdits).getAll();
      tx.oncomplete = (): void => {
        if (meta.result === undefined) {
          resolve(null);
          return;
        }
        resolve({ meta: meta.result, player: player.result, chests: chests.result, chunks: chunks.result });
      };
      tx.onerror = (): void => reject(tx.error ?? new Error('IndexedDB read failed.'));
      tx.onabort = (): void => reject(tx.error ?? new Error('IndexedDB read aborted.'));
    });
  }

  /**
   * Writes one snapshot in a single readwrite transaction (all-or-nothing).
   * Requests are issued synchronously so a save started in `pagehide` is
   * already queued before the handler returns.
   */
  write(snapshot: SaveSnapshot): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(ALL_STORES, 'readwrite');
      tx.objectStore(STORES.meta).put(snapshot.meta, META_KEY);
      tx.objectStore(STORES.player).put(snapshot.player, PLAYER_KEY);
      tx.objectStore(STORES.chests).put(snapshot.chests, CHESTS_KEY);
      const chunkStore = tx.objectStore(STORES.chunkEdits);
      if (snapshot.replaceAllChunks) {
        chunkStore.clear();
      }
      for (const record of snapshot.chunkPuts) {
        chunkStore.put(record, chunkKey(record.cx, record.cz));
      }
      for (const { cx, cz } of snapshot.chunkDeletes) {
        chunkStore.delete(chunkKey(cx, cz));
      }
      tx.oncomplete = (): void => resolve();
      tx.onerror = (): void => reject(tx.error ?? new Error('IndexedDB write failed.'));
      tx.onabort = (): void => reject(tx.error ?? new Error('IndexedDB write aborted.'));
    });
  }
}

/**
 * Opens the save store, or returns null (logging once) when IndexedDB is
 * missing, blocked or failing (e.g. some private modes) — the game then runs
 * without saving.
 */
export async function openSaveStore(): Promise<IndexedDbSaveStore | null> {
  if (typeof indexedDB === 'undefined') {
    console.warn('[save] IndexedDB is unavailable; the world will not be saved.');
    return null;
  }
  try {
    return await IndexedDbSaveStore.open();
  } catch (error) {
    console.warn('[save] could not open IndexedDB; the world will not be saved.', error);
    return null;
  }
}
