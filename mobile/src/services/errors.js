// Records failed syncs so a broken write is never mistaken for missing data.
const MAX = 50;
const failures = [];
const listeners = new Set();

function emit() {
  for (const fn of listeners) {
    try { fn(getSyncFailures()); } catch { }
  }
}

export function reportSyncFailure(operation, error, opts = {}) {
  const entry = {
    operation,
    message: String(error?.message || error || "Unknown error"),
    detail: opts.detail || null,
    critical: !!opts.critical,
    at: new Date().toISOString(),
  };
  failures.unshift(entry);
  if (failures.length > MAX) failures.length = MAX;
  console.warn(`[sync:${operation}]${entry.critical ? " CRITICAL" : ""}`, entry.message, entry.detail || "");
  emit();
  return entry;
}

export function getSyncFailures() {
  return failures.slice();
}

export function getCriticalSyncFailures() {
  return failures.filter((f) => f.critical);
}

export function clearSyncFailures() {
  failures.length = 0;
  emit();
}

export function onSyncFailure(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function trySync(operation, promiseOrFn, opts = {}) {
  try {
    const value = await (typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn);
    return { ok: true, value, error: null };
  } catch (error) {
    reportSyncFailure(operation, error, opts);
    return { ok: false, value: null, error };
  }
}
