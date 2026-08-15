// Persistance IndexedDB (amendement E).
//
// Pourquoi pas localStorage : un seul calque de sculpture de la version 1 pèse
// 245 760 octets bruts, soit 327 680 caractères en base64, comptés en UTF-16 par
// Safari — environ 640 Ko de quota pour UN calque, sur un quota d'origine
// d'environ 5 Mo. Un projet plus son instantané de base consomme ~1,3 Mo : le
// quota est atteint vers quatre projets. IndexedDB stocke les tableaux typés
// nativement, sans base64, et sans ce plafond.

const DB_NAME = 'atelier-relief';
const DB_VERSION = 1;

const STORE_PROJECTS = 'projects';
const STORE_SCULPTS = 'sculpts';
const STORE_META = 'meta';

const LEGACY_STATE_KEY = 'relief-lab-state-v2';
const LEGACY_SCULPT_KEY = 'relief-lab-sculpt';

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_SCULPTS)) db.createObjectStore(STORE_SCULPTS, { keyPath: 'projectId' });
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB bloquée par un autre onglet'));
  });
  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getMeta(key) {
  const db = await openDb();
  const row = await wrap(tx(db, STORE_META, 'readonly').get(key));
  return row ? row.value : null;
}

export async function setMeta(key, value) {
  const db = await openDb();
  await wrap(tx(db, STORE_META, 'readwrite').put({ key, value }));
}

/** Le projet est stocké sans son calque : les gros tableaux ont leur propre magasin. */
export async function saveProject(project) {
  const db = await openDb();
  const { sculpt, history, ...rest } = project;
  await wrap(tx(db, STORE_PROJECTS, 'readwrite').put({ ...rest, updatedAt: Date.now() }));
}

export async function loadProject(id) {
  const db = await openDb();
  return wrap(tx(db, STORE_PROJECTS, 'readonly').get(id));
}

export async function listProjects() {
  const db = await openDb();
  const rows = await wrap(tx(db, STORE_PROJECTS, 'readonly').getAll());
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id) {
  const db = await openDb();
  await wrap(tx(db, STORE_PROJECTS, 'readwrite').delete(id));
  await wrap(tx(db, STORE_SCULPTS, 'readwrite').delete(id));
}

export async function saveSculpt(projectId, serialized) {
  const db = await openDb();
  if (!serialized) {
    await wrap(tx(db, STORE_SCULPTS, 'readwrite').delete(projectId));
    return;
  }
  await wrap(tx(db, STORE_SCULPTS, 'readwrite').put({ projectId, ...serialized }));
}

export async function loadSculpt(projectId) {
  const db = await openDb();
  return wrap(tx(db, STORE_SCULPTS, 'readonly').get(projectId));
}

// ---- Migration depuis la version 1 ----

/**
 * Lit les deux clés localStorage de la version 1 et retourne un descriptif de
 * projet, ou null. Ne supprime RIEN : les clés d'origine restent en place tant
 * que Nicolas n'a pas confirmé que la reprise est correcte.
 *
 * ⚠ localStorage est cloisonné par origine. Si la version 1 a été utilisée en
 * `file://`, ces clés sont invisibles depuis l'application servie en http. La
 * migration ne peut donc réussir que si les deux versions partagent la même
 * origine. C'est une limite du navigateur, pas du code.
 */
export function readLegacyLocalStorage() {
  let state = null;
  let sculpt = null;

  try {
    const raw = localStorage.getItem(LEGACY_STATE_KEY);
    if (raw) state = JSON.parse(raw);
  } catch (_) {
    state = null;
  }

  try {
    const raw = localStorage.getItem(LEGACY_SCULPT_KEY);
    if (raw) {
      const SW = 256;
      const SH = 160;
      const bin = atob(raw);
      if (bin.length === SW * SH * 3 * 2) {
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const packed = new Int16Array(bytes.buffer);
        const n = SW * SH;
        const warpX = new Float32Array(n);
        const warpY = new Float32Array(n);
        const height = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          warpX[i] = packed[i] / 120000;
          warpY[i] = packed[n + i] / 120000;
          height[i] = packed[n * 2 + i] / 20000;
        }
        sculpt = { cols: SW, rows: SH, warpX, warpY, height };
      }
    }
  } catch (_) {
    sculpt = null;
  }

  if (!state && !sculpt) return null;
  return { state, sculpt };
}

export async function hasMigrated() {
  return (await getMeta('legacyMigrated')) === true;
}

export async function markMigrated() {
  await setMeta('legacyMigrated', true);
}
