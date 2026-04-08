import type {
  ErrorStorageConfig,
  ErrorRecord,
  ErrorStatistics,
  ResolvedConfig,
} from './types';
import { sanitize } from './sanitize';
import { IDBHelper } from './idb';

/**
 * Framework-agnostic error storage backed by IndexedDB.
 *
 * @typeParam T - Shape of the error data you want to store.
 *
 * @example
 * ```ts
 * interface MyError {
 *   status: number;
 *   message: string;
 *   url: string;
 * }
 *
 * const storage = new ErrorStorage<MyError>({
 *   maxErrors: 500,
 *   retentionDays: 7,
 *   remoteUrl: 'https://api.example.com/errors',
 * });
 *
 * await storage.save({ status: 500, message: 'Internal', url: '/api/users' });
 * ```
 */
export class ErrorStorage<T = unknown> {
  private config: ResolvedConfig;
  private idb: IDBHelper;
  private queue: ErrorRecord<T>[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private redactKeysSet: Set<string>;

  constructor(options: ErrorStorageConfig = {}) {
    this.config = {
      dbName: options.dbName ?? 'ErrorStorage',
      storeName: options.storeName ?? 'errors',
      maxErrors: options.maxErrors ?? 1000,
      retentionDays: options.retentionDays ?? 30,
      indexes: options.indexes ?? [],
      sanitize: options.sanitize ?? true,
      redactKeys: options.redactKeys ?? [],
      remoteUrl: options.remoteUrl ?? null,
      remoteHeaders: options.remoteHeaders ?? {},
      batchRemote: options.batchRemote ?? false,
      flushInterval: options.flushInterval ?? 30_000,
      maxQueueSize: options.maxQueueSize ?? 500,
      beforeSave: options.beforeSave,
      onError: options.onError,
      onRemoteError: options.onRemoteError,
    };

    this.redactKeysSet = new Set(
      this.config.redactKeys.map((k) => k.toLowerCase()),
    );
    this.idb = new IDBHelper(this.config);

    if (this.config.batchRemote && this.config.remoteUrl) {
      this.startFlushTimer();
    }
  }

  private handleError(error: unknown, operation: string): void {
    this.config.onError?.(error, { operation });
  }

  // ─── Save ────────────────────────────────────────────────────────────

  /**
   * Store an error. Optionally attach metadata.
   * If `remoteUrl` is configured, the error is also sent to the server.
   */
  async save(data: T, meta?: Record<string, unknown>): Promise<ErrorRecord<T> | null> {
    const cleanData = this.config.sanitize
      ? (sanitize(data, this.redactKeysSet) as T)
      : data;
    const cleanMeta = this.config.sanitize
      ? (sanitize(meta, this.redactKeysSet) as Record<string, unknown> | undefined)
      : meta;

    const record: ErrorRecord<T> = {
      id: this.generateId(),
      timestamp: Date.now(),
      data: cleanData,
      meta: cleanMeta,
    };

    // beforeSave hook
    if (this.config.beforeSave) {
      const allow = await this.config.beforeSave(record as ErrorRecord<unknown>);
      if (!allow) return record;
    }

    // local save
    let localOk = false;
    try {
      await this.idb.add(record);
      await this.idb.cleanup(
        Date.now() - this.config.retentionDays * 86_400_000,
        this.config.maxErrors,
      );
      localOk = true;
    } catch (err) {
      this.handleError(err, 'save');
    }

    // remote reporting
    if (this.config.remoteUrl) {
      if (this.config.batchRemote) {
        this.enqueue(record);
      } else {
        this.sendToRemote([record]);
      }
    }

    return localOk ? record : null;
  }

  // ─── Query ───────────────────────────────────────────────────────────

  /**
   * Retrieve all stored errors, newest first.
   */
  async getAll(): Promise<ErrorRecord<T>[]> {
    try {
      const records = await this.idb.getAll<ErrorRecord<T>>();
      return records.sort((a, b) => b.timestamp - a.timestamp);
    } catch (err) {
      this.handleError(err, 'getAll');
      return [];
    }
  }

  /**
   * Retrieve errors within a date range.
   */
  async getByDateRange(start: Date, end: Date): Promise<ErrorRecord<T>[]> {
    try {
      return await this.idb.getAllByRange<ErrorRecord<T>>(
        'timestamp',
        IDBKeyRange.bound(start.getTime(), end.getTime()),
      );
    } catch (err) {
      this.handleError(err, 'getByDateRange');
      return [];
    }
  }

  /**
   * Retrieve errors matching an indexed field value.
   * The field must be listed in `config.indexes`.
   */
  async getByIndex(indexName: string, value: IDBValidKey): Promise<ErrorRecord<T>[]> {
    try {
      return this.idb.getAllByIndex<ErrorRecord<T>>(indexName, value);
    } catch (err) {
      this.handleError(err, 'getByIndex');
      return [];
    }
  }

  /**
   * Get basic statistics about stored errors.
   */
  async getStatistics(): Promise<ErrorStatistics> {
    try {
      const records = await this.idb.getAll<ErrorRecord<T>>();
  
      if (records.length === 0) {
        return { totalErrors: 0, oldestTimestamp: null, newestTimestamp: null };
      }
  
      const timestamps = records.map((r) => r.timestamp);
      return {
        totalErrors: records.length,
        oldestTimestamp: Math.min(...timestamps),
        newestTimestamp: Math.max(...timestamps),
      };
    } catch (err) {
      this.handleError(err, 'getStatistics');
      return { totalErrors: 0, oldestTimestamp: null, newestTimestamp: null };
    }
  }

  // ─── Export ──────────────────────────────────────────────────────────

  /**
   * Export all errors as a JSON string.
   */
  async exportAsJSON(): Promise<string> {
    const records = await this.getAll();
    const stats = await this.getStatistics();

    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        statistics: stats,
        errors: records,
      },
      null,
      2,
    );
  }

  /**
   * Trigger a file download in the browser (no-op in non-browser envs).
   */
  async downloadJSON(filename?: string): Promise<void> {
    if (typeof document === 'undefined') return;

    const json = await this.exportAsJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? `errors-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  // ─── Delete ──────────────────────────────────────────────────────────

  /**
   * Delete a single error by ID.
   */
  async delete(id: string): Promise<boolean> {
    try {
      await this.idb.delete(id);
      return true;
    } catch (err) {
      this.handleError(err, 'delete');
      return false;
    }
  }

  /**
   * Delete all stored errors.
   */
  async clear(): Promise<boolean> {
    try {
      await this.idb.clear();
      return true;
    } catch (err) {
      this.handleError(err, 'clear');
      return false;
    }
  }

  // ─── Remote ──────────────────────────────────────────────────────────

  /**
   * Manually flush the batch queue to the remote server.
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);
    await this.sendToRemote(batch);
  }

  private async sendToRemote(records: ErrorRecord<T>[]): Promise<void> {
    if (!this.config.remoteUrl) return;

    try {
      const res = await fetch(this.config.remoteUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.remoteHeaders,
        },
        body: JSON.stringify({ errors: records }),
      });

      if (!res.ok) {
        throw new Error(`Remote responded with ${res.status}`);
      }
    } catch (err) {
      // Retry: re-queue at the front (drops oldest if overflow)
      if (this.config.batchRemote) {
        this.queue.unshift(...records);
        // Trim from the back to respect maxQueueSize
        if (this.queue.length > this.config.maxQueueSize) {
          const overflow = this.queue.length - this.config.maxQueueSize;
          this.queue.splice(this.queue.length - overflow, overflow);
          this.handleError(
            new Error(`Queue overflow on retry: dropped ${overflow} newest record(s)`),
            'sendToRemote',
          );
        }
      }
      this.config.onRemoteError?.(err);
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => this.config.onRemoteError?.(err));
    }, this.config.flushInterval);

    // Allow Node.js processes to exit even if the timer is running
    if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
      (this.flushTimer as unknown as { unref: () => void }).unref();
    }
  }

  /**
   * Push records to the queue, dropping the oldest if it would exceed maxQueueSize.
   */
  private enqueue(...records: ErrorRecord<T>[]): void {
    this.queue.push(...records);

    if (this.queue.length > this.config.maxQueueSize) {
      const overflow = this.queue.length - this.config.maxQueueSize;
      const dropped = this.queue.splice(0, overflow);
      this.handleError(
        new Error(`Queue overflow: dropped ${dropped.length} oldest record(s)`),
        'enqueue',
      );
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Stop background timers. Call this when you no longer need the instance
   * (e.g. app unmount, cleanup).
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // ─── Utils ───────────────────────────────────────────────────────────

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}
