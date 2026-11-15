# ngramIntl — Multi-Test Sync

> A lightweight Chrome & Firefox extension that records your typing speed and mistakes on Monkeytype, TypeRacer, and 10FastFingers, and exports them to **[ngramInternational](https://astralbearcoder.github.io/ngrams-international-3.0/)**.

[![Companion App](https://img.shields.io/badge/companion-ngrams--international--3.0-34d399?style=for-the-badge&logo=googlechrome&logoColor=white)](https://astralbearcoder.github.io/ngrams-international-3.0/)
[![Version](https://img.shields.io/badge/version-2.0.0-facc15?style=for-the-badge)](https://github.com/AstralBearCoder/extension-ngram-multi-tests)
[![Manifest](https://img.shields.io/badge/Manifest-V3%20(Chrome%20%26%20Firefox)-88c0d0?style=for-the-badge)](https://github.com/AstralBearCoder/extension-ngram-multi-tests)
[![Zero Deps](https://img.shields.io/badge/dependencies-zero%20npm-blue?style=for-the-badge&logo=javascript&logoColor=white)](https://github.com/AstralBearCoder/extension-ngram-multi-tests)

Most typing tests only give you an overall WPM score. This extension tracks every 2-, 3-, and 4-letter combination (n-gram) while you type on other websites, so you can spot your real weak spots and practice them inside [ngramInternational](https://github.com/AstralBearCoder/ngrams-international-3.0).

## At a Glance

| | |
| :--- | :--- |
| ⏱️ **Key-by-key timing** | Times every keystroke individually instead of guessing from whole words |
| 🎯 **Clean speed vs. errors** | Mistakes and `Backspace` fixes count as errors without dragging down your speed score |
| 🌐 **3 typing sites** | Works on **Monkeytype**, **TypeRacer**, and **10FastFingers** (turn each one on or off anytime) |
| 🌍 **8 languages + `qu=1`** | English, French, Spanish, German, Italian, Portuguese, Polish, and Russian |
| 🗂️ **Test manager** | Every test is named by site, mode, language, and date — delete one test or export only one language |
| 🔒 **100 % local** | Everything stays inside your browser — no account, no server, no tracking |

---

## Quick Start

1. **Install the extension:**
   - **Chrome / Edge / Brave:** open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select this folder.
   - **Firefox (109+):** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and pick `manifest.json`.
2. **Take tests as usual** on Monkeytype, TypeRacer, or 10FastFingers.
3. **Export your data:** open the extension popup, pick a language (or keep all tests), click **Export JSON**, and import the file into **ngramInternational** (*Profile → Import*).

---

## How It Works

1. **You take a typing test.** The extension quietly watches only the typing sites you enabled.
2. **It times every letter transition.** Instead of dividing a whole word's time by its length, it records the real time between each key you press.
3. **Mistakes don't fake your speed.** If you hit the wrong key or press `Backspace`, that n-gram is marked as an error, and its messy timing is left out of your speed average.
4. **You choose what to export.** Tests are saved one by one, so you can delete bad runs, filter by language, and export whenever you're ready.

---

## What Changed Since v1.0

| | `v1.0` | `v2.0.0` |
| :--- | :--- | :--- |
| **Sites** | Monkeytype only | **Monkeytype, TypeRacer, 10FastFingers** |
| **Timing** | Estimated from total word time | **Measured keystroke by keystroke** |
| **Word length** | Only 2–4 letter words | **All words** (2+ letters), including the final word |
| **Mistakes** | Slowed down average timing | **Kept separate** from clean speed |
| **`qu=1` option** | Missing export separation | **`qu = 1` / `qu = 2` switch** built into the popup |
| **Test control** | One big combined blob | **Individual test list** with delete & language filter |
| **Browsers** | Chrome only | **Chrome + Firefox** |

---

# Deep Dive

<details>
<summary><b>📐 1. How mistakes and Backspace work (example)</b></summary>

<br>

Suppose the word is `"the"`, and you type `t` → `x` (typo) → `Backspace` → `h` → `e`:

- **`th`**: marked as **1 error** (0 ms added to speed), because you missed `'h'` and had to fix it.
- **`he`**: timed **normally** (`e` minus `h`), because you typed both letters cleanly right after recovering.
- **`the`**: marked as **1 error** (0 ms added to speed), because the word had a fix in the middle.

Very short glitches (`< 15 ms`) and long pauses where you stopped typing (`> 3.5 s`) are ignored so they don't skew your stats.

</details>

<details>
<summary><b>📦 2. Storage & Export Format (<code>fmt: 5</code>)</b></summary>

<br>

- Each test takes about **5 KB** of browser storage (**2.34 MB** for 500 tests out of Chrome's 10 MB limit).
- The popup shows a gentle reminder once you pass **400 tests** (or **4 MB**) so you can export and clear old tests.
- Switching between **`qu = 1`** and **`qu = 2`** clears saved tests (after asking you to confirm) so both counting styles never get mixed.
- When `qu = 1` is on, exported languages include `_qu` (like `eng_qu` or `fra_qu`) to match `ngrams-international-3.0`.

</details>

<details>
<summary><b>🧪 3. Running Tests & Building a Zip</b></summary>

<br>

Requires **Node.js 18+** (no packages to install):

```bash
# Run unit tests and 500-test storage benchmark
node verify.mjs

# Package the extension into a .zip
zip -r ngramintl-sync-v2.0.0.zip manifest.json icons/ core/ adapters/ popup.html popup.js content.css
