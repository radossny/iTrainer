// Minimalne opakowanie IndexedDB na obietnicach.
// Zamiast Dexie — mniej magii, zero zależności, aplikacja działa offline.

const DB_NAME = "itrainer";
const DB_VERSION = 1;

// Magazyny tworzone z góry, także te jeszcze nieużywane.
// Dodanie magazynu później wymaga podbicia wersji i migracji — taniej zrobić to teraz.
const STORES = {
  meta: "k",           // ustawienia: hrMax, hrRest, kalibracja
  daily: "date",       // metryki dzienne, jeden rekord na dzień
  workouts: "id",      // treningi, id = import_hash
  imports: "id",       // proweniencja importów
  goals: "key",        // cele, key = `${id}:${version}`
  plans: "id",
  sessions: "id",      // plan_sessions
  checkins: "id",
  decisions: "id",
};

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

export async function put(store, value) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const r = tx(db, store, "readwrite").put(value);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function bulkPut(store, values) {
  if (!values.length) return 0;
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction(store, "readwrite");
    const os = t.objectStore(store);
    values.forEach((v) => os.put(v));
    t.oncomplete = () => res(values.length);
    t.onerror = () => rej(t.error);
  });
}

export async function get(store, key) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const r = tx(db, store, "readonly").get(key);
    r.onsuccess = () => res(r.result ?? null);
    r.onerror = () => rej(r.error);
  });
}

export async function getAll(store) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const r = tx(db, store, "readonly").getAll();
    r.onsuccess = () => res(r.result ?? []);
    r.onerror = () => rej(r.error);
  });
}

export async function clear(store) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const r = tx(db, store, "readwrite").clear();
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
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
// IndexedDB znika przy czyszczeniu danych witryny, a na iOS bywa usuwane
// po tygodniu nieużywania, jeśli strona nie jest zainstalowana jako PWA.
// Dlatego eksport to funkcja podstawowa, nie dodatek.

export async function exportAll() {
  const out = { format: "itrainer-backup", version: 1, exportedAt: new Date().toISOString(), stores: {} };
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
