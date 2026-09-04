# Syncing your data between machines

BTR's Desk keeps its data in the browser (`localStorage`), scoped to whichever
machine and browser you're using — opening the hosted link on a second
computer starts with a blank slate, not your existing tasks. This folder is
where you hand data from one machine to another, using this GitHub repo as
the courier. It's manual (nothing auto-syncs) but it costs nothing and needs
no software beyond a browser.

The file to move around is always the same one: **`sync/backup.json`**.
Every time you push, you overwrite it; every time you pull, you replace your
local data with whatever's in it. Fixed filename on purpose — git's history
on this one file *is* your backup history, so there's no pile of
`btrdesk-backup-2026-09-04.json`, `...-05.json`, etc. to sort through.

## Option A — just the browser, no git needed (easiest on a new machine)

**Push (on the machine with your current data):**
1. Open BTR's Desk → **Export backup** (bottom-left of the sidebar). This
   downloads `btrdesk-backup-<date>.json` to your Downloads folder.
2. Go to [this repo's sync folder on github.com](https://github.com/Bhuvan-Teja/BTRDesk/tree/main/sync).
3. Click **Add file → Upload files**, drag in the file you just downloaded,
   and rename it to exactly `backup.json` before committing (GitHub will
   warn you it already exists — that's expected, confirm the replace).
4. Commit directly to `main`.

**Pull (on the machine you're moving to):**
1. Go to [`sync/backup.json`](https://github.com/Bhuvan-Teja/BTRDesk/blob/main/sync/backup.json)
   on github.com.
2. Click the **download** (⭳) button on the file view to save it locally.
3. Open BTR's Desk → **Import** (next to Export backup) → pick the file you
   just downloaded.

## Option B — git CLI (faster if you already have a clone)

**Push:**
```bash
# after Export backup in the app, move/rename the downloaded file into place
mv ~/Downloads/btrdesk-backup-*.json sync/backup.json
git add sync/backup.json
git commit -m "sync"
git push
```

**Pull:**
```bash
git pull
```
Then **Import** in the app and pick `sync/backup.json` from your clone.

## The one rule

**Always pull/download the latest `sync/backup.json` and Import it *before*
making new changes on a machine you haven't used in a while.** There's no
merge — whichever copy you push last wins, completely overwriting the other.
Fine for one person hopping between machines one at a time; easy to lose an
edit if you work on two machines in parallel without syncing in between.
