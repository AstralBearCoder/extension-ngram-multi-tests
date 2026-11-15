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

  /**
   * Tokenizes text into atomic units, honoring 'qu=1' mode without regex allocation.
   * Returns { units: string[], starts: Uint8Array, ends: Uint8Array, count: number }.
   */
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

      // Preallocated hot-path buffers for current word (zero GC churn)
      this.charTs = new Float64Array(MAX_WORD_CHARS);
      this.charOk = new Uint8Array(MAX_WORD_CHARS);
      this.charDirty = new Uint8Array(MAX_WORD_CHARS);

      this.targetWord = '';
      this.targetChars = [];
      this.prevTypedLen = 0;
      this.pendingKeyTs = NaN;
      this.lastKeyWasBackspace = false;

      this.testActive = false;
      this.totalKeystrokes = 0;
      this.staged = Object.create(null); // { [ngram]: [len, okCount, okSumMs, errCount] }
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
      this.targetWord = targetWord || '';
      this.targetChars = Array.from(this.targetWord);
      this.prevTypedLen = 0;
      this.pendingKeyTs = NaN;
      this.lastKeyWasBackspace = false;
    }

    resetTest() {
      this.testActive = false;
      this.totalKeystrokes = 0;
      this.staged = Object.create(null);
      this.startWord('');
    }

    onKeyDown(e) {
      if (!this.enabled || !e.isTrusted || e.repeat || e.isComposing) return;
      // Ignore pure Ctrl/Meta shortcuts while keeping AltGr (ctrl+alt on Windows)
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

    /**
     * Reconciles the input box string against targetChars with exact timestamps.
     */
    onWordInput(typedValue) {
      if (!this.enabled || !this.targetWord) return;
      const now = Number.isFinite(this.pendingKeyTs) ? this.pendingKeyTs : performance.now();
      this.pendingKeyTs = NaN;

      const typedChars = Array.from(typedValue);
      const newLen = typedChars.length;
      const targetLen = Math.min(this.targetChars.length, MAX_WORD_CHARS);

      if (newLen > 0 && !this.testActive) {
        this.testActive = true;
      }

      if (newLen < this.prevTypedLen) {
        // Backspace or Ctrl+Backspace erased [newLen .. prevTypedLen - 1]
        const from = Math.max(0, newLen);
        const to = Math.min(this.prevTypedLen, targetLen);
        for (let p = from; p < to; p++) {
          this.charDirty[p] = 1;
          this.charOk[p] = 0;
        }
        // Overshoot correction if previously past targetLen
        if (this.prevTypedLen > targetLen && targetLen > 0) {
          this.charDirty[targetLen - 1] = 1;
        }
        this.prevTypedLen = newLen;
        return;
      }

      // Forward typing (1 char or dead-key composition result)
      const startIdx = Math.max(0, this.prevTypedLen);
      for (let p = startIdx; p < newLen; p++) {
        if (p >= targetLen) {
          if (targetLen > 0) this.charDirty[targetLen - 1] = 1;
          continue;
        }
        this.charTs[p] = now;
        if (typedChars[p] === this.targetChars[p]) {
          this.charOk[p] = 1;
        } else {
          this.charOk[p] = 0;
          this.charDirty[p] = 1;
        }
      }
      this.prevTypedLen = newLen;
    }

    /**
     * Extracts all 2, 3, and 4-grams from the current word.
     * @param {boolean} isPartialEnd - true when timer expired mid-word (do not penalize untyped suffix).
     */
    flushCurrentWord(isPartialEnd = false) {
      if (!this.enabled || !this.targetWord || this.prevTypedLen === 0) return;

      const { units, starts, ends, count, charCount } = tokenizeWordUnits(this.targetWord, this.quAsOne);
      if (count < 2) return;

      const maxCheckChar = isPartialEnd ? Math.min(this.prevTypedLen, charCount) : charCount;

      for (let len = 2; len <= 4; len++) {
        if (count < len) break;

        for (let a = 0; a <= count - len; a++) {
          const b = a + len - 1;
          const endChar = ends[b];

          // When test timer expires mid-word, skip units beyond what user actually reached
          if (isPartialEnd && endChar >= maxCheckChar) continue;

          const startChar = starts[a];
          let clean = true;

          // Anchor unit 'a': must be typed accurately; internal 'qu' transition must be clean
          for (let c = startChar; c <= ends[a]; c++) {
            if (this.charOk[c] !== 1) {
              clean = false;
              break;
            }
            if (c > startChar && this.charDirty[c] === 1) {
              clean = false;
              break;
            }
          }

          // Subsequent units [a+1 .. b]: must be both accurate AND untouched by errors/backspace
          if (clean) {
            for (let u = a + 1; u <= b; u++) {
              for (let c = starts[u]; c <= ends[u]; c++) {
                if (this.charOk[c] !== 1 || this.charDirty[c] === 1) {
                  clean = false;
                  break;
                }
              }
              if (!clean) break;
            }
          }

          let ngramStr = '';
          for (let u = a; u <= b; u++) ngramStr += units[u];

          if (clean) {
            const dt = this.charTs[endChar] - this.charTs[startChar];
            if (dt >= MIN_IKI_MS && dt <= MAX_IKI_MS) {
              this._record(ngramStr, len, true, dt);
            }
            // dt > MAX_IKI_MS: AFK pause -> discarded from both speed & errors
          } else {
            this._record(ngramStr, len, false, 0);
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

      const lang = resolveLangCode(rawLang);
      const ngramsMap = this.staged;
      const strokes = this.totalKeystrokes;

      this.staged = Object.create(null);
      this.totalKeystrokes = 0;
      this.startWord('');

      if (Object.keys(ngramsMap).length === 0) return;

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
