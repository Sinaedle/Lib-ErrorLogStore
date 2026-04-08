// ─── Config ───────────────────────────────────────────────────────────

export interface ErrorStorageConfig {
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
  onError?: (error: unknown, context: { operation: string }) => void;
  /**
   * Called when a remote report fails.
   */
  onRemoteError?: (error: unknown) => void;
}

// ─── Stored Record ────────────────────────────────────────────────────

export interface ErrorRecord<T = unknown> {
  /** Unique ID (auto-generated) */
  id: string;
  /** Unix timestamp in ms */
  timestamp: number;
  /** The error payload – shape is defined by the consumer via generic T */
  data: T;
  /** Arbitrary metadata the consumer can attach */
  meta?: Record<string, unknown>;
}

// ─── Statistics ───────────────────────────────────────────────────────

export interface ErrorStatistics {
  totalErrors: number;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
}

// ─── Resolved (internal) config with defaults applied ─────────────────

export interface ResolvedConfig {
  dbName: string;
  storeName: string;
  maxErrors: number;
  retentionDays: number;
  indexes: string[];
  sanitize: boolean;
  redactKeys: string[];
  remoteUrl: string | null;
  remoteHeaders: Record<string, string>;
  batchRemote: boolean;
  flushInterval: number;
  maxQueueSize: number;
  beforeSave?: (record: ErrorRecord<unknown>) => boolean | Promise<boolean>;
  onError?: (error: unknown, context: { operation: string }) => void;
  onRemoteError?: (error: unknown) => void;
}
