/**
 * ngramIntl Monkeytype Collector (Content Script)
 */

const LANG_MAP = {
  'english': 'eng', 'french': 'fra', 'spanish': 'spa',
  'german': 'deu', 'italian': 'ita', 'portuguese': 'por',
  'polish': 'pol', 'russian': 'rus'
};

function getActiveLanguage() {
  try {
    const cfg = JSON.parse(localStorage.getItem('config') || '{}');
    const lang = (cfg.language || 'english').split('_')[0].toLowerCase();
    return LANG_MAP[lang] || 'eng';
  } catch (e) {
    return 'eng';
  }
}

// Algorithme de tokenisation Qu unifié avec ngramInternational
function tokenizeUnits(text) {
  if (!text) return [];
  const units = [];
  let i = 0;
  while (i < text.length) {
    if (i + 1 < text.length && text[i].toLowerCase() === 'q' && text[i + 1].toLowerCase() === 'u') {
      units.push(text.substring(i, i + 2));
      i += 2;
    } else {
      units.push(text[i]);
      i++;
    }
  }
  return units;
}

class MonkeyCollector {
  constructor() {
    this.currentWordStartTime = 0;
    this.currentWordErrors = 0;
    this.stagedNgrams = {};
    this.totalKeystrokes = 0;
    this.testActive = false;
    this.observer = null;

    this.init();
  }

  init() {
    window.addEventListener('keydown', (e) => this.handleKeyDown(e), true);
    this.watchForResults();
  }

  handleKeyDown(e) {
    // Si l'utilisateur tape sur Monkeytype
    if (e.key === 'Tab' || e.key === 'Escape') {
      this.resetTest();
      return;
    }

    if (e.key.length === 1 || e.key === 'Backspace' || e.key === ' ') {
      const now = performance.now();

      if (!this.testActive && e.key.length === 1 && e.key !== ' ') {
        this.testActive = true;
        this.currentWordStartTime = now;
        this.currentWordErrors = 0;
      }

      this.totalKeystrokes++;

      if (e.key === 'Backspace') {
        this.currentWordErrors++;
      }

      // Détection de fin de mot (Espace)
      if (e.key === ' ' && this.testActive) {
        const elapsed = Math.round(now - this.currentWordStartTime);
        this.extractLastTypedWord(elapsed);
        this.currentWordStartTime = performance.now();
        this.currentWordErrors = 0;
      }
    }
  }

  extractLastTypedWord(duration) {
    // On récupère le mot actif avant l'espace
    const activeWordEl = document.querySelector('#words .word.active');
    if (!activeWordEl) return;

    // Détection d'erreurs visuelles de Monkeytype
    const hasVisualErrors = activeWordEl.querySelectorAll('.letter.incorrect, .letter.extra').length > 0;
    const hadError = this.currentWordErrors > 0 || hasVisualErrors;

    const wordText = activeWordEl.textContent.trim();
    if (!wordText) return;

    this.processWord(wordText, Math.max(100, Math.min(4500, duration)), hadError);
  }

  processWord(word, duration, hadError) {
    const units = tokenizeUnits(word);
    const len = units.length;

    if (len >= 2 && len <= 4) {
      this.stageSample(word, len, duration, hadError);
    }

    // Décomposition pyramidale exacte d'ngramInternational
    if (len === 4) {
      const subTriTime = Math.round(duration * 0.75);
      this.stageSample(units.slice(0, 3).join(''), 3, subTriTime, hadError);
      this.stageSample(units.slice(1, 4).join(''), 3, subTriTime, hadError);

      const subBiTime = Math.round(duration * 0.5);
      this.stageSample(units.slice(0, 2).join(''), 2, subBiTime, hadError);
      this.stageSample(units.slice(1, 3).join(''), 2, subBiTime, hadError);
      this.stageSample(units.slice(2, 4).join(''), 2, subBiTime, hadError);
    } else if (len === 3) {
      const subBiTime = Math.round(duration * 0.65);
      this.stageSample(units.slice(0, 2).join(''), 2, subBiTime, hadError);
      this.stageSample(units.slice(1, 3).join(''), 2, subBiTime, hadError);
    }
  }

  stageSample(ngram, len, time, hadError) {
    if (!this.stagedNgrams[ngram]) {
      this.stagedNgrams[ngram] = { len, samples: [] };
    }
    this.stagedNgrams[ngram].samples.push({ time, hadError });
  }

  resetTest() {
    this.testActive = false;
    this.stagedNgrams = {};
    this.totalKeystrokes = 0;
    this.currentWordStartTime = 0;
    this.currentWordErrors = 0;
  }

  watchForResults() {
    // Surveille l'apparition de l'écran de résultats (#result)
    const resultElement = document.getElementById('result');
    if (!resultElement) {
      setTimeout(() => this.watchForResults(), 1000);
      return;
    }

    this.observer = new MutationObserver(() => {
      const isVisible = window.getComputedStyle(resultElement).display !== 'none';
      if (isVisible && this.testActive) {
        this.onTestComplete();
      }
    });

    this.observer.observe(resultElement, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  async onTestComplete() {
    this.testActive = false;
    const lang = getActiveLanguage();

    if (Object.keys(this.stagedNgrams).length === 0) return;

    // Enregistre les données dans chrome.storage
    chrome.storage.local.get(['ngram_export_data'], (res) => {
      const store = res.ngram_export_data || {
        version: 6.2,
        profile: { name: "Monkeytype Import" },
        timestamp: new Date().toISOString(),
        stats: {}
      };

      if (!store.stats[lang]) {
        store.stats[lang] = {
          meta: { completedTests: 0, totalKeystrokes: 0, lastRun: null },
          ngrams: {}
        };
      }

      const lStats = store.stats[lang];
      lStats.meta.completedTests += 1;
      lStats.meta.totalKeystrokes += this.totalKeystrokes;
      lStats.meta.lastRun = new Date().toISOString();

      // Fusion des n-grams
      for (const [ng, val] of Object.entries(this.stagedNgrams)) {
        if (!lStats.ngrams[ng]) {
          lStats.ngrams[ng] = { len: val.len, samples: [], history: [] };
        }
        lStats.ngrams[ng].samples.push(...val.samples);
      }

      chrome.storage.local.set({ ngram_export_data: store }, () => {
        this.showToastUI(lStats.meta.completedTests);
        this.stagedNgrams = {};
        this.totalKeystrokes = 0;
      });
    });
  }

  showToastUI(testsCount) {
    const existing = document.getElementById('ngram-sync-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'ngram-sync-toast';
    toast.innerHTML = `
      <div class="ngram-toast-content">
        <span>⚡ <strong>ngramIntl</strong> : Test Monkeytype enregistré ! (${testsCount} accumulé${testsCount > 1 ? 's' : ''})</span>
        <button id="ngram-toast-download">Télécharger JSON</button>
      </div>
    `;
    document.body.appendChild(toast);

    document.getElementById('ngram-toast-download').addEventListener('click', () => {
      chrome.storage.local.get(['ngram_export_data'], (data) => {
        if (!data.ngram_export_data) return;
        const blob = new Blob([JSON.stringify(data.ngram_export_data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ngram-monkeytype-backup.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    });

    setTimeout(() => {
      if (toast) toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 600);
    }, 7000);
  }
}

new MonkeyCollector();
