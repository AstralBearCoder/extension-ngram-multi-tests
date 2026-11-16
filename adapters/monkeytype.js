(() => {
  'use strict';

  const { SurgicalEngine } = globalThis.__NgramEngine;
  const engine = new SurgicalEngine('monkeytype', 'Monkeytype');

  let activeWordEl = null;
  let flushedWordEl = null;
  let wasEnded = false;

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

  function isTypingContext(target) {
    if (!target || target === document.body || target === document.documentElement) return true;
    if (target.id === 'wordsInput') return true;
    const tag = target.tagName;
    return tag !== 'INPUT' && tag !== 'TEXTAREA' && !target.isContentEditable;
  }

  function getConfig() {
    try {
      return JSON.parse(localStorage.getItem('config') || '{}');
    } catch {
      return {};
    }
  }

  function getTestType(cfg) {
    const domType = document.querySelector('#result .stats .testType .bottom')?.textContent;
    if (domType) {
      const clean = domType.replace(/\s+/g, ' ').trim();
      if (clean) return clean;
    }
    const mode = cfg.mode || 'time';
    if (mode === 'time') return `time ${cfg.time || 30}s`;
    if (mode === 'words') return `words ${cfg.words || 25}`;
    return mode;
  }

  function isResultVisible(resultEl) {
    if (!resultEl) return false;
    return !resultEl.classList.contains('hidden') && window.getComputedStyle(resultEl).display !== 'none';
  }

  function syncActiveWord() {
    const current = document.querySelector('#words .word.active');
    if (!current || current === flushedWordEl) return null;
    if (current !== activeWordEl) {
      if (activeWordEl && engine.testActive) {
        flushedWordEl = activeWordEl;
        engine.flushCurrentWord(false);
      }
      activeWordEl = current;
      engine.startWord(readTargetWord(current));
    }
    return current;
  }

  function handleTestEnd() {
    if (!engine.testActive) return;

    const activeText = engine.targetWord;
    const completedLastWord = Boolean(activeText && engine.prevTypedLen >= activeText.length);
    engine.flushCurrentWord(!completedLastWord);
    activeWordEl = null;
    flushedWordEl = null;

    const cfg = getConfig();
    engine.commitTest(getTestType(cfg), cfg.language || 'english');
  }

  window.addEventListener('keydown', (e) => {
    if (!isTypingContext(e.target)) return;

    if (e.key === 'Tab' || e.key === 'Escape') {
      activeWordEl = null;
      flushedWordEl = null;
      wasEnded = false;
      engine.resetTest();
      return;
    }

    if (isResultVisible(document.getElementById('result'))) return;

    if (e.key === ' ') {
      if (engine.testActive && activeWordEl) {
        flushedWordEl = activeWordEl;
        engine.flushCurrentWord(false);
        activeWordEl = null;
      }
      return;
    }

    syncActiveWord();
    engine.onKeyDown(e);
  }, true);

  document.addEventListener('input', (e) => {
    if (!e.target || e.target.id !== 'wordsInput') return;
    if (isResultVisible(document.getElementById('result'))) return;

    const current = syncActiveWord();
    if (!current) return;

    const raw = e.target.value || '';
    const clean = (raw.startsWith(' ') && !engine.targetWord.startsWith(' ')) ? raw.slice(1) : raw;
    engine.onWordInput(clean);
  }, true);

  const lifecycleObserver = new MutationObserver(() => {
    const nowEnded = isResultVisible(document.getElementById('result'));
    if (nowEnded && !wasEnded) {
      wasEnded = true;
      handleTestEnd();
    } else if (!nowEnded) {
      wasEnded = false;
    }
  });

  lifecycleObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class']
  });
})();