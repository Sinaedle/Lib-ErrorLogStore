export declare interface ErrorRecord<T = unknown> {
    /** Unique ID (auto-generated) */
    id: string;
    /** Unix timestamp in ms */
    timestamp: number;
    /** The error payload – shape is defined by the consumer via generic T */
    data: T;
    /** Arbitrary metadata the consumer can attach */
    meta?: Record<string, unknown>;
}

export declare interface ErrorStatistics {
    totalErrors: number;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
}

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
export declare class ErrorStorage<T = unknown> {
    private config;
    private idb;
    private queue;
    private flushTimer;
    private redactKeysSet;
    constructor(options?: ErrorStorageConfig);
    private handleError;
    /**
     * Store an error. Optionally attach metadata.
     * If `remoteUrl` is configured, the error is also sent to the server.
     */
    save(data: T, meta?: Record<string, unknown>): Promise<ErrorRecord<T> | null>;
    /**
     * Retrieve all stored errors, newest first.
     */
    getAll(): Promise<ErrorRecord<T>[]>;
    /**
     * Retrieve errors within a date range.
     */
    getByDateRange(start: Date, end: Date): Promise<ErrorRecord<T>[]>;
    /**
     * Retrieve errors matching an indexed field value.
     * The field must be listed in `config.indexes`.
     */
    getByIndex(indexName: string, value: IDBValidKey): Promise<ErrorRecord<T>[]>;
    /**
     * Get basic statistics about stored errors.
     */
    getStatistics(): Promise<ErrorStatistics>;
    /**
     * Export all errors as a JSON string.
     */
    exportAsJSON(): Promise<string>;
    /**
     * Trigger a file download in the browser (no-op in non-browser envs).
     */
    downloadJSON(filename?: string): Promise<void>;
    /**
     * Delete a single error by ID.
     */
    delete(id: string): Promise<boolean>;
    /**
     * Delete all stored errors.
     */
    clear(): Promise<boolean>;
    /**
     * Manually flush the batch queue to the remote server.
     */
    flush(): Promise<void>;
    private sendToRemote;
    private startFlushTimer;
    /**
     * Push records to the queue, dropping the oldest if it would exceed maxQueueSize.
     */
    private enqueue;
    /**
     * Stop background timers. Call this when you no longer need the instance
     * (e.g. app unmount, cleanup).
     */
    destroy(): void;
    private generateId;
}

export declare interface ErrorStorageConfig {
    /** IndexedDB database name (default: 'ErrorStorage') */
    dbName?: string;
    /** IndexedDB object store name (default: 'errors') */
    storeName?: string;
    /** Maximum number of stored errors (default: 1000) */
    maxErrors?: number;
    /** Retention period in days (default: 30) */
    retentionDays?: number;
    /** Additional index fields to create on the object store.
     *  Each entry is a keyPath string used for both the index name and key.
     *  Nested paths like 'meta.userId' are supported by IndexedDB.
     */
    indexes?: string[];
    /**
     * Auto-sanitize values that IndexedDB cannot clone
     * (FormData, File, Blob, Headers, Map, Set, Error, functions, etc.)
     * Default: true
     */
    sanitize?: boolean;
    /**
     * Field names (case-insensitive) to redact from stored data.
     * Matched keys will have their values replaced with '[REDACTED]'.
     * Useful for hiding sensitive headers like Authorization, Cookie, etc.
     *
     * @example ['authorization', 'cookie', 'x-api-key']
     */
    redactKeys?: string[];
    /**
     * Remote endpoint to POST errors to on every save.
     * If not set, remote reporting is disabled.
     */
    remoteUrl?: string;
    /**
     * Custom headers to include in remote requests (e.g. Authorization).
     */
    remoteHeaders?: Record<string, string>;
    /**
     * If true, errors are sent to the remote server in batches
     * rather than one-by-one. Use `flushInterval` to control timing.
     * (default: false)
     */
    batchRemote?: boolean;
    /**
     * Interval in milliseconds for flushing batched remote reports.
     * Only used when `batchRemote` is true. (default: 30000)
     */
    flushInterval?: number;
    /**
     * Maximum number of records held in the in-memory remote queue
     * when `batchRemote` is true. When exceeded, the oldest queued
     * records are dropped to make room for new ones. (default: 500)
     */
    maxQueueSize?: number;
    /**
     * Called before an error is saved. Return `false` to skip storage.
     */
    beforeSave?: (record: ErrorRecord<unknown>) => boolean | Promise<boolean>;
    /**
     * Called when an internal storage operation fails
     * (IndexedDB unavailable, quota exceeded, structured clone error, etc.)
     */
    onError?: (error: unknown, context: {
        operation: string;
    }) => void;
    /**
     * Called when a remote report fails.
     */
    onRemoteError?: (error: unknown) => void;
}

/**
 * Convert any value into something that IndexedDB's structured clone
 * algorithm can safely store. Handles FormData, File/Blob, Headers,
 * URLSearchParams, Map, Set, Error, functions, BigInt, and circular refs.
 */
export declare function sanitize(value: unknown, redactKeys?: Set<string>, seen?: WeakSet<object>): unknown;

export { }
