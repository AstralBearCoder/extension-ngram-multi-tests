(() => {
  'use strict';

  const { SurgicalEngine } = globalThis.__NgramEngine;
  const engine = new SurgicalEngine('typeracer', 'TypeRacer');

  let words = [];
  let wordIdx = 0;
  let boundInput = null;
  let lastPassage = '';

  function readPassage() {
    const row = document.querySelector('.inputPanel tr:first-child');
    if (!row) return '';
    return (row.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function initPassageIfChanged() {
    const passage = readPassage();
    if (!passage || passage === lastPassage) return;
    lastPassage = passage;
    words = passage.split(' ').filter(Boolean);
    wordIdx = 0;
    engine.resetTest();
    if (words.length > 0) {
      engine.startWord(words[0]);
    }
  }

  function getTestType() {
    return location.href.includes('practice') ? 'practice' : 'race';
  }

  function attachInput(input) {
    if (boundInput === input) return;
    boundInput = input;

    input.addEventListener('keydown', (e) => {
      if (!words.length) initPassageIfChanged();
      engine.onKeyDown(e);
    }, true);

    input.addEventListener('input', () => {
      if (!words.length) initPassageIfChanged();
      const val = input.value || '';

      // TypeRacer clears input after Space on a correctly typed word
      if (val === '' && engine.prevTypedLen > 0 && wordIdx < words.length - 1) {
        engine.flushCurrentWord(false);
        wordIdx += 1;
        engine.startWord(words[wordIdx]);
        return;
      }

      // Check completion on the very last word (no trailing space on TypeRacer)
      const currentTarget = words[wordIdx] || '';
      engine.onWordInput(val.endsWith(' ') ? val.slice(0, -1) : val);

      if (wordIdx === words.length - 1 && val === currentTarget && engine.testActive) {
        engine.flushCurrentWord(false);
        engine.commitTest(getTestType(), 'eng');
        lastPassage = '';
        words = [];
      }
    });
  }

  const domObserver = new MutationObserver(() => {
    const input = document.querySelector('.inputPanel input.txtInput');
    if (input && !input.disabled) {
      attachInput(input);
      initPassageIfChanged();
    } else if (boundInput && (!input || input.disabled) && engine.testActive) {
      engine.flushCurrentWord(true);
      engine.commitTest(getTestType(), 'eng');
      boundInput = null;
      lastPassage = '';
      words = [];
    }
  });

  domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
})();
