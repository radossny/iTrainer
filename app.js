import { parseCsv, detectKind, num } from "./lib/csv.js";
import * as db from "./lib/db.js";
import { comboChart, lineChart, stackChart } from "./lib/chart.js";
import { DOCS } from "./docs.js";
import {
  detectActiveMetrics, parseWorkouts, buildDailyLoad, weeklyLoad, hrrZones,
  baseline, calibrate, paceAtHr, intensitySplit, qualityReport, fmtPace,
} from "./compute/index.js";

const AGE = 41; // do wzoru 220 − wiek; docelowo z profilu użytkownika

const state = {
  daily: [], workouts: [], files: [],
  hrMax: null, hrRest: null,
  band: [145, 160], adjust: true, selMetric: null, openDoc: null,
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ===== wczytywanie ================================================== */

async function ingestFiles(fileList) {
  $("#err").hidden = true;
  for (const file of fileList) {
    if (!/\.csv$/i.test(file.name)) continue;
    try {
      const { header, rows } = parseCsv(await file.text());
      const kind = detectKind(header);
      if (kind === "workouts") {
        await db.bulkPut("workouts", parseWorkouts(rows).workouts);
        state.files.push({ name: file.name, kind: "treningi", n: rows.length });
      } else if (kind === "daily") {
        const merged = rows.map((r) => ({ ...r, date: r.date }));
        await db.bulkPut("daily", merged);
        state.files.push({ name: file.name, kind: "zdrowie", n: rows.length });
      } else {
        showErr(`${file.name}: nie rozpoznano formatu. Oczekiwana kolumna „date” albo „startDate”.`);
        continue;
      }
      await db.put("imports", {
        id: `${Date.now()}-${file.name}`, importedAt: new Date().toISOString(),
        source: "vital2ai", fileName: file.name, rows: rows.length, kind,
      });
    } catch (e) {
      showErr(`${file.name}: ${e.message}`);
    }
  }
  await loadFromDb();
  render();
}

function showErr(msg) {
  const el = $("#err");
  el.hidden = false;
  el.innerHTML = `<div class="panel" style="border-color:var(--flag)">
    <div class="panel-b" style="color:var(--flag);font-size:13px">${esc(msg)}</div></div>`;
}

async function loadFromDb() {
  state.daily = (await db.getAll("daily")).sort((a, b) => a.date.localeCompare(b.date));
  state.workouts = (await db.getAll("workouts")).sort((a, b) => a.startMs - b.startMs);
  state.hrMax = await db.getSetting("hrMax", null);
  state.hrRest = await db.getSetting("hrRest", null);
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
  }));
  return {
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
  $("#files").innerHTML = state.files
    .map((f) => `<span class="chip">${esc(f.name)} · ${f.kind} · ${f.n}</span>`).join("");

  if (!state.daily.length && !state.workouts.length) {
    $("#app").innerHTML = `<p class="empty">Po wczytaniu pojawi się kalibracja, raport jakości i wskaźniki.</p>`;
    return;
  }

  const d = derive();

  $("#stat").hidden = false;
  $("#stat").innerHTML = [
    `dni: ${state.daily.length}`, `treningi: ${state.workouts.length}`,
    `metryki: ${d.metrics.filter((m) => m.isActive).length}/${d.metrics.length}`,
    `HR max: ${d.hrMax}${state.hrMax ? "" : " (proponowane)"}`,
    `HR spocz.: ${d.hrRest}`,
  ].map((s) => `<span>${esc(s)}</span>`).join("");

  $("#app").innerHTML = [
    calibPanel(d), qualityPanel(d), ledgerPanel(d), loadPanel(d),
    vitalsPanel(d), intensityPanel(d), pacePanel(d), tablePanel(d), backupPanel(),
  ].join("");
}

/* ---- panele -------------------------------------------------------- */

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
drop.addEventListener("click", () => fileInput.click());
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault(); drop.classList.remove("over");
  ingestFiles(e.dataTransfer.files);
});
fileInput.addEventListener("change", (e) => ingestFiles(e.target.files));

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

loadFromDb().then(render).catch((e) => showErr(`Nie udało się otworzyć bazy: ${e.message}`));
