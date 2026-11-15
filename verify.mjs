import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storageCode = fs.readFileSync(path.join(__dirname, 'core', 'storage.js'), 'utf8');
const engineCode = fs.readFileSync(path.join(__dirname, 'core', 'engine.js'), 'utf8');

assert.ok(storageCode.includes('__NgramStorage'), 'core/storage.js invalide');
assert.ok(engineCode.includes('__NgramEngine'), 'core/engine.js invalide');

const memStore = {};
let fakeNow = 1000;

const sandbox = {
  console,
  setTimeout: () => 1,
  clearTimeout: () => {},
  performance: { now: () => fakeNow },
  document: {
    getElementById: () => null,
    createElement: () => ({ appendChild() {}, classList: { add() {} } }),
    createTextNode: () => ({}),
    body: { appendChild() {} }
  },
  chrome: {
    runtime: { lastError: null },
    storage: {
      local: {
        get: (keys, cb) => {
          const out = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) {
            if (k in memStore) out[k] = structuredClone(memStore[k]);
          }
          cb(out);
        },
        set: (obj, cb) => {
          Object.assign(memStore, structuredClone(obj));
          cb();
        },
        remove: (keys, cb) => {
          for (const k of (Array.isArray(keys) ? keys : [keys])) delete memStore[k];
          cb();
        },
        getBytesInUse: (_k, cb) => cb(Buffer.byteLength(JSON.stringify(memStore)))
      },
      onChanged: { addListener: () => {} }
    }
  }
};

vm.createContext(sandbox);
vm.runInContext(storageCode, sandbox);
vm.runInContext(engineCode, sandbox);

const { S, E } = vm.runInContext(
  '({ S: globalThis.__NgramStorage, E: globalThis.__NgramEngine })',
  sandbox
);
const { SurgicalEngine } = E;
const plain = (v) => JSON.parse(JSON.stringify(v));

// Test 1: Isolation Backspace sur "t[x][Backspace]he"
const eng = new SurgicalEngine('monkeytype', 'Monkeytype');
eng.startWord('the');
fakeNow = 1000; eng.onKeyDown({ isTrusted: true, key: 't' }); eng.onWordInput('t');
fakeNow = 1120; eng.onKeyDown({ isTrusted: true, key: 'x' }); eng.onWordInput('tx');
fakeNow = 1350; eng.onKeyDown({ isTrusted: true, key: 'Backspace' }); eng.onWordInput('t');
fakeNow = 1480; eng.onKeyDown({ isTrusted: true, key: 'h' }); eng.onWordInput('th');
fakeNow = 1590; eng.onKeyDown({ isTrusted: true, key: 'e' }); eng.onWordInput('the');
eng.flushCurrentWord(false);

assert.deepEqual(plain(eng.staged['th']), [2, 0, 0, 1], '"th" doit compter 1 erreur et 0ms de vitesse');
assert.deepEqual(plain(eng.staged['he']), [2, 1, 110, 0], '"he" doit mesurer exactement 1590 - 1480 = 110ms');
assert.deepEqual(plain(eng.staged['the']), [3, 0, 0, 1], '"the" doit compter 1 erreur');

// Test 2: Mot >= 5 lettres & mode qu=1
await S.switchQuMode(true);
eng.quAsOne = true;
eng.resetTest();
eng.startWord('quick');
fakeNow = 2000; eng.onKeyDown({ isTrusted: true, key: 'q' }); eng.onWordInput('q');
fakeNow = 2050; eng.onKeyDown({ isTrusted: true, key: 'u' }); eng.onWordInput('qu');
fakeNow = 2170; eng.onKeyDown({ isTrusted: true, key: 'i' }); eng.onWordInput('qui');
fakeNow = 2260; eng.onKeyDown({ isTrusted: true, key: 'c' }); eng.onWordInput('quic');
fakeNow = 2340; eng.onKeyDown({ isTrusted: true, key: 'k' }); eng.onWordInput('quick');
eng.flushCurrentWord(false);
assert.deepEqual(plain(eng.staged['qui']), [2, 1, 170, 0], 'En mode qu=1, "qui" mesure 2170 - 2000 = 170ms');

await eng.commitTest('words 10', 'english');
const exported = await S.buildExportPayload(null, 'eng');
assert.ok(exported.stats.eng_qu, 'Doit exporter sous la clé eng_qu en mode qu=1');
assert.equal(exported.stats.eng_qu.fmt, 5);
console.log('Equivalence checks PASSED.');

// Micro-benchmark: 500 tests x 250 n-grams
await S.clearAllTests();
const mockNgrams = {};
for (let i = 0; i < 250; i++) mockNgrams[`n${i}`] = [2, 3, 340, i % 5 === 0 ? 1 : 0];
const t0 = Date.now();
for (let i = 0; i < 500; i++) {
  await S.saveTest(
    { site: 'monkeytype', siteLabel: 'Monkeytype', testType: 'time 60s', lang: i % 2 ? 'eng' : 'fra', strokes: 300, quAsOne: false },
    mockNgrams
  );
}
const jsonOut = JSON.stringify(await S.buildExportPayload(null, 'ALL'));
const t1 = Date.now();
console.log(
  `500 tests stored + exported in ${t1 - t0} ms | Storage: ${(Buffer.byteLength(JSON.stringify(memStore)) / 1048576).toFixed(2)} MB | Export JSON: ${(Buffer.byteLength(jsonOut) / 1048576).toFixed(2)} MB`
);
