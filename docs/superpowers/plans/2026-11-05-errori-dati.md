# Errori nei dati di prima — piano (punto 1 di 5)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** four data bugs that predate the clean-up (kept unchanged by it on purpose) are fixed, each pinned by a replay test.

**Architecture:** the scripts stay as they are; each fix is the smallest change. Normal recorded runs must stay byte-identical;
only the runs that hit the bug change, and their expected files then come from the fixed script, checked by hand.

**Tech Stack:** Python 3.7 (Pi), requests 2.21, the recorder tests/registratore.py and tests/test_scarico.py.

**Spec:** none (bounded fixes). Source of the findings: docs/superpowers/plans/2026-11-04-pulizia-script-pi.ledger.md
(final review I4, ER finding of Task 15). The user asked for all four on 2026-11-05 ("procedi con tutti e 5 i punti").

## Global Constraints

- Python 3.7, no new libraries, JSON decoded from `r.content.decode('utf-8', 'replace')`, files with `encoding='utf-8'`.
- Names in English, comments in Italian and only for a why; scripts read top to bottom.
- Never touch `old/`; never ssh to the Pi; never push; files added by name, never `git add -A`.
- One commit per task, Italian message closed by `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Every other replay test stays green and byte-identical; never edit an expected file of a run the fix does not change.
- Suite: `/usr/bin/python3 -m unittest discover -s tests -t .` from the worktree root.

## Review Focus

1. A normal run (no failure) produces exactly the same files as before the fix (aria/normale, mare/acqven, others).
2. A failed BZ station never receives another station's values, and the other BZ stations are untouched.
3. One TN station without coordinates leaves every other TN station written.
4. MAR_VEN with a missing CPSM file still writes the variables of the files that arrived; MAR_ER and MAR_FVG unchanged.
5. ER asks for an instant on the quarter hour that is already measured (never in the future), and the file instant stays
   on the 15-minute grid; a reference sample exactly on a quarter hour is kept as is.

### Task 1: aria BZ, aria TN, mare VEN — a skipped item stays skipped without --debug

**Files:** Modify `dati_aria.py` (BZ station download failure ~:175; TN station without coordinates ~:253),
`dati_mare.py` (CPSM file download failure ~:93). Test: `tests/test_scarico.py`; new fixture runs
`tests/fixtures/scarico/aria/bz_errore/`, `tests/fixtures/scarico/aria/tn_senza_coordinate/`; regenerated expected of
`tests/fixtures/scarico/mare/reti/`.

The three bugs are one pattern: `if debug: print(...); continue` (or `...; files[name] = []`) puts the skip under the
`if`, so without `--debug` the loop goes on with the wrong data (BZ: the previous station's `data`; TN: `co` is None ->
TypeError stops all TN; mare: `files[name]` missing -> KeyError stops the VEN network).

- [ ] **Step 1: the failing runs.** Copy `aria/normale` to `aria/bz_errore` and make the timeseries response of ONE BZ
  station that is not the first one an HTTP 500 (as `pc/tutte_500` does for its response); copy `aria/normale` to
  `aria/tn_senza_coordinate` and add to the TN response one station whose name is not in `TN_COORDS` (keep the others).
  Expected files of both runs: the fixed behaviour — BZ: the failed station has no reading from this run, every other
  station byte-identical to `aria/normale`; TN: identical to `aria/normale`. `mare/reti` already records the VEN
  'livello' failure: its expected files gain MAR_VEN (the variables of the CPSM files that arrived), MAR_ER and MAR_FVG
  stay byte-identical. Tests `test_aria_bz_errore`, `test_aria_tn_senza_coordinate`; `test_mare_reti` keeps its name.
- [ ] **Step 2: run them, see them fail** (BZ: the failed station carries the previous station's values or the run
  crashes; TN: no AQ_TN files; mare: no MAR_VEN).
- [ ] **Step 3: fix** — the print stays under `if debug:`, the skip (`continue` / `files[name] = []`) is unconditional.
- [ ] **Step 4: run** the three tests, then the whole suite: all green, `aria/normale` and `mare/acqven` untouched.
- [ ] **Step 5: commit** "Dati: stazione BZ in errore o TN senza coordinate saltate anche senza --debug; MAR_VEN continua se manca un file".

### Task 2: ER — the instant of the run on the quarter hour

**Files:** Modify `dati_emilia_romagna.py` (`reference_time`, ~:54-69). Test: `tests/test_scarico.py` (+ a small unit
test of the rounding); re-recorded `tests/fixtures/scarico/emilia_romagna/normale/`.

Today the instant is the last sample of REF_STATION's level, every 5 minutes (e.g. 09:35): most ER stations measure every
15 minutes and have no value then, so a run inserts 6-17 readings instead of hundreds (measured in Task 15: 584 stations
at the quarter hour).

- [ ] **Step 1: test first** — the instant is the reference sample rounded DOWN to the quarter hour (09:35 -> 09:30,
  09:30 -> 09:30, 09:44:59 -> 09:30, 09:45 -> 09:45); pure function `quarter_hour(ms) -> ms`, tested directly.
- [ ] **Step 2: run it, see it fail** (ImportError / AttributeError).
- [ ] **Step 3: implement** `quarter_hour` and use it in `reference_time` (also on the "ora attuale" fallback).
- [ ] **Step 4: re-record** `emilia_romagna/normale` live with the fixed script (tests/registratore.py `registra`, then
  `attesi` from the fixed script — read the recorder's usage), and check by hand: the run inserts hundreds of readings
  (report the number), the file instant is on the quarter hour, the station list is plausible (~500+).
- [ ] **Step 5: run** the whole suite; commit "ER: l'istante del giro è il quarto d'ora già misurato (prima solo le poche
  stazioni a 5 minuti)".
