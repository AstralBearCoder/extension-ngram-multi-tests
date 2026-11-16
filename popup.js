document.addEventListener('DOMContentLoaded', async () => {
  const S = globalThis.__NgramStorage;

  const quotaEl = document.getElementById('quota-label');
  const langFilterEl = document.getElementById('lang-filter');
  const selectAllEl = document.getElementById('select-all');
  const testsListEl = document.getElementById('tests-list');
  const actionsBarEl = document.getElementById('actions-bar');
  const confirmBarEl = document.getElementById('confirm-bar');
  const confirmMsgEl = document.getElementById('confirm-msg');
  const confirmYesBtn = document.getElementById('confirm-yes');
  const confirmNoBtn = document.getElementById('confirm-no');
  const btnExport = document.getElementById('btn-export');
  const btnClear = document.getElementById('btn-clear');
  const quRadios = document.querySelectorAll('input[name="quMode"]');
  const siteChecks = document.querySelectorAll('input[data-site]');

  let allTests = [];
  const selectedIds = new Set();
  let pendingConfirm = null;

  function closeConfirm(runCancel = true) {
    const cancel = pendingConfirm?.onCancel;
    pendingConfirm = null;
    confirmBarEl.hidden = true;
    actionsBarEl.hidden = false;
    if (runCancel && cancel) cancel();
  }

  function askConfirm(message, onConfirm, onCancel = null) {
    if (pendingConfirm) closeConfirm(true);
    pendingConfirm = { onConfirm, onCancel };
    confirmMsgEl.textContent = message;
    actionsBarEl.hidden = true;
    confirmBarEl.hidden = false;
  }

  confirmYesBtn.addEventListener('click', async () => {
    const fn = pendingConfirm?.onConfirm;
    closeConfirm(false);
    if (fn) await fn();
  });

  confirmNoBtn.addEventListener('click', () => closeConfirm(true));

  async function initPrefs() {
    const prefs = await S.getPrefs();
    quRadios.forEach((r) => {
      r.checked = (r.value === '1') === prefs.quAsOne;
    });
    siteChecks.forEach((cb) => {
      cb.checked = prefs.enabledSites[cb.dataset.site] !== false;
    });
  }

  function populateLangFilter(tests) {
    const prev = langFilterEl.value;
    const langs = Array.from(new Set(tests.map((t) => t.lang))).sort();
    langFilterEl.textContent = '';

    const allOpt = document.createElement('option');
    allOpt.value = 'ALL';
    allOpt.textContent = `All (${tests.length})`;
    langFilterEl.appendChild(allOpt);

    for (const l of langs) {
      const opt = document.createElement('option');
      opt.value = l;
      const count = tests.filter((t) => t.lang === l).length;
      opt.textContent = `${l.toUpperCase()} (${count})`;
      langFilterEl.appendChild(opt);
    }

    if (langs.includes(prev)) langFilterEl.value = prev;
    else langFilterEl.value = 'ALL';
  }

  function getFilteredTests() {
    const lang = langFilterEl.value;
    return lang === 'ALL' ? allTests : allTests.filter((t) => t.lang === lang);
  }

  function renderList() {
    const visible = getFilteredTests();
    testsListEl.textContent = '';

    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No recorded tests.';
      testsListEl.appendChild(empty);
      btnExport.disabled = true;
      btnClear.disabled = allTests.length === 0;
      selectAllEl.checked = false;
      return;
    }

    btnClear.disabled = false;
    let checkedVisible = 0;

    for (const t of visible) {
      const item = document.createElement('div');
      item.className = 'test-item';

      const label = document.createElement('label');
      label.className = 'test-label';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selectedIds.has(t.id);
      if (cb.checked) checkedVisible++;
      cb.addEventListener('change', () => {
        if (cb.checked) selectedIds.add(t.id);
        else selectedIds.delete(t.id);
        updateExportButton();
      });

      const info = document.createElement('div');
      info.style.minWidth = '0';
      const nameDiv = document.createElement('div');
      nameDiv.className = 'test-name';
      nameDiv.title = t.name;
      nameDiv.textContent = t.name;

      const metaDiv = document.createElement('div');
      metaDiv.className = 'test-meta';
      metaDiv.textContent = `${t.strokes} keystrokes · ${t.ngramCount} n-grams`;

      info.appendChild(nameDiv);
      info.appendChild(metaDiv);
      label.appendChild(cb);
      label.appendChild(info);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-del-one';
      delBtn.title = 'Delete this test';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', async () => {
        allTests = await S.deleteTest(t.id);
        selectedIds.delete(t.id);
        await refreshUI();
      });

      item.appendChild(label);
      item.appendChild(delBtn);
      testsListEl.appendChild(item);
    }

    selectAllEl.checked = checkedVisible === visible.length;
    updateExportButton();
  }

  function updateExportButton() {
    const visible = getFilteredTests();
    const count = visible.filter((t) => selectedIds.has(t.id)).length;
    btnExport.disabled = count === 0;
    btnExport.textContent = count > 0 ? `Export JSON (${count})` : 'Export JSON';
  }

  async function refreshUI() {
    allTests = await S.getIndex();
    if (selectedIds.size === 0 && allTests.length > 0) {
      allTests.forEach((t) => selectedIds.add(t.id));
    }

    const bytes = await S.getBytesInUse();
    const kb = Math.round(bytes / 1024);
    const sizeText = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
    quotaEl.textContent = `${allTests.length} test${allTests.length === 1 ? '' : 's'} · ${sizeText}`;
    quotaEl.className = (allTests.length >= 400 || bytes >= 4 * 1024 * 1024) ? 'quota warn' : 'quota';
    if (allTests.length >= 400) {
      quotaEl.title = 'Recommendation: export and clear before ~800 tests to stay safely within storage quota.';
    }

    populateLangFilter(allTests);
    renderList();
  }

  quRadios.forEach((r) => {
    r.addEventListener('change', async () => {
      if (!r.checked) return;
      const nextQu = r.value === '1';
      if (allTests.length === 0) {
        await S.switchQuMode(nextQu);
        return;
      }
      askConfirm(
        `Switching to qu = ${nextQu ? 1 : 2} will delete all ${allTests.length} recorded test(s). Continue?`,
        async () => {
          await S.switchQuMode(nextQu);
          selectedIds.clear();
          await refreshUI();
        },
        initPrefs
      );
    });
  });

  siteChecks.forEach((cb) => {
    cb.addEventListener('change', async () => {
      const prefs = await S.getPrefs();
      prefs.enabledSites[cb.dataset.site] = cb.checked;
      await S.setPrefs(prefs);
    });
  });

  langFilterEl.addEventListener('change', renderList);

  selectAllEl.addEventListener('change', () => {
    const visible = getFilteredTests();
    for (const t of visible) {
      if (selectAllEl.checked) selectedIds.add(t.id);
      else selectedIds.delete(t.id);
    }
    renderList();
  });

  btnExport.addEventListener('click', async () => {
    const lang = langFilterEl.value;
    const ids = getFilteredTests().filter((t) => selectedIds.has(t.id)).map((t) => t.id);
    const payload = await S.buildExportPayload(ids, lang);
    if (!payload) return;

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const suffix = lang === 'ALL' ? 'all' : lang;
    a.download = `ngramintl-${suffix}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  btnClear.addEventListener('click', () => {
    if (!allTests.length) return;
    askConfirm(
      `Permanently delete all ${allTests.length} recorded test(s)?`,
      async () => {
        await S.clearAllTests();
        selectedIds.clear();
        await refreshUI();
      }
    );
  });

  await initPrefs();
  await refreshUI();
});
