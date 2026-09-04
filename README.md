# BTR's Desk

A minimal, single-user tool for two problems: allocating/prioritizing time across
multiple projects, and capturing the important points from a meeting before they're lost.

## Running it

**Hosted (works from any machine):** https://bhuvan-teja.github.io/BTRDesk/ —
bookmark it, that's your daily entry point from now on. It's served straight
from this repo's `main` branch, so a push here updates it for every machine
you open that link from.

**Local, no install:** open [index.html](index.html) directly in your browser
(double-click it, or right-click → Open with → your browser) if you'd rather
not depend on GitHub Pages being up.

Either way — see the note below on what does and doesn't carry over between
the hosted version and a local copy.

## Where your data lives

Everything is stored in your browser's local storage, tied to the page's
**origin** (the hosted URL, or the local file's location) and the browser
you open it in. That means:

- It persists across restarts, closing the tab, etc.
- **The hosted link makes the app reachable from any machine — it does not
  by itself sync your tasks and notes between machines.** Two different
  computers opening `https://bhuvan-teja.github.io/BTRDesk/` each keep their
  own separate data, same as two different browsers would.
- Clearing your browser's site data / history will erase it.

**Moving data to another machine today:** see [sync/README.md](sync/README.md)
— Export backup, hand the file to this repo, Import it on the other end. It's
a manual round trip, but it needs nothing beyond a browser and this repo.

Real automatic sync across machines (so the same tasks and notes just show up
everywhere, no export/import step) would mean swapping local storage for a
small always-on data store — a private GitHub Gist accessed via the GitHub
API is the natural next step for this repo, since it stays free and doesn't
need a real backend. Not built yet; ask for it if the manual routine gets old.

Going further than that — real accounts, multiple people, login from any
device, no export/import at all — is a bigger step (a real backend, not just
a synced file). The full plan for that, if it's ever wanted, is in
[docs/multi-user-scaling-plan.md](docs/multi-user-scaling-plan.md): what's
needed, the target architecture, and the implementation/testing/deployment/
monitoring plans. Planning only — nothing in it is built.

Because of that last point: **use "Export backup" in the bottom-left corner every
so often** (weekly is plenty). It downloads a `btrdesk-backup-*.json` file. "Import"
in the same corner restores from one of those files — useful for moving to a new
machine or recovering from a wiped browser profile.

## Using it

- **Tasks** — one view, two parts: **Today** at the top (anything scheduled
  today or earlier and still undone), with a capacity bar (planned hours vs.
  your daily hours, default 8h) so overcommitting is visible immediately — a
  task left undone from a past date shows an **Overdue** chip instead of
  quietly disappearing — and **Upcoming** below it, everything scheduled for
  a future date, grouped by date. Give a task a future date (quick-capture or
  its edit modal) and it moves down into Upcoming instead of cluttering today.
  **Today only / Today + Upcoming**, next to the capacity bar, hides or shows
  the Upcoming section — Today's own list (and every other list — Upcoming,
  a project's page, Calendar) is always ordered by a task's **Time**
  (earliest first, midnight to 11:59 PM), with untimed tasks falling after
  the timed ones.
- **Notes** — meeting notes: title, attendees, key points, action items. Any
  action item has a **"→ Today"** button that turns it into a task in one click.
- **Top bar** — Tasks, Notes, Calendar and Analysis all sit in one group at
  the top right, next to "BTR's Desk"; they're four different views onto the
  same data, not a sequence of steps, so there's no default reading order
  between them.
- **Editing a task** — click anywhere on its row (title, project, badges — not
  the checkbox, ▶, or ✕). There's no separate edit icon anymore; the whole row
  is the button.
- **Rescheduling by drag** — anywhere tasks are grouped by date (Upcoming, a
  project's page), grab a task and drop it on a different date's group to move
  it there — no handle needed, since a real drag and a plain click (which
  still opens it for editing) never conflict with each other.
- **Calendar** — every open task, one colored chip per task per day, with a
  **Month / Week / Day** toggle above it. Month and Week both show chips —
  drag one onto another day to reschedule it exactly like the list views, or
  click a chip (without dragging) to edit that task. Day shows the full task
  rows for just that one date (checkbox, ▶, delete, click-to-edit — the same
  as everywhere else), useful when a day has too much going on for a chip to
  say much. **‹ ›** step by a month/week/day depending on the active mode,
  and **Today** jumps back to the current one; each mode remembers its own
  position independently, so paging Month forward doesn't move Day or Week.
- **Adding a task or note** — the **+** button, bottom right, on every screen.
  Hover it (or tap it) to reveal two options, **Task** and **Note**; picking
  either opens a full form (all fields — project, priority, hours, date and an
  optional time for a task; attendees, key points and action items for a note)
  as a pop-up. Nothing is created until you hit Save; Cancel discards it. Open
  the **+** from a specific project's page and the Project field is already
  set to that project instead of defaulting to your first one.
- **Task time** — Hours is the estimate (how long it'll take); the separate,
  optional **Time** field is when it's happening, entered on a 12-hour clock
  (2:30 PM, not 14:30) and shown that way on the task row too. Leave it blank
  for a task that isn't tied to a specific time of day.
- **Notes for this task** — every task's edit form has its own scratch
  space for "what to actually do here" — a 📝 shows on the row when it has
  something written. It's saved with the task and normally private to it:
  delete the task and whatever's in there goes with it, nothing left behind.
  **Persist** turns it into a real entry in the Notes section (titled with
  the task, tagged to the same project) and clears it from the task — from
  then on it's an independent note, unaffected by whatever happens to the
  task afterward.
- **Basic formatting** — this field and a note's **Key points** both have a
  small toolbar above them: **B** (bold), a bulleted list, and a numbered
  list. Select some text first for Bold; the list buttons work like a word
  processor's — turn the current line(s) into a list, or keep typing inside
  one to add more items. (Action items stay plain text, one per line, since
  each line is already its own checkbox row — formatting inside them isn't
  meaningful the same way.)
- **Projects** (left sidebar) — click `+` to add one, and ✎ (on hover) to
  rename/recolor/delete. **Click a row (including "All projects") to open it**:
  every open task and note tagged to it, with a **Tasks / Notes** toggle at the
  top. Tasks are grouped by date, oldest to newest, and each date has a **▾**
  to collapse or expand just that day's tasks; the checkbox, focus, click-to-edit
  and delete all work exactly like the Today view, and tasks here can be
  drag-and-dropped onto a different date the same way. Which mode (Tasks or
  Notes) you last used is remembered.
  **Reorder by dragging**: hover a row and grab the `⠿` handle on its left edge —
  that's the only spot that drags; clicking or dragging from anywhere else on the
  row opens the project instead, so nothing reorders by accident.
- **Completed** (bottom of the sidebar) — every task you've checked off, from
  every project, lives here instead of cluttering Today or a project page once
  it's done. Grouped by date with the same collapsible **▾** as project pages.
  **Clear bucket** permanently deletes everything in it (with a confirmation) —
  time already logged in Analysis isn't affected, since that's tracked
  separately from the task itself.
- **Search** — a bar pinned to the top of the main panel, above every view, so
  it's there no matter what you're looking at. Filters tasks and notes by
  keyword as you type. Press `/` anywhere to jump to it.

### Task alerts

Click **Enable alerts** at the bottom of the sidebar once, and any task with a
Time set gets a browser notification the moment that time arrives — the tag
below the button tells you which of three states you're in (grant it, it's
blocked, or your browser doesn't support it here).

Two honest limits, since this is still just a file with no server behind it:

- **The BTR's Desk tab has to be open somewhere** (another tab or a background
  window is fine — it doesn't have to be in front) **when the time hits.**
  Closed entirely, nothing fires; reopening it later doesn't back-fill missed
  alerts, it only schedules what's still ahead of you.
- If your browser ever blocks notifications for this page, re-enabling has to
  happen in the browser's own site settings — a page can't undo a block on
  itself.
- **Sidebar** — drag its right edge to widen it (useful for long project names),
  or click **« Hide** to hide it completely; **» Projects** in the top bar
  brings it back. Both the width and hidden state are remembered per browser.

### Focus mode

Each undone task has a large **▶** button next to it, and matching ✎ (edit) /
✕ (delete) buttons the same size right beside it — all three always visible,
none hidden behind a hover. Clicking ▶:

- Starts a live timer and pins a banner at the top of the app showing what
  you're focused on and the elapsed time — visible from any view (Today,
  Upcoming or Notes) so it's never out of sight.
- Locks out starting focus on any other task until this one is finished — the
  app only ever tracks one task at a time, on purpose.
- **Complete** stops the timer, marks the task done, and records how long it
  actually took. The task then shows both its original estimate and the
  difference — e.g. `-18m under` or `+22m over` — so estimates get sharper
  over time.
- **Cancel** (in the banner) discards the session without completing the task,
  in case you started the wrong one.

### Analysis

Every completed focus session is logged (project, date, actual duration). The
**Analysis** tab turns that log into two charts:

- **Today by project** — a doughnut of today's tracked time, split by project,
  with a legend (name, time, share) underneath.
- **Trend** — a bar chart of tracked hours, bucketed by **Day / Month / Year**
  (the "View by" control above it). Day view always starts from the 1st of the
  current month, Month view from January, Year view from your earliest tracked
  year — never a rolling window, so the range is always predictable. Today's
  (or the current month's/year's) bar carries its exact value as a direct label.

This only tracks time going forward — a task marked done by ticking its checkbox
(instead of running it through Focus mode) isn't timed, so it won't appear here.

The app opens with one example project/task/note so the layout isn't empty on
first run — edit or delete them, they're not special.

### A note on project colors

The six project colors are picked to stay distinguishable from each other —
including under color blindness — not just to look nice together, since they're
the only thing telling projects apart in the sidebar, task rows, and the
Analysis doughnut. If you had projects from an earlier version of this file,
their colors are remapped automatically to the new set the first time you open it.

## Changing your daily capacity

The 8h default lives in `app.js` — search for `capacity: 8` near the top of
`seedState()`. A settings UI for this wasn't worth the extra surface for a
single-user tool; edit the number and refresh if 8 isn't your number, or ask
for a settings field to be added if you'd rather not touch code.

## Roadmap (not built yet)

- Tags/labels beyond project
- Markdown export of notes
- Sync across devices (would need a small backend — bigger change, only worth it
  if you actually need the same data on your phone and laptop)
