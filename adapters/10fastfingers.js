(() => {
  'use strict';

  const { SurgicalEngine } = globalThis.__NgramEngine;
  const engine = new SurgicalEngine('fastfingers10', '10FastFingers');

  let currentWordNr = null;
  let boundInput = null;

  function detectLang() {
    const m = location.pathname.match(/\/(?:typing-test|advanced-typing-test)\/([a-z]+)/i);
    if (m && m[1]) return m[1];
    const h1 = document.querySelector('#test-header, h1')?.textContent || '';
    return h1.split(' ')[0] || 'english';
  }

  function getTestType() {
    if (location.pathname.includes('advanced-typing-test')) return '1000 words';
    if (location.pathname.includes('competition')) return 'competition';
    if (location.pathname.includes('text-practice')) return 'practice';
    return '60s top200';
  }

  function syncActiveWord() {
    const activeSpan = document.querySelector('#row1 span.highlight');
    if (!activeSpan) return;
    const nr = activeSpan.getAttribute('wordnr') || activeSpan.textContent;
    if (nr !== currentWordNr) {
      if (currentWordNr !== null && engine.testActive) {
        engine.flushCurrentWord(false);
      }
      currentWordNr = nr;
      engine.startWord((activeSpan.textContent || '').trim());
    }
  }

  function attach() {
    const input = document.getElementById('inputfield');
    const row1 = document.getElementById('row1');
    const resultEl = document.getElementById('auswertung-result');
    if (!input || !row1) {
      setTimeout(attach, 600);
      return;
    }

    if (boundInput !== input) {
      boundInput = input;

      input.addEventListener('keydown', (e) => {
        if (e.key === 'F5' || e.key === 'Escape') return;
        syncActiveWord();
        engine.onKeyDown(e);

        if (e.key === ' ' && engine.testActive) {
          engine.flushCurrentWord(false);
          currentWordNr = null;
        }
      }, true);

      input.addEventListener('input', () => {
        syncActiveWord();
        const val = input.value || '';
        if (!val && engine.prevTypedLen > 0) return;
        engine.onWordInput(val.trimEnd());
      });
    }

    const obs = new MutationObserver(() => {
      const wordsHidden = document.getElementById('words')?.style.display === 'none';
      const resultVisible = resultEl && window.getComputedStyle(resultEl).display !== 'none' && resultEl.innerHTML.trim().length > 0;
      if ((wordsHidden || resultVisible) && engine.testActive) {
        engine.flushCurrentWord(true);
        currentWordNr = null;
        engine.commitTest(getTestType(), detectLang());
      } else if (!wordsHidden && !resultVisible) {
        syncActiveWord();
      }
    });

    if (resultEl) obs.observe(resultEl, { childList: true, attributes: true, attributeFilter: ['style'] });
    obs.observe(row1, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  attach();
})();
