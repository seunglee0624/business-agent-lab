// IndexedDB 저장. 1단계는 슬롯 하나(slot1)만 쓴다.

const DB_NAME = 'club-building';
const STORE = 'saves';
const SLOT = 'slot1';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req?.result);
    };
    tx.onerror = () => reject(tx.error);
  }));
}

export function saveState(state) {
  return run('readwrite', (store) => store.put(state, SLOT));
}

export function loadState() {
  return run('readonly', (store) => store.get(SLOT));
}

export function clearState() {
  return run('readwrite', (store) => store.delete(SLOT));
}

export function exportState(state) {
  const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const club = state.user ? state.clubs[state.user.clubId].name : '새 게임';
  a.href = url;
  a.download = `축구구단키우기_${club}_${state.date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importState(file) {
  return file.text().then((text) => {
    const state = JSON.parse(text);
    if (!state || typeof state !== 'object' || !state.version || !state.clubs) throw new Error('세이브 파일 형식이 아닙니다.');
    return state;
  });
}
