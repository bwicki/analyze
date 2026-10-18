// Page-side client of the parser worker. parseFiles(files, onProgress) → results (see parse-worker.js).

let worker = null, seq = 0;
const pending = new Map();

function ensure() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker/parse-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data, p = pending.get(m.id); if (!p) return;
    if (m.type === 'progress') p.onProgress && p.onProgress(m);
    else if (m.type === 'done') { pending.delete(m.id); p.resolve(m.results); }
    else if (m.type === 'error') { pending.delete(m.id); p.reject(new Error(m.message)); }
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'worker error')); pending.clear(); worker = null; };
  return worker;
}

export function parseFiles(files, onProgress, profiles = []) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    ensure().postMessage({ id, cmd: 'parse', files: Array.from(files), profiles });
  });
}
