(() => {
  'use strict';

  const { SurgicalEngine } = globalThis.__NgramEngine;
  const engine = new SurgicalEngine('monkeytype', 'Monkeytype');

  let activeWordEl = null;
  let boundInput = null;

  function readTargetWord(wordEl) {
    if (!wordEl) return '';
    let text = '';
    const children = wordEl.children;
    for (let i = 0; i < children.length; i++) {
      const ch = children[i];
      if (!ch.classList.contains('extra')) {
        text += ch.textContent;
      }
    }
    return text;
  }

  function getConfig() {
    try {
      return JSON.parse(localStorage.getItem('config') || '{}');
    } catch {
      return {};
    }
  }

  function getTestType(cfg) {
    const mode = cfg.mode || 'time';
    if (mode === 'time') return `time ${cfg.time || 30}s`;
    if (mode === 'words') return `words ${cfg.words || 25}`;
    if (mode === 'quote') return 'quote';
    if (mode === 'zen') return 'zen';
    return mode;
  }

  function syncActiveWord(forceReset = false) {
    const current = document.querySelector('#words .word.active');
    if (!current) return;
    if (forceReset || current !== activeWordEl) {
      if (activeWordEl && engine.testActive) {
        engine.flushCurrentWord(false);
      }
      activeWordEl = current;
      engine.startWord(readTargetWord(current));
    }
  }

  function bindWordsInput() {
    const input = document.getElementById('wordsInput');
    if (!input || input === boundInput) return;
    boundInput = input;

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' || e.key === 'Escape') {
        activeWordEl = null;
        engine.resetTest();
        return;
      }
      if (!activeWordEl) syncActiveWord(true);
      engine.onKeyDown(e);

      if (e.key === ' ' && engine.testActive) {
        // Monkeytype advances .word.active on Space; flush before DOM shift
        engine.flushCurrentWord(false);
        activeWordEl = null;
      }
    }, true);

    input.addEventListener('input', () => {
      const current = document.querySelector('#words .word.active');
      if (current && current !== activeWordEl) {
        if (activeWordEl) engine.flushCurrentWord(false);
        activeWordEl = current;
        engine.startWord(readTargetWord(current));
      }
      if (activeWordEl) {
        engine.onWordInput(input.value || '');
      }
    });
  }

  function observeLifecycle() {
    const resultEl = document.getElementById('result');
    const wordsEl = document.getElementById('words');
    if (!resultEl || !wordsEl) {
      setTimeout(observeLifecycle, 600);
      return;
    }

    bindWordsInput();

    const resultObserver = new MutationObserver(() => {
      const typingHidden = document.getElementById('typingTest')?.classList.contains('hidden');
      const resultVisible = window.getComputedStyle(resultEl).display !== 'none';
      if ((resultVisible || typingHidden) && engine.testActive) {
        // Flush final word cleanly (partial=true preserves timed expiry mid-word without false errors)
        const activeText = readTargetWord(activeWordEl);
        const completedLastWord = activeText && engine.prevTypedLen >= activeText.length;
        engine.flushCurrentWord(!completedLastWord);
        activeWordEl = null;

        const cfg = getConfig();
        engine.commitTest(getTestType(cfg), cfg.language || 'english');
      } else if (!resultVisible && !typingHidden) {
        bindWordsInput();
      }
    });

    resultObserver.observe(resultEl, { attributes: true, attributeFilter: ['style', 'class'] });

    const wordsObserver = new MutationObserver(() => {
      bindWordsInput();
      const current = document.querySelector('#words .word.active');
      if (current && current !== activeWordEl) {
        // Test restarted via UI button or quick restart
        if (!engine.testActive) {
          activeWordEl = current;
          engine.startWord(readTargetWord(current));
        }
      }
    });

    wordsObserver.observe(wordsEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  observeLifecycle();
})();
