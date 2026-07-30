// Opakowanie IndexedDB na obietnicach, bez zależności.
//
// Kluczowa właściwość: awaria bazy NIE może zablokować aplikacji.
// Safari na iOS potrafi nie odpowiedzieć na indexedDB.open() — w trybie
// prywatnym albo po przywróceniu karty z tła. Wtedy przechodzimy na
// magazyn w pamięci, a użytkownik dostaje ostrzeżenie, że dane znikną
// po odświeżeniu.

const DB_NAME = "itrainer";
const DB_VERSION = 1;
const OPEN_TIMEOUT_MS = 4000;

const STORES = {
  meta: "k", daily: "date", workouts: "id", imports: "id",
  goals: "key", plans: "id", sessions: "id", checkins: "id", decisions: "id",
};

const memory = {};
Object.keys(STORES).forEach((k) => (memory[k] = new Map()));

let mode = "unknown";     // 'indexeddb' | 'memory' | 'unknown'
let lastError = null;
let dbPromise = null;

export function status() {
  return { mode, error: lastError, persistent: mode === "indexeddb" };
}

function useMemory(reason) {
  if (mode !== "memory") {
    mode = "memory";
    lastError = reason;
    console.warn("iTrainer: baza w pamieci -", reason);
  }
  return null;
}

export function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined" || indexedDB === null) {
      return resolve(useMemory("przeglądarka nie udostępnia IndexedDB"));
    }

    let settled = false;
    const finish = (v, reason) => {
      if (settled) return;
      settled = true;
      if (v) { mode = "indexeddb"; resolve(v); }
      else resolve(useMemory(reason));
    };

    // Safari bywa, że nie odpowiada w ogóle — dlatego twardy limit czasu.
    const timer = setTimeout(
      () => finish(null, "baza nie odpowiedziała w " + OPEN_TIMEOUT_MS / 1000 + " s"),
      OPEN_TIMEOUT_MS
    );

    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      clearTimeout(timer);
      return finish(null, "otwarcie bazy odrzucone: " + e.message);
    }

    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => { clearTimeout(timer); finish(req.result, null); };
    req.onerror = () => { clearTimeout(timer); finish(null, "błąd bazy: " + (req.error?.message || "nieznany")); };
    req.onblocked = () => { clearTimeout(timer); finish(null, "baza zablokowana przez inną kartę"); };
  });

  return dbPromise;
}

/* ---- operacje: identyczne API w obu trybach ------------------------ */

function req2promise(request) {
  return new Promise((res, rej) => {
    request.onsuccess = () => res(request.result);
    request.onerror = () => rej(request.error || new Error("operacja bazy nieudana"));
  });
}

export async function put(store, value) {
  const db = await openDb();
  if (!db) { memory[store].set(value[STORES[store]], value); return value[STORES[store]]; }
  try {
    return await req2promise(db.transaction(store, "readwrite").objectStore(store).put(value));
  } catch (e) {
    useMemory("zapis nieudany: " + e.message);
    memory[store].set(value[STORES[store]], value);
    return value[STORES[store]];
  }
}

export async function bulkPut(store, values) {
  if (!values.length) return 0;
  const db = await openDb();
  if (!db) { values.forEach((v) => memory[store].set(v[STORES[store]], v)); return values.length; }
  try {
    return await new Promise((res, rej) => {
      const t = db.transaction(store, "readwrite");
      const os = t.objectStore(store);
      values.forEach((v) => os.put(v));
      t.oncomplete = () => res(values.length);
      t.onerror = () => rej(t.error || new Error("zapis zbiorczy nieudany"));
      t.onabort = () => rej(t.error || new Error("zapis przerwany — możliwy brak miejsca"));
    });
  } catch (e) {
    useMemory("zapis zbiorczy nieudany: " + e.message);
    values.forEach((v) => memory[store].set(v[STORES[store]], v));
    return values.length;
  }
}

export async function get(store, key) {
  const db = await openDb();
  if (!db) return memory[store].get(key) ?? null;
  try {
    return (await req2promise(db.transaction(store, "readonly").objectStore(store).get(key))) ?? null;
  } catch { return memory[store].get(key) ?? null; }
}

export async function getAll(store) {
  const db = await openDb();
  if (!db) return [...memory[store].values()];
  try {
    return (await req2promise(db.transaction(store, "readonly").objectStore(store).getAll())) ?? [];
  } catch { return [...memory[store].values()]; }
}

export async function clear(store) {
  memory[store].clear();
  const db = await openDb();
  if (!db) return;
  try { await req2promise(db.transaction(store, "readwrite").objectStore(store).clear()); } catch {}
}

/* ---- ustawienia ---------------------------------------------------- */

export async function getSetting(k, fallback = null) {
  const row = await get("meta", k);
  return row ? row.v : fallback;
}
export async function setSetting(k, v) {
  return put("meta", { k, v, updatedAt: new Date().toISOString() });
}

/* ---- kopia zapasowa ------------------------------------------------ */

export async function exportAll() {
  const out = {
    format: "itrainer-backup", version: 1,
    exportedAt: new Date().toISOString(), stores: {},
  };
  for (const name of Object.keys(STORES)) out.stores[name] = await getAll(name);
  return out;
}

export async function importAll(backup) {
  if (backup?.format !== "itrainer-backup") throw new Error("To nie jest kopia iTrainer.");
  let n = 0;
  for (const [name, rows] of Object.entries(backup.stores || {})) {
    if (!STORES[name] || !Array.isArray(rows)) continue;
    n += await bulkPut(name, rows);
  }
  return n;
}

export async function wipeAll() {
  for (const name of Object.keys(STORES)) await clear(name);
}
