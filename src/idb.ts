import type { ResolvedConfig } from './types';

/**
 * Thin, promise-based wrapper around IndexedDB.
 * All methods open → operate → close so we never leak connections.
 */
export class IDBHelper {
  private dbVersion = 1;

  constructor(private config: ResolvedConfig) {}

  // ─── Open ────────────────────────────────────────────────────────────

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(this.config.storeName)) {
          const store = db.createObjectStore(this.config.storeName, {
            keyPath: 'id',
          });

          // Built-in index
          store.createIndex('timestamp', 'timestamp', { unique: false });

          // User-defined indexes
          for (const keyPath of this.config.indexes) {
            store.createIndex(keyPath, keyPath, { unique: false });
          }
        }
      };
    });
  }

  /** Run a scoped operation and auto-close the DB when done. */
  private async withDB<R>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore, db: IDBDatabase) => Promise<R>,
  ): Promise<R> {
    const db = await this.open();
    try {
      const tx = db.transaction([this.config.storeName], mode);
      const store = tx.objectStore(this.config.storeName);
      return await fn(store, db);
    } finally {
      db.close();
    }
  }

  // ─── CRUD ────────────────────────────────────────────────────────────

  add<T>(record: T): Promise<void> {
    return this.withDB('readwrite', (store) =>
      this.req<void>(store.add(record)),
    );
  }

  getAll<T>(): Promise<T[]> {
    return this.withDB('readonly', (store) => this.req<T[]>(store.getAll()));
  }

  getAllByIndex<T>(indexName: string, value: IDBValidKey): Promise<T[]> {
    return this.withDB('readonly', (store) => {
      const index = store.index(indexName);
      return this.req<T[]>(index.getAll(value));
    });
  }

  getAllByRange<T>(
    indexName: string,
    range: IDBKeyRange,
  ): Promise<T[]> {
    return this.withDB('readonly', (store) => {
      const index = store.index(indexName);
      return this.req<T[]>(index.getAll(range));
    });
  }

  delete(key: IDBValidKey): Promise<void> {
    return this.withDB('readwrite', (store) =>
      this.req<void>(store.delete(key)),
    );
  }

  clear(): Promise<void> {
    return this.withDB('readwrite', (store) =>
      this.req<void>(store.clear()),
    );
  }

  count(): Promise<number> {
    return this.withDB('readonly', (store) =>
      this.req<number>(store.count()),
    );
  }

  // ─── Cleanup helpers ─────────────────────────────────────────────────

  /**
   * Delete records older than `cutoffMs` and trim to `maxErrors`.
   * Runs inside a single readwrite transaction.
   */
  cleanup(cutoffMs: number, maxErrors: number): Promise<void> {
    return this.withDB('readwrite', async (store) => {
      // 1. Delete by retention
      await this.deleteByCursor(
        store.index('timestamp').openCursor(IDBKeyRange.upperBound(cutoffMs)),
        store,
        Infinity,
      );

      // 2. Trim excess
      const total = await this.req<number>(store.count());
      if (total > maxErrors) {
        await this.deleteByCursor(
          store.index('timestamp').openCursor(),
          store,
          total - maxErrors,
        );
      }
    });
  }

  // ─── Internal utils ──────────────────────────────────────────────────

  private req<T>(request: IDBRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  }

  private deleteByCursor(
    cursorReq: IDBRequest<IDBCursorWithValue | null>,
    store: IDBObjectStore,
    limit: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      let deleted = 0;
      cursorReq.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor && deleted < limit) {
          store.delete(cursor.primaryKey);
          deleted++;
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorReq.onerror = () => resolve(); // best-effort
    });
  }
}
