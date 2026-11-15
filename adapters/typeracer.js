(() => {
  'use strict';

  const { SurgicalEngine } = globalThis.__NgramEngine;
  const engine = new SurgicalEngine('typeracer', 'TypeRacer');

  let words = [];
  let wordIdx = 0;
  let lastPassage = '';
  let wasEnded = false;

  function isRaceInput(el) {
    return Boolean(
      el &&
      el.tagName === 'INPUT' &&
      el.type === 'text' &&
      el.classList.contains('bg-race-text-bg')
    );
  }

  function findRaceInput() {
    return document.querySelector('input.bg-race-text-bg[type="text"]');
  }

  function readPassage() {
    const card = document.querySelector('.bg-race-text-card-bg') || document;
    const chars = card.querySelectorAll('span[data-char-index]');
    if (!chars.length) return '';
    let text = '';
    for (let i = 0; i < chars.length; i++) {
      text += chars[i].textContent || '';
    }
    return text.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function detectLang() {
    const univ = new URLSearchParams(location.search).get('universe') || '';
    const um = univ.match(/^lang_([a-z]{2,3})$/i);
    if (um) return um[1];

    const langRe = /\b(English|French|Spanish|German|Italian|Portuguese|Polish|Russian)\b/i;
    const navMatch = (document.querySelector('header, nav, [role="banner"]')?.textContent || '').match(langRe);
    if (navMatch) return navMatch[1];

    const topMatch = (document.body.innerText || '').slice(0, 200).match(langRe);
    if (topMatch) return topMatch[1];

    const bodyText = document.body.textContent || '';
    const m2 = bodyText.match(/The text is in "([^"]+)"/i);
    return m2 ? m2[1] : 'english';
  }

  function syncPassage() {
    const passage = readPassage();
    if (!passage || passage === lastPassage) return;
    lastPassage = passage;
    words = passage.split(' ').filter(Boolean);
    wordIdx = 0;
    wasEnded = false;
    engine.resetTest();
    if (words.length > 0) {
      engine.startWord(words[0]);
    }
  }

  function getTestType() {
    return location.href.includes('practice') ? 'practice' : 'race';
  }

  function advanceIfClearedBySpace(inputEl) {
    if (
      !wasEnded &&
      engine.testActive &&
      engine.prevTypedLen > 0 &&
      inputEl.value === '' &&
      wordIdx < words.length - 1
    ) {
      engine.flushCurrentWord(false);
      wordIdx += 1;
      engine.startWord(words[wordIdx]);
    }
  }

  function finishRace(isPartial) {
    if (wasEnded || !engine.testActive) return;
    wasEnded = true;
    const lang = detectLang();
    engine.flushCurrentWord(isPartial);
    engine.commitTest(getTestType(), lang);
    lastPassage = '';
    words = [];
    wordIdx = 0;
  }

  window.addEventListener('keydown', (e) => {
    if (!isRaceInput(e.target)) return;
    if (!words.length) syncPassage();
    engine.onKeyDown(e);

    if (e.key === ' ') {
      const inputEl = e.target;
      queueMicrotask(() => advanceIfClearedBySpace(inputEl));
    }
  }, true);

  document.addEventListener('input', (e) => {
    if (!isRaceInput(e.target)) return;
    if (!words.length) syncPassage();
    if (!words.length) return;

    const inputEl = e.target;
    const rawVal = inputEl.value || '';

    if (rawVal === '' && !engine.lastKeyWasBackspace) {
      advanceIfClearedBySpace(inputEl);
      return;
    }

    const cleanVal = rawVal.endsWith(' ') ? rawVal.slice(0, -1) : rawVal;
    engine.onWordInput(cleanVal);

    const currentTarget = words[wordIdx] || '';
    if (wordIdx === words.length - 1 && cleanVal === currentTarget && engine.testActive) {
      finishRace(false);
      return;
    }

    if (rawVal.endsWith(' ') && !engine.lastKeyWasBackspace) {
      queueMicrotask(() => advanceIfClearedBySpace(inputEl));
    }
  }, true);

  const lifecycleObserver = new MutationObserver(() => {
    const input = findRaceInput();
    if (input && !input.disabled) {
      syncPassage();
    } else if (!wasEnded && engine.testActive && words.length > 0 && (!input || input.disabled)) {
      finishRace(true);
    }
  });

  lifecycleObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled']
  });
})();
