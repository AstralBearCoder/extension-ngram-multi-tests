(() => {
  'use strict';

  const MAX_WORD_CHARS = 64;
  const MIN_IKI_MS = 15;
  const MAX_IKI_MS = 3500;

  const LANG_MAP = Object.freeze({
    english: 'eng', en: 'eng', eng: 'eng',
    french: 'fra', fr: 'fra', fra: 'fra', francais: 'fra',
    spanish: 'spa', es: 'spa', spa: 'spa', espanol: 'spa',
    german: 'deu', de: 'deu', deu: 'deu', deutsch: 'deu',
    italian: 'ita', it: 'ita', ita: 'ita', italiano: 'ita',
    portuguese: 'por', pt: 'por', por: 'por', portugues: 'por',
    polish: 'pol', pl: 'pol', pol: 'pol', polski: 'pol',
    russian: 'rus', ru: 'rus', rus: 'rus'
  });

  function resolveLangCode(raw) {
    if (!raw) return 'eng';
    const base = String(raw).toLowerCase().trim().split(/[_-]/)[0];
    return LANG_MAP[base] || 'eng';
  }

  function tokenizeWordUnits(word, quAsOne) {
    const chars = Array.from(word);
    const n = Math.min(chars.length, MAX_WORD_CHARS);
    const units = [];
    const starts = new Uint8Array(n);
    const ends = new Uint8Array(n);

    let i = 0;
    let u = 0;
    while (i < n) {
      if (
        quAsOne &&
        i + 1 < n &&
        (chars[i] === 'q' || chars[i] === 'Q') &&
        (chars[i + 1] === 'u' || chars[i + 1] === 'U')
      ) {
        units.push(chars[i] + chars[i + 1]);
        starts[u] = i;
        ends[u] = i + 1;
        i += 2;
      } else {
        units.push(chars[i]);
        starts[u] = i;
        ends[u] = i;
        i += 1;
      }
      u += 1;
    }
    return { units, starts, ends, count: u, charCount: n, chars };
  }

  class SurgicalEngine {
    constructor(siteId, siteLabel) {
      this.siteId = siteId;
      this.siteLabel = siteLabel;
      this.quAsOne = false;
      this.enabled = true;

      this.charTs = new Float64Array(MAX_WORD_CHARS);
      this.charOk = new Uint8Array(MAX_WORD_CHARS);
      this.charDirty = new Uint8Array(MAX_WORD_CHARS);
      this.charEpoch = new Uint16Array(MAX_WORD_CHARS);
      this.winErr = new Uint8Array(MAX_WORD_CHARS * 3);

      this.targetWord = '';
      this.targetChars = [];
      this.unitData = null;
      this.prevTypedLen = 0;
      this.editEpoch = 0;
      this.pendingKeyTs = NaN;
      this.lastKeyWasBackspace = false;

      this.testActive = false;
      this.totalKeystrokes = 0;
      this.staged = {};
      this.toastTimer = null;

      this._syncPrefs();
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.ngram_prefs_v1) {
          this._applyPrefs(changes.ngram_prefs_v1.newValue);
        }
      });
    }

    async _syncPrefs() {
      const prefs = await globalThis.__NgramStorage.getPrefs();
      this._applyPrefs(prefs);
    }

    _applyPrefs(prefs) {
      if (!prefs) return;
      const prevQu = this.quAsOne;
      this.quAsOne = Boolean(prefs.quAsOne);
      this.enabled = prefs.enabledSites ? prefs.enabledSites[this.siteId] !== false : true;
      if (prevQu !== this.quAsOne || !this.enabled) {
        this.resetTest();
      }
    }

    startWord(targetWord) {
      this.charTs.fill(0);
      this.charOk.fill(0);
      this.charDirty.fill(0);
      this.charEpoch.fill(0);
      this.winErr.fill(0);
      this.targetWord = targetWord || '';
      this.unitData = this.targetWord ? tokenizeWordUnits(this.targetWord, this.quAsOne) : null;
      this.targetChars = this.unitData ? this.unitData.chars : [];
      this.prevTypedLen = 0;
      this.editEpoch = 0;
      this.pendingKeyTs = NaN;
      this.lastKeyWasBackspace = false;
    }

    resetTest() {
      this.testActive = false;
      this.totalKeystrokes = 0;
      this.staged = {};
      this.startWord('');
    }

    onKeyDown(e) {
      if (!this.enabled || !e.isTrusted || e.repeat || e.isComposing) return;
      if ((e.ctrlKey && !e.altKey && e.key !== 'Backspace') || e.metaKey) return;

      if (e.key === 'Backspace') {
        this.lastKeyWasBackspace = true;
        this.pendingKeyTs = NaN;
        this.totalKeystrokes += 1;
        return;
      }

      if (e.key.length === 1) {
        this.pendingKeyTs = performance.now();
        this.lastKeyWasBackspace = false;
        this.totalKeystrokes += 1;
        if (!this.testActive && e.key !== ' ') {
          this.testActive = true;
        }
      }
    }

    _evaluateUnit(b) {
      const { units, starts, ends } = this.unitData;
      const endChar = ends[b];

      for (let len = 2; len <= 4; len++) {
        const a = b - len + 1;
        if (a < 0) break;

        const startChar = starts[a];
        let allOk = true;
        let hasDirtyNonAnchor = false;

        for (let c = startChar; c <= endChar; c++) {
          if (this.charOk[c] !== 1) {
            allOk = false;
            break;
          }
          if (c > startChar && this.charDirty[c] === 1) {
            hasDirtyNonAnchor = true;
          }
        }

        let ngramStr = '';
        for (let u = a; u <= b; u++) ngramStr += units[u];
        const slot = b * 3 + (len - 2);

        if (!allOk) {
          this._record(ngramStr, len, false, 0);
          this.winErr[slot] = 1;
        } else if (this.charEpoch[startChar] === this.charEpoch[endChar]) {
          const dt = this.charTs[endChar] - this.charTs[startChar];
          if (dt >= MIN_IKI_MS && dt <= MAX_IKI_MS) {
            this._record(ngramStr, len, true, dt);
          }
        } else if (hasDirtyNonAnchor && this.winErr[slot] === 0) {
          this._record(ngramStr, len, false, 0);
          this.winErr[slot] = 1;
        }
      }
    }

    onWordInput(typedValue) {
      if (!this.enabled || !this.unitData) return;
      const now = Number.isFinite(this.pendingKeyTs) ? this.pendingKeyTs : performance.now();
      this.pendingKeyTs = NaN;

      const typedChars = Array.from(typedValue);
      const newLen = typedChars.length;
      const targetLen = this.unitData.charCount;

      if (newLen > 0 && !this.testActive) {
        this.testActive = true;
      }

      if (newLen < this.prevTypedLen) {
        this.editEpoch = (this.editEpoch + 1) & 0xffff;
        const from = Math.max(0, newLen);
        const to = Math.min(this.prevTypedLen, targetLen);
        for (let p = from; p < to; p++) {
          this.charOk[p] = 0;
        }
        this.prevTypedLen = newLen;
        return;
      }

      const startIdx = Math.max(0, this.prevTypedLen);
      const maxChar = Math.min(newLen, targetLen);
      for (let p = startIdx; p < maxChar; p++) {
        this.charTs[p] = now;
        this.charEpoch[p] = this.editEpoch;
        if (typedChars[p] === this.targetChars[p]) {
          this.charOk[p] = 1;
        } else {
          this.charOk[p] = 0;
          this.charDirty[p] = 1;
        }
      }
      this.prevTypedLen = newLen;

      if (maxChar > startIdx) {
        const { ends, count } = this.unitData;
        for (let b = 0; b < count; b++) {
          const endChar = ends[b];
          if (endChar >= startIdx && endChar < maxChar) {
            this._evaluateUnit(b);
          } else if (endChar >= maxChar) {
            break;
          }
        }
      }
    }

    flushCurrentWord(isPartialEnd = false) {
      if (!this.enabled || !this.unitData || this.prevTypedLen === 0) return;

      if (!isPartialEnd) {
        const { units, ends, count } = this.unitData;
        for (let b = 0; b < count; b++) {
          if (ends[b] >= this.prevTypedLen) {
            for (let len = 2; len <= 4; len++) {
              const a = b - len + 1;
              if (a < 0) break;
              let ngramStr = '';
              for (let u = a; u <= b; u++) ngramStr += units[u];
              this._record(ngramStr, len, false, 0);
            }
          }
        }
      }

      this.startWord('');
    }

    _record(ngram, len, ok, dt) {
      let tuple = this.staged[ngram];
      if (!tuple) {
        tuple = this.staged[ngram] = [len, 0, 0, 0];
      }
      if (ok) {
        tuple[1] += 1;
        tuple[2] += dt;
      } else {
        tuple[3] += 1;
      }
    }

    async commitTest(testType, rawLang) {
      if (!this.enabled || !this.testActive) return;
      this.testActive = false;

      const stagedCount = Object.keys(this.staged).length;
      const lang = resolveLangCode(rawLang);
      const ngramsMap = this.staged;
      const strokes = this.totalKeystrokes;

      this.staged = {};
      this.totalKeystrokes = 0;
      this.startWord('');

      if (stagedCount === 0) return;

      try {
        const saved = await globalThis.__NgramStorage.saveTest(
          {
            site: this.siteId,
            siteLabel: this.siteLabel,
            testType: testType || 'standard',
            lang,
            strokes,
            quAsOne: this.quAsOne
          },
          ngramsMap
        );

        if (saved) {
          this._showToast(saved.row.name, saved.totalTests);
        }
      } catch (err) {
        console.error('[ngramIntl] saveTest failed:', err);
      }
    }

    _showToast(label, totalTests) {
      const existing = document.getElementById('ngram-sync-toast');
      if (existing) existing.remove();
      if (this.toastTimer) clearTimeout(this.toastTimer);

      const toast = document.createElement('div');
      toast.id = 'ngram-sync-toast';

      const content = document.createElement('div');
      content.className = 'ngram-toast-content';

      const text = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = 'ngramIntl';
      text.appendChild(document.createTextNode('⚡ '));
      text.appendChild(strong);
      text.appendChild(document.createTextNode(`: ${label} (${totalTests} total)`));

      content.appendChild(text);
      toast.appendChild(content);
      document.body.appendChild(toast);

      this.toastTimer = setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 450);
      }, 4200);
    }
  }

  globalThis.__NgramEngine = { SurgicalEngine, resolveLangCode };
})();
