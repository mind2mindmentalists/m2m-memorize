(() => {
  let DATA = null;
  let LINES = [];
  let BY_ID = new Map();
  let sourceMarkdown = "";
  const STORE_KEY = "m2m-memorize-v2";
  const DAY = 24 * 60 * 60 * 1000;
  const INTERVALS = [0, 2 / 24, 8 / 24, 1, 2, 4, 8];
  const STOP_WORDS = new Set(
    "the a an is are was were be been being have has had do does did will would could should may might shall can to of in for on with at by from as into through during before after but and or yet so if that this these those i me my we our you your he him his she her it its they them their what which who whom not just very".split(
      " ",
    ),
  );

  const MODES = [
    ["due", "Due"],
    ["focus", "Focus"],
    ["trouble", "Trouble"],
    ["full", "Full Run"],
    ["random", "Random"],
  ];

  const app = document.getElementById("app");
  let state = normalizeState(loadState());
  let runtime = {
    queue: [],
    done: new Set(),
    index: 0,
    reveal: false,
    search: "",
    toast: "",
    editingId: null,
    editText: "",
    savingMd: false,
    password: "",
    sessionHits: 0,
    sessionMisses: 0,
  };

  function defaultState() {
    return {
      profile: "james",
      role: "james",
      section: "all",
      mode: "due",
      letterMode: false,
      edits: {},
      progress: { james: {}, marina: {} },
      focus: { james: [], marina: [] },
      skipped: { james: [], marina: [] },
    };
  }

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || defaultState();
    } catch {
      return defaultState();
    }
  }

  function normalizeState(value) {
    const base = defaultState();
    const next = { ...base, ...value };
    next.progress = {
      james: { ...(value?.progress?.james || {}) },
      marina: { ...(value?.progress?.marina || {}) },
    };
    next.focus = {
      james: Array.isArray(value?.focus?.james) ? value.focus.james : [],
      marina: Array.isArray(value?.focus?.marina) ? value.focus.marina : [],
    };
    next.skipped = {
      james: Array.isArray(value?.skipped?.james) ? value.skipped.james : [],
      marina: Array.isArray(value?.skipped?.marina) ? value.skipped.marina : [],
    };
    next.edits = { ...(value?.edits || {}) };
    next.letterMode = Boolean(value?.letterMode);
    if (!["james", "marina"].includes(next.profile)) next.profile = "james";
    if (!["james", "marina", "both"].includes(next.role)) next.role = "james";
    if (!MODES.some(([mode]) => mode === next.mode)) next.mode = "due";
    return next;
  }

  function saveState() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function progressStore() {
    state.progress[state.profile] ||= {};
    return state.progress[state.profile];
  }

  function focusSet() {
    state.focus[state.profile] ||= [];
    return new Set(state.focus[state.profile]);
  }

  function skippedSet() {
    state.skipped[state.profile] ||= [];
    return new Set(state.skipped[state.profile]);
  }

  function progressFor(id) {
    return (
      progressStore()[id] || {
        level: 0,
        hits: 0,
        misses: 0,
        streak: 0,
        dueAt: 0,
        lastSeen: 0,
      }
    );
  }

  function setProgress(id, value) {
    progressStore()[id] = { ...progressFor(id), ...value };
    saveState();
  }

  function lineText(line) {
    return state.edits[line.id]?.text || line.text;
  }

  function lineWords(line) {
    return (lineText(line).match(/[A-Za-z0-9']+/g) || []).length;
  }

  function sections() {
    return [...new Set(LINES.map((line) => line.section))];
  }

  function filteredLines({ includeSkipped = false } = {}) {
    const skipped = skippedSet();
    return LINES.filter((line) => {
      const roleMatch = state.role === "both" || line.speaker === state.role;
      const sectionMatch = state.section === "all" || line.section === state.section;
      const skipMatch = includeSkipped || !skipped.has(line.id);
      return roleMatch && sectionMatch && skipMatch;
    });
  }

  function visibleListLines() {
    const needle = runtime.search.trim().toLowerCase();
    const lines = filteredLines({ includeSkipped: true });
    if (!needle) return lines;
    return lines.filter((line) =>
      [lineText(line), line.cue, line.section, line.beat, line.speaker]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }

  function isDue(line, now = Date.now()) {
    return progressFor(line.id).dueAt <= now;
  }

  function buildQueue(mode = state.mode) {
    const now = Date.now();
    const lines = filteredLines();
    const focused = focusSet();
    let queue = lines;

    if (mode === "due") {
      queue = lines.filter((line) => isDue(line, now));
      queue.sort((a, b) => {
        const ap = progressFor(a.id);
        const bp = progressFor(b.id);
        return ap.dueAt - bp.dueAt || bp.misses - ap.misses || a.sourceLine - b.sourceLine;
      });
    }

    if (mode === "focus") {
      queue = lines.filter((line) => focused.has(line.id));
    }

    if (mode === "trouble") {
      queue = lines
        .filter((line) => progressFor(line.id).misses > 0)
        .sort((a, b) => progressFor(b.id).misses - progressFor(a.id).misses);
    }

    if (mode === "random") {
      queue = shuffle(lines);
    }

    return queue.map((line) => line.id);
  }

  function shuffle(items) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function start(mode = state.mode) {
    state.mode = mode;
    runtime.queue = buildQueue(mode);
    runtime.done = new Set();
    runtime.index = 0;
    runtime.reveal = false;
    runtime.sessionHits = 0;
    runtime.sessionMisses = 0;
    saveState();
    render();
  }

  function activeQueue() {
    return runtime.queue.filter((id) => !runtime.done.has(id));
  }

  function currentLine() {
    const active = activeQueue();
    if (runtime.index >= active.length) runtime.index = 0;
    return BY_ID.get(active[runtime.index]);
  }

  function nextLine() {
    const active = activeQueue();
    if (active.length > 0) runtime.index = (runtime.index + 1) % active.length;
    runtime.reveal = false;
    render();
  }

  function previousLine() {
    runtime.index = Math.max(0, runtime.index - 1);
    runtime.reveal = false;
    render();
  }

  function reviewDelay(level, max) {
    const ratio = max > 0 ? level / max : 0;
    const index = Math.min(INTERVALS.length - 1, Math.floor(ratio * (INTERVALS.length - 1)));
    return INTERVALS[index] * DAY;
  }

  function levelLine(line, { done = false } = {}) {
    const current = progressFor(line.id);
    const now = Date.now();
    const max = maxLevel(lineText(line));
    const level = Math.min(max, current.level + 1);
    setProgress(line.id, {
      level,
      hits: current.hits + 1,
      streak: current.streak + 1,
      dueAt: now + reviewDelay(level, max),
      lastSeen: now,
    });
    if (done) runtime.done.add(line.id);
    runtime.sessionHits += 1;
    runtime.reveal = false;
    showToast(levelLabel(level, max));
  }

  function scoreCurrent(good) {
    const line = currentLine();
    if (!line) return;
    const current = progressFor(line.id);
    const now = Date.now();

    if (good) {
      levelLine(line, { done: true });
      return;
    }

    const initials = initialsLevel(lineText(line));
    setProgress(line.id, {
      level: current.level > initials ? initials : Math.max(0, current.level - 1),
      misses: current.misses + 1,
      streak: 0,
      dueAt: now,
      lastSeen: now,
    });
    runtime.sessionMisses += 1;
    runtime.reveal = true;
    showToast("Marked for review");
    render();
  }

  function drillCurrent() {
    const line = currentLine();
    if (!line) return;
    levelLine(line);
  }

  function jumpToInitials() {
    const line = currentLine();
    if (!line) return;
    const current = progressFor(line.id);
    const level = initialsLevel(lineText(line));
    setProgress(line.id, {
      level,
      streak: current.streak,
      dueAt: Date.now(),
      lastSeen: Date.now(),
    });
    runtime.reveal = false;
    showToast("Jumped to initials only");
  }

  function resetCurrentLine() {
    const line = currentLine();
    if (!line) return;
    const store = progressStore();
    delete store[line.id];
    saveState();
    runtime.reveal = false;
    showToast("Line reset");
  }

  function skipCurrentLine() {
    const line = currentLine();
    if (!line) return;
    const skipped = skippedSet();
    if (skipped.has(line.id)) {
      skipped.delete(line.id);
      state.skipped[state.profile] = [...skipped];
      saveState();
      showToast("Restored");
      return;
    }
    skipped.add(line.id);
    state.skipped[state.profile] = [...skipped];
    runtime.done.add(line.id);
    saveState();
    showToast("Skipped");
  }

  function toggleFocus(id) {
    const focus = focusSet();
    if (focus.has(id)) {
      focus.delete(id);
      showToast("Removed from focus");
    } else {
      focus.add(id);
      showToast("Added to focus");
    }
    state.focus[state.profile] = [...focus];
    saveState();
    render();
  }

  function selectLine(id) {
    const lines = visibleListLines();
    const index = Math.max(0, lines.findIndex((line) => line.id === id));
    const ordered = [...lines.slice(index), ...lines.slice(0, index)];
    state.mode = "full";
    runtime.queue = ordered.map((line) => line.id);
    runtime.done = new Set();
    runtime.index = 0;
    runtime.reveal = false;
    saveState();
    render();
  }

  function statsFor(lines) {
    const focused = focusSet();
    return lines.reduce(
      (stats, line) => {
        const progress = progressFor(line.id);
        stats.words += lineWords(line);
        if (progress.level >= maxLevel(lineText(line))) stats.mastered += 1;
        if (isDue(line)) stats.due += 1;
        if (focused.has(line.id)) stats.focus += 1;
        if (progress.misses > 0) stats.trouble += 1;
        return stats;
      },
      { total: lines.length, words: 0, mastered: 0, due: 0, focus: 0, trouble: 0 },
    );
  }

  function render() {
    if (!LINES.length) {
      app.innerHTML = `<section class="empty-card">No script data found.</section>`;
      return;
    }

    const lines = filteredLines();
    const stats = statsFor(lines);
    const line = currentLine();
    const focus = focusSet();
    const currentProgress = line ? progressFor(line.id) : null;

    app.innerHTML = `
      <input id="import-file" class="hidden-input" type="file" accept="application/json" />
      ${renderTopbar()}
      ${renderToolbar()}
      <section class="layout">
        <div>
          ${renderStats(stats)}
          ${renderPractice(line, currentProgress, focus)}
        </div>
        ${renderBrowser(line)}
      </section>
      ${runtime.toast ? `<div class="toast">${escapeHtml(runtime.toast)}</div>` : ""}
    `;
  }

  function boot(scriptData, sourceMd) {
    DATA = scriptData || { lines: [] };
    LINES = DATA.lines || [];
    BY_ID = new Map(LINES.map((line) => [line.id, line]));
    sourceMarkdown = sourceMd || "";
    start(state.mode);
  }

  function renderUnlock(error = "") {
    app.innerHTML = `
      <section class="unlock-shell">
        <div class="unlock-panel">
          <div class="unlock-mark">M2M</div>
          <h1>Vegas Memorize</h1>
          <p class="subtle">Enter the show password.</p>
          <form data-action="unlock-form">
            <input id="unlock-password" type="password" autocomplete="current-password" placeholder="Password" autofocus />
            <button class="btn primary" type="submit">Unlock</button>
          </form>
          ${error ? `<div class="unlock-error">${escapeHtml(error)}</div>` : ""}
        </div>
      </section>
    `;
    document.getElementById("unlock-password")?.focus();
  }

  async function unlockApp() {
    const input = document.getElementById("unlock-password");
    const password = input?.value || "";
    try {
      const payload = await decryptEncryptedPayload(password);
      runtime.password = password;
      boot(payload.script, payload.sourceMd);
    } catch {
      renderUnlock("That password did not unlock the script.");
    }
  }

  async function decryptEncryptedPayload(password) {
    const payload = window.M2M_ENCRYPTED_PAYLOAD;
    if (!payload) throw new Error("Missing encrypted payload");
    const salt = fromBase64(payload.salt);
    const iv = fromBase64(payload.iv);
    const ciphertext = fromBase64(payload.ciphertext);
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: payload.iterations, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(clear));
  }

  function fromBase64(value) {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  }

  function renderTopbar() {
    return `
      <section class="topbar">
        <div class="brand">
          <p class="eyebrow">Mind2Mind</p>
          <h1>Vegas Memorize</h1>
          <div class="subtle">${escapeHtml(DATA.source || "Script")} · ${LINES.length} lines · ${escapeHtml(state.profile)} profile</div>
        </div>
        <div class="top-actions">
          <button class="btn primary small" data-action="download-md">Download MD</button>
          <button class="btn blue small" data-action="save-md">${runtime.savingMd ? "Saving..." : "Save MD"}</button>
          <button class="btn ghost small" data-action="export">Export</button>
          <button class="btn ghost small" data-action="import">Import</button>
          <button class="btn ghost small" data-action="reset">Reset</button>
        </div>
      </section>
    `;
  }

  function renderToolbar() {
    return `
      <section class="toolbar">
        <div class="field">
          <label for="profile">Profile</label>
          <select id="profile" data-change="profile">
            ${option("james", "James", state.profile)}
            ${option("marina", "Marina", state.profile)}
          </select>
        </div>
        <div class="field">
          <label for="role">Lines</label>
          <select id="role" data-change="role">
            ${option("james", "James only", state.role)}
            ${option("marina", "Marina only", state.role)}
            ${option("both", "Both", state.role)}
          </select>
        </div>
        <div class="field">
          <label for="section">Section</label>
          <select id="section" data-change="section">
            ${option("all", "Full show", state.section)}
            ${sections().map((section) => option(section, section, state.section)).join("")}
          </select>
        </div>
        <div class="field">
          <label>Run</label>
          <div class="segmented">
            ${MODES.map(
              ([mode, label]) =>
                `<button class="mode ${state.mode === mode ? "active" : ""}" data-action="start" data-mode="${mode}">${label}</button>`,
            ).join("")}
          </div>
        </div>
        <div class="field">
          <label>View</label>
          <button class="mode ${state.letterMode ? "active" : ""}" data-action="toggle-letter-mode">Initials only</button>
        </div>
      </section>
    `;
  }

  function renderStats(stats) {
    return `
      <section class="stats">
        ${stat("Lines", stats.total, `${stats.words.toLocaleString()} words`)}
        ${stat("Due", stats.due, `${Math.round((stats.due / Math.max(stats.total, 1)) * 100)}% now`)}
        ${stat("Mastered", stats.mastered, `${Math.round((stats.mastered / Math.max(stats.total, 1)) * 100)}% complete`)}
        ${stat("Focus", stats.focus, `${stats.trouble} trouble`)}
      </section>
    `;
  }

  function renderPractice(line, progress, focus) {
    const active = activeQueue();
    if (!line) {
      return `
        <section class="practice-panel empty-card">
          <div class="complete">
            <h2>Run Complete</h2>
            <p class="subtle">${runtime.sessionHits} hit · ${runtime.sessionMisses} missed</p>
            <div class="button-row">
              <button class="btn primary" data-action="start" data-mode="${state.mode}">Run Again</button>
              <button class="btn ghost" data-action="start" data-mode="full">Full Run</button>
            </div>
          </div>
        </section>
      `;
    }

    const text = lineText(line);
    if (state.role === "both" && line.speaker !== state.profile) {
      return renderPartnerLine(line, active, focus);
    }

    const max = maxLevel(text);
    const rawLevel = Math.min(progress.level || 0, max);
    const displayLevel = state.letterMode ? Math.min(initialsLevel(text), max) : rawLevel;
    const pct = max > 0 ? Math.round((rawLevel / max) * 100) : 100;
    const phase = state.letterMode
      ? `Initials only · saved ${levelLabel(rawLevel, max)}`
      : levelLabel(rawLevel, max);
    const focused = focus.has(line.id);
    const skippedCurrent = skippedSet().has(line.id);
    const isEdited = Boolean(state.edits[line.id]);
    const isEditing = runtime.editingId === line.id;
    const masked = runtime.reveal ? escapeHtml(text) : renderMaskedLine(text, displayLevel);
    const initials = initialsLevel(text);
    const canJump = rawLevel < initials;

    return `
      <section class="practice-panel">
        <div class="card-header">
          <div class="meta-row">
            <span class="speaker ${line.speaker}">${line.speaker}</span>
            <span class="source">Source line ${line.sourceLine} · ${Math.min(runtime.index + 1, active.length)}/${Math.max(active.length, 1)}${isEdited ? " · Edited" : ""}</span>
          </div>
          <div>
            <h2>${escapeHtml(line.section)}</h2>
            <div class="section-title">${escapeHtml(line.beat)}</div>
          </div>
          <div class="progress" aria-label="Memorization progress"><span style="width:${pct}%"></span></div>
          <div class="source">${escapeHtml(phase)}</div>
        </div>

        <div class="cue-box">
          <div class="cue-label">Cue</div>
          <div class="cue-text">${escapeHtml(line.cue)}</div>
        </div>

        ${
          isEditing
            ? `<div class="edit-card">
                <label for="line-edit">Edit line</label>
                <textarea id="line-edit">${escapeHtml(runtime.editText)}</textarea>
                <div class="button-row">
                  <button class="btn green" data-action="save-line-edit" data-id="${line.id}">Save Line</button>
                  <button class="btn ghost" data-action="cancel-line-edit">Cancel</button>
                </div>
              </div>`
            : `<div class="recall-card">
                <div class="line">${masked}</div>
              </div>`
        }

        <div class="score-row">
          <button class="btn blue" data-action="reveal">${runtime.reveal ? "Hide" : "Reveal"}</button>
          <button class="btn blue" data-action="drill">Drill</button>
          <button class="btn green" data-action="score" data-good="true">Nailed</button>
          <button class="btn red" data-action="score" data-good="false">Missed</button>
        </div>
        <div class="secondary-actions">
          ${canJump ? `<button class="btn ghost small" data-action="jump-initials">Jump to Initials</button>` : ""}
          ${rawLevel > 0 ? `<button class="btn ghost small" data-action="reset-line">Reset Line</button>` : ""}
          <button class="btn ghost small" data-action="skip-line">${skippedCurrent ? "Restore" : "Skip"}</button>
          <button class="btn ghost small" data-action="edit-line" data-id="${line.id}">Edit Line</button>
          <button class="btn ghost small" data-action="prev">Previous</button>
          <button class="btn ghost small" data-action="next">Next</button>
          <button class="btn ghost small" data-action="focus" data-id="${line.id}">${focused ? "Unfocus" : "Focus"}</button>
        </div>
      </section>
    `;
  }

  function renderPartnerLine(line, active, focus) {
    const focused = focus.has(line.id);
    const skippedCurrent = skippedSet().has(line.id);
    const text = lineText(line);
    const isEdited = Boolean(state.edits[line.id]);
    return `
      <section class="practice-panel partner-panel">
        <div class="card-header">
          <div class="meta-row">
            <span class="speaker ${line.speaker}">${line.speaker}</span>
            <span class="source">Their line · ${Math.min(runtime.index + 1, active.length)}/${Math.max(active.length, 1)}${isEdited ? " · Edited" : ""}</span>
          </div>
          <div>
            <h2>${escapeHtml(line.section)}</h2>
            <div class="section-title">${escapeHtml(line.beat)}</div>
          </div>
        </div>
        <div class="cue-box">
          <div class="cue-label">Cue</div>
          <div class="cue-text">${escapeHtml(line.cue)}</div>
        </div>
        <div class="recall-card partner-card">
          <div class="line">${escapeHtml(text)}</div>
        </div>
        <div class="score-row">
          <button class="btn primary" data-action="partner-next">Next</button>
        </div>
        <div class="secondary-actions">
          <button class="btn ghost small" data-action="prev">Previous</button>
          <button class="btn ghost small" data-action="skip-line">${skippedCurrent ? "Restore" : "Skip"}</button>
          <button class="btn ghost small" data-action="edit-line" data-id="${line.id}">Edit Line</button>
          <button class="btn ghost small" data-action="focus" data-id="${line.id}">${focused ? "Unfocus" : "Focus"}</button>
        </div>
      </section>
    `;
  }

  function renderBrowser(activeLine) {
    const list = visibleListLines();
    return `
      <aside class="line-list">
        <div class="list-head">
          <div class="browser-filters">
            <input id="search" type="search" value="${escapeAttr(runtime.search)}" placeholder="Search lines, cues, sections" />
          </div>
          <div class="subtle">${list.length} visible</div>
        </div>
        <div class="list-body">
          ${list.map((line) => renderListItem(line, activeLine?.id === line.id)).join("")}
        </div>
      </aside>
    `;
  }

  function renderListItem(line, active) {
    const progress = progressFor(line.id);
    const text = lineText(line);
    const max = maxLevel(text);
    const pct = max > 0 ? Math.round((Math.min(progress.level || 0, max) / max) * 100) : 100;
    const skipped = skippedSet().has(line.id);
    const edited = Boolean(state.edits[line.id]);
    return `
      <button class="list-item ${active ? "active" : ""}" data-action="select-line" data-id="${line.id}">
        <div class="list-top">
          <span class="speaker ${line.speaker}">${line.speaker}</span>
          <span class="source">${skipped ? "Skipped · " : ""}${edited ? "Edited · " : ""}L${line.sourceLine}</span>
        </div>
        <div class="beat">${escapeHtml(line.beat)}</div>
        <div class="line-preview">${escapeHtml(truncate(text, 124))}</div>
        <div class="progress"><span style="width:${pct}%"></span></div>
      </button>
    `;
  }

  function stat(label, value, hint) {
    return `
      <div class="stat">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(String(value))}</div>
        <div class="hint">${escapeHtml(hint)}</div>
      </div>
    `;
  }

  function option(value, label, selected) {
    return `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }

  function wordImportance(word) {
    const clean = word.toLowerCase().replace(/[^a-z0-9']/g, "");
    if (!clean || clean.length <= 1) return 0;
    if (STOP_WORDS.has(clean)) return 0;
    if (/^\[[^\]]+\]$/.test(word)) return 3;
    if (/[0-9]/.test(clean)) return 3;
    return clean.length <= 3 ? 1 : 2;
  }

  function wordSlots(text) {
    const tokens = text.split(/(\s+)/);
    const slots = [];
    tokens.forEach((token, index) => {
      if (index % 2 === 0 && token.length > 0 && /[A-Za-z0-9\[]/.test(token)) {
        slots.push({ tokenIndex: index, importance: wordImportance(token), word: token });
      }
    });
    return slots;
  }

  function maxLevel(text) {
    return wordSlots(text).length * 2;
  }

  function initialsLevel(text) {
    return wordSlots(text).length;
  }

  function levelLabel(level, max) {
    const half = Math.round(max / 2);
    if (level <= 0) return "Full text";
    if (level >= max) return "Cue only";
    if (level <= half) return `${level}/${half} to initials`;
    return `${level - half}/${half} initials hidden`;
  }

  function renderMaskedLine(text, level) {
    const max = maxLevel(text);
    if (level >= max) return `<span class="letter">Cue only.</span>`;
    if (level <= 0) return escapeHtml(text);

    const tokens = text.split(/(\s+)/);
    const slots = wordSlots(text);
    const count = slots.length;
    const ordered = [...slots].sort((a, b) => {
      if (a.importance !== b.importance) return a.importance - b.importance;
      return b.tokenIndex - a.tokenIndex;
    });
    const toInitial = new Set(
      ordered.slice(0, Math.min(level, count)).map((slot) => slot.tokenIndex),
    );
    const toGone = new Set(
      ordered.slice(0, Math.max(level - count, 0)).map((slot) => slot.tokenIndex),
    );
    return tokens
      .map((token, index) => {
        if (toGone.has(index)) return `<span class="gone">${escapeHtml(goneToken(token))}</span>`;
        if (toInitial.has(index)) return `<span class="letter">${escapeHtml(initialToken(token))}</span>`;
        return escapeHtml(token);
      })
      .join("");
  }

  function initialToken(token) {
    if (/^\[[^\]]+\]$/.test(token)) {
      const first = token.replace(/\[|\]/g, "").match(/[A-Za-z0-9]/)?.[0] || "?";
      return `[${first}]`;
    }
    const match = token.match(/^([^A-Za-z0-9]*)([A-Za-z0-9])(.*)$/);
    if (!match) return token.charAt(0);
    const trailing = match[3].replace(/[A-Za-z0-9'’]/g, "");
    return `${match[1]}${match[2]}${trailing}`;
  }

  function goneToken(token) {
    const trailing = token.match(/([^A-Za-z0-9'’\]]+)$/)?.[1] || "";
    return `▁▁${trailing}`;
  }

  function truncate(value, length) {
    return value.length > length ? `${value.slice(0, length - 1)}…` : value;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function showToast(message) {
    runtime.toast = message;
    clearTimeout(showToast.timer);
    render();
    showToast.timer = setTimeout(() => {
      runtime.toast = "";
      render();
    }, 1400);
  }

  function markdownLineFor(line, text) {
    const prefix = line.linePrefix || `**${line.speakerLabel || line.speaker}:** `;
    return `${prefix}${text.trim()}`;
  }

  function updatedMarkdown() {
    const source = sourceMarkdown || "";
    const hadTrailingNewline = source.endsWith("\n");
    const mdLines = source.split(/\r?\n/);
    for (const line of LINES) {
      const edit = state.edits[line.id];
      if (!edit || typeof edit.text !== "string") continue;
      mdLines[line.sourceLine - 1] = markdownLineFor(line, edit.text);
    }
    let markdown = mdLines.join("\n");
    if (hadTrailingNewline && !markdown.endsWith("\n")) markdown += "\n";
    return markdown;
  }

  function downloadMarkdown() {
    const blob = new Blob([updatedMarkdown()], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = DATA.source || "M2M_Vegas_Full_Script.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function saveMarkdownToDisk() {
    runtime.savingMd = true;
    render();
    try {
      const response = await fetch("/api/save-md", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: updatedMarkdown(), password: runtime.password }),
      });
      if (!response.ok) throw new Error("Save failed");
      const result = await response.json();
      sourceMarkdown = updatedMarkdown();
      showToast(result.message || "Markdown saved");
    } catch {
      showToast("Local save unavailable. Use Download MD.");
    } finally {
      runtime.savingMd = false;
      render();
    }
  }

  function startLineEdit(id) {
    const line = BY_ID.get(id);
    if (!line) return;
    runtime.editingId = id;
    runtime.editText = lineText(line);
    runtime.reveal = true;
    render();
    const field = document.getElementById("line-edit");
    field?.focus();
  }

  function cancelLineEdit() {
    runtime.editingId = null;
    runtime.editText = "";
    runtime.reveal = false;
    render();
  }

  function saveLineEdit(id) {
    const line = BY_ID.get(id);
    if (!line) return;
    const text = runtime.editText.trim();
    if (!text) {
      showToast("Line cannot be empty");
      return;
    }
    if (text === line.text) {
      delete state.edits[id];
    } else {
      state.edits[id] = { text, updatedAt: new Date().toISOString() };
    }
    const progress = progressFor(id);
    setProgress(id, { level: Math.min(progress.level, maxLevel(text)), dueAt: Date.now() });
    saveState();
    runtime.editingId = null;
    runtime.editText = "";
    runtime.reveal = false;
    showToast("Line saved");
  }

  function exportData() {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      script: DATA.source,
      state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `m2m-memorize-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function importData(file) {
    if (!file) return;
    const parsed = JSON.parse(await file.text());
    state = normalizeState(parsed.state || parsed);
    saveState();
    start(state.mode);
    showToast("Practice data imported");
  }

  app.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;

    if (action === "start") start(target.dataset.mode || state.mode);
    if (action === "toggle-letter-mode") {
      state.letterMode = !state.letterMode;
      saveState();
      render();
    }
    if (action === "reveal") {
      runtime.reveal = !runtime.reveal;
      render();
    }
    if (action === "score") scoreCurrent(target.dataset.good === "true");
    if (action === "drill") drillCurrent();
    if (action === "jump-initials") jumpToInitials();
    if (action === "reset-line") resetCurrentLine();
    if (action === "skip-line") skipCurrentLine();
    if (action === "partner-next") {
      const line = currentLine();
      if (line) runtime.done.add(line.id);
      runtime.sessionHits += 1;
      runtime.reveal = false;
      render();
    }
    if (action === "next") nextLine();
    if (action === "prev") previousLine();
    if (action === "focus") toggleFocus(target.dataset.id);
    if (action === "select-line") selectLine(target.dataset.id);
    if (action === "export") exportData();
    if (action === "import") document.getElementById("import-file")?.click();
    if (action === "download-md") downloadMarkdown();
    if (action === "save-md") saveMarkdownToDisk();
    if (action === "edit-line") startLineEdit(target.dataset.id);
    if (action === "cancel-line-edit") cancelLineEdit();
    if (action === "save-line-edit") saveLineEdit(target.dataset.id);
    if (action === "reset" && confirm("Reset all saved practice progress?")) {
      state = defaultState();
      saveState();
      start("due");
      showToast("Progress reset");
    }
  });

  app.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-action='unlock-form']");
    if (!form) return;
    event.preventDefault();
    unlockApp();
  });

  app.addEventListener("change", (event) => {
    const target = event.target;
    if (target.id === "import-file") {
      importData(target.files?.[0]).catch(() => showToast("Import failed"));
      return;
    }

    const key = target.dataset.change;
    if (!key) return;
    state[key] = target.value;
    saveState();
    start(state.mode);
  });

  app.addEventListener("input", (event) => {
    if (event.target.id === "line-edit") {
      runtime.editText = event.target.value;
      return;
    }
    if (event.target.id !== "search") return;
    runtime.search = event.target.value;
    render();
    const search = document.getElementById("search");
    search?.focus();
    search?.setSelectionRange(runtime.search.length, runtime.search.length);
  });

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
    if (event.code === "Space") {
      event.preventDefault();
      runtime.reveal = !runtime.reveal;
      render();
    }
    if (event.key === "1") scoreCurrent(true);
    if (event.key === "2") drillCurrent();
    if (event.key === "3") scoreCurrent(false);
    if (event.key === "ArrowRight") nextLine();
    if (event.key === "ArrowLeft") previousLine();
  });

  if (window.M2M_ENCRYPTED_PAYLOAD) {
    renderUnlock();
  } else {
    boot(window.M2M_SCRIPT || { lines: [] }, window.M2M_SOURCE_MD || "");
  }
})();
