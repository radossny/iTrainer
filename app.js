import { parseCsv, detectKind, num } from "./lib/csv.js?v=8";
import * as db from "./lib/db.js?v=8";
import { comboChart, lineChart, stackChart } from "./lib/chart.js?v=8";
import { DOCS } from "./docs.js?v=8";
import {
  detectActiveMetrics, parseWorkouts, buildDailyLoad, weeklyLoad, hrrZones,
  baseline, calibrate, paceAtHr, intensitySplit, qualityReport, fmtPace,
} from "./compute/metrics.js?v=8";
import {
  matchPlan, nextSession, weekOf, planSummary, checkRules, KIND_LABEL, KIND_COLOR,
} from "./compute/plan.js?v=8";

window.__itrainerBooted = true; // wyłącza ostrzeżenie o niewczytanym kodzie

// Podbij przy każdej zmianie kodu. Pokazuje się w stopce nagłówka, więc od razu
// widać, czy przeglądarka wykonuje aktualną wersję, czy wersję z cache.
// JEDNO źródło prawdy o wersji. Musi być zgodne z ?v=N we wszystkich importach
// oraz w index.html — ten sam plik z różnym ?v= to dwa osobne moduły z osobnym stanem.
export const VERSION = "8";

const AGE = 41; // do wzoru 220 − wiek; docelowo z profilu użytkownika

const state = {
  daily: [], workouts: [], files: [],
  hrMax: null, hrRest: null,
  band: [145, 160], adjust: true, selMetric: null, openDoc: null,
  plan: null, planErr: null,
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Bez tego każda awaria kończy się objawem „nic się nie dzieje”.
// Wszystko, co pójdzie nie tak, ma wylądować na ekranie.
window.addEventListener("error", (e) =>
  showErr(`Błąd: ${e.message}${e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : ""}`));
window.addEventListener("unhandledrejection", (e) =>
  showErr(`Błąd: ${e.reason?.message || e.reason}`));

/* ===== wczytywanie ================================================== */

/** Plan i cel jako dane w repozytorium — do czasu, gdy zacznie je generować model. */
async function loadPlan() {
  try {
    const res = await fetch("./plan.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.plan = await res.json();
  } catch (e) {
    state.planErr = e.message;
  }
}

async function readFile(file) {
  // file.text() nie istnieje w starszych Safari — stąd zapasowa ścieżka
  if (typeof file.text === "function") return file.text();
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error || new Error("nie udało się odczytać pliku"));
    r.readAsText(file, "utf-8");
  });
}

/**
 * Import: najpierw stan i widok, dopiero potem zapis do bazy.
 * Gdyby baza zawiodła — a na iOS potrafi — aplikacja i tak pokazuje wynik.
 * Persystencja jest usługą, nie warunkiem działania.
 */
async function ingestFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  $("#err").hidden = true;
  setBusy(`Wczytuję ${files.length} ${files.length === 1 ? "plik" : "pliki"}…`);
  const errors = [];
  const toPersist = [];

  try {
    for (const file of files) {
      let text;
      try {
        text = await readFile(file);
      } catch (e) {
        errors.push(`${file.name}: nie udało się odczytać pliku (${e.message})`);
        continue;
      }
      if (!text || !text.trim()) { errors.push(`${file.name}: plik jest pusty`); continue; }

      let header, rows;
      try {
        ({ header, rows } = parseCsv(text));
      } catch (e) {
        errors.push(`${file.name}: błąd parsowania (${e.message})`);
        continue;
      }
      if (!rows.length) { errors.push(`${file.name}: brak wierszy danych`); continue; }

      const kind = detectKind(header);
      if (kind === "workouts") {
        const { workouts } = parseWorkouts(rows);
        if (!workouts.length) { errors.push(`${file.name}: nie udało się odczytać żadnej sesji`); continue; }
        mergeWorkouts(workouts);
        toPersist.push(["workouts", workouts]);
        state.files.push({ name: file.name, kind: "treningi", n: workouts.length });
      } else if (kind === "daily") {
        const merged = mergeDaily(rows);
        toPersist.push(["daily", merged]);
        state.files.push({ name: file.name, kind: "zdrowie", n: rows.length });
      } else {
        errors.push(`${file.name}: nie rozpoznano formatu. Oczekiwana kolumna „date” albo „startDate”. Znalezione nagłówki: ${header.slice(0, 4).join(", ")}…`);
      }
    }
  } catch (e) {
    errors.push(`Nieoczekiwany błąd przy wczytywaniu: ${e.message}`);
  }

  setBusy(null);
  if (errors.length) showErr(errors.join(" — "));

  // Widok najpierw. Błąd renderowania też musi być widoczny.
  try {
    render();
  } catch (e) {
    showErr(`Błąd przy budowaniu widoku: ${e.message}`);
    console.error(e);
  }

  // Zapis w tle, bez blokowania interfejsu.
  (async () => {
    try {
      for (const [store, rows] of toPersist) await db.bulkPut(store, rows);
      for (const f of state.files.slice(-files.length)) {
        await db.put("imports", {
          id: `${Date.now()}-${f.name}`, importedAt: new Date().toISOString(),
          source: "vital2ai", fileName: f.name, rows: f.n, kind: f.kind,
        });
      }
    } catch (e) {
      showErr(`Dane wczytane, ale nie udało się ich zapisać: ${e.message}. Zrób kopię JSON.`);
    }
    renderStorageNote();
  })();
}

/** Dokłada treningi do stanu, odrzucając duplikaty po import_hash. */
function mergeWorkouts(list) {
  const byId = new Map(state.workouts.map((w) => [w.id, w]));
  for (const w of list) byId.set(w.id, w);
  state.workouts = [...byId.values()].sort((a, b) => a.startMs - b.startMs);
}

/**
 * Scala rekordy dzienne pole po polu zamiast nadpisywać cały wiersz.
 * Nowsza pusta komórka nie może skasować wartości zapisanej wcześniej.
 */
function mergeDaily(rows) {
  const byDate = new Map(state.daily.map((r) => [r.date, r]));
  const touched = [];
  for (const r of rows) {
    const old = byDate.get(r.date);
    let out;
    if (!old) out = { ...r };
    else {
      out = { ...old };
      for (const [k, v] of Object.entries(r)) if (v !== "" && v != null) out[k] = v;
    }
    byDate.set(r.date, out);
    touched.push(out);
  }
  state.daily = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return touched;
}

function setBusy(msg) {
  const el = $("#busy");
  el.hidden = !msg;
  el.innerHTML = msg ? `<div class="busy">${esc(msg)}</div>` : "";
}

function showErr(msg) {
  const el = $("#err");
  el.hidden = false;
  el.innerHTML = `<div class="panel" style="border-color:var(--flag)">
    <div class="panel-b" style="color:var(--flag);font-size:13px;line-height:1.5">${esc(msg)}</div></div>`;
}

/** Ostrzeżenie, gdy baza działa tylko w pamięci — dane znikną po odświeżeniu. */
function renderStorageNote() {
  // Zabezpieczenie przed niezgodnością wersji modułów: gdy lib/db.js jest starszy
  // i nie eksportuje status(), aplikacja ma działać dalej, a nie się wysypać.
  const s = typeof db.status === "function"
    ? db.status()
    : { mode: "unknown", error: "lib/db.js w starszej wersji — podmień plik" };
  const el = $("#store");
  if (s.mode === "memory") {
    el.hidden = false;
    el.innerHTML = `<div class="panel" style="border-color:var(--warn)">
      <div class="panel-b" style="font-size:12.5px;line-height:1.5">
        <strong>Dane nie zostaną zapamiętane.</strong> Trwały magazyn przeglądarki jest
        niedostępny (${esc(s.error || "nieznany powód")}). Aplikacja działa normalnie, ale po
        odświeżeniu strony trzeba będzie wgrać pliki ponownie. Najczęstsza przyczyna:
        tryb prywatny. Pobierz kopię JSON, jeśli chcesz zachować wynik.</div></div>`;
  } else el.hidden = true;
}

async function loadFromDb() {
  try {
    const [daily, workouts, hrMax, hrRest] = await Promise.all([
      db.getAll("daily"), db.getAll("workouts"),
      db.getSetting("hrMax", null), db.getSetting("hrRest", null),
    ]);
    if (daily.length) state.daily = daily.sort((a, b) => a.date.localeCompare(b.date));
    if (workouts.length) state.workouts = workouts.sort((a, b) => a.startMs - b.startMs);
    state.hrMax = hrMax;
    state.hrRest = hrRest;
  } catch (e) {
    showErr(`Nie udało się odczytać zapisanych danych: ${e.message}`);
  }
  try { renderStorageNote(); } catch (e) { console.warn("renderStorageNote:", e); }
}


/* ===== składanie widoku ============================================= */

function derive() {
  const metrics = detectActiveMetrics(state.daily);
  const parsed = { workouts: state.workouts, duplicates: 0, overlaps: state.workouts.filter((w) => w.overlapsPrev).length };
  const calib = calibrate(state.workouts, state.daily, AGE);
  const hrMax = state.hrMax ?? calib.suggested;
  const hrRest = state.hrRest ?? calib.hrRest;
  const zones = hrrZones(hrMax, hrRest);
  const daily = buildDailyLoad(state.workouts, hrMax, hrRest);
  const weekly = weeklyLoad(daily);
  const vitals = state.daily.map((r) => ({
    date: r.date, label: r.date.slice(5),
    rhr: num(r.restingHeartRate), hrv: num(r.heartRateVariabilitySDNN),
    sleep: num(r.sleepAnalysis),
  }));
  const matched = state.plan ? matchPlan(state.plan.sessions, state.workouts) : [];
  const rules = state.plan
    ? checkRules({ daily, vitals, bases: { rhr: baseline(vitals.map((v) => v.rhr)), hrv: baseline(vitals.map((v) => v.hrv)) }, matched })
    : [];

  return {
    matched, rules, plan: state.plan,
    metrics, parsed, calib, hrMax, hrRest, zones, weekly, vitals,
    bases: { rhr: baseline(vitals.map((v) => v.rhr)), hrv: baseline(vitals.map((v) => v.hrv)) },
    intensity: intensitySplit(state.workouts, zones),
    pace: paceAtHr(state.workouts, state.band, state.adjust),
    flags: qualityReport({ metrics, parsed, dailyRows: state.daily, calib }),
  };
}

const docBtn = (id) =>
  `<button class="ibtn" data-doc="${id}" aria-expanded="${state.openDoc === id}"
     aria-label="Jak to jest liczone">i</button>`;

const docBox = (id) => state.openDoc !== id ? "" :
  `<div class="doc"><p class="t">${esc(DOCS[id].t)}</p>${DOCS[id].b.map((x) => `<p>${esc(x)}</p>`).join("")}</div>`;

function panel({ tag, title, doc, right = "", body, key = false }) {
  return `<section class="panel${key ? " key" : ""}">
    <div class="panel-h">
      <div><div class="eyebrow">${esc(tag)}</div>
        <h2>${esc(title)}${doc ? docBtn(doc) : ""}</h2></div>
      <div class="eyebrow" style="text-align:right">${right}</div>
    </div>
    <div class="panel-b">${doc ? docBox(doc) : ""}${body}</div>
  </section>`;
}

const COLORS = { flag: "var(--flag)", warn: "var(--warn)", ok: "var(--ok)", info: "var(--hair)" };
const SC = { ok: "#2C6B57", empty: "#C3CBD0", all_zero: "#B23A26", constant: "#9A6B12" };
const SL = { ok: "aktywna", empty: "pusta", all_zero: "same zera", constant: "stała" };

function render() {
  $("#ver").innerHTML = `<span>kod ${VERSION}</span>`
    + (state.plan ? `<span>plan ${esc(state.plan.planVersion)}</span>` : "");
  $("#files").innerHTML = state.files
    .map((f) => `<span class="chip">${esc(f.name)} · ${f.kind} · ${f.n}</span>`).join("");

  if (!state.daily.length && !state.workouts.length) {
    $("#app").innerHTML = `<p class="empty">Po wczytaniu pojawi się kalibracja, raport jakości i wskaźniki.</p>`;
    return;
  }

  const d = derive();

  $("#stat").hidden = false;
  $("#stat").innerHTML = [
    `wersja kodu: ${VERSION}`,
    `dni: ${state.daily.length}`, `treningi: ${state.workouts.length}`,
    `metryki: ${d.metrics.filter((m) => m.isActive).length}/${d.metrics.length}`,
    `HR max: ${d.hrMax}${state.hrMax ? "" : " (proponowane)"}`,
    `HR spocz.: ${d.hrRest}`,
  ].map((s) => `<span>${esc(s)}</span>`).join("");

  renderStorageNote();
  $("#app").innerHTML = [
    todayPanel(d), rulesPanel(d), weekPanel(d), planPanel(d),
    calibPanel(d), qualityPanel(d), ledgerPanel(d), loadPanel(d),
    vitalsPanel(d), intensityPanel(d), pacePanel(d), tablePanel(d), backupPanel(),
  ].join("");
}

/* ---- panele -------------------------------------------------------- */

/* ---- plan ---------------------------------------------------------- */

function sessionSpec(s) {
  const bits = [];
  if (s.km) bits.push(`${s.km} km`);
  if (s.min) bits.push(`${s.min} min`);
  if (s.hrMax) bits.push(`tętno < ${s.hrMax}`);
  if (s.hrLo) bits.push(`tętno ${s.hrLo}–${s.hrHi}`);
  return bits.join(" · ");
}

function todayPanel(d) {
  if (state.planErr) return panel({
    tag: "plan", title: "Nie udało się wczytać planu",
    body: `<p class="hint">Brak pliku <code>plan.json</code> w katalogu głównym (${esc(state.planErr)}).
      Pozostałe panele działają normalnie.</p>`,
  });
  if (!d.plan) return "";

  const sum = planSummary(d.matched, d.plan.goal);
  const next = nextSession(d.matched);
  const g = d.plan.goal;

  const body = next ? `
    <div class="row" style="gap:26px;align-items:flex-start;margin-bottom:14px">
      <div>
        <div class="kpi" style="color:${KIND_COLOR[next.kind]}">${sum.daysToRace}</div>
        <div class="eyebrow" style="margin-top:3px">dni do startu</div>
      </div>
      <div>
        <div class="kpi">${sum.done}/${sum.total}</div>
        <div class="eyebrow" style="margin-top:3px">jednostek</div>
      </div>
      ${sum.avgCompliance != null ? `<div>
        <div class="kpi" style="color:${sum.avgCompliance >= 85 ? "var(--ok)" : sum.avgCompliance >= 70 ? "var(--warn)" : "var(--flag)"}">${sum.avgCompliance}%</div>
        <div class="eyebrow" style="margin-top:3px">zgodność</div></div>` : ""}
      ${sum.missed ? `<div>
        <div class="kpi" style="color:var(--flag)">${sum.missed}</div>
        <div class="eyebrow" style="margin-top:3px">pominięte</div></div>` : ""}
    </div>
    <div style="border-left:3px solid ${KIND_COLOR[next.kind]};padding:10px 0 10px 13px">
      <div class="eyebrow">${next.status === "today" ? "dzisiaj" : esc(next.date)} · ${KIND_LABEL[next.kind]}</div>
      <div style="font-size:16px;font-weight:600;margin:3px 0 4px">${esc(next.label)}</div>
      <div class="mono" style="font-size:11.5px;color:var(--slate)">${esc(sessionSpec(next))}</div>
      ${next.note ? `<p style="font-size:12.5px;color:var(--slate);margin:8px 0 0;line-height:1.5">${esc(next.note)}</p>` : ""}
    </div>`
    : `<p class="hint">Plan zrealizowany.</p>`;

  return panel({
    key: true, tag: "plan", title: esc(g.eventName),
    right: `cel ${esc(g.target.value)} · A ${esc(g.stretch.value)}`,
    body,
  });
}

function rulesPanel(d) {
  if (!d.plan || !d.rules.length) return "";
  return panel({
    tag: "warstwa 0 · reguły", title: "Sygnały z danych",
    right: "bez udziału modelu",
    body: d.rules.map((r) => `<div class="flagrow">
      <span class="dot" style="background:${COLORS[r.lvl]}"></span>
      <div><b>${esc(r.t)}</b><span>${esc(r.d)}</span></div></div>`).join(""),
  });
}

const STATUS_MARK = {
  done: ["✓", "var(--ok)"], missed: ["✗", "var(--flag)"],
  today: ["●", "var(--blue)"], upcoming: ["·", "var(--hair)"],
};

function weekPanel(d) {
  if (!d.plan) return "";
  const week = weekOf(d.matched);
  if (!week.length) return "";
  const rows = week.map((s) => {
    const [mark, color] = STATUS_MARK[s.status];
    const w = s.workout;
    return `<tr>
      <td style="color:${color};font-weight:600">${mark}</td>
      <td>${esc(s.date.slice(5))}</td>
      <td style="text-align:left;font-size:11px;color:${KIND_COLOR[s.kind]}">${KIND_LABEL[s.kind]}</td>
      <td style="text-align:left;font-size:11.5px">${esc(s.label)}</td>
      <td>${w ? w.duration : "—"}</td>
      <td>${w?.distance ? w.distance.toFixed(1) : "—"}</td>
      <td>${w?.avgHr ?? "—"}</td>
      <td style="color:${s.compliance ? (s.compliance.score >= .85 ? "var(--ok)" : s.compliance.score >= .7 ? "var(--warn)" : "var(--flag)") : "inherit"}">
        ${s.compliance ? Math.round(s.compliance.score * 100) + "%" : "—"}</td>
    </tr>${s.compliance?.notes.length ? `<tr><td></td><td colspan="7"
      style="text-align:left;font-size:11.5px;color:var(--slate);padding-top:0;border-bottom:1px solid #EDF0F1">
      ${esc(s.compliance.notes.join(" · "))}</td></tr>` : ""}`;
  }).join("");

  return panel({
    tag: "plan tygodnia", title: "Zamierzenie kontra wykonanie",
    body: `<table><thead><tr>
      <th></th><th>data</th><th style="text-align:left">typ</th>
      <th style="text-align:left">jednostka</th><th>min</th><th>km</th><th>HR</th><th>zgodn.</th>
    </tr></thead><tbody>${rows}</tbody></table>`,
  });
}

function planPanel(d) {
  if (!d.plan) return "";
  const rows = d.matched.map((s) => {
    const [mark, color] = STATUS_MARK[s.status];
    return `<tr style="opacity:${s.status === "upcoming" ? .6 : 1}">
      <td style="color:${color};font-weight:600">${mark}</td>
      <td>${esc(s.date)}</td>
      <td style="text-align:left;font-size:11px;color:${KIND_COLOR[s.kind]}">${KIND_LABEL[s.kind]}</td>
      <td style="text-align:left;font-size:11.5px">${esc(s.label)}</td>
      <td>${s.workout ? s.workout.duration : "—"}</td>
      <td>${s.workout?.avgHr ?? "—"}</td>
      <td>${s.compliance ? Math.round(s.compliance.score * 100) + "%" : "—"}</td></tr>`;
  }).join("");
  const rp = d.plan.goal.racePlan.map((r) =>
    `<tr><td style="text-align:left">km ${esc(r.km)}</td>
     <td>${r.hrMax ? "≤ " + r.hrMax : "—"}</td>
     <td style="text-align:left">${esc(r.pace)}</td></tr>`).join("");

  return panel({
    tag: "plan", title: "Cały cykl", right: `wersja planu ${esc(d.plan.planVersion)}`,
    body: `<table><thead><tr><th></th><th>data</th><th style="text-align:left">typ</th>
        <th style="text-align:left">jednostka</th><th>min</th><th>HR</th><th>zgodn.</th></tr></thead>
        <tbody>${rows}</tbody></table>
      <div class="eyebrow" style="margin:18px 0 6px">taktyka na start</div>
      <table><thead><tr><th style="text-align:left">odcinek</th><th>tętno</th>
        <th style="text-align:left">tempo</th></tr></thead><tbody>${rp}</tbody></table>
      <p class="hint" style="margin-top:14px">${esc(d.plan.goal.hr.note)}</p>`,
  });
}

/* ---- kalibracja ---------------------------------------------------- */

function calibPanel(d) {
  const c = d.calib;
  const alert = c.z5long.length ? `<div class="alert">
    <strong>Dane sugerują, że wartość domyślna jest za niska.</strong>
    ${c.z5long.length} sesji ma ponad 20 minut w strefie 5, najdłuższa ${Math.round(c.z5max)} min.
    To fizjologicznie niemożliwe przy poprawnie ustawionym maksimum.
    ${c.longHard ? `Najdłuższy mocny bieg (${esc(c.longHard.date)}, ${c.longHard.duration} min)
      miał średnie tętno ${c.longHard.avgHr} — z tego wychodzi HR max około
      <strong>${c.fromThreshold}</strong>.` : ""}</div>` : "";

  const presets = [
    c.observed && { v: c.observed, l: `obserwowane ${c.observed}` },
    c.fromAge && { v: c.fromAge, l: `220 − wiek ${c.fromAge}` },
    c.fromThreshold && { v: c.fromThreshold, l: `z progu ${c.fromThreshold}` },
  ].filter(Boolean).map((p) =>
    `<button class="seg" data-hrmax="${p.v}" aria-pressed="${d.hrMax === p.v}">${esc(p.l)}</button>`).join("");

  const rows = d.zones.map((z) =>
    `<tr><td>Z${z.z}</td><td>${z.lo}</td><td>${z.hi}</td><td>${z.pct}</td>
     <td style="color:var(--slate);font-size:11px">${esc(z.role)}</td></tr>`).join("");

  return panel({
    key: true, tag: "kalibracja", doc: "hrmax",
    title: "HR max — od tej liczby zależy wszystko poniżej",
    body: `${alert}
      <div class="row" style="margin-bottom:12px">
        <input type="number" id="hrmaxNum" min="150" max="220" value="${d.hrMax}" aria-label="HR max">
        <input type="range" id="hrmaxRange" min="160" max="210" value="${d.hrMax}" aria-label="HR max suwak">
        ${presets}
      </div>
      <div class="eyebrow" style="margin-bottom:6px">strefy z rezerwy tętna przy tym ustawieniu</div>
      <table><thead><tr><th>strefa</th><th>od</th><th>do</th><th>% rezerwy</th><th>rola</th></tr></thead>
        <tbody>${rows}</tbody></table>`,
  });
}

function qualityPanel(d) {
  return panel({
    tag: "kontrola jakości", doc: "coverage",
    title: "Co trzeba wiedzieć przed liczeniem czegokolwiek",
    right: `${d.flags.length} ustaleń`,
    body: d.flags.map((f) => `<div class="flagrow">
      <span class="dot" style="background:${COLORS[f.lvl]}"></span>
      <div><b>${esc(f.t)}</b><span>${esc(f.d)}</span></div></div>`).join(""),
  });
}

function ledgerPanel(d) {
  const cells = d.metrics.map((m) => `
    <button class="cell${m.isActive ? "" : " dead"}" data-metric="${esc(m.metric)}"
      aria-pressed="${state.selMetric === m.metric}" title="${esc(m.metric)} — ${SL[m.status]}">
      <span class="cname">${esc(m.metric)}</span>
      <span class="barwrap"><span style="display:block;height:100%;width:${Math.round(m.coverage * 100)}%;background:${SC[m.status]}"></span></span>
      <span class="cmeta">${m.nValues} · ${SL[m.status]}</span>
    </button>`).join("");

  let detail = "";
  const sm = d.metrics.find((m) => m.metric === state.selMetric);
  if (sm) {
    const series = state.daily.map((r) => ({ date: r.date, label: r.date.slice(5), v: num(r[sm.metric]) }))
      .filter((r) => r.v !== null);
    detail = `<div style="margin-top:14px;border-top:1px solid var(--hair);padding-top:12px">
      <div class="eyebrow">${esc(sm.metric)}</div>
      <div class="mono" style="font-size:11px;color:var(--slate);margin:4px 0 10px">
        ${sm.nValues} wartości · ${sm.nDistinct} unikalnych · ${SL[sm.status]} ·
        ${esc(sm.firstSeen)} → ${esc(sm.lastSeen)}</div>
      ${series.length > 1 && sm.numeric
        ? lineChart({ data: series, xKey: "label", height: 140, series: [{ key: "v", color: "#2E6FA8" }] })
        : `<p class="hint">Brak przebiegu liczbowego do pokazania.</p>`}</div>`;
  }

  return panel({
    tag: "rejestr metryk", title: "Wszystkie kolumny eksportu i ich status",
    right: `${d.metrics.filter((m) => m.isActive).length} aktywnych`,
    body: `<p class="hint">Każde pole to jedna kolumna. Pasek pokazuje pokrycie w dniach.
      Przekreślone nie wchodzą do analiz. Kliknij, żeby zobaczyć przebieg.</p>
      <div class="ledger">${cells}</div>${detail}`,
  });
}

function loadPanel(d) {
  return panel({
    tag: "warstwa 1 · obciążenie", doc: "trimp", title: "TRIMP tygodniowo i ACWR",
    right: `${d.weekly.length} tygodni ${docBtn("acwr")}`,
    body: `${docBox("acwr")}
      ${comboChart({ data: d.weekly, xKey: "label", barKey: "trimp", lineKey: "acwr", refLine: 1.5 })}
      <div class="legend">
        <span><i style="background:#17395C"></i>TRIMP tygodniowy (oś lewa)</span>
        <span><i style="background:#B23A26"></i>ACWR (oś prawa), próg 1,5</span></div>`,
  });
}

function vitalsPanel(d) {
  const r = d.bases.rhr, h = d.bases.hrv;
  return panel({
    tag: "warstwa 1 · regeneracja", doc: "baseline", title: "Tętno spoczynkowe i HRV",
    right: r ? `próg RHR ${r.hi.toFixed(0)} · próg HRV ${h ? h.lo.toFixed(0) : "—"}` : "",
    body: `${lineChart({
      data: d.vitals, xKey: "label", height: 200, refLine: r ? r.hi : null,
      series: [{ key: "rhr", color: "#2E6FA8", dots: false },
               { key: "hrv", color: "#2C6B57", axis: "r" }],
    })}
    <div class="legend">
      <span><i style="background:#2E6FA8"></i>HR spoczynkowe (oś lewa)</span>
      <span><i style="background:#2C6B57"></i>HRV (oś prawa)</span>
      <span><i style="background:#B23A26"></i>próg alertu</span></div>`,
  });
}

function intensityPanel(d) {
  const i = d.intensity;
  const kpi = [["spokojne", i.tot.easy, "#2C6B57"], ["pośrednie", i.tot.mid, "#9A6B12"],
    ["mocne", i.tot.hard, "#B23A26"]]
    .map(([l, v, c]) => `<div><div class="kpi" style="color:${c}">${v}</div>
      <div class="eyebrow" style="margin-top:3px">${l}</div></div>`).join("");
  return panel({
    tag: "warstwa 1 · rozkład intensywności", doc: "zones",
    title: "Biegi według średniego tętna", right: `${i.n} biegów`,
    body: `<p class="hint">Progi wynikają z ustawionego HR max: spokojne poniżej ${i.easyMax},
      pośrednie do ${i.midMax}, mocne powyżej. Zmiana kalibracji zmienia ten wykres.</p>
      <div class="row" style="gap:22px;margin-bottom:12px">${kpi}</div>
      ${stackChart({ data: i.list, xKey: "month", keys: [
        { key: "easy", color: "#2C6B57", label: "spokojne" },
        { key: "mid", color: "#9A6B12", label: "pośrednie" },
        { key: "hard", color: "#B23A26", label: "mocne" }] })}`,
  });
}

function pacePanel(d) {
  const bands = [[135, 145], [145, 160], [155, 168]].map((b) =>
    `<button class="seg" data-band="${b[0]},${b[1]}" aria-pressed="${state.band[0] === b[0]}">${b[0]}–${b[1]}</button>`).join("");
  const toggle = `<button class="seg" data-adjust="1" aria-pressed="${state.adjust}">${state.adjust ? "skorygowane" : "surowe"}</button>`;
  const body = d.pace.length > 1
    ? `${lineChart({ data: d.pace, xKey: "label", height: 180, reversed: true,
        fmt: fmtPace, series: [{ key: "sec", color: "#17395C", width: 2, dots: true }] })}
       <p class="note">korekta terenowa: −4 s/km na każde 10 m/km przewyższenia
         ${state.adjust ? "(włączona)" : "(wyłączona)"}</p>`
    : `<p class="hint">Za mało biegów w tym paśmie tętna. Wybierz szersze pasmo.</p>`;
  return panel({
    tag: "warstwa 1 · kpi cyklu", doc: "pace", title: "Tempo przy zadanym tętnie",
    right: `<span class="row" style="justify-content:flex-end">${bands}${toggle}</span>`,
    body,
  });
}

function tablePanel(d) {
  const rows = [...state.workouts].reverse().map((w) => `<tr style="opacity:${w.isNoise ? .45 : 1}">
    <td>${esc(w.date)}</td><td style="font-size:11px">${esc(w.type)}</td>
    <td>${w.duration}</td><td>${w.distance?.toFixed(2) ?? "—"}</td><td>${w.elevation ?? "—"}</td>
    <td>${w.avgHr ?? "—"}</td>
    <td style="color:${(w.z5 ?? 0) > 20 ? "var(--flag)" : "inherit"}">${w.z5 ? w.z5.toFixed(1) : "—"}</td>
    <td style="color:${w.zoneCoverage != null && w.zoneCoverage < .8 ? "var(--warn)" : "inherit"}">
      ${w.zoneCoverage != null ? w.zoneCoverage.toFixed(2) : "—"}</td>
    <td>${w.trimp ? Math.round(w.trimp) : "—"}</td>
    <td style="font-size:10px;color:var(--slate)">
      ${[w.isNoise && "szum", w.overlapsPrev && "nakładka"].filter(Boolean).join(" ")}</td></tr>`).join("");
  return panel({
    tag: "warstwa 0 · rekordy", title: "Treningi po przetworzeniu",
    right: `${state.workouts.length} sesji`,
    body: `<div class="scroll"><table><thead><tr>
      <th>data</th><th>typ</th><th>min</th><th>km</th><th>m</th><th>HR śr</th>
      <th>Z5 min</th><th>pokr.</th><th>TRIMP</th><th>flagi</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`,
  });
}

function backupPanel() {
  return panel({
    tag: "baza", doc: "backup", title: "Kopia zapasowa",
    body: `<p class="hint">Baza żyje w tej przeglądarce. Zrób kopię, zanim będzie potrzebna.</p>
      <div class="row">
        <button class="seg" data-act="export">Pobierz kopię JSON</button>
        <button class="seg" data-act="import">Wczytaj kopię</button>
        <button class="seg" data-act="wipe" style="color:var(--flag)">Wyczyść bazę</button>
      </div><input type="file" id="restore" accept=".json,application/json" hidden>`,
  });
}

/* ===== zdarzenia ==================================================== */

const drop = $("#drop"), fileInput = $("#file");

// Bez własnego handlera na kliknięcie: <label for="file"> otwiera okno wyboru
// natywnie. Wcześniejsze drop.click() → fileInput.click() zapętlało się,
// bo input leży wewnątrz strefy i zdarzenie wracało do tego samego handlera.

// Przeglądarka domyślnie otwiera upuszczony plik zamiast oddać go stronie.
// Bez tej blokady CSV upuszczony obok strefy ląduje w Excelu.
["dragover", "drop"].forEach((ev) =>
  window.addEventListener(ev, (e) => e.preventDefault(), false));

drop.addEventListener("dragenter", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", (e) => {
  if (!drop.contains(e.relatedTarget)) drop.classList.remove("over");
});
drop.addEventListener("drop", (e) => {
  e.preventDefault(); e.stopPropagation();
  drop.classList.remove("over");
  ingestFiles(e.dataTransfer.files);
});

fileInput.addEventListener("change", (e) => {
  // Lista plików musi zostać skopiowana ZANIM wyczyścimy input —
  // ustawienie value="" opróżnia FileList w przeglądarce.
  const files = Array.from(e.target.files || []);
  e.target.value = ""; // pozwala wgrać ten sam plik ponownie
  ingestFiles(files);
});

$("#app").addEventListener("click", async (e) => {
  const t = e.target.closest("[data-doc],[data-metric],[data-band],[data-adjust],[data-hrmax],[data-act]");
  if (!t) return;

  if (t.dataset.doc) state.openDoc = state.openDoc === t.dataset.doc ? null : t.dataset.doc;
  else if (t.dataset.metric) state.selMetric = state.selMetric === t.dataset.metric ? null : t.dataset.metric;
  else if (t.dataset.band) state.band = t.dataset.band.split(",").map(Number);
  else if (t.dataset.adjust) state.adjust = !state.adjust;
  else if (t.dataset.hrmax) { state.hrMax = +t.dataset.hrmax; await db.setSetting("hrMax", state.hrMax); }
  else if (t.dataset.act === "export") return doExport();
  else if (t.dataset.act === "import") return $("#restore").click();
  else if (t.dataset.act === "wipe") {
    if (!confirm("Usunąć wszystkie dane z bazy? Kopii nie da się odzyskać bez pliku JSON.")) return;
    await db.wipeAll(); state.files = []; await loadFromDb();
  }
  render();
});

$("#app").addEventListener("change", async (e) => {
  if (e.target.id === "hrmaxNum" || e.target.id === "hrmaxRange") {
    state.hrMax = +e.target.value;
    await db.setSetting("hrMax", state.hrMax);
    render();
  }
  if (e.target.id === "restore") {
    try {
      const txt = await e.target.files[0].text();
      const n = await db.importAll(JSON.parse(txt));
      await loadFromDb(); render();
      alert(`Wczytano ${n} rekordów.`);
    } catch (err) { showErr(`Nie udało się wczytać kopii: ${err.message}`); }
  }
});

$("#app").addEventListener("input", (e) => {
  if (e.target.id === "hrmaxRange") $("#hrmaxNum").value = e.target.value;
  if (e.target.id === "hrmaxNum") $("#hrmaxRange").value = e.target.value;
});

async function doExport() {
  const data = await db.exportAll();
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `itrainer-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ===== start ======================================================== */

$("#ver").innerHTML = `<span>kod ${VERSION}</span>`;
$("#ver").hidden = false;

Promise.all([loadPlan(), loadFromDb()])
  .then(() => { try { render(); } catch (e) { showErr(`Błąd widoku: ${e.message}`); console.error(e); } })
  .catch((e) => showErr(`Nie udało się otworzyć bazy: ${e.message}`));
