/* Knee Rehab Tracker PWA
   - Stores data in localStorage
   - Offline-first (service worker)
   - Editable rehab template (JSON)
*/

const STORAGE_KEY = "kneeRehabTracker:v1";
const TEMPLATE_KEY = "kneeRehabTemplate:v1";

const $ = (id) => document.getElementById(id);

const todayISO = () => {
  const d = new Date();
  // local date ISO (YYYY-MM-DD)
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
};

const formatDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
};

function safeParse(json, fallback) {
  try { return JSON.parse(json); } catch { return fallback; }
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const base = {
    procedure: "general",
    phaseId: "p1",
    logs: {} // { "YYYY-MM-DD": log }
  };
  return raw ? { ...base, ...safeParse(raw, base) } : base;
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadTemplate() {
  const raw = localStorage.getItem(TEMPLATE_KEY);
  if (raw) return safeParse(raw, defaultTemplate("general"));
  return defaultTemplate("general");
}

function saveTemplate(tpl) {
  localStorage.setItem(TEMPLATE_KEY, JSON.stringify(tpl));
}

function defaultTemplate(procedure) {
  // Generic templates (not medical advice). A starting point to track.
  // You should customize to match your surgeon/PT protocol.
  const common = {
    meta: {
      name: "Knee rehab template",
      version: 1,
      warning: "Follow your surgeon/PT restrictions. This is a tracking template, not medical advice."
    },
    phases: [
      {
        id: "p1",
        name: "Phase 1: Early Recovery (Days 1–14)",
        goals: ["Reduce swelling", "Restore motion", "Activate quads/hip"],
        exercises: [
          { id: "ankle_pumps", name: "Ankle pumps", target: "20–30 reps", sets: 1, reps: 25, timerSec: 0 },
          { id: "quad_sets", name: "Quad sets", target: "10–15 reps (5s hold)", sets: 2, reps: 12, timerSec: 0 },
          { id: "heel_slides", name: "Heel slides", target: "10–15 reps", sets: 2, reps: 12, timerSec: 0 },
          { id: "slr", name: "Straight leg raises", target: "2–3×10 (only if knee stays straight)", sets: 2, reps: 10, timerSec: 0 },
          { id: "knee_extension", name: "Passive knee extension hold", target: "2–5 min", sets: 1, reps: 1, timerSec: 180 }
        ]
      },
      {
        id: "p2",
        name: "Phase 2: Mobility & Strength (Weeks 2–6)",
        goals: ["Full ROM (as cleared)", "Normalize gait", "Begin strength"],
        exercises: [
          { id: "bike_easy", name: "Stationary bike (easy)", target: "5–15 min", sets: 1, reps: 1, timerSec: 600 },
          { id: "mini_squat", name: "Mini squats", target: "2–3×10–15", sets: 3, reps: 12, timerSec: 0 },
          { id: "step_ups", name: "Step-ups (low step)", target: "2–3×10 each leg", sets: 3, reps: 10, timerSec: 0 },
          { id: "hamstring_stretch", name: "Hamstring stretch", target: "3×30s", sets: 3, reps: 1, timerSec: 30 },
          { id: "calf_stretch", name: "Calf stretch", target: "3×30s", sets: 3, reps: 1, timerSec: 30 }
        ]
      },
      {
        id: "p3",
        name: "Phase 3: Strength & Control (Weeks 6–12)",
        goals: ["Balance", "Single-leg control", "Strength endurance"],
        exercises: [
          { id: "glute_bridge", name: "Glute bridges", target: "3×12–15", sets: 3, reps: 12, timerSec: 0 },
          { id: "wall_sit", name: "Wall sit", target: "3×20–45s", sets: 3, reps: 1, timerSec: 30 },
          { id: "single_leg_balance", name: "Single-leg balance", target: "3×30–60s", sets: 3, reps: 1, timerSec: 45 },
          { id: "band_side_steps", name: "Band lateral steps", target: "2–3×10–15", sets: 3, reps: 12, timerSec: 0 }
        ]
      },
      {
        id: "p4",
        name: "Phase 4: Return to Activity (3+ months, after clearance)",
        goals: ["Confidence", "Controlled impact", "Sport/work readiness"],
        exercises: [
          { id: "lunges", name: "Bodyweight lunges", target: "3×8–12", sets: 3, reps: 10, timerSec: 0 },
          { id: "walk_jog", name: "Walk/jog intervals", target: "10–20 min", sets: 1, reps: 1, timerSec: 900 },
          { id: "lateral_shuffle", name: "Lateral shuffle (control)", target: "3×20–30s", sets: 3, reps: 1, timerSec: 25 }
        ]
      }
    ]
  };

  // Slightly different starter emphasis by procedure (still generic)
  const procTweaks = {
    general: common,
    acl: {
      ...common,
      meta: { ...common.meta, name: "ACL (generic) tracking template" }
    },
    meniscus: {
      ...common,
      meta: { ...common.meta, name: "Meniscus (generic) tracking template" }
    },
    tka: {
      ...common,
      meta: { ...common.meta, name: "Total knee replacement (generic) tracking template" }
    }
  };

  return procTweaks[procedure] || common;
}

/** Build a “today log” object */
function makeEmptyLog(date, phaseId, tplPhase) {
  const exercises = {};
  for (const ex of tplPhase.exercises) {
    exercises[ex.id] = {
      done: false,
      sets: ex.sets ?? 1,
      reps: ex.reps ?? 10,
      timerSec: ex.timerSec ?? 0
    };
  }
  return {
    date,
    phaseId,
    pain: "",
    swelling: "none",
    notes: "",
    exercises
  };
}

function getPhase(template, phaseId) {
  return template.phases.find(p => p.id === phaseId) || template.phases[0];
}

function computeStats(state) {
  const dates = Object.keys(state.logs).sort();
  const daysLogged = dates.length;

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);

  const last14 = new Date(today);
  last14.setDate(today.getDate() - 13);

  let thisWeek = 0;
  let painSum = 0;
  let painCount = 0;

  for (const iso of dates) {
    const [y,m,d] = iso.split("-").map(Number);
    const dt = new Date(y, m-1, d);

    if (dt >= weekAgo) thisWeek++;

    if (dt >= last14) {
      const p = state.logs[iso]?.pain;
      const pn = Number(p);
      if (!Number.isNaN(pn) && p !== "" && pn >= 0) {
        painSum += pn;
        painCount++;
      }
    }
  }

  const avgPain = painCount ? (painSum / painCount).toFixed(1) : "–";
  const streak = computeStreak(dates);

  return { daysLogged, thisWeek, avgPain, streak };
}

function computeStreak(sortedDates) {
  // streak counts consecutive days up to today (or most recent day if today not logged)
  if (!sortedDates.length) return 0;

  const set = new Set(sortedDates);
  let cur = new Date();
  // Use local “today” date
  const isoToday = todayISO();
  const hasToday = set.has(isoToday);
  if (!hasToday) {
    // start from most recent logged date
    const last = sortedDates[sortedDates.length - 1];
    const [y,m,d] = last.split("-").map(Number);
    cur = new Date(y, m-1, d);
  } else {
    const [y,m,d] = isoToday.split("-").map(Number);
    cur = new Date(y, m-1, d);
  }

  let streak = 0;
  while (true) {
    const tzOffset = cur.getTimezoneOffset() * 60000;
    const iso = new Date(cur.getTime() - tzOffset).toISOString().slice(0,10);
    if (!set.has(iso)) break;
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(c);
  return node;
}

function renderPhaseSelect(template, state) {
  const sel = $("phaseSelect");
  sel.innerHTML = "";
  for (const p of template.phases) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  if (!template.phases.some(p => p.id === state.phaseId)) state.phaseId = template.phases[0].id;
  sel.value = state.phaseId;
}

function renderToday(template, state, date = todayISO()) {
  const phase = getPhase(template, state.phaseId);
  $("todayPill").textContent = `${formatDate(date)} • ${phase.name.split(":")[0]}`;
  $("procedureSelect").value = state.procedure;

  // If there's a saved log for this date, load it; else create blank from template
  const existing = state.logs[date];
  const log = existing ? structuredClone(existing) : makeEmptyLog(date, state.phaseId, phase);

  // Ensure exercises match current phase template (merge additions)
  for (const ex of phase.exercises) {
    if (!log.exercises[ex.id]) {
      log.exercises[ex.id] = {
        done: false,
        sets: ex.sets ?? 1,
        reps: ex.reps ?? 10,
        timerSec: ex.timerSec ?? 0
      };
    }
  }

  $("painInput").value = log.pain ?? "";
  $("swellingSelect").value = log.swelling ?? "none";
  $("notesInput").value = log.notes ?? "";

  // Render exercises
  const list = $("exerciseList");
  list.innerHTML = "";

  for (const ex of phase.exercises) {
    const exState = log.exercises[ex.id] || { done:false, sets: ex.sets ?? 1, reps: ex.reps ?? 10, timerSec: ex.timerSec ?? 0 };

    const setsInput = el("input", { class:"input", type:"number", min:"0", step:"1", value: exState.sets });
    const repsInput = el("input", { class:"input", type:"number", min:"0", step:"1", value: exState.reps });
    const timerInput = el("input", { class:"input", type:"number", min:"0", step:"5", value: exState.timerSec });

    const timerBtn = el("button", { class:"btn", text:"Start timer" });
    timerBtn.addEventListener("click", () => startTimer(ex.name, Number(timerInput.value) || 0));

    const chk = el("input", { type:"checkbox" });
    chk.checked = !!exState.done;

    const item = el("div", { class:"item" }, [
      el("div", { class:"item-top" }, [
        el("div", {}, [
          el("div", { class:"item-name", text: ex.name }),
          el("div", { class:"hint", text: ex.target ? `Target: ${ex.target}` : "" })
        ]),
        el("div", { class:"badge", text: ex.id })
      ]),
      el("div", { class:"item-controls" }, [
        el("div", {}, [ el("div", { class:"label", text:"Sets" }), setsInput ]),
        el("div", {}, [ el("div", { class:"label", text:"Reps" }), repsInput ]),
        el("div", {}, [ el("div", { class:"label", text:"Timer (sec)" }), timerInput ])
      ]),
      el("div", { class:"checkline" }, [
        chk,
        el("div", { class:"muted", text:"Mark done" }),
        el("div", { style:"flex:1" }),
        timerBtn
      ])
    ]);

    // bind changes into local draft log
    const bind = () => {
      log.exercises[ex.id] = {
        done: chk.checked,
        sets: Number(setsInput.value) || 0,
        reps: Number(repsInput.value) || 0,
        timerSec: Number(timerInput.value) || 0
      };
      setDraft(log);
    };

    chk.addEventListener("change", bind);
    setsInput.addEventListener("input", bind);
    repsInput.addEventListener("input", bind);
    timerInput.addEventListener("input", bind);

    list.appendChild(item);
  }

  // bind overall fields into draft
  const bindOverall = () => {
    log.pain = $("painInput").value;
    log.swelling = $("swellingSelect").value;
    log.notes = $("notesInput").value;
    log.phaseId = state.phaseId;
    setDraft(log);
  };
  $("painInput").addEventListener("input", bindOverall);
  $("swellingSelect").addEventListener("change", bindOverall);
  $("notesInput").addEventListener("input", bindOverall);

  // initial draft
  setDraft(log);

  $("saveStatus").textContent = existing ? "Loaded saved entry." : "New entry (not saved yet).";
}

let currentDraft = null;
function setDraft(log) { currentDraft = log; }

function renderHistory(template, state) {
  const history = $("historyList");
  history.innerHTML = "";

  const dates = Object.keys(state.logs).sort().reverse();
  if (!dates.length) {
    history.appendChild(el("div", { class:"muted", text:"No entries yet. Save your first day above." }));
    return;
  }

  for (const iso of dates) {
    const log = state.logs[iso];
    const phase = getPhase(template, log.phaseId);
    const doneCount = Object.values(log.exercises || {}).filter(x => x?.done).length;
    const total = Object.keys(log.exercises || {}).length;

    const card = el("div", { class:"history-card" }, [
      el("div", { class:"history-top" }, [
        el("div", { class:"history-date", text: formatDate(iso) }),
        el("div", { class:"pill", text: `${doneCount}/${total} done` })
      ]),
      el("div", { class:"small", text: `Phase: ${phase.name}` }),
      el("div", { class:"small", text: `Pain: ${log.pain === "" ? "–" : log.pain} • Swelling: ${log.swelling || "–"}` }),
      log.notes ? el("div", { class:"small", text: `Notes: ${log.notes.slice(0, 120)}${log.notes.length > 120 ? "…" : ""}` }) : el("div")
    ]);

    card.addEventListener("click", () => {
      // load this day into the form
      state.phaseId = log.phaseId;
      $("phaseSelect").value = state.phaseId;
      renderToday(template, state, iso);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    history.appendChild(card);
  }
}

function renderStats(state) {
  const { daysLogged, thisWeek, avgPain, streak } = computeStats(state);
  $("daysLogged").textContent = String(daysLogged);
  $("thisWeek").textContent = String(thisWeek);
  $("avgPain").textContent = String(avgPain);
  $("streakPill").textContent = streak ? `Streak: ${streak} day${streak === 1 ? "" : "s"}` : "Streak: 0";
}

function startTimer(label, seconds) {
  if (!seconds || seconds <= 0) {
    alert("Set a timer value (seconds) first.");
    return;
  }
  const end = Date.now() + seconds * 1000;
  const originalTitle = document.title;
  const tick = () => {
    const leftMs = end - Date.now();
    const left = Math.max(0, Math.ceil(leftMs / 1000));
    document.title = `${label}: ${left}s`;
    if (left <= 0) {
      document.title = originalTitle;
      clearInterval(int);
      try { navigator.vibrate?.([200, 80, 200]); } catch {}
      alert(`Timer done: ${label}`);
    }
  };
  tick();
  const int = setInterval(tick, 250);
}

function openModal() {
  const modal = $("modal");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}
function closeModal() {
  const modal = $("modal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    } catch (e) {
      console.warn("SW registration failed", e);
    }
  });
}

/** PWA install prompt */
let deferredPrompt = null;
function setupInstall() {
  const btn = $("installBtn");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.hidden = false;
  });
  btn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.hidden = true;
  });
}

/** App init */
function main() {
  registerServiceWorker();
  setupInstall();

  let state = loadState();
  let template = loadTemplate();

  // Elements
  renderPhaseSelect(template, state);
  renderToday(template, state, todayISO());
  renderHistory(template, state);
  renderStats(state);

  $("todayPill").textContent = formatDate(todayISO());

  $("procedureSelect").addEventListener("change", (e) => {
    state.procedure = e.target.value;
    // reset template only if user wants; here we load a fresh default and overwrite template.
    template = defaultTemplate(state.procedure);
    saveTemplate(template);
    renderPhaseSelect(template, state);
    renderToday(template, state, todayISO());
    renderHistory(template, state);
    renderStats(state);
    $("subtitle").textContent = `Template loaded: ${template.meta?.name || "Custom"}`;
  });

  $("phaseSelect").addEventListener("change", (e) => {
    state.phaseId = e.target.value;
    saveState(state);
    renderToday(template, state, todayISO());
  });

  $("saveTodayBtn").addEventListener("click", () => {
    const iso = (currentDraft?.date) || todayISO();
    const draft = structuredClone(currentDraft);
    if (!draft) return;

    // basic validation
    const pain = draft.pain === "" ? "" : Number(draft.pain);
    if (draft.pain !== "" && (Number.isNaN(pain) || pain < 0 || pain > 10)) {
      alert("Pain must be 0–10 (or empty).");
      return;
    }
    draft.phaseId = state.phaseId;

    state.logs[iso] = draft;
    saveState(state);

    $("saveStatus").textContent = `Saved ${formatDate(iso)}.`;
    renderHistory(template, state);
    renderStats(state);
  });

  $("resetTodayBtn").addEventListener("click", () => {
    renderToday(template, state, todayISO());
    $("saveStatus").textContent = "Today reset (not saved).";
  });

  // Template editor
  $("editTemplateBtn").addEventListener("click", () => {
    $("templateJson").value = JSON.stringify(template, null, 2);
    $("templateStatus").textContent = "";
    openModal();
  });
  $("closeModalBtn").addEventListener("click", closeModal);
  $("modal").addEventListener("click", (e) => {
    if (e.target === $("modal")) closeModal();
  });

  $("saveTemplateBtn").addEventListener("click", () => {
    const raw = $("templateJson").value;
    const parsed = safeParse(raw, null);
    if (!parsed || !parsed.phases || !Array.isArray(parsed.phases)) {
      $("templateStatus").textContent = "Invalid JSON or missing phases[].";
      return;
    }
    // minimal schema sanity
    for (const p of parsed.phases) {
      if (!p.id || !p.name || !Array.isArray(p.exercises)) {
        $("templateStatus").textContent = "Each phase needs id, name, exercises[].";
        return;
      }
    }
    template = parsed;
    saveTemplate(template);
    renderPhaseSelect(template, state);
    renderToday(template, state, todayISO());
    renderHistory(template, state);
    renderStats(state);
    $("templateStatus").textContent = "Saved template.";
    $("subtitle").textContent = `Template: ${template.meta?.name || "Custom"}`;
  });

  $("resetTemplateBtn").addEventListener("click", () => {
    template = defaultTemplate(state.procedure || "general");
    $("templateJson").value = JSON.stringify(template, null, 2);
    $("templateStatus").textContent = "Reset to default for current procedure.";
  });

  // Export/import
  $("exportBtn").addEventListener("click", () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      state: loadState(),
      template: loadTemplate()
    };
    downloadJson(`knee-rehab-backup-${todayISO()}.json`, payload);
  });

  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const parsed = safeParse(text, null);
    if (!parsed || (!parsed.state && !parsed.template)) {
      alert("Invalid import file.");
      e.target.value = "";
      return;
    }

    if (parsed.state) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed.state));
      state = loadState();
    }
    if (parsed.template) {
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify(parsed.template));
      template = loadTemplate();
    }

    renderPhaseSelect(template, state);
    renderToday(template, state, todayISO());
    renderHistory(template, state);
    renderStats(state);
    $("subtitle").textContent = "Imported successfully.";
    e.target.value = "";
  });
}

main();
