# Final whole-branch review — part 3 (e7f529f..67dbf6f)

Reviewer: opus, read-only, 2026-11-07. Inputs: spec, plan (Global Constraints, Review Focus), ledger (rulings and
parked minors), review-final-e7f529f..67dbf6f.diff, plus the old programs extracted from e7f529f and offline
experiments in the scratchpad (final-review/). Full suite not re-run (175 OK at 67dbf6f per the ledger).

### Summary

The ten programs, comune.py and the six downloader touch-ups do what the spec says. Old and new code read side by
side: the paths the nets cannot see (the real Pi archive, requests vs urllib, DST rules, concurrent writers, deploy
order) keep the old behaviour, and every change I found is either one of the spec's "Effetti accettati" or one the
ledger already ruled on. I found no Critical or Important issue. The Minors are: a deploy hazard (`.worktrees/` is
not excluded), two stale comments the ledger parked for Task 18 and never fixed, two folder helpers still outside
comune.py, WARN lines split between stdout and stderr, a slower plausibility path in climatology/Storico, pid-named
temporary files that no longer clean themselves up, and the accepted effects for the final report.

### Review Focus verdicts

1. **Strange archive files: OK.** `comune.load_json` catches ValueError/OSError/EOFError/zlib.error (comune.py:40).
   Experiment results: an empty, truncated, bad-CRC, Latin-1 or BOM file gives `{}` and one WARN line. `null`, a list
   or a number is returned as is and caught by the per-file guards (export_web.py:132-135, climatology.py:51-54,
   history.py:120-126; test_archivio covers a list record, a numeric ISTANTE and a string MISURE). `day_files` skips
   tmp, `latest`, upper-case and wrong-length names, and picks the `.json` over the `.json.gz` (comune.py:45-58).
   merge_readings starts from the `.json.gz` when the `.json` is missing (comune.py:192); with a corrupt `.gz` it
   writes only the new points, as designed. A day cannot normally end up with both a `.json` and a `.json.gz`: every
   writer stays within 8 days (write_parsed floor; AQ `days=None` fetches at most 7 days, dati_aria.py:107/144/187;
   recover 7; LIG/PIE nightly ≤8 before 07:20), while the 03:30 gzip only takes files untouched for more than 8 days.
2. **Solar vs civil: OK.** `is_dst_solar` matches the old `_ita_is_dst` at every 10-minute step 2025-2029 (0
   mismatches). One cutoff, `now_solar() - days`, drives the window, `prec_cutoff`, `drop_extra_prec` and the
   snapshot frames (export_web.py:73-79, 98, 259); test_finestra_in_ora_solare_d_estate pins it. The Storico takes
   `today` once in main (history.py:243) and uses RECENT_DAYS=8, so G-8..G are recomputed (history.py:42, 175).
   test_finestra_otto_giorni passes `today` explicitly. I re-derived the G-8 bound from recover (VEN k=1..7 from G-1;
   BZ/LOM 7 days) and from the PIE 3-day/7-hour and LIG nightly windows: it holds.
3. **urllib to requests: OK.** `comune.get_json` calls raise_for_status and decodes with 'utf-8','replace'. Parameters
   are encoded with the same urlencode/quote_plus as the old code (ER station ids, the LOM `$where` with quotes and
   spaces). Timeouts are carried over (90/60/45). check_updates `get_or_none` catches RequestException (requests
   2.21 wraps socket, SSL, protocol and body-timeout errors) and maps `not r.ok` to None. Recorded runs are
   byte-identical, including the BZ 500 and the AQ_TN 404, and the live ER and check_updates checks of Tasks 9-10
   passed.
4. **Subprocesses in tests: OK.** registratore.intercept_subprocess patches `subprocess.run` (logs the command) and
   `Popen` (raises) before the script runs. recover.py:260 and :276 are the only launches in the programs, with no
   os.system or os.popen anywhere. test_recover_tutte checks sottoprocessi.txt. The other suites run with RETE_VIETATA,
   the curl shim and GIT_ALLOW_PROTOCOL=file.
5. **Writes and state: OK.** recover writes through merge_readings and save_json (atomic, pid tmp). `.tracking/` goes
   through save_json (compact) and test_check_updates compares it decoded. status.py writes atomically with a pid tmp
   removed on failure, using json.dump defaults; test_main_scrive_status_json pins the bytes.
6. **Pi bash vs Mac bash, anchored excludes: OK.** The only new bash construct is a non-empty array (publish.sh:19),
   which is safe on bash 3.2 and 5. I dry-ran deploy_exclude.txt with the Mac's /usr/bin/rsync (openrsync, the
   deploy client). `/PIE/` and `/PC_PIE/zero_idrometrici.json` are excluded. `foo/PIE/zero_idrometrici.json` and the
   VEN zero file are still copied; the LOM and PC_PO ones are in TestDeploy. In the backup, `/history_out/` and
   `/history_cache/` are anchored, and the anti-delete guard counts only `*/data-parsed/*` (backup_usb.sh:46),
   so the smaller backup does not trip it.
7. **Incremental push: OK.** data_push() and the rc handling are byte-identical to e7f529f apart from the
   delta_names.py call. The delta_names.py body is identical to the old heredoc (diffed). The bash.json scenarios
   cover first run, unchanged, new data (data-inc parent = previous data), busy lock (rc 2), three failures (repo
   rebuilt) and the return.
8. **Python 3.7: OK.** A grep of every main-folder .py finds no 3.8+ API (removeprefix, math.prod/isqrt,
   cached_property, zoneinfo, BadGzipFile, `:=`, `f'{x=}'`, `dict[...]`). Dict insertion order is relied on and
   guaranteed in 3.7. test_python37 now covers `*.py`, including status.py and delta_names.py. Not run on a real 3.7:
   there is none on the Mac.
9. **Hot loop speed: OK, with a note.** On battery the whole export got faster: 7 days 32.7 → 26.7 s, 30 days
   28.7 → 16.1 s (the ledger has 18.9 → 15.3 s on AC). The checker on its own is ~35% slower per value (0.33 → 0.46
   s per 1M values). The climatology/Storico path is ~60% slower per value (0.50 → 0.80 s per 1M) because it
   converts the value twice (Minor 6). Climatology was not timed on a real archive.

### Issues

#### Critical

None.

#### Important

None.

#### Minor

1. **deploy_exclude.txt:25-28 — `.worktrees/` is not excluded.**
   - What: run from the main checkout, deploy.sh copies `.worktrees/programma-5-punti/` to the Pi. The openrsync dry
     run copies its `*.py`, `site/index.html` and `docs/`; tests/, .git and data are excluded by the unanchored
     patterns.
   - Trigger: deploying from /Users/manuelbogoni/Desktop/hydro/00_arpav while the worktree exists.
   - Effect: harmless clutter. Nothing on the Pi reads it: `*` globs skip dot folders and discover_regions filters
     names. It does add a few MB to every USB backup version.
   - Fix: add `.worktrees/` next to `.claude/`, plus a DEPLOY_TREE entry and a re-baselined bash.json; or deploy from
     the worktree. On the Pi, check `ls -a ~/METEO` for a stray `.worktrees/` left by earlier deploys.
2. **Deploy notes — copy order.**
   - What: rsync copies in name order. climatology.py lands before comune.py, and needs comune.day_files and
     value_key, which the old comune lacks. publish.sh lands before status.py and watchdog*.yml.
   - Trigger: a run starting in the few seconds of the copy. Climatology would fail with AttributeError. publish.sh
     would print "ATTENZIONE: status.json non aggiornato" and push gh-pages without watchdog.yml and
     watchdog_storico.yml, which heals at the next page push (10 min).
   - Running bash scripts are safe: rsync renames, it does not overwrite in place. check_updates.py is safe too: it
     uses only old comune functions.
   - Fix (wording only): run deploy.sh at a minute with no :x5 publish and not at 04:10, e.g. hh:01 or hh:11. Remove
     `~/METEO/watchdog_actions.yml` and `~/METEO/site/FVG/stations_nocoord.csv` after the copy, not before: the old
     publish.sh still reads the old watchdog name.
3. **dati_aria.py:5, dati_pc.py:38-39 — stale comments** that the ledger parked for Task 18 (Task 6 ruling) and that
   were not fixed.
   - dati_aria.py:5: "basta aggiungerla a REGION_CFG". The list is now `REGIONS`, export_web.py:27.
   - dati_pc.py:38-39: "i doppioni con ER/LOM li toglie export_web alla pubblicazione". export_web never deduplicates;
     PC_PO is published whole by the user's choice (export_web.py:24-26).
   - Fix: two comment lines.
4. **history.py:37, check_updates.py:24 — folder helpers outside comune.py.**
   - What: `BASE = dirname(realpath(__file__))` and `_BASE_DIR` remain. Spec criterion 1 lists "cartelle" among the
     tools to define once.
   - Effect: history resolves the project with realpath, while export, climatology and recover use comune.BASE
     (abspath). The path is the same on the Pi; only a symlinked layout would make them read different trees.
   - Fix: use comune.BASE/region_dir; test_history patches `history.BASE` and needs adjusting.
5. **comune.py:37,41 vs export_web.py:135,167, climatology.py:54, history.py:125 — WARN lines on two streams.**
   - What: load_json's WARN lines go to stdout (accepted by the spec); "WARN: file saltato" and "derivate non
     calcolate" go to stderr.
   - Effect: both reach the same cron log. With output redirected, Python 3.7 buffers both streams, so the skip lines
     arrive in a separate chunk away from their region header. Cosmetic: the path in each line still names the region.
   - Fix: one stream for all WARN lines.
6. **climatology.py:29-30, history.py:84-85 — plausibility converts twice.**
   - What: `comune.to_float(v)` is followed by `quality.valid(var, value)`, which calls to_float again and looks up the
     limits for every value. quality.checker exists for exactly this and is used only by the export.
   - Effect: ~60% more per value in the micro-benchmark. Climatology reads the whole archive at 04:10, and
     `history.py --full` does too.
   - Fix: `ok = quality.checker(var)` once per variable, or at least time climatology on the Pi after deploy, next to
     the 07:20 Storico time the notes already ask for.
7. **comune.py:72 — pid-named tmp files no longer clean themselves up.**
   - What: a writer killed mid-write leaves `X.json.<pid>.tmp`, and the next writer does not overwrite it (the old
     fixed name was reused).
   - Already covered: data-parsed/ and site/ (03:15 `find '*.tmp' -mtime +1`, info/exclude `*.tmp`, backup
     `--exclude='*.tmp'`) and history_out/<REG>/ (write_region).
   - Not covered: the history_out/ root (an `index.json.<pid>.tmp` would be `git add -A`'d onto the history branch),
     history_cache/ and .tracking/.
   - Trigger: rare, a kill inside the write. Fix: add those three folders to the 03:15 find, or accept.
8. **Accepted effects missing from the spec's list.** The ledger asks for these in the final report:
   - recover rewrites an unreadable stazioni.json: `{}` for BZ/ER, only the window's stations for LOM (old: ERRORE,
     nothing written). It heals at the next downloader run.
   - check_updates reports every station as new once after an unreadable `.tracking` state.
   - check_updates `get_json_or_none` decodes with 'utf-8','replace', so a UTF-8 BOM now reads as None (old
     json.loads(bytes) accepted it). The live pair shows no BOM today.
   - export `-r` is stricter (argparse choices), and so are day-file names (`TEMP-latest.json` is no longer read).
   - A UMID series that is all zeros now drops out of the 30-day CSV, together with a station left with no series.
9. **Open minors the ledger deferred to this review.**
   - Task 15: test_avviso_storico checks only the title prefix; history_status catches only OSError; `giorni` goes
     negative if the Pi clock is ahead; no end-to-end touch → mtime → status.json test through publish.sh; one failed
     raw fetch at 08:35 UTC mails 'status illeggibile' (shared scheme).
   - Task 5: derive.py has a double blank line in `_derive_instant` and a misaligned comment on the PREC `put`.
   - Task 12: docs/ and deploy_exclude.txt still reach the Pi.
10. **Optional read-only Pi pre-check.** day_files now makes the `.json` win for the 30-day export and climatology as
    well. The spec says no day has both files, and a one-liner proves it before the first 30-day export:
    `cd ~/METEO && for f in */data-parsed/*/*.json.gz; do [ -e "${f%.gz}" ] && echo "$f"; done | head`.

### Declined to judge

- **The Pi's real state.** I cannot check whether `~/METEO/.worktrees` exists, whether any `.json` + `.json.gz` pairs
  exist, what fsync costs on the SD card, or the cron TZ and locale (status.py writes history.last in local time and
  assumes Europe/Rome, like the cron times).
- **Runtime behaviour I could not run:** Python 3.7 itself, live requests vs urllib beyond the recorded runs (I relied
  on the ledger's live checks), and a GitHub Actions run of watchdog_storico.yml.
- **Pre-existing behaviour, not regressions:**
  - BZ never recovers the current day.
  - data-inc stays stale after a repo rebuild.
  - A failed data push skips the page push.
  - climate.json order follows the hash seed.
  - Lost updates between recover and the downloaders (no lock).
  - Export and Storico have no per-region guard.
  - A recover run with the network down costs ~5 s per call (accepted retry; bounded by the outage).
- **Out of scope:** the climatology vs Storico daily rules (the user's decision), and site/ and tests/web (the UI
  work). site/index.html at 67dbf6f is the live 3e0ea5bd, so the deploy changes the page only through the watchdogs.

### Assessment

**Ready to deploy.** Before or at the copy (none blocking): exclude `.worktrees/` or deploy from the worktree (Minor
1); copy at a minute with no :x5 publish and not at 04:10, and remove the two leftover files after the copy (Minor 2);
optionally run the pair check (Minor 10).
