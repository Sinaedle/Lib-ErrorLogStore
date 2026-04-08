/**
 * Convert any value into something that IndexedDB's structured clone
 * algorithm can safely store. Handles FormData, File/Blob, Headers,
 * URLSearchParams, Map, Set, Error, functions, BigInt, and circular refs.
 */
export function sanitize(
  value: unknown,
  redactKeys: Set<string> = new Set(),
  seen = new WeakSet<object>()
): unknown {
  // Primitives
  if (value === null || value === undefined) return value;

  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return (value as bigint).toString();
  if (type === 'function' || type === 'symbol') return undefined;

  // From here on, value is an object
  const obj = value as object;

  // Circular reference guard
  if (seen.has(obj)) return '[Circular]';
  seen.add(obj);

  // FormData → plain object
  if (typeof FormData !== 'undefined' && obj instanceof FormData) {
    const out: Record<string, unknown> = {};
    obj.forEach((v, k) => {
      out[k] = redactKeys.has(k.toLowerCase())
        ? '[REDACTED]'
        : sanitize(v, redactKeys, seen);
    });
    return out;
  }

  // File → metadata only (must come before Blob since File extends Blob)
  if (typeof File !== 'undefined' && obj instanceof File) {
    return {
      __type: 'File',
      name: obj.name,
      size: obj.size,
      type: obj.type,
      lastModified: obj.lastModified,
    };
  }

  // Blob → metadata only
  if (typeof Blob !== 'undefined' && obj instanceof Blob) {
    return { __type: 'Blob', size: obj.size, type: obj.type };
  }

  // Headers → plain object
  if (typeof Headers !== 'undefined' && obj instanceof Headers) {
    const out: Record<string, string> = {};
    obj.forEach((v, k) => {
      out[k] = redactKeys.has(k.toLowerCase()) ? '[REDACTED]' : v;
    });
    return out;
  }

  // URLSearchParams → plain object
  if (typeof URLSearchParams !== 'undefined' && obj instanceof URLSearchParams) {
    const out: Record<string, string> = {};
    obj.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }

  // Error → { name, message, stack }
  if (obj instanceof Error) {
    return {
      __type: 'Error',
      name: obj.name,
      message: obj.message,
      stack: obj.stack,
    };
  }

  // Date → keep as-is (structured clone supports Date)
  if (obj instanceof Date) return new Date(obj.getTime());

  // Map → plain object
  if (obj instanceof Map) {
    const out: Record<string, unknown> = {};
    obj.forEach((v, k) => {
      out[String(k)] = sanitize(v, redactKeys, seen);
    });
    return out;
  }

  // Set → array
  if (obj instanceof Set) {
    return Array.from(obj, (v) => sanitize(v, redactKeys, seen));
  }

  // Array
  if (Array.isArray(obj)) {
    return obj.map((v) => sanitize(v, redactKeys, seen));
  }

  // Plain object
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (redactKeys.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
      continue;
    }
    const sanitized = sanitize(v, redactKeys, seen);
    if (sanitized !== undefined) out[k] = sanitized;
  }
  return out;
}