(function () {
  'use strict';

  var STORE_KEY = 'btrdesk-data-v1';
  var UI_WIDTH_KEY = 'btrdesk-sidebar-width';
  var UI_COLLAPSED_KEY = 'btrdesk-sidebar-collapsed';
  var COLORS = ['#0E8A72', '#C1592E', '#3B6EA5', '#B98A1F', '#5C7A33', '#8A4A96'];
  // Superseded palette (kept only so migrate() can remap existing projects created
  // before this set was validated for CVD-safe pairwise contrast — see README).
  var LEGACY_COLORS = ['#1F5D50', '#B5502D', '#C9A227', '#3D5A80', '#6B4E71', '#6E7B3D'];
  var PRIORITY_ORDER = { high: 0, med: 1, low: 2 };
  // Within a day, a task with a scheduled Time sorts by that clock time
  // (00:00 -> 23:59); a task with no Time set has no slot on the clock, so
  // it falls after every timed task for that day, with priority breaking
  // ties either way — same tiebreak rule used everywhere before this.
  function compareByTimeThenPriority(a, b) {
    var ta = a.startTime || '24:00', tb = b.startTime || '24:00';
    return (ta < tb ? -1 : ta > tb ? 1 : 0) || (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  // Every touch of localStorage goes through these two — some browsers
  // (locked-down corporate profiles especially) throw the moment
  // localStorage is even read, not just when it's full or disabled. An
  // unguarded call anywhere near the top of the file would throw during
  // initial script execution and silently take every button below it with
  // it, so nothing — task creation included — would ever respond. Falling
  // back to an in-memory value keeps the app usable for that session; it
  // just won't remember prefs (or data — see load/save) across reloads.
  function safeGet(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
  }

  // Local calendar date, not UTC — toISOString() reports the UTC date, which
  // is still "yesterday" for part of every day in any timezone ahead of UTC
  // (e.g. IST, UTC+5:30, until 5:30am local), so today's own tasks would
  // wrongly file under Upcoming until the UTC day caught up.
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function todayLabel() {
    var d = new Date();
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function formatHMS(totalSeconds) {
    totalSeconds = Math.max(0, Math.floor(totalSeconds));
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = totalSeconds % 60;
    return h > 0 ? (h + ':' + pad2(m) + ':' + pad2(s)) : (pad2(m) + ':' + pad2(s));
  }
  function formatDurationShort(totalSeconds) {
    totalSeconds = Math.max(0, Math.round(totalSeconds));
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm';
    return totalSeconds + 's';
  }
  // "HH:MM" (24h, as stored by <input type="time">) -> "2:30 PM" — always
  // 12-hour with AM/PM, regardless of the browser's own locale rendering.
  function formatTime12h(hhmm) {
    if (!hhmm) return '';
    var parts = hhmm.split(':');
    var h = parseInt(parts[0], 10);
    var m = parts[1] || '00';
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + m + ' ' + ampm;
  }

  function seedState() {
    var today = todayISO();
    return {
      capacity: 8,
      focusTaskId: null,
      sessions: [],
      projects: [
        { id: 'p1', name: 'Example Project', color: COLORS[0] }
      ],
      tasks: [
        { id: 't1', title: 'Check this off, then add your own task with the + button', projectId: 'p1', priority: 'med', time: 1, date: today, startTime: null, taskNotes: '', done: false, focusStartedAt: null, actualSeconds: null }
      ],
      notes: [
        {
          id: 'n1', title: 'Example meeting note — delete me', date: today, projectId: 'p1', attendees: '—',
          pointsHtml: '<ul><li>Use the + button (bottom right) → Note to capture attendees, key points and action items.</li>'
            + '<li>Select text in Key points to try <b>Bold</b>, or a bullet/numbered list from the toolbar above it.</li>'
            + '<li>Action items below can be converted straight into a task.</li></ul>',
          actions: [{ text: 'Try converting this into a task', done: false, converted: false }]
        }
      ]
    };
  }

  function migrate(s) {
    var today = todayISO();
    s.capacity = s.capacity || 8;
    if (s.focusTaskId === undefined) s.focusTaskId = null;
    if (!Array.isArray(s.sessions)) s.sessions = [];
    (s.projects || []).forEach(function (p) {
      var legacyIdx = LEGACY_COLORS.indexOf(p.color);
      if (legacyIdx !== -1) p.color = COLORS[legacyIdx % COLORS.length];
    });
    (s.tasks || []).forEach(function (t) {
      if (!t.date) t.date = today;
      if (t.focusStartedAt === undefined) t.focusStartedAt = null;
      if (t.actualSeconds === undefined) t.actualSeconds = null;
      if (t.startTime === undefined) t.startTime = null;
      if (t.taskNotes === undefined) t.taskNotes = '';
    });
    // Key points moved from an array of plain-text lines to a single rich-
    // text HTML blob (so Bold/bullet/numbered formatting has somewhere to
    // live) — fold any pre-existing plain lines into an equivalent list.
    (s.notes || []).forEach(function (n) {
      if (n.pointsHtml === undefined) {
        n.pointsHtml = (Array.isArray(n.points) && n.points.length)
          ? '<ul>' + n.points.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>'
          : '';
      }
      delete n.points;
    });
    // guard against a stale focusTaskId pointing at a missing/completed task
    if (s.focusTaskId) {
      var active = (s.tasks || []).find(function (t) { return t.id === s.focusTaskId && t.focusStartedAt; });
      if (!active) s.focusTaskId = null;
    }
    return s;
  }

  function load() {
    try {
      var raw = safeGet(STORE_KEY, null);
      if (raw) return migrate(JSON.parse(raw));
    } catch (e) { /* ignore, fall through to seed */ }
    return seedState();
  }
  function save() {
    try { safeSet(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  var state = load();
  var filter = { view: 'tasks', project: 'all', query: '' };
  var idSeq = Date.now();
  function nextId(prefix) { idSeq += 1; return prefix + idSeq; }

  // ---------- helpers ----------
  function projectById(id) {
    for (var i = 0; i < state.projects.length; i++) if (state.projects[i].id === id) return state.projects[i];
    return { id: id, name: 'Unknown project', color: '#9B998C' };
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function matches(text) {
    if (!filter.query) return true;
    return String(text).toLowerCase().indexOf(filter.query) !== -1;
  }

  // ---------- tiny rich-text editor (Bold / bullet / numbered list) ----------
  // Used for the two prose-style fields — a task's own notes, and a
  // meeting note's key points — not the list-of-discrete-items fields
  // (action items) where each line is its own interactive checkbox row.
  var RICH_ALLOWED_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, UL: 1, OL: 1, LI: 1, BR: 1, DIV: 1, P: 1, SPAN: 1 };
  function sanitizeRichHtml(html) {
    var root = document.createElement('div');
    root.innerHTML = html || '';
    (function clean(node) {
      Array.from(node.childNodes).forEach(function (child) {
        if (child.nodeType === 1) {
          clean(child); // sanitize descendants before deciding this tag's own fate
          if (RICH_ALLOWED_TAGS[child.tagName]) {
            Array.from(child.attributes).forEach(function (a) { child.removeAttribute(a.name); });
          } else {
            // Not a formatting tag we support — drop the tag but keep its
            // (already-cleaned) contents rather than losing the text.
            while (child.firstChild) node.insertBefore(child.firstChild, child);
            node.removeChild(child);
          }
        } else if (child.nodeType !== 3) {
          node.removeChild(child); // comments etc.
        }
      });
    })(root);
    return root.innerHTML;
  }
  function stripHtml(html) {
    var d = document.createElement('div');
    d.innerHTML = html || '';
    return d.textContent || '';
  }
  function richEditorHtml(id, valueHtml, placeholder) {
    return '<div class="rich-toolbar" data-for="' + id + '">'
      + '<button type="button" data-cmd="bold" title="Bold"><b>B</b></button>'
      + '<button type="button" data-cmd="insertUnorderedList" title="Bulleted list">≣ •</button>'
      + '<button type="button" data-cmd="insertOrderedList" title="Numbered list">≣ 1.</button>'
      + '</div>'
      + '<div class="rich-input" id="' + id + '" contenteditable="true" data-placeholder="' + esc(placeholder) + '">' + (valueHtml || '') + '</div>';
  }
  // Buttons act on the current selection in the editor, so the mousedown has
  // to be prevented (not the click) — otherwise focus jumps to the button
  // first and the text selection is already gone by the time execCommand runs.
  function wireRichToolbar(toolbarEl) {
    toolbarEl.addEventListener('mousedown', function (e) {
      var btn = e.target.closest('button[data-cmd]');
      if (!btn) return;
      e.preventDefault();
      document.execCommand(btn.dataset.cmd, false, null);
    });
  }
  function updateRichEmptyState(el) {
    el.classList.toggle('is-empty', !el.textContent.trim());
  }
  function initRichEditor(id) {
    var toolbar = document.querySelector('.rich-toolbar[data-for="' + id + '"]');
    var input = document.getElementById(id);
    wireRichToolbar(toolbar);
    updateRichEmptyState(input);
    input.addEventListener('input', function () { updateRichEmptyState(input); });
  }
  function richValue(id) {
    return sanitizeRichHtml(document.getElementById(id).innerHTML);
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function fmtDateLong(iso) {
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // ---------- task row (shared by Today + Upcoming) ----------
  function taskRowHtml(t, opts) {
    var draggable = !!(opts && opts.draggable);
    var p = projectById(t.projectId);
    var isFocusing = state.focusTaskId === t.id;
    var focusLocked = !!state.focusTaskId && !isFocusing;
    var today = todayISO();

    var overdueChip = (!t.done && t.date < today) ? '<span class="chip-overdue">Overdue ' + fmtDate(t.date) + '</span>' : '';
    var clockHtml = t.startTime ? '<span class="task-clock">' + formatTime12h(t.startTime) + '</span>' : '';
    var noteFlag = t.taskNotes ? '<span class="task-note-flag" title="Has notes — open Edit to view or persist them">📝</span>' : '';

    var trailingHtml;
    if (t.done && t.actualSeconds != null) {
      var estSec = t.time * 3600;
      var diff = t.actualSeconds - estSec;
      var cls = Math.abs(diff) < 60 ? 'onmark' : (diff > 0 ? 'over' : 'under');
      var label = Math.abs(diff) < 60 ? 'On estimate' : (diff > 0 ? '+' + formatDurationShort(diff) + ' over' : '-' + formatDurationShort(-diff) + ' under');
      trailingHtml = '<span class="task-time">' + t.time + 'h est.</span>'
        + '<span class="badge-actual ' + cls + '" title="Estimated ' + t.time + 'h · actual ' + formatDurationShort(t.actualSeconds) + '">' + label + '</span>';
    } else {
      trailingHtml = '<span class="task-time">' + t.time + 'h</span>';
    }

    var focusHtml = '';
    var secondaryActions = '<span class="task-actions">'
      + '<button type="button" class="icon-btn danger" data-action="delete-task" data-id="' + t.id + '" aria-label="Delete task">✕</button>'
      + '</span>';
    if (!t.done) {
      focusHtml = isFocusing
        ? '<span class="focus-flag">● Focusing</span>'
        : '<button type="button" class="focus-start-btn" data-action="focus-task" data-id="' + t.id + '" ' + (focusLocked ? 'disabled title="Finish your current focus session first"' : 'title="Start focus"') + '>▶</button>';
    }

    return '<li class="task ' + (t.done ? 'done' : '') + ' ' + (isFocusing ? 'focusing' : '') + '" data-id="' + t.id + '" title="Click to edit"' + (draggable ? ' draggable="true"' : '') + '>'
      + '<button type="button" class="check" data-action="toggle-task" data-id="' + t.id + '" aria-label="Mark done">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round"><path d="M4 12l6 6L20 6"/></svg></button>'
      + '<span class="dot" style="background:' + p.color + '"></span>'
      + '<span class="task-title">' + esc(t.title) + '</span>'
      + noteFlag
      + overdueChip
      + '<span class="task-project">' + esc(p.name) + '</span>'
      + '<span class="badge badge-' + t.priority + '">' + ({ high: 'High', med: 'Med', low: 'Low' }[t.priority]) + '</span>'
      + clockHtml
      + trailingHtml
      + focusHtml
      + secondaryActions
      + '</li>';
  }

  // ---------- rendering ----------
  function renderProjectList() {
    var counts = { all: 0 };
    var completedCount = 0;
    state.projects.forEach(function (p) { counts[p.id] = 0; });
    state.tasks.forEach(function (t) {
      if (t.done) { completedCount++; return; }
      if (counts.hasOwnProperty(t.projectId)) { counts.all++; counts[t.projectId]++; }
    });

    var isProjectView = filter.view === 'project';
    var html = '<li class="project ' + (isProjectView && filter.project === 'all' ? 'active' : '') + '" data-project="all">'
      + '<span class="drag-handle" aria-hidden="true"></span>'
      + '<span class="dot" style="background:var(--text-faint)"></span>'
      + '<span class="name">All projects</span>'
      + '<span class="count">' + counts.all + '</span></li>';

    state.projects.forEach(function (p) {
      html += '<li class="project ' + (isProjectView && filter.project === p.id ? 'active' : '') + '" data-project="' + p.id + '">'
        + '<span class="drag-handle" title="Drag to reorder" aria-hidden="true">⠿</span>'
        + '<span class="dot" style="background:' + p.color + '"></span>'
        + '<span class="name">' + esc(p.name) + '</span>'
        + '<span class="count">' + counts[p.id] + '</span>'
        + '<span class="project-actions">'
        + '<button type="button" class="icon-btn" data-action="edit-project" data-id="' + p.id + '" aria-label="Edit project">✎</button>'
        + '</span>'
        + '</li>';
    });
    document.getElementById('projectList').innerHTML = html;

    document.getElementById('completedCount').textContent = completedCount;
    document.getElementById('completedBucketBtn').classList.toggle('active', filter.view === 'completed');
  }

  // "Today only" vs "Today + Upcoming" — just hides/shows the Upcoming
  // section below Today's list; doesn't change what counts as "today"
  // (a still-undone task from an earlier date stays visible as Overdue).
  var TASK_SCOPE_KEY = 'btrdesk-task-scope';
  var taskScope = safeGet(TASK_SCOPE_KEY, 'all');
  if (['today', 'all'].indexOf(taskScope) === -1) taskScope = 'all';

  function applyTaskScope() {
    document.querySelectorAll('#taskScopeControl button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.taskScope === taskScope);
    });
    document.getElementById('upcomingSection').hidden = taskScope === 'today';
  }

  function renderTasks() {
    applyTaskScope();
    var today = todayISO();
    // Completed tasks live in the Completed bucket now, not inline here.
    var list = state.tasks.filter(function (t) {
      if (t.done) return false;
      if (filter.project !== 'all' && t.projectId !== filter.project) return false;
      if (!matches(t.title)) return false;
      return t.date <= today;
    }).sort(compareByTimeThenPriority);

    var el = document.getElementById('taskList');
    el.innerHTML = list.length === 0
      ? '<li class="empty">Nothing here — add a task with the + button.</li>'
      : list.map(taskRowHtml).join('');

    var planned = list.reduce(function (s, t) { return s + t.time; }, 0);
    var pct = Math.min(100, (planned / state.capacity) * 100);
    var fill = document.getElementById('capacityFill');
    fill.style.width = pct + '%';
    fill.classList.toggle('over', planned > state.capacity);
    document.getElementById('plannedHours').textContent = (Math.round(planned * 100) / 100).toString();
    document.getElementById('capacityLabelTotal').textContent = state.capacity.toFixed(1);
    document.getElementById('capacitySetting').textContent = state.capacity.toFixed(1);
  }

  function renderUpcoming() {
    var today = todayISO();
    var list = state.tasks.filter(function (t) {
      if (filter.project !== 'all' && t.projectId !== filter.project) return false;
      if (!matches(t.title)) return false;
      return !t.done && t.date > today;
    }).sort(function (a, b) {
      return a.date.localeCompare(b.date) || compareByTimeThenPriority(a, b);
    });

    var el = document.getElementById('upcomingList');
    el.innerHTML = list.length
      ? dateGroupsHtml(groupTasksByDate(list), { draggable: true })
      : '<div class="empty">Nothing scheduled ahead — add a task with the + button and pick a future date.</div>';
  }

  function noteCardHtml(n) {
    var p = projectById(n.projectId);
    var pointsHtml = n.pointsHtml ? '<div class="points">' + n.pointsHtml + '</div>' : '';
    var actionsHtml = '';
    if (n.actions.length) {
      actionsHtml = '<div class="actions"><div class="actions-label">Action items</div><ul class="action-items">'
        + n.actions.map(function (a, i) {
          return '<li><label><input type="checkbox" ' + (a.done ? 'checked' : '') + ' data-action="toggle-action" data-note="' + n.id + '" data-idx="' + i + '"> '
            + '<span class="a-title">' + esc(a.text) + '</span></label>'
            + '<button type="button" class="to-task ' + (a.converted ? 'done' : '') + '" data-action="convert" data-note="' + n.id + '" data-idx="' + i + '">'
            + (a.converted ? 'Added ✓' : '→ Today') + '</button></li>';
        }).join('')
        + '</ul></div>';
    }
    return '<article class="note" data-id="' + n.id + '" title="Click to edit">'
      + '<header><h3>' + esc(n.title) + '</h3>'
      + '<span class="note-head-right"><time>' + fmtDate(n.date) + '</time>'
      + '<button type="button" class="icon-btn danger" data-action="delete-note" data-id="' + n.id + '" aria-label="Delete note">✕</button>'
      + '</span></header>'
      + '<div class="note-meta"><span class="dot" style="background:' + p.color + '"></span>' + esc(p.name)
      + (n.attendees ? '<span class="sep">·</span>' + esc(n.attendees) : '') + '</div>'
      + pointsHtml
      + actionsHtml
      + '</article>';
  }

  function filteredNotes() {
    return state.notes.filter(function (n) {
      if (filter.project !== 'all' && n.projectId !== filter.project) return false;
      var hay = n.title + ' ' + stripHtml(n.pointsHtml) + ' ' + n.actions.map(function (a) { return a.text; }).join(' ');
      return matches(hay);
    }).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  }

  function renderNotes() {
    var list = filteredNotes();
    var el = document.getElementById('noteList');
    el.innerHTML = list.length === 0
      ? '<div class="empty">No notes match — try a different project or search.</div>'
      : list.map(noteCardHtml).join('');
  }

  function renderFocusBanner() {
    var banner = document.getElementById('focusBanner');
    if (!state.focusTaskId) { banner.hidden = true; return; }
    var t = state.tasks.find(function (x) { return x.id === state.focusTaskId; });
    if (!t || !t.focusStartedAt) { state.focusTaskId = null; banner.hidden = true; return; }
    var p = projectById(t.projectId);
    banner.hidden = false;
    document.getElementById('focusTitle').textContent = t.title;
    banner.querySelector('.focus-dot').style.background = p.color;
    tickFocus();
  }

  function tickFocus() {
    if (!state.focusTaskId) return;
    var t = state.tasks.find(function (x) { return x.id === state.focusTaskId; });
    if (!t || !t.focusStartedAt) return;
    var elapsed = Math.floor((Date.now() - t.focusStartedAt) / 1000);
    var el = document.getElementById('focusElapsed');
    if (el) el.textContent = formatHMS(elapsed);
  }
  setInterval(tickFocus, 1000);

  function renderProjectSelect(selectEl, selectedId) {
    selectEl.innerHTML = state.projects.map(function (p) {
      return '<option value="' + p.id + '" ' + (p.id === selectedId ? 'selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('');
  }

  function renderAll() {
    renderProjectList();
    renderTasks();
    renderUpcoming();
    renderNotes();
    renderFocusBanner();
    renderAnalysis();
    renderProjectView();
    renderCompletedView();
    renderCalendarView();
    scheduleTaskNotifications();
  }

  // ---------- date grouping (shared by the Project view and Completed bucket) ----------
  var collapsedDates = {}; // date (ISO) -> true when that date's group is collapsed; session-only

  function groupTasksByDate(list) {
    var groups = [];
    list.forEach(function (t) {
      var g = groups.length && groups[groups.length - 1].date === t.date ? groups[groups.length - 1] : null;
      if (!g) { g = { date: t.date, items: [] }; groups.push(g); }
      g.items.push(t);
    });
    return groups;
  }

  function dateGroupsHtml(groups, opts) {
    var draggable = !!(opts && opts.draggable);
    return groups.map(function (g) {
      var collapsed = !!collapsedDates[g.date];
      var doneCount = g.items.filter(function (t) { return t.done; }).length;
      var countLabel = g.items.length + (g.items.length === 1 ? ' task' : ' tasks')
        + (doneCount && doneCount !== g.items.length ? ' · ' + doneCount + ' done' : '');
      return '<div class="date-block' + (collapsed ? ' collapsed' : '') + '" data-date="' + g.date + '">'
        + '<button type="button" class="date-toggle" data-action="toggle-date" data-date="' + g.date + '" aria-expanded="' + (!collapsed) + '">'
        + '<span class="chevron">▾</span>'
        + '<span class="date-label">' + esc(fmtDateLong(g.date)) + '</span>'
        + '<span class="date-count">' + countLabel + '</span>'
        + '</button>'
        + '<ul class="tasks"' + (collapsed ? ' hidden' : '') + '>' + g.items.map(function (t) { return taskRowHtml(t, { draggable: draggable }); }).join('') + '</ul>'
        + '</div>';
    }).join('');
  }

  function onDateToggleClick(rerender) {
    return function (e) {
      var toggle = e.target.closest('[data-action="toggle-date"]');
      if (!toggle) return;
      var d = toggle.dataset.date;
      collapsedDates[d] = !collapsedDates[d];
      rerender();
    };
  }

  // Drag a task row from one date's group and drop it on another to
  // reschedule it — the drop target is the whole date-block, not a sibling
  // position, so this is simpler than the project reorder: no before/after,
  // just "which date did you drop it on".
  var dragTaskId = null;
  function clearDateDropMarkers() {
    document.querySelectorAll('.date-block.drop-target').forEach(function (b) { b.classList.remove('drop-target'); });
  }
  function wireDateDragDrop(container) {
    container.addEventListener('dragstart', function (e) {
      var li = e.target.closest('.task[draggable="true"]');
      if (!li) return;
      dragTaskId = li.dataset.id;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragTaskId); } catch (err) { /* Firefox needs this set */ }
    });
    container.addEventListener('dragover', function (e) {
      if (!dragTaskId) return;
      var block = e.target.closest('.date-block[data-date]');
      if (!block) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!block.classList.contains('drop-target')) { clearDateDropMarkers(); block.classList.add('drop-target'); }
    });
    container.addEventListener('drop', function (e) {
      if (!dragTaskId) return;
      var block = e.target.closest('.date-block[data-date]');
      if (block) {
        e.preventDefault();
        var t = state.tasks.find(function (x) { return x.id === dragTaskId; });
        var targetDate = block.dataset.date;
        if (t && targetDate && t.date !== targetDate) { t.date = targetDate; save(); renderAll(); }
      }
      clearDateDropMarkers();
      dragTaskId = null;
    });
    container.addEventListener('dragend', function () {
      document.querySelectorAll('.task.dragging').forEach(function (li) { li.classList.remove('dragging'); });
      clearDateDropMarkers();
      dragTaskId = null;
    });
  }

  // ---------- project view (all tasks + notes for one project, or all) ----------
  var PROJECT_VIEW_MODE_KEY = 'btrdesk-project-view-mode';
  var projectViewMode = safeGet(PROJECT_VIEW_MODE_KEY, 'tasks');
  if (['tasks', 'notes'].indexOf(projectViewMode) === -1) projectViewMode = 'tasks';

  function renderProjectView() {
    if (!document.getElementById('view-project').classList.contains('active')) return;

    var p = filter.project === 'all' ? null : projectById(filter.project);
    document.getElementById('projectViewTitle').textContent = p ? p.name : 'All projects';
    document.querySelectorAll('#projectViewToggle button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === projectViewMode);
    });

    var tasksWrap = document.getElementById('projectTasksWrap');
    var notesWrap = document.getElementById('projectNotesWrap');
    var showTasks = projectViewMode === 'tasks';
    tasksWrap.hidden = !showTasks;
    notesWrap.hidden = showTasks;

    if (showTasks) {
      // Completed tasks have moved to the Completed bucket — this is active work only.
      var list = state.tasks.filter(function (t) {
        if (t.done) return false;
        if (filter.project !== 'all' && t.projectId !== filter.project) return false;
        return matches(t.title);
      }).sort(function (a, b) {
        return a.date.localeCompare(b.date) || compareByTimeThenPriority(a, b);
      });

      tasksWrap.innerHTML = list.length
        ? dateGroupsHtml(groupTasksByDate(list), { draggable: true })
        : '<div class="empty">No open tasks for this project — add one with the + button.</div>';
    } else {
      var notes = filteredNotes();
      notesWrap.innerHTML = notes.length ? notes.map(noteCardHtml).join('') : '<div class="empty">No notes for this project yet.</div>';
    }
  }

  // ---------- completed bucket ----------
  function renderCompletedView() {
    if (!document.getElementById('view-completed').classList.contains('active')) return;
    var list = state.tasks.filter(function (t) { return t.done && matches(t.title); })
      .sort(function (a, b) { return b.date.localeCompare(a.date) || compareByTimeThenPriority(a, b); });
    document.getElementById('completedList').innerHTML = list.length
      ? dateGroupsHtml(groupTasksByDate(list))
      : '<div class="empty">Nothing completed yet — checked-off tasks land here.</div>';
  }

  // ---------- calendar (open tasks by date; drag a chip onto another day) ----------
  var CAL_MODE_KEY = 'btrdesk-calendar-view-mode';
  var calendarViewMode = safeGet(CAL_MODE_KEY, 'month');
  if (['month', 'week', 'day'].indexOf(calendarViewMode) === -1) calendarViewMode = 'month';

  // Each mode remembers its own position independently — flipping the month
  // grid forward and then switching to Day shouldn't strand you on some
  // unrelated date, so Week/Day/Month each keep their own cursor, all
  // starting on today.
  var calendarCursors = { month: new Date(), week: new Date(), day: new Date() };
  Object.keys(calendarCursors).forEach(function (k) { calendarCursors[k].setHours(0, 0, 0, 0); });
  function activeCursor() { return calendarCursors[calendarViewMode]; }

  function startOfWeek(d) {
    var r = new Date(d);
    r.setDate(r.getDate() - r.getDay());
    r.setHours(0, 0, 0, 0);
    return r;
  }
  function isoOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function openTasksForDate(dateISO) {
    return state.tasks.filter(function (t) { return !t.done && t.date === dateISO && matches(t.title); })
      .sort(compareByTimeThenPriority);
  }
  function calChipsHtml(items) {
    return items.map(function (t) {
      var p = projectById(t.projectId);
      return '<div class="cal-chip" draggable="true" data-id="' + t.id + '" title="' + esc(t.title) + ' · ' + esc(p.name) + '">'
        + '<span class="dot" style="background:' + p.color + '"></span>'
        + '<span class="cal-chip-title">' + esc(t.title) + '</span>'
        + '</div>';
    }).join('');
  }

  function renderCalendarMonth() {
    var cursor = calendarCursors.month;
    var year = cursor.getFullYear(), month = cursor.getMonth();
    document.getElementById('calendarLabel').textContent = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    var startWeekday = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
    var todayStr = todayISO();

    var html = '';
    for (var i = 0; i < totalCells; i++) {
      var dayNum = i - startWeekday + 1;
      var inMonth = dayNum >= 1 && dayNum <= daysInMonth;
      var cellDate = inMonth ? (year + '-' + pad2(month + 1) + '-' + pad2(dayNum)) : '';
      var displayDayNum = inMonth ? dayNum : new Date(year, month, dayNum).getDate();
      var items = inMonth ? openTasksForDate(cellDate) : [];
      html += '<div class="cal-cell' + (inMonth ? '' : ' is-outside') + (cellDate === todayStr ? ' is-today' : '') + '" data-date="' + cellDate + '">'
        + '<div class="cal-daynum">' + displayDayNum + '</div>'
        + '<div class="cal-cell-tasks">' + calChipsHtml(items) + '</div>'
        + '</div>';
    }
    document.getElementById('calendarGrid').innerHTML = html;
  }

  function renderCalendarWeek() {
    var start = startOfWeek(calendarCursors.week);
    var end = new Date(start); end.setDate(end.getDate() + 6);
    var sameMonth = start.getMonth() === end.getMonth();
    var label = sameMonth
      ? start.toLocaleDateString(undefined, { month: 'short' }) + ' ' + start.getDate() + '–' + end.getDate() + ', ' + end.getFullYear()
      : start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' – ' + end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('calendarLabel').textContent = label;

    var todayStr = todayISO();
    var html = '';
    for (var i = 0; i < 7; i++) {
      var d = new Date(start); d.setDate(start.getDate() + i);
      var dateISO = isoOf(d);
      html += '<div class="cal-cell' + (dateISO === todayStr ? ' is-today' : '') + '" data-date="' + dateISO + '">'
        + '<div class="cal-daynum">' + d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) + '</div>'
        + '<div class="cal-cell-tasks">' + calChipsHtml(openTasksForDate(dateISO)) + '</div>'
        + '</div>';
    }
    document.getElementById('calendarGrid').innerHTML = html;
  }

  function renderCalendarDay() {
    var cursor = calendarCursors.day;
    var dateISO = isoOf(cursor);
    document.getElementById('calendarLabel').textContent = cursor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    var items = state.tasks.filter(function (t) { return t.date === dateISO && matches(t.title); })
      .sort(function (a, b) { return (a.done - b.done) || compareByTimeThenPriority(a, b); });
    var todayStr = todayISO();
    var body = items.length
      ? '<ul class="tasks">' + items.map(function (t) { return taskRowHtml(t, { draggable: false }); }).join('') + '</ul>'
      : '<div class="empty">Nothing scheduled for this day — add a task with the + button.</div>';
    document.getElementById('calendarGrid').innerHTML = '<div class="cal-cell' + (dateISO === todayStr ? ' is-today' : '') + '" data-date="' + dateISO + '">' + body + '</div>';
  }

  function renderCalendarView() {
    if (!document.getElementById('view-calendar').classList.contains('active')) return;
    document.querySelectorAll('#calendarModeControl button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.calMode === calendarViewMode);
    });
    document.getElementById('calendarWeekdays').hidden = calendarViewMode === 'day';
    document.getElementById('calendarGrid').className = 'cal-grid mode-' + calendarViewMode;
    if (calendarViewMode === 'week') renderCalendarWeek();
    else if (calendarViewMode === 'day') renderCalendarDay();
    else renderCalendarMonth();
  }

  document.getElementById('calendarModeControl').addEventListener('click', function (e) {
    var btn = e.target.closest('button'); if (!btn) return;
    var mode = btn.dataset.calMode;
    if (mode === calendarViewMode) return;
    calendarViewMode = mode;
    safeSet(CAL_MODE_KEY, calendarViewMode);
    renderCalendarView();
  });

  document.getElementById('calPrevBtn').addEventListener('click', function () {
    var c = activeCursor();
    // Clamp to the 1st before shifting months so a 31st-of-the-month cursor
    // never rolls over into the wrong month on a shorter one.
    if (calendarViewMode === 'month') { c.setDate(1); c.setMonth(c.getMonth() - 1); }
    else if (calendarViewMode === 'week') c.setDate(c.getDate() - 7);
    else c.setDate(c.getDate() - 1);
    renderCalendarView();
  });
  document.getElementById('calNextBtn').addEventListener('click', function () {
    var c = activeCursor();
    if (calendarViewMode === 'month') { c.setDate(1); c.setMonth(c.getMonth() + 1); }
    else if (calendarViewMode === 'week') c.setDate(c.getDate() + 7);
    else c.setDate(c.getDate() + 1);
    renderCalendarView();
  });
  document.getElementById('calTodayBtn').addEventListener('click', function () {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    calendarCursors[calendarViewMode] = t;
    renderCalendarView();
  });

  document.getElementById('calendarGrid').addEventListener('click', function (e) {
    var chip = e.target.closest('.cal-chip');
    if (!chip) return;
    taskModal(state.tasks.find(function (x) { return x.id === chip.dataset.id; }));
  });
  // Day mode renders full task rows instead of chips — reuse the same
  // click handling as every other task list (toggle / focus / delete / edit).
  document.getElementById('calendarGrid').addEventListener('click', onTaskListClick);

  var calDragTaskId = null;
  document.getElementById('calendarGrid').addEventListener('dragstart', function (e) {
    var chip = e.target.closest('.cal-chip[draggable="true"]');
    if (!chip) return;
    calDragTaskId = chip.dataset.id;
    chip.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', calDragTaskId); } catch (err) { /* Firefox needs this set */ }
  });
  document.getElementById('calendarGrid').addEventListener('dragover', function (e) {
    if (!calDragTaskId) return;
    var cell = e.target.closest('.cal-cell[data-date]');
    if (!cell || !cell.dataset.date) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!cell.classList.contains('drop-target')) {
      document.querySelectorAll('.cal-cell.drop-target').forEach(function (c) { c.classList.remove('drop-target'); });
      cell.classList.add('drop-target');
    }
  });
  document.getElementById('calendarGrid').addEventListener('drop', function (e) {
    if (!calDragTaskId) return;
    var cell = e.target.closest('.cal-cell[data-date]');
    if (cell && cell.dataset.date) {
      e.preventDefault();
      var t = state.tasks.find(function (x) { return x.id === calDragTaskId; });
      if (t && t.date !== cell.dataset.date) { t.date = cell.dataset.date; save(); renderAll(); }
    }
    document.querySelectorAll('.cal-cell.drop-target').forEach(function (c) { c.classList.remove('drop-target'); });
    calDragTaskId = null;
  });
  document.getElementById('calendarGrid').addEventListener('dragend', function () {
    document.querySelectorAll('.cal-chip.dragging').forEach(function (c) { c.classList.remove('dragging'); });
    document.querySelectorAll('.cal-cell.drop-target').forEach(function (c) { c.classList.remove('drop-target'); });
    calDragTaskId = null;
  });

  // ---------- analysis (time tracked, from completed focus sessions) ----------
  var ANALYSIS_GRAN_KEY = 'btrdesk-analysis-granularity';
  var MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var analysisGranularity = safeGet(ANALYSIS_GRAN_KEY, 'day');
  if (['day', 'month', 'year'].indexOf(analysisGranularity) === -1) analysisGranularity = 'day';

  function hoursOf(seconds) { return seconds / 3600; }
  function formatHoursShort(h) { return (Math.round(h * 10) / 10) + 'h'; }
  function niceCeiling(v) {
    if (v <= 1) return 1;
    if (v <= 2) return 2;
    if (v <= 4) return 4;
    if (v <= 8) return 8;
    if (v <= 12) return 12;
    if (v <= 24) return 24;
    return Math.ceil(v / 10) * 10;
  }

  // Buckets always start at a fixed anchor (the 1st of the month / January /
  // the earliest tracked year) through the current period — never a rolling
  // "last N" window — so "Day" always reads from the 1st of this month.
  function buildBuckets(granularity) {
    var now = new Date();
    var buckets = [];
    if (granularity === 'day') {
      var year = now.getFullYear(), month = now.getMonth(), todayNum = now.getDate();
      for (var d = 1; d <= todayNum; d++) {
        buckets.push({
          key: year + '-' + pad2(month + 1) + '-' + pad2(d),
          label: String(d),
          dateLabelFull: new Date(year, month, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          isCurrent: d === todayNum
        });
      }
    } else if (granularity === 'month') {
      var year2 = now.getFullYear(), curMonth = now.getMonth();
      for (var m = 0; m <= curMonth; m++) {
        buckets.push({
          key: year2 + '-' + pad2(m + 1),
          label: MONTH_ABBR[m],
          dateLabelFull: MONTH_ABBR[m] + ' ' + year2,
          isCurrent: m === curMonth
        });
      }
    } else {
      var curYear = now.getFullYear(), earliest = curYear;
      state.sessions.forEach(function (s) { var y = parseInt(s.date.slice(0, 4), 10); if (y < earliest) earliest = y; });
      for (var y2 = earliest; y2 <= curYear; y2++) {
        buckets.push({ key: String(y2), label: String(y2), dateLabelFull: String(y2), isCurrent: y2 === curYear });
      }
    }
    var byKey = {};
    buckets.forEach(function (b) { byKey[b.key] = 0; });
    state.sessions.forEach(function (s) {
      var key = granularity === 'day' ? s.date : granularity === 'month' ? s.date.slice(0, 7) : s.date.slice(0, 4);
      if (byKey.hasOwnProperty(key)) byKey[key] += s.seconds;
    });
    buckets.forEach(function (b) { b.seconds = byKey[b.key]; b.hours = hoursOf(b.seconds); });
    return buckets;
  }

  function rangeLabel(granularity, buckets) {
    if (!buckets.length) return '';
    var now = new Date();
    if (granularity === 'day') {
      var first = new Date(now.getFullYear(), now.getMonth(), 1);
      return first.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' – ' + now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
    if (granularity === 'month') return buckets[0].label + ' – ' + buckets[buckets.length - 1].label + ' ' + now.getFullYear();
    return buckets.length > 1 ? buckets[0].label + ' – ' + buckets[buckets.length - 1].label : buckets[0].label;
  }

  function buildDonut() {
    var today = todayISO();
    document.getElementById('donutDateLabel').textContent = todayLabel();
    var byProject = {};
    state.sessions.forEach(function (s) { if (s.date === today) byProject[s.projectId] = (byProject[s.projectId] || 0) + s.seconds; });
    var data = Object.keys(byProject).map(function (pid) { return { projectId: pid, seconds: byProject[pid] }; })
      .sort(function (a, b) { return b.seconds - a.seconds; });
    var total = data.reduce(function (s, d) { return s + d.seconds; }, 0);

    var wrap = document.getElementById('donutWrap');
    if (!total) {
      wrap.innerHTML = '<div class="analysis-empty">No focus sessions completed today yet — start one from a task’s ▶ button.</div>';
      return;
    }

    var size = 168, sw = 26, r = (size - sw) / 2, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r, gap = 3, offset = 0;
    var arcs = data.map(function (d) {
      var p = projectById(d.projectId);
      var frac = d.seconds / total;
      var len = Math.max(0, frac * C - gap);
      var arc = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + p.color + '" stroke-width="' + sw
        + '" stroke-linecap="butt" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-offset).toFixed(2)
        + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"><title>' + esc(p.name) + ': ' + formatDurationShort(d.seconds) + '</title></circle>';
      offset += frac * C;
      return arc;
    }).join('');

    var legend = data.map(function (d) {
      var p = projectById(d.projectId);
      var pct = Math.round((d.seconds / total) * 100);
      return '<div class="legend-row"><span class="dot" style="background:' + p.color + '"></span>'
        + '<span class="name">' + esc(p.name) + '</span>'
        + '<span class="value">' + formatDurationShort(d.seconds) + '</span>'
        + '<span class="pct">' + pct + '%</span></div>';
    }).join('');

    wrap.innerHTML = '<div class="donut-figure"><svg viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="Time by project today">' + arcs + '</svg>'
      + '<div class="donut-center"><span class="value">' + formatDurationShort(total) + '</span><span class="caption">today</span></div></div>'
      + '<div class="legend">' + legend + '</div>';
  }

  function buildTrend(granularity) {
    var buckets = buildBuckets(granularity);
    document.getElementById('analysisRange').textContent = rangeLabel(granularity, buckets);
    var totalSeconds = buckets.reduce(function (s, b) { return s + b.seconds; }, 0);
    document.getElementById('trendTotal').textContent = formatDurationShort(totalSeconds);

    var wrap = document.getElementById('trendWrap');
    if (!totalSeconds) {
      wrap.innerHTML = '<div class="analysis-empty">No tracked time yet in this period — complete a focus session to see it here.</div>';
      return;
    }

    var n = buckets.length;
    var width = Math.max(360, n * 34 + 48);
    var height = 180;
    var padding = { top: 22, right: 12, bottom: 22, left: 34 };
    var innerW = width - padding.left - padding.right;
    var innerH = height - padding.top - padding.bottom;
    var maxHours = Math.max.apply(null, buckets.map(function (b) { return b.hours; }));
    var niceMax = niceCeiling(maxHours || 1);
    var step = innerW / n;
    var barW = Math.min(22, step * 0.55);

    function y(hours) { return padding.top + innerH - (hours / niceMax) * innerH; }

    var gridHtml = [0, niceMax / 2, niceMax].map(function (v) {
      var yy = y(v);
      return '<line class="grid-line" x1="' + padding.left + '" x2="' + (width - padding.right) + '" y1="' + yy + '" y2="' + yy + '"></line>'
        + '<text class="axis-label" x="' + (padding.left - 6) + '" y="' + (yy + 3) + '" text-anchor="end">' + formatHoursShort(v) + '</text>';
    }).join('');

    var barsHtml = buckets.map(function (b, i) {
      var bx = padding.left + step * i + step / 2;
      var barH = Math.max(0, (b.hours / niceMax) * innerH);
      var by = padding.top + innerH - barH;
      var labelHtml = (b.isCurrent && b.hours > 0)
        ? '<text class="bar-label" x="' + bx + '" y="' + (by - 6) + '" text-anchor="middle">' + formatDurationShort(b.seconds) + '</text>'
        : '';
      return '<g>'
        + '<rect class="bar' + (b.isCurrent ? ' is-current' : '') + '" x="' + (bx - barW / 2) + '" y="' + by + '" width="' + barW + '" height="' + barH + '" rx="3">'
        + '<title>' + esc(b.dateLabelFull) + ': ' + formatDurationShort(b.seconds) + '</title></rect>'
        + labelHtml
        + '<text class="axis-label" x="' + bx + '" y="' + (height - 6) + '" text-anchor="middle">' + esc(b.label) + '</text>'
        + '</g>';
    }).join('');

    wrap.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="Hours tracked over time">' + gridHtml + barsHtml + '</svg>';
  }

  function renderAnalysis() {
    if (!document.getElementById('view-analysis').classList.contains('active')) return;
    buildDonut();
    buildTrend(analysisGranularity);
  }

  document.getElementById('granularityControl').addEventListener('click', function (e) {
    var btn = e.target.closest('button'); if (!btn) return;
    analysisGranularity = btn.dataset.granularity;
    safeSet(ANALYSIS_GRAN_KEY, analysisGranularity);
    document.querySelectorAll('#granularityControl button').forEach(function (b) { b.classList.toggle('active', b === btn); });
    renderAnalysis();
  });

  // ---------- focus mode ----------
  function startFocus(taskId) {
    if (state.focusTaskId) return; // one at a time
    var t = state.tasks.find(function (x) { return x.id === taskId; });
    if (!t || t.done) return;
    t.focusStartedAt = Date.now();
    state.focusTaskId = taskId;
    save(); renderAll();
  }
  function completeFocus() {
    var t = state.tasks.find(function (x) { return x.id === state.focusTaskId; });
    if (!t) { state.focusTaskId = null; save(); renderAll(); return; }
    t.actualSeconds = Math.round((Date.now() - t.focusStartedAt) / 1000);
    t.done = true;
    t.focusStartedAt = null;
    state.focusTaskId = null;
    state.sessions.push({ id: nextId('s'), taskId: t.id, title: t.title, projectId: t.projectId, date: todayISO(), seconds: t.actualSeconds });
    save(); renderAll();
  }
  function cancelFocus() {
    var t = state.tasks.find(function (x) { return x.id === state.focusTaskId; });
    if (t) t.focusStartedAt = null;
    state.focusTaskId = null;
    save(); renderAll();
  }

  document.getElementById('focusCompleteBtn').addEventListener('click', completeFocus);
  document.getElementById('focusCancelBtn').addEventListener('click', function () {
    if (confirm('Discard this focus session? The elapsed time will not be saved.')) cancelFocus();
  });

  // ---------- browser notifications at a task's scheduled time ----------
  // Client-side only: timers live in this tab, so a task only alerts while
  // BTR's Desk is open somewhere (background tab is fine; closed is not).
  var NOTIFY_SUPPORTED = typeof Notification !== 'undefined';
  var NOTIFY_MAX_DELAY = 20 * 24 * 60 * 60 * 1000; // stay well under setTimeout's ~24.8-day ceiling
  var notifyTimers = {}; // taskId -> setTimeout id

  function fireTaskNotification(t) {
    if (!NOTIFY_SUPPORTED || Notification.permission !== 'granted') return;
    var p = projectById(t.projectId);
    try {
      var n = new Notification(t.title, { body: p.name + ' · ' + formatTime12h(t.startTime), tag: 'btrdesk-task-' + t.id });
      n.onclick = function () { window.focus(); n.close(); };
    } catch (e) { /* some platforms need a service worker for this; fail quietly */ }
  }

  function scheduleTaskNotifications() {
    if (!NOTIFY_SUPPORTED) return;
    Object.keys(notifyTimers).forEach(function (id) { clearTimeout(notifyTimers[id]); });
    notifyTimers = {};
    if (Notification.permission !== 'granted') return;
    var now = Date.now();
    state.tasks.forEach(function (t) {
      if (t.done || !t.startTime) return;
      var target = new Date(t.date + 'T' + t.startTime + ':00').getTime();
      var delay = target - now;
      if (delay <= 0 || delay > NOTIFY_MAX_DELAY) return;
      notifyTimers[t.id] = setTimeout(function () { fireTaskNotification(t); }, delay);
    });
  }
  // Rescans periodically so a task scheduled further out still gets picked
  // up as it comes into range, and so a day rollover doesn't need a reload.
  setInterval(scheduleTaskNotifications, 5 * 60 * 1000);

  function renderNotifyBtn() {
    var btn = document.getElementById('notifyBtn');
    var sep = document.getElementById('notifySep');
    if (!NOTIFY_SUPPORTED) { btn.hidden = true; sep.hidden = true; return; }
    btn.hidden = false; sep.hidden = false;
    if (Notification.permission === 'granted') {
      btn.textContent = 'Alerts on'; btn.disabled = true;
      btn.title = 'You’ll get a browser notification at a task’s scheduled time while this tab is open.';
    } else if (Notification.permission === 'denied') {
      btn.textContent = 'Alerts blocked'; btn.disabled = true;
      btn.title = 'Notifications are blocked for this page — check your browser’s site settings to re-enable.';
    } else {
      btn.textContent = 'Enable alerts'; btn.disabled = false;
      btn.title = 'Get a browser notification at a task’s scheduled time.';
    }
  }
  document.getElementById('notifyBtn').addEventListener('click', function () {
    if (!NOTIFY_SUPPORTED) return;
    Notification.requestPermission().then(function () {
      renderNotifyBtn();
      scheduleTaskNotifications();
    });
  });

  // ---------- modal ----------
  var overlay = document.getElementById('modalOverlay');
  var modalEl = document.getElementById('modal');

  function closeModal() { overlay.classList.remove('open'); modalEl.innerHTML = ''; modalEl.classList.remove('wide'); }
  function openModal(html, wide) { modalEl.innerHTML = html; modalEl.classList.toggle('wide', !!wide); overlay.classList.add('open'); }

  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  // Enter saves the open modal, same as clicking Save — except inside a
  // textarea or rich-text editor (Enter has to keep inserting newlines/list
  // items there) or while focus is on a button (a focused Cancel/Delete
  // already handles its own Enter; firing Save too would be wrong).
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !overlay.classList.contains('open')) return;
    var tag = e.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'BUTTON' || e.target.isContentEditable) return;
    var saveBtn = document.getElementById('mSave');
    if (saveBtn) { e.preventDefault(); saveBtn.click(); }
  });

  function projectModal(existing) {
    var isEdit = !!existing;
    var name = isEdit ? existing.name : '';
    var color = isEdit ? existing.color : COLORS[state.projects.length % COLORS.length];
    openModal(
      '<h2>' + (isEdit ? 'Edit project' : 'New project') + '</h2>'
      + '<div class="field"><label>Name</label><input type="text" id="mProjectName" value="' + esc(name) + '" placeholder="e.g. Northwind — SOX Readiness"></div>'
      + '<div class="field"><label>Color</label><div class="swatches" id="mSwatches">'
      + COLORS.map(function (c) { return '<span class="swatch ' + (c === color ? 'selected' : '') + '" style="background:' + c + '" data-color="' + c + '"></span>'; }).join('')
      + '</div></div>'
      + '<div class="modal-actions">'
      + (isEdit ? '<button type="button" class="btn-danger-text" id="mDelete">Delete project</button>' : '<span></span>')
      + '<div class="modal-actions-right"><button type="button" class="btn-secondary" id="mCancel">Cancel</button><button type="button" class="btn-primary" id="mSave">Save</button></div>'
      + '</div>'
    );
    var chosen = color;
    document.getElementById('mSwatches').addEventListener('click', function (e) {
      var sw = e.target.closest('.swatch'); if (!sw) return;
      chosen = sw.dataset.color;
      document.querySelectorAll('#mSwatches .swatch').forEach(function (s) { s.classList.toggle('selected', s === sw); });
    });
    document.getElementById('mCancel').addEventListener('click', closeModal);
    document.getElementById('mSave').addEventListener('click', function () {
      var val = document.getElementById('mProjectName').value.trim();
      if (!val) return;
      if (isEdit) { existing.name = val; existing.color = chosen; }
      else { state.projects.push({ id: nextId('p'), name: val, color: chosen }); }
      save(); renderAll(); closeModal();
    });
    if (isEdit) {
      document.getElementById('mDelete').addEventListener('click', function () {
        if (state.projects.length <= 1) { alert('Keep at least one project.'); return; }
        if (!confirm('Delete "' + existing.name + '"? Its tasks and notes stay, tagged as this project until reassigned.')) return;
        state.projects = state.projects.filter(function (p) { return p.id !== existing.id; });
        save(); renderAll(); closeModal();
      });
    }
  }

  // When adding a new task/note while a specific project's page is open,
  // default to that project instead of always the first one in the list.
  function contextualProjectId() {
    return (filter.view === 'project' && filter.project !== 'all') ? filter.project : state.projects[0].id;
  }

  function taskModal(existing) {
    var t = existing || { title: '', projectId: contextualProjectId(), priority: 'med', time: 1, date: todayISO(), startTime: null, taskNotes: '' };
    openModal(
      '<h2>' + (existing ? 'Edit task' : 'New task') + '</h2>'
      + '<div class="field"><label>Title</label><input type="text" id="mTaskTitle" value="' + esc(t.title) + '"></div>'
      + '<div class="field"><label>Project</label><select id="mTaskProject"></select></div>'
      + '<div class="field-row">'
      + '<div class="field"><label>Priority</label><select id="mTaskPriority">'
      + ['high', 'med', 'low'].map(function (v) { return '<option value="' + v + '" ' + (v === t.priority ? 'selected' : '') + '>' + ({ high: 'High', med: 'Med', low: 'Low' }[v]) + '</option>'; }).join('')
      + '</select></div>'
      + '<div class="field"><label>Hours</label><input type="number" id="mTaskTime" value="' + t.time + '" min="0.25" step="0.25"></div>'
      + '</div>'
      + '<div class="field-row">'
      + '<div class="field"><label>Date</label><input type="date" id="mTaskDate" value="' + t.date + '"></div>'
      + '<div class="field"><label>Time (optional)</label><input type="time" id="mTaskStartTime" value="' + (t.startTime || '') + '"></div>'
      + '</div>'
      + '<div class="field"><label>Notes for this task</label>' + richEditorHtml('mTaskNotes', t.taskNotes || '', 'What to do for this task…')
      + (existing
        ? '<div class="field-inline-action"><button type="button" class="btn-secondary" id="mPersistNote">Persist</button>'
          + '<span class="field-hint">Moves this into the Notes section, titled with this task — and clears it from here.</span></div>'
        : '<div class="field-hint">Saved with the task; deleted along with it unless you Persist it to Notes later.</div>')
      + '</div>'
      + '<div class="modal-actions">'
      + (existing ? '<button type="button" class="btn-danger-text" id="mDelete">Delete task</button>' : '<span></span>')
      + '<div class="modal-actions-right"><button type="button" class="btn-secondary" id="mCancel">Cancel</button><button type="button" class="btn-primary" id="mSave">Save</button></div>'
      + '</div>'
    );
    renderProjectSelect(document.getElementById('mTaskProject'), t.projectId);
    initRichEditor('mTaskNotes');
    document.getElementById('mTaskTitle').focus();
    document.getElementById('mCancel').addEventListener('click', closeModal);
    document.getElementById('mSave').addEventListener('click', function () {
      var title = document.getElementById('mTaskTitle').value.trim();
      if (!title) return;
      var projectId = document.getElementById('mTaskProject').value;
      var priority = document.getElementById('mTaskPriority').value;
      var time = parseFloat(document.getElementById('mTaskTime').value) || 1;
      var date = document.getElementById('mTaskDate').value || todayISO();
      var startTime = document.getElementById('mTaskStartTime').value || null;
      var taskNotes = richValue('mTaskNotes');
      if (existing) {
        existing.title = title; existing.projectId = projectId; existing.priority = priority;
        existing.time = time; existing.date = date; existing.startTime = startTime; existing.taskNotes = taskNotes;
      } else {
        state.tasks.unshift({ id: nextId('t'), title: title, projectId: projectId, priority: priority, time: time, date: date, startTime: startTime, taskNotes: taskNotes, done: false, focusStartedAt: null, actualSeconds: null });
      }
      save(); renderAll(); closeModal();
    });
    if (existing) {
      document.getElementById('mPersistNote').addEventListener('click', function () {
        var notesEl = document.getElementById('mTaskNotes');
        if (!notesEl.textContent.trim()) return;
        var pointsHtml = richValue('mTaskNotes');
        state.notes.unshift({ id: nextId('n'), title: existing.title, date: existing.date, projectId: existing.projectId, attendees: '', pointsHtml: pointsHtml, actions: [] });
        existing.taskNotes = '';
        save(); renderAll();
        var btn = document.getElementById('mPersistNote');
        if (notesEl) { notesEl.innerHTML = ''; updateRichEmptyState(notesEl); }
        if (btn) {
          btn.textContent = 'Saved to Notes ✓'; btn.disabled = true;
          setTimeout(function () { if (btn.isConnected) { btn.textContent = 'Persist'; btn.disabled = false; } }, 1500);
        }
      });
      document.getElementById('mDelete').addEventListener('click', function () {
        if (state.focusTaskId === existing.id) state.focusTaskId = null;
        state.tasks = state.tasks.filter(function (x) { return x.id !== existing.id; });
        save(); renderAll(); closeModal();
      });
    }
  }

  function noteModal(existing) {
    var n = existing || { title: '', date: todayISO(), projectId: contextualProjectId(), attendees: '', pointsHtml: '', actions: [] };
    openModal(
      '<h2>' + (existing ? 'Edit note' : 'New meeting note') + '</h2>'
      + '<div class="field"><label>Title</label><input type="text" id="mNoteTitle" value="' + esc(n.title) + '" placeholder="e.g. Kickoff — Meridian Retail RFP"></div>'
      + '<div class="field-row">'
      + '<div class="field"><label>Project</label><select id="mNoteProject"></select></div>'
      + '<div class="field"><label>Date</label><input type="date" id="mNoteDate" value="' + n.date + '"></div>'
      + '</div>'
      + '<div class="field"><label>Attendees</label><input type="text" id="mNoteAttendees" value="' + esc(n.attendees) + '" placeholder="Comma-separated"></div>'
      + '<div class="field"><label>Key points</label>' + richEditorHtml('mNotePoints', n.pointsHtml || '', 'Key points from the meeting…') + '</div>'
      + '<div class="field"><label>Action items (one per line)</label><textarea id="mNoteActions">' + esc(n.actions.map(function (a) { return a.text; }).join('\n')) + '</textarea></div>'
      + '<div class="modal-actions">'
      + (existing ? '<button type="button" class="btn-danger-text" id="mDelete">Delete note</button>' : '<span></span>')
      + '<div class="modal-actions-right"><button type="button" class="btn-secondary" id="mCancel">Cancel</button><button type="button" class="btn-primary" id="mSave">Save</button></div>'
      + '</div>'
    );
    renderProjectSelect(document.getElementById('mNoteProject'), n.projectId);
    initRichEditor('mNotePoints');
    document.getElementById('mNoteTitle').focus();
    document.getElementById('mCancel').addEventListener('click', closeModal);
    document.getElementById('mSave').addEventListener('click', function () {
      var title = document.getElementById('mNoteTitle').value.trim();
      if (!title) return;
      var projectId = document.getElementById('mNoteProject').value;
      var date = document.getElementById('mNoteDate').value || todayISO();
      var attendees = document.getElementById('mNoteAttendees').value.trim();
      var pointsHtml = richValue('mNotePoints');
      var newActionTexts = document.getElementById('mNoteActions').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      var oldActions = existing ? existing.actions : [];
      var actions = newActionTexts.map(function (text) {
        var prev = oldActions.find(function (a) { return a.text === text; });
        return prev || { text: text, done: false, converted: false };
      });
      if (existing) {
        existing.title = title; existing.projectId = projectId; existing.date = date;
        existing.attendees = attendees; existing.pointsHtml = pointsHtml; existing.actions = actions;
      } else {
        state.notes.unshift({ id: nextId('n'), title: title, date: date, projectId: projectId, attendees: attendees, pointsHtml: pointsHtml, actions: actions });
      }
      save(); renderAll(); closeModal();
    });
    if (existing) {
      document.getElementById('mDelete').addEventListener('click', function () {
        if (!confirm('Delete this note? This cannot be undone.')) return;
        state.notes = state.notes.filter(function (x) { return x.id !== existing.id; });
        save(); renderAll(); closeModal();
      });
    }
  }

  // ---------- project reordering (drag & drop) ----------
  function reorderProject(srcId, targetId, before) {
    if (srcId === targetId) return;
    var arr = state.projects;
    var srcIdx = arr.findIndex(function (p) { return p.id === srcId; });
    if (srcIdx < 0) return;
    var srcItem = arr[srcIdx];
    arr.splice(srcIdx, 1);
    var targetIdx = arr.findIndex(function (p) { return p.id === targetId; });
    var insertAt = targetIdx < 0 ? arr.length : (before ? targetIdx : targetIdx + 1);
    arr.splice(insertAt, 0, srcItem);
    save(); renderProjectList();
  }

  function clearDropMarkers() {
    document.querySelectorAll('.project.drop-before, .project.drop-after').forEach(function (li) {
      li.classList.remove('drop-before', 'drop-after');
    });
  }

  var dragSrcId = null;
  var projectListEl = document.getElementById('projectList');

  // Dragging only starts from the grip handle: the li is made draggable the
  // instant the mouse goes down on its handle, and un-draggable again as soon
  // as the mouse is released — so a click-and-drag anywhere else on the row
  // (the row itself is still clickable, to filter by that project) never
  // starts a reorder.
  projectListEl.addEventListener('mousedown', function (e) {
    var handle = e.target.closest('.drag-handle');
    if (!handle) return;
    var li = handle.closest('.project[data-project]');
    if (li && li.dataset.project !== 'all') li.setAttribute('draggable', 'true');
  });
  document.addEventListener('mouseup', function () {
    projectListEl.querySelectorAll('.project[draggable="true"]').forEach(function (li) {
      li.removeAttribute('draggable');
    });
  });

  projectListEl.addEventListener('dragstart', function (e) {
    var li = e.target.closest('.project[draggable="true"]');
    if (!li) return;
    dragSrcId = li.dataset.project;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragSrcId); } catch (err) { /* Firefox needs this set; harmless if it throws elsewhere */ }
  });
  // Drop targets are any real project row — only the row being dragged ever
  // carries draggable="true" (set on its handle's mousedown), so the target
  // under the pointer must be matched on data-project instead.
  function dropTargetRow(e) {
    var li = e.target.closest('.project[data-project]');
    if (!li || li.dataset.project === 'all') return null;
    return li;
  }
  projectListEl.addEventListener('dragover', function (e) {
    if (!dragSrcId) return;
    var li = dropTargetRow(e);
    if (!li || li.dataset.project === dragSrcId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var rect = li.getBoundingClientRect();
    var before = (e.clientY - rect.top) < rect.height / 2;
    clearDropMarkers();
    li.classList.add(before ? 'drop-before' : 'drop-after');
  });
  projectListEl.addEventListener('drop', function (e) {
    if (!dragSrcId) return;
    var li = dropTargetRow(e);
    if (!li) return;
    e.preventDefault();
    var rect = li.getBoundingClientRect();
    var before = (e.clientY - rect.top) < rect.height / 2;
    reorderProject(dragSrcId, li.dataset.project, before);
  });
  projectListEl.addEventListener('dragend', function () {
    dragSrcId = null;
    clearDropMarkers();
    var dragging = projectListEl.querySelector('.project.dragging');
    if (dragging) dragging.classList.remove('dragging');
  });

  // ---------- add button (speed-dial: Task / Note) ----------
  var fabWrap = document.getElementById('fabWrap');
  document.getElementById('fabMainBtn').addEventListener('click', function () {
    fabWrap.classList.toggle('open');
  });
  document.getElementById('fabTaskBtn').addEventListener('click', function () {
    fabWrap.classList.remove('open');
    taskModal(null);
  });
  document.getElementById('fabNoteBtn').addEventListener('click', function () {
    fabWrap.classList.remove('open');
    noteModal(null);
  });
  document.addEventListener('click', function (e) {
    if (!fabWrap.contains(e.target)) fabWrap.classList.remove('open');
  });

  // ---------- view / filter wiring ----------
  function switchView(view) {
    filter.view = view;
    // Tasks and Notes are top-level views, not a per-project drill-down —
    // landing on either one (from the topbar, not from a project row) always
    // shows everything, regardless of which project you were last looking at.
    if (view === 'tasks' || view === 'notes') filter.project = 'all';
    document.querySelectorAll('[data-view]').forEach(function (b) { b.classList.toggle('active', b.dataset.view === view); });
    document.getElementById('view-tasks').classList.toggle('active', view === 'tasks');
    document.getElementById('view-notes').classList.toggle('active', view === 'notes');
    document.getElementById('view-analysis').classList.toggle('active', view === 'analysis');
    document.getElementById('view-project').classList.toggle('active', view === 'project');
    document.getElementById('view-completed').classList.toggle('active', view === 'completed');
    document.getElementById('view-calendar').classList.toggle('active', view === 'calendar');
    if (view === 'tasks') { renderTasks(); renderUpcoming(); }
    if (view === 'notes') renderNotes();
    if (view === 'analysis') renderAnalysis();
    if (view === 'project') renderProjectView();
    if (view === 'completed') renderCompletedView();
    if (view === 'calendar') renderCalendarView();
    renderProjectList(); // refresh sidebar highlighting (project row / Completed bucket)
  }
  document.querySelectorAll('[data-view]').forEach(function (btn) {
    btn.addEventListener('click', function () { switchView(btn.dataset.view); });
  });

  document.getElementById('projectViewToggle').addEventListener('click', function (e) {
    var btn = e.target.closest('button'); if (!btn) return;
    projectViewMode = btn.dataset.mode;
    safeSet(PROJECT_VIEW_MODE_KEY, projectViewMode);
    renderProjectView();
  });

  document.getElementById('projectTasksWrap').addEventListener('click', onDateToggleClick(renderProjectView));
  document.getElementById('projectTasksWrap').addEventListener('click', onTaskListClick);
  wireDateDragDrop(document.getElementById('projectTasksWrap'));

  document.getElementById('completedList').addEventListener('click', onDateToggleClick(renderCompletedView));
  document.getElementById('completedList').addEventListener('click', onTaskListClick);

  document.getElementById('completedBucketBtn').addEventListener('click', function () {
    switchView('completed');
  });
  document.getElementById('clearCompletedBtn').addEventListener('click', function () {
    var doneTasks = state.tasks.filter(function (t) { return t.done; });
    if (!doneTasks.length) return;
    if (!confirm('Permanently delete all ' + doneTasks.length + ' completed task' + (doneTasks.length === 1 ? '' : 's') + '? This cannot be undone.')) return;
    state.tasks = state.tasks.filter(function (t) { return !t.done; });
    save(); renderAll();
  });

  document.getElementById('projectList').addEventListener('click', function (e) {
    var editBtn = e.target.closest('[data-action="edit-project"]');
    if (editBtn) { projectModal(state.projects.find(function (p) { return p.id === editBtn.dataset.id; })); return; }
    var li = e.target.closest('.project');
    if (!li) return;
    filter.project = li.dataset.project;
    switchView('project');
    renderAll();
  });

  document.getElementById('addProjectBtn').addEventListener('click', function () { projectModal(null); });

  document.getElementById('searchInput').addEventListener('input', function (e) {
    filter.query = e.target.value.trim().toLowerCase();
    renderAll();
  });

  function onTaskListClick(e) {
    var toggle = e.target.closest('[data-action="toggle-task"]');
    if (toggle) {
      var t = state.tasks.find(function (x) { return x.id === toggle.dataset.id; });
      if (t) {
        if (!t.done && state.focusTaskId === t.id) { completeFocus(); return; }
        t.done = !t.done;
        save(); renderAll();
      }
      return;
    }
    var focusBtn = e.target.closest('[data-action="focus-task"]');
    if (focusBtn && !focusBtn.disabled) { startFocus(focusBtn.dataset.id); return; }
    var delBtn = e.target.closest('[data-action="delete-task"]');
    if (delBtn) {
      if (state.focusTaskId === delBtn.dataset.id) state.focusTaskId = null;
      state.tasks = state.tasks.filter(function (x) { return x.id !== delBtn.dataset.id; });
      save(); renderAll();
      return;
    }
    // Anything else on the row (title, badges, dot…) opens it for editing —
    // there's no separate edit icon anymore.
    var row = e.target.closest('.task[data-id]');
    if (row) { taskModal(state.tasks.find(function (x) { return x.id === row.dataset.id; })); }
  }
  document.getElementById('taskList').addEventListener('click', onTaskListClick);
  document.getElementById('upcomingList').addEventListener('click', onDateToggleClick(renderUpcoming));
  document.getElementById('upcomingList').addEventListener('click', onTaskListClick);
  wireDateDragDrop(document.getElementById('upcomingList'));

  document.getElementById('taskScopeControl').addEventListener('click', function (e) {
    var btn = e.target.closest('button'); if (!btn) return;
    taskScope = btn.dataset.taskScope;
    safeSet(TASK_SCOPE_KEY, taskScope);
    applyTaskScope();
  });

  function onNoteListClick(e) {
    var delBtn = e.target.closest('[data-action="delete-note"]');
    if (delBtn) {
      if (confirm('Delete this note?')) {
        state.notes = state.notes.filter(function (x) { return x.id !== delBtn.dataset.id; });
        save(); renderAll();
      }
      return;
    }
    var convertBtn = e.target.closest('[data-action="convert"]');
    if (convertBtn) {
      var note = state.notes.find(function (n) { return n.id === convertBtn.dataset.note; });
      if (!note) return;
      var action = note.actions[parseInt(convertBtn.dataset.idx, 10)];
      if (!action || action.converted) return;
      action.converted = true;
      state.tasks.unshift({ id: nextId('t'), title: action.text, projectId: note.projectId, priority: 'med', time: 1, date: todayISO(), done: false, focusStartedAt: null, actualSeconds: null });
      save(); renderAll();
      return;
    }
    // A click on the action-item checkbox (or its label) is handled by the
    // 'change' listener below — don't also open the edit modal underneath it.
    if (e.target.closest('[data-action="toggle-action"]')) return;
    // Anything else on the card (title, meta, points, empty space…) opens it
    // for editing — same "the whole row is the button" pattern as tasks.
    var card = e.target.closest('.note[data-id]');
    if (card) { noteModal(state.notes.find(function (x) { return x.id === card.dataset.id; })); }
  }
  function onNoteListChange(e) {
    var chk = e.target.closest('[data-action="toggle-action"]');
    if (!chk) return;
    var note = state.notes.find(function (n) { return n.id === chk.dataset.note; });
    if (!note) return;
    var action = note.actions[parseInt(chk.dataset.idx, 10)];
    if (action) { action.done = chk.checked; save(); }
  }
  document.getElementById('noteList').addEventListener('click', onNoteListClick);
  document.getElementById('noteList').addEventListener('change', onNoteListChange);
  document.getElementById('projectNotesWrap').addEventListener('click', onNoteListClick);
  document.getElementById('projectNotesWrap').addEventListener('change', onNoteListChange);

  // ---------- export / import ----------
  document.getElementById('exportBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'btrdesk-backup-' + todayISO() + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
  document.getElementById('importBtn').addEventListener('click', function () {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', function (e) {
    var file = e.target.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data.projects || !data.tasks || !data.notes) throw new Error('bad shape');
        if (!confirm('Replace all current data with this backup?')) return;
        state = migrate(data);
        save(); renderAll();
      } catch (err) {
        alert('That file does not look like a BTR\'s Desk backup.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // ---------- about / cross-machine sync instructions ----------
  var REPO_URL = 'https://github.com/Bhuvan-Teja/BTRDesk';
  function aboutModal() {
    openModal(
      '<h2>About BTR\'s Desk</h2>'
      + '<p>A minimal, single-user tool for allocating time across projects and '
      + 'capturing meeting notes. No backend — everything lives in this browser\'s '
      + 'local storage, and the app itself is just static files served from '
      + '<a href="' + REPO_URL + '" target="_blank" rel="noopener">this GitHub repo</a>.</p>'

      + '<h3>Move your data to another machine</h3>'
      + '<p>Opening this app on a different computer starts with a blank slate — '
      + 'local storage doesn\'t travel with the page. To carry your tasks and notes '
      + 'over, hand them through the repo\'s <code>sync/backup.json</code> file:</p>'

      + '<p><b>On the machine with your current data:</b></p>'
      + '<ol>'
      + '<li>Click <b>Export backup</b> (bottom-left) — saves <code>btrdesk-backup-&lt;date&gt;.json</code> to Downloads.</li>'
      + '<li>Go to <a href="' + REPO_URL + '/tree/main/sync" target="_blank" rel="noopener">the sync folder</a> on GitHub → '
      + '<b>Add file → Upload files</b> → drag in that file, rename it to exactly <code>backup.json</code>, and commit '
      + '(GitHub will warn the file already exists — that\'s expected, confirm the replace).</li>'
      + '</ol>'

      + '<p><b>On the machine you\'re moving to:</b></p>'
      + '<ol>'
      + '<li>Go to <a href="' + REPO_URL + '/blob/main/sync/backup.json" target="_blank" rel="noopener">sync/backup.json</a> on GitHub → click the download icon → save it.</li>'
      + '<li>Click <b>Import</b> (next to Export backup) → pick the file you just downloaded.</li>'
      + '</ol>'

      + '<div class="callout">No merge — whichever copy you push last completely overwrites the '
      + 'other. Download and Import the latest <code>backup.json</code> before making new changes '
      + 'on a machine you haven\'t used in a while, so you don\'t lose an edit.</div>'

      + '<div class="modal-actions"><span></span><div class="modal-actions-right">'
      + '<button type="button" class="btn-primary" id="mAboutClose">Close</button>'
      + '</div></div>',
      true
    );
    document.getElementById('mAboutClose').addEventListener('click', closeModal);
  }
  document.getElementById('aboutBtn').addEventListener('click', aboutModal);

  // ---------- sidebar resize / collapse ----------
  var rail = document.getElementById('rail');
  var railResize = document.getElementById('railResize');
  var collapseBtn = document.getElementById('sidebarCollapseBtn');
  var reopenBtn = document.getElementById('sidebarReopenBtn');

  (function initSidebar() {
    var savedWidth = parseInt(safeGet(UI_WIDTH_KEY, ''), 10);
    if (savedWidth && savedWidth >= 180 && savedWidth <= 440) rail.style.width = savedWidth + 'px';
    var collapsed = safeGet(UI_COLLAPSED_KEY, '0') === '1';
    setSidebarCollapsed(collapsed);
  })();

  function setSidebarCollapsed(collapsed) {
    rail.classList.toggle('is-hidden', collapsed);
    reopenBtn.hidden = !collapsed;
    safeSet(UI_COLLAPSED_KEY, collapsed ? '1' : '0');
  }
  collapseBtn.addEventListener('click', function () { setSidebarCollapsed(true); });
  reopenBtn.addEventListener('click', function () { setSidebarCollapsed(false); });

  var resizing = false, resizeStartX = 0, resizeStartWidth = 0;
  railResize.addEventListener('mousedown', function (e) {
    resizing = true; resizeStartX = e.clientX; resizeStartWidth = rail.getBoundingClientRect().width;
    rail.classList.add('is-resizing');
    railResize.classList.add('active');
    e.preventDefault();
  });
  document.addEventListener('mousemove', function (e) {
    if (!resizing) return;
    var w = Math.min(440, Math.max(180, resizeStartWidth + (e.clientX - resizeStartX)));
    rail.style.width = w + 'px';
  });
  document.addEventListener('mouseup', function () {
    if (!resizing) return;
    resizing = false;
    rail.classList.remove('is-resizing');
    railResize.classList.remove('active');
    safeSet(UI_WIDTH_KEY, Math.round(rail.getBoundingClientRect().width).toString());
  });

  // ---------- keyboard ----------
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !overlay.classList.contains('open')) {
      var tag = document.activeElement.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        document.getElementById('searchInput').focus();
      }
    }
  });

  // ---------- day rollover ----------
  // A tab left open across midnight shouldn't need a manual reload to
  // notice: check the local date periodically, and immediately whenever the
  // tab regains focus/visibility (an interval alone can be throttled for
  // minutes on end while a tab is backgrounded — but that's fine, since
  // nothing's showing anyone a stale "Today" until they actually look).
  var lastKnownDate = todayISO();
  function checkDateRollover() {
    var now = todayISO();
    if (now === lastKnownDate) return;
    lastKnownDate = now;
    document.getElementById('todayDate').textContent = todayLabel();
    renderAll();
  }
  setInterval(checkDateRollover, 60 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkDateRollover(); });
  window.addEventListener('focus', checkDateRollover);

  // ---------- init ----------
  document.getElementById('todayDate').textContent = todayLabel();
  renderNotifyBtn();
  renderAll();
})();
