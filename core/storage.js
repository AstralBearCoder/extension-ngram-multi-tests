(() => {
  'use strict';

  const INDEX_KEY = 'ngram_index_v1';
  const PREFS_KEY = 'ngram_prefs_v1';
  const TEST_PREFIX = 'ngram_t_';

  const DEFAULT_PREFS = Object.freeze({
    quAsOne: false,
    enabledSites: {
      monkeytype: true,
      typeracer: true,
      fastfingers10: true
    }
  });

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (res) => resolve(res || {}));
    });
  }

  function storageSet(obj) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(obj, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, () => resolve());
    });
  }

  async function getBytesInUse() {
    if (typeof chrome.storage.local.getBytesInUse === 'function') {
      return new Promise((resolve) => {
        chrome.storage.local.getBytesInUse(null, (bytes) => resolve(Number(bytes) || 0));
      });
    }
    // Firefox fallback: light index estimation (~5 KB per test average)
    const index = await getIndex();
    return index.length * 5120;
  }

  async function getPrefs() {
    const res = await storageGet([PREFS_KEY]);
    const raw = res[PREFS_KEY] || {};
    return {
      quAsOne: Boolean(raw.quAsOne),
      enabledSites: Object.assign({}, DEFAULT_PREFS.enabledSites, raw.enabledSites || {})
    };
  }

  async function setPrefs(nextPrefs) {
    await storageSet({ [PREFS_KEY]: nextPrefs });
  }

  async function getIndex() {
    const res = await storageGet([INDEX_KEY]);
    return Array.isArray(res[INDEX_KEY]) ? res[INDEX_KEY] : [];
  }

  function formatTestDate(ts) {
    const d = new Date(ts);
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /**
   * Saves one completed test atomically as an isolated payload + lightweight index row.
   * @param {Object} testMeta - { site, siteLabel, testType, lang, strokes, quAsOne }
   * @param {Object} ngramsMap - { [ngram]: [len, okCount, okSumMs, errCount] }
   */
  async function saveTest(testMeta, ngramsMap) {
    const keys = Object.keys(ngramsMap);
    if (keys.length === 0) return null;

    const ts = Date.now();
    const id = `${ts}_${Math.random().toString(36).slice(2, 7)}`;
    const name = `${testMeta.siteLabel} · ${testMeta.testType} · ${testMeta.lang} · ${formatTestDate(ts)}`;

    const row = {
      id,
      name,
      site: testMeta.site,
      testType: testMeta.testType,
      lang: testMeta.lang,
      quAsOne: Boolean(testMeta.quAsOne),
      strokes: testMeta.strokes | 0,
      ngramCount: keys.length,
      ts
    };

    const index = await getIndex();
    index.unshift(row);

    await storageSet({
      [TEST_PREFIX + id]: { ts, ngrams: ngramsMap },
      [INDEX_KEY]: index
    });

    return { row, totalTests: index.length };
  }

  async function deleteTest(id) {
    const index = await getIndex();
    const nextIndex = index.filter((item) => item.id !== id);
    await storageRemove([TEST_PREFIX + id]);
    await storageSet({ [INDEX_KEY]: nextIndex });
    return nextIndex;
  }

  async function clearAllTests() {
    const index = await getIndex();
    const keys = index.map((item) => TEST_PREFIX + item.id);
    keys.push(INDEX_KEY);
    await storageRemove(keys);
  }

  async function switchQuMode(newQuAsOne) {
    const prefs = await getPrefs();
    if (prefs.quAsOne === Boolean(newQuAsOne)) return false;
    await clearAllTests();
    prefs.quAsOne = Boolean(newQuAsOne);
    await setPrefs(prefs);
    return true;
  }

  /**
   * Builds a ngrams-international-3.0 compatible Option A (fmt: 5) JSON payload
   * for a selected subset of tests (filtered by language and/or IDs).
   */
  async function buildExportPayload(selectedIds = null, langFilter = 'ALL') {
    const index = await getIndex();
    const idSet = selectedIds ? new Set(selectedIds) : null;

    const targets = index.filter((row) => {
      if (idSet && !idSet.has(row.id)) return false;
      if (langFilter !== 'ALL' && row.lang !== langFilter) return false;
      return true;
    });

    if (targets.length === 0) return null;

    // Sort chronologically ascending so history blocks preserve evolution order
    targets.sort((a, b) => a.ts - b.ts);

    const storageKeys = targets.map((t) => TEST_PREFIX + t.id);
    const payloads = await storageGet(storageKeys);
    const stats = {};

    for (let i = 0; i < targets.length; i++) {
      const metaRow = targets[i];
      const payload = payloads[TEST_PREFIX + metaRow.id];
      if (!payload || !payload.ngrams) continue;

      const langKey = metaRow.quAsOne ? `${metaRow.lang}_qu` : metaRow.lang;
      if (!stats[langKey]) {
        stats[langKey] = {
          fmt: 5,
          meta: {
            completedTests: 0,
            totalKeystrokes: 0,
            lastRun: null
          },
          ngrams: {}
        };
      }

      const lStats = stats[langKey];
      lStats.meta.completedTests += 1;
      lStats.meta.totalKeystrokes += metaRow.strokes || 0;
      lStats.meta.lastRun = new Date(metaRow.ts).toISOString();

      const testNgrams = payload.ngrams;
      for (const ng of Object.keys(testNgrams)) {
        const tuple = testNgrams[ng]; // [len, okCount, okSumMs, errCount]
        const len = tuple[0];
        if (len < 2 || len > 4) continue;

        let entry = lStats.ngrams[ng];
        if (!entry) {
          entry = lStats.ngrams[ng] = { len, cur: [0, 0, 0], h: [] };
        }
        // Emit 1 chronological checkpoint per test so Evolution Chart works natively
        entry.h.push([tuple[1], Math.round(tuple[2]), tuple[3], metaRow.ts]);
      }
    }

    if (Object.keys(stats).length === 0) return null;

    return {
      version: 6.2,
      profile: { name: 'ngramIntl Sync' },
      timestamp: new Date().toISOString(),
      stats
    };
  }

  globalThis.__NgramStorage = Object.freeze({
    getPrefs,
    setPrefs,
    getIndex,
    saveTest,
    deleteTest,
    clearAllTests,
    switchQuMode,
    getBytesInUse,
    buildExportPayload
  });
})();
