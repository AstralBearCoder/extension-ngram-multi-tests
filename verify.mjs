import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storageCode = fs.readFileSync(path.join(__dirname, 'core', 'storage.js'), 'utf8');
const engineCode = fs.readFileSync(path.join(__dirname, 'core', 'engine.js'), 'utf8');

assert.ok(storageCode.includes('__NgramStorage'), 'Invalid core/storage.js');
assert.ok(engineCode.includes('__NgramEngine'), 'Invalid core/engine.js');

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

const eng = new SurgicalEngine('monkeytype', 'Monkeytype');

// Test 1: "t[x][Backspace]he" (Rule 1B: "the" also receives 1 error)
eng.startWord('the');
fakeNow = 1000; eng.onKeyDown({ isTrusted: true, key: 't' }); eng.onWordInput('t');
fakeNow = 1120; eng.onKeyDown({ isTrusted: true, key: 'x' }); eng.onWordInput('tx');
fakeNow = 1350; eng.onKeyDown({ isTrusted: true, key: 'Backspace' }); eng.onWordInput('t');
fakeNow = 1480; eng.onKeyDown({ isTrusted: true, key: 'h' }); eng.onWordInput('th');
fakeNow = 1590; eng.onKeyDown({ isTrusted: true, key: 'e' }); eng.onWordInput('the');
eng.flushCurrentWord(false);

assert.deepEqual(plain(eng.staged['th']), [2, 0, 0, 1], '"th" -> 1 error, 0 speed');
assert.deepEqual(plain(eng.staged['he']), [2, 1, 110, 0], '"he" -> 110 ms');
assert.deepEqual(plain(eng.staged['the']), [3, 0, 0, 1], '"the" -> 1 error (1B)');

// Test 2: "fiere" -> Backspace "ere" -> "ère"
eng.resetTest();
eng.startWord('fière');
fakeNow = 2000; eng.onKeyDown({ isTrusted: true, key: 'f' }); eng.onWordInput('f');
fakeNow = 2100; eng.onKeyDown({ isTrusted: true, key: 'i' }); eng.onWordInput('fi');
fakeNow = 2220; eng.onKeyDown({ isTrusted: true, key: 'e' }); eng.onWordInput('fie');
fakeNow = 2340; eng.onKeyDown({ isTrusted: true, key: 'r' }); eng.onWordInput('fier');
fakeNow = 2460; eng.onKeyDown({ isTrusted: true, key: 'e' }); eng.onWordInput('fiere');
fakeNow = 2700; eng.onKeyDown({ isTrusted: true, key: 'Backspace' }); eng.onWordInput('fier');
fakeNow = 2800; eng.onKeyDown({ isTrusted: true, key: 'Backspace' }); eng.onWordInput('fie');
fakeNow = 2900; eng.onKeyDown({ isTrusted: true, key: 'Backspace' }); eng.onWordInput('fi');
fakeNow = 3100; eng.onKeyDown({ isTrusted: true, key: 'è' }); eng.onWordInput('fiè');
fakeNow = 3210; eng.onKeyDown({ isTrusted: true, key: 'r' }); eng.onWordInput('fièr');
fakeNow = 3305; eng.onKeyDown({ isTrusted: true, key: 'e' }); eng.onWordInput('fière');
eng.flushCurrentWord(false);

assert.deepEqual(plain(eng.staged['fi']), [2, 1, 100, 0], '"fi" -> 1 clean (100 ms)');
assert.deepEqual(plain(eng.staged['re']), [2, 2, 215, 0], '"re" -> 2 clean (120 + 95 ms)');
assert.deepEqual(plain(eng.staged['èr']), [2, 1, 110, 1], '"èr" -> 1 clean + 1 err');
assert.deepEqual(plain(eng.staged['ère']), [3, 1, 205, 1], '"ère" -> 1 clean + 1 err');
for (const ng of ['iè', 'fiè', 'ièr', 'fièr', 'ière']) {
  assert.deepEqual(plain(eng.staged[ng]), [Array.from(ng).length, 0, 0, 1], `"${ng}" -> 0 clean, 1 err`);
}

// Test 3: "fiere" -> Ctrl+Backspace -> "fière"
eng.resetTest();
eng.startWord('fière');
fakeNow = 4000; eng.onKeyDown({ isTrusted: true, key: 'f' }); eng.onWordInput('f');
fakeNow = 4100; eng.onKeyDown({ isTrusted: true, key: 'i' }); eng.onWordInput('fi');
fakeNow = 4200; eng.onKeyDown({ isTrusted: true, key: 'e' }); eng.onWordInput('fie');
fakeNow = 4300; eng.onKeyDown({ isTrusted: true, key: 'r' }); eng.onWordInput('fier');
fakeNow = 4400; eng.onKeyDown({ isTrusted: true, key: 'e' }); eng.onWordInput('fiere');
fakeNow = 4700; eng.onKeyDown({ isTrusted: true, ctrlKey: true, key: 'Backspace' }); eng.onWordInput('');
fakeNow = 4900; eng.onKeyDown({ isTrusted: true, key: 'f' }); eng.onWordInput('f');
fakeNow = 4990; eng.onKeyDown({ isTrusted: true, key: 'i' }); eng.onWordInput('fi');
fakeNow = 5140; eng.onKeyDown({ isTrusted: true, key: 'è' }); eng.onWordInput('fiè');
fakeNow = 5240; eng.onKeyDown({ isTrusted: true, key: 'r' }); eng.onWordInput('fièr');
fakeNow = 5330; eng.onKeyDown({ isTrusted: true, key: 'e' }); eng.onWordInput('fière');
eng.flushCurrentWord(false);

assert.deepEqual(plain(eng.staged['fi']), [2, 2, 190, 0], 'Ctrl+Backspace "fi" -> 2 clean');
assert.deepEqual(plain(eng.staged['re']), [2, 2, 190, 0], 'Ctrl+Backspace "re" -> 2 clean');
for (const ng of ['iè', 'fiè', 'èr', 'ièr', 'ère', 'fièr', 'ière']) {
  const got = plain(eng.staged[ng]);
  assert.equal(got[1], 1, `Ctrl+Backspace "${ng}" -> 1 clean`);
  assert.equal(got[3], 1, `Ctrl+Backspace "${ng}" -> 1 err`);
}

// Test 4: Double mistake + hesitation Backspace (no error) + overshoot erased (Rule 2B)
eng.resetTest();
eng.startWord('the');
fakeNow = 6000; eng.onKeyDown({ isTrusted: true, key: 't' }); eng.onWordInput('t');
fakeNow = 6100; eng.onKeyDown({ isTrusted: true, key: 'x' }); eng.onWordInput('tx');
fakeNow = 6200; eng.onKeyDown({ isTrusted: true, key: 'Backspace' }); eng.onWordInput('t');
fakeNow = 6300; eng.onKeyDown({ isTrusted: true, key: 'y' }); eng.onWordInput('ty');
fakeNow = 6400; eng.onKeyDown({ isTrusted: true, key: 'Backspace' }); eng.onWordInput('t');
fakeNow = 6500; eng.onKeyDown({ isTrusted: true, key: 'h' }); eng.onWordInput('th');
fakeNow = 6600; eng.onKeyDown({ isTrusted: true, key: 'e' }); eng.onWordInput('the');
fakeNow = 6680; eng.onKeyDown({ isTrusted: true, key: 'z' }); eng.onWordInput('thez');
fakeNow = 6760; eng.onKeyDown({ isTrusted: true, key: 'Backspace' }); eng.onWordInput('the');
eng.flushCurrentWord(false);

assert.deepEqual(plain(eng.staged['th']), [2, 0, 0, 2], 'Double mistake -> err=2');
assert.deepEqual(plain(eng.staged['he']), [2, 1, 100, 0], 'Overshoot "z" erased -> 0 err (2B)');
assert.deepEqual(plain(eng.staged['the']), [3, 0, 0, 1], '"the" -> err=1 (1B)');

eng.resetTest();
eng.startWord('fière');
fakeNow = 7000; eng.onKeyDown({ isTrusted: true, key: 'f' }); eng.onWordInput('f');
fakeNow = 7100; eng.onKeyDown({ isTrusted: true, key: 'i' }); eng.onWordInput('fi');
fakeNow = 7300; eng.onKeyDown({ isTrusted: true, key: 'Backspace' }); eng.onWordInput('f');
fakeNow = 7500; eng.onKeyDown({ isTrusted: true, key: 'i' }); eng.onWordInput('fi');
fakeNow = 7600; eng.onKeyDown({ isTrusted: true, key: 'è' }); eng.onWordInput('fiè');
fakeNow = 7700; eng.onKeyDown({ isTrusted: true, key: 'r' }); eng.onWordInput('fièr');
fakeNow = 7800; eng.onKeyDown({ isTrusted: true, key: 'e' }); eng.onWordInput('fière');
eng.flushCurrentWord(false);

assert.deepEqual(plain(eng.staged['fi']), [2, 1, 100, 0], 'Hesitation Backspace keeps original "fi" speed and 0 err');
assert.deepEqual(plain(eng.staged['iè']), [2, 1, 100, 0], 'Hesitation Backspace -> 0 err on "iè"');
assert.equal(eng.staged['fiè'], undefined, '"fiè" split across Backspace without error is skipped');

// Test 5: Skipped suffix on Space (Rule 3)
eng.resetTest();
eng.startWord('fière');
fakeNow = 8000; eng.onKeyDown({ isTrusted: true, key: 'f' }); eng.onWordInput('f');
fakeNow = 8090; eng.onKeyDown({ isTrusted: true, key: 'i' }); eng.onWordInput('fi');
eng.flushCurrentWord(false);
assert.deepEqual(plain(eng.staged['fi']), [2, 1, 90, 0]);
assert.deepEqual(plain(eng.staged['ière']), [4, 0, 0, 1]);

// Test 6: qu=1 mode + fmt: 5 export
await S.switchQuMode(true);
eng.quAsOne = true;
eng.resetTest();
eng.startWord('quick');
fakeNow = 9000; eng.onKeyDown({ isTrusted: true, key: 'q' }); eng.onWordInput('q');
fakeNow = 9050; eng.onKeyDown({ isTrusted: true, key: 'u' }); eng.onWordInput('qu');
fakeNow = 9170; eng.onKeyDown({ isTrusted: true, key: 'i' }); eng.onWordInput('qui');
fakeNow = 9260; eng.onKeyDown({ isTrusted: true, key: 'c' }); eng.onWordInput('quic');
fakeNow = 9340; eng.onKeyDown({ isTrusted: true, key: 'k' }); eng.onWordInput('quick');
eng.flushCurrentWord(false);
assert.deepEqual(plain(eng.staged['qui']), [2, 1, 170, 0], 'In qu=1 mode, "qui" -> 170 ms');

await eng.commitTest('words 10', 'english');
const exported = await S.buildExportPayload(null, 'eng');
assert.ok(exported.stats.eng_qu, 'Must export under eng_qu key in qu=1 mode');
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
