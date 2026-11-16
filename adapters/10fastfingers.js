(() => {
  'use strict';

  const { SurgicalEngine } = globalThis.__NgramEngine;
  const engine = new SurgicalEngine('fastfingers10', '10FastFingers');

  let currentWordKey = null;
  let lastFlushedKey = null;
  let awaitingSpaceClear = false;
  let wasEnded = false;

  function isBoxInput(el) {
    return Boolean(el && el.dataset && el.dataset.testid === 'Typing-box-input');
  }

  function isTestFinished() {
    return Boolean(document.querySelector('[data-testid="typing-test-result-root"]'));
  }

  function detectLang() {
    const hidden = document.querySelector('input[name="languageselect"]')?.value;
    if (hidden) return hidden;
    const label = document.querySelector('[data-testid="LanguageDropdown-current-value"]')?.textContent;
    if (label) return label.trim();
    const m = location.pathname.match(/\/(?:typing-test|advanced-typing-test)\/([a-z]+)/i);
    return (m && m[1]) ? m[1] : 'english';
  }

  function getTestType() {
    if (location.pathname.includes('advanced-typing-test')) return '1000 words';
    if (location.pathname.includes('competition')) return 'competition';
    return '60s';
  }

  function readActiveWordState() {
    const box = document.querySelector('[data-testid="word-box-words"]');
    if (!box) return null;

    const awSpans = box.querySelectorAll('span[class*="-aw"]');
    if (!awSpans.length) return null;

    let word = '';
    for (let i = 0; i < awSpans.length; i++) {
      word += awSpans[i].textContent || '';
    }
    word = word.trim();
    if (!word) return null;

    const typedCount = box.querySelectorAll('span[class*="-t"]').length;
    return { key: `${typedCount}:${word}`, word };
  }

  function syncActiveWord() {
    const state = readActiveWordState();
    if (!state || state.key === lastFlushedKey) return;
    if (state.key !== currentWordKey) {
      if (currentWordKey !== null && engine.testActive) {
        lastFlushedKey = currentWordKey;
        engine.flushCurrentWord(false);
      }
      currentWordKey = state.key;
      wasEnded = false;
      engine.startWord(state.word);
    }
  }

  window.addEventListener('keydown', (e) => {
    if (!isBoxInput(e.target)) return;
    if (e.key === 'F5' || e.key === 'Escape') return;
    if (isTestFinished()) return;

    if (e.key === ' ' && engine.testActive) {
      const ta = e.target;
      lastFlushedKey = currentWordKey;
      engine.flushCurrentWord(false);
      currentWordKey = null;
      awaitingSpaceClear = true;
      queueMicrotask(() => {
        if ((ta.value || '').trim() === '') {
          awaitingSpaceClear = false;
        }
      });
      return;
    }

    syncActiveWord();
    engine.onKeyDown(e);
  }, true);

  document.addEventListener('input', (e) => {
    if (!isBoxInput(e.target)) return;
    if (isTestFinished()) return;

    const val = e.target.value || '';
    if (awaitingSpaceClear) {
      if (val.trim() === '') {
        awaitingSpaceClear = false;
        return;
      }
      if (val.endsWith(' ')) return;
      awaitingSpaceClear = false;
    }

    syncActiveWord();
    engine.onWordInput(val.trimEnd());
  }, true);

  const lifecycleObserver = new MutationObserver(() => {
    const finished = isTestFinished();
    if (finished && !wasEnded && engine.testActive) {
      wasEnded = true;
      engine.flushCurrentWord(true);
      currentWordKey = null;
      lastFlushedKey = null;
      awaitingSpaceClear = false;
      engine.commitTest(getTestType(), detectLang());
    } else if (!finished) {
      wasEnded = false;
    }
  });

  lifecycleObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
})();