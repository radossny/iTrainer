
// =====================================================================
// WARSTWA 0 i 1 — czyste funkcje, bez UI i bez bazy.
// To jest serce aplikacji. Wszystko, co poniżej, da się testować
// bez przeglądarki i bez danych osobowych.
// =====================================================================

import { num } from "../lib/csv.js";

export const NOISE_TYPES = new Set(["Flexibility", "Cooldown", "Preparation and Recovery"]);
export const NOISE_MAX_MIN = 5;
export const TERRAIN_SEC_PER_10M = 4; // korekta tempa: s/km na 10 m/km przewyższenia

/* --- pomocnicze ------------------------------------------------------ */

export function hashRow(...parts) {
  let h = 5381;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const isoDay = (d) => d.toISOString().slice(0, 10);

export function weekStart(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return isoDay(d);
}

export const monthKey = (s) => s.slice(0, 7);
export const fmtPace = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

/* --- metryki dzienne -------------------------------------------------- */

/**
 * Wykrywa, które kolumny eksportu niosą informację.
 * Kluczowe: kolumna wypełniona samymi zerami wygląda na obecną, a nie jest.
 * Bez tego filtra model dostaje "zero minut światła dziennego przez kwartał".
 */
export function detectActiveMetrics(rows) {
  if (!rows.length) return [];
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => c !== "date");
  return cols.map((metric) => {
    const vals = [];
    let firstSeen = null, lastSeen = null;
    for (const r of rows) {
      const raw = r[metric];
      if (raw === null || raw === undefined || raw === "") continue;
      vals.push(raw);
      if (!firstSeen) firstSeen = r.date;
      lastSeen = r.date;
    }
    const nums = vals.map(num).filter((v) => v !== null);
    const numeric = vals.length > 0 && nums.length === vals.length;
    const distinct = new Set(vals.map(String)).size;
    let status = "ok";
    if (vals.length === 0) status = "empty";
    else if (numeric && nums.every((v) => v === 0)) status = "all_zero";
    else if (distinct === 1) status = "constant";
    return {
      metric, nValues: vals.length, nDistinct: distinct,
      coverage: vals.length / rows.length,
      firstSeen, lastSeen, status, numeric,
      isActive: status === "ok",
    };
  }).sort((a, b) => b.coverage - a.coverage || a.metric.localeCompare(b.metric));
}

/* --- treningi --------------------------------------------------------- */

/**
 * import_hash daje idempotencję: zachodzące na siebie eksporty można wgrywać
 * bez duplikatów. Wykrywa też sesje nakładające się w czasie, żeby dzienna
 * suma minut nie liczyła tego samego dwa razy.
 */
export function parseWorkouts(rows) {
  const out = [];
  const seen = new Set();
  let duplicates = 0;

  for (const r of rows) {
    const start = r.startDate;
    const duration = num(r.duration);
    if (!start || duration === null) continue;
    const id = hashRow(start, r.workoutActivityType, duration);
    if (seen.has(id)) { duplicates++; continue; }
    seen.add(id);

    const startMs = new Date(String(start).replace(" ", "T") + ":00").getTime();
    const z = [1, 2, 3, 4, 5].map((i) => num(r[`heartRateZone${i}Duration`]) ?? 0);
    const zoneSum = z.reduce((a, b) => a + b, 0);

    out.push({
      id, date: String(start).slice(0, 10), start: String(start),
      startMs, endMs: startMs + duration * 60000,
      type: r.workoutActivityType || "Unknown",
      duration,
      distance: num(r.totalDistance),
      elevation: num(r.elevationGain),
      pace: num(r.averagePace),
      avgHr: num(r.averageHeartRate),
      maxHr: num(r.maximumHeartRate),
      effort: num(r.workoutEffortScore),
      z1: z[0], z2: z[1], z3: z[2], z4: z[3], z5: z[4],
      zoneCoverage: duration > 0 && zoneSum > 0 ? zoneSum / duration : null,
      isNoise: NOISE_TYPES.has(r.workoutActivityType) && duration < NOISE_MAX_MIN,
      isRace: false,
      source: "vital2ai",
    });
  }

  out.sort((a, b) => a.startMs - b.startMs);
  let overlaps = 0;
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i + 1].startMs < out[i].endMs) { out[i + 1].overlapsPrev = true; overlaps++; }
  }
  return { workouts: out, duplicates, overlaps };
}

/* --- obciążenie ------------------------------------------------------- */

/**
 * TRIMP Banistera. Zależy WYŁĄCZNIE od HRmax i HRspocz, które trzymamy u siebie.
 * Świadomie nie korzysta ze stref Apple: te są przeliczane pierwszego dnia
 * każdego miesiąca, więc minuty w strefie 4 sprzed roku to inna wielkość niż dziś.
 */
export function trimpBanister(durationMin, avgHr, hrMax, hrRest) {
  if (!durationMin || !avgHr) return 0;
  const hrr = Math.max(0, Math.min(1, (avgHr - hrRest) / Math.max(1, hrMax - hrRest)));
  return durationMin * hrr * 0.64 * Math.exp(1.92 * hrr);
}

/** Strefy z rezerwy tętna — nasze własne, stabilne w czasie. */
export function hrrZones(hrMax, hrRest) {
  const r = hrMax - hrRest;
  const at = (p) => Math.round(hrRest + r * p);
  const role = ["regeneracja", "baza tlenowa", "tempo umiarkowane", "próg / tempo startowe", "maksymalne"];
  return [0, 1, 2, 3, 4].map((i) => ({
    z: i + 1, lo: at(0.5 + i * 0.1), hi: i === 4 ? hrMax : at(0.6 + i * 0.1),
    pct: `${50 + i * 10}–${60 + i * 10}%`, role: role[i],
  }));
}

export function buildDailyLoad(workouts, hrMax, hrRest) {
  if (!workouts.length) return [];
  const byDate = new Map();

  for (const w of workouts) {
    w.trimp = w.isNoise ? 0 : trimpBanister(w.duration, w.avgHr, hrMax, hrRest);
    if (w.isNoise) continue;
    const cur = byDate.get(w.date) || { trimp: 0, minutes: 0, sessions: 0 };
    cur.trimp += w.trimp;
    cur.minutes += w.overlapsPrev ? 0 : w.duration;
    cur.sessions += 1;
    byDate.set(w.date, cur);
  }

  const series = [];
  const first = new Date(workouts[0].date + "T00:00:00Z");
  const last = new Date(workouts[workouts.length - 1].date + "T00:00:00Z");
  for (let d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = isoDay(d);
    series.push({ date: key, ...(byDate.get(key) || { trimp: 0, minutes: 0, sessions: 0 }) });
  }

  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return series.map((row, i) => {
    const atl = mean(series.slice(Math.max(0, i - 6), i + 1).map((r) => r.trimp));
    const ctl = mean(series.slice(Math.max(0, i - 27), i + 1).map((r) => r.trimp));
    return { ...row, atl, ctl, acwr: ctl > 0 ? atl / ctl : null };
  });
}

export function weeklyLoad(daily) {
  const m = new Map();
  for (const d of daily) {
    const w = weekStart(d.date);
    const c = m.get(w) || { week: w, label: w.slice(5), trimp: 0, minutes: 0, acwr: null };
    c.trimp += d.trimp;
    c.minutes += d.minutes;
    if (d.acwr != null) c.acwr = d.acwr;
    m.set(w, c);
  }
  return [...m.values()].sort((a, b) => a.week.localeCompare(b.week));
}

/* --- wartości bazowe -------------------------------------------------- */

/**
 * Mediana i odchylenie z ostatnich N dni. Progi alertów liczone z danych
 * użytkownika, nie wpisane na sztywno.
 */
export function baseline(values, window = 60) {
  const v = values.filter((x) => x !== null && x !== undefined).slice(-window).sort((a, b) => a - b);
  if (!v.length) return null;
  const median = v[Math.floor(v.length / 2)];
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { median, sd, lo: median - 1.5 * sd, hi: median + 1.5 * sd, n: v.length };
}

/**
 * Tętno spoczynkowe odniesienia: mediana najniższego kwartyla z ostatnich 60 dni.
 * Pojedyncze minimum bywa odczytem odstającym i zaniża rezerwę tętna.
 */
export function restingReference(values, window = 60) {
  const v = values.filter((x) => x != null).slice(-window).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = v.slice(0, Math.max(1, Math.round(v.length / 4)));
  return Math.round(q[Math.floor(q.length / 2)]);
}

/* --- kalibracja HR max ------------------------------------------------ */

/**
 * Trzy niezależne oszacowania plus sygnał ostrzegawczy.
 * Sesje z długim czasem w strefie 5 są fizjologicznie niemożliwe —
 * jeśli występują, granice stref (a więc HRmax) są zaniżone.
 */
export function calibrate(workouts, dailyRows, age = null) {
  const maxes = workouts.map((w) => w.maxHr).filter(Boolean);
  const rests = dailyRows.map((r) => num(r.restingHeartRate)).filter((v) => v != null);
  const observed = maxes.length ? Math.max(...maxes) : null;
  const hrRest = restingReference(rests) ?? 55;

  // Najmocniejszy utrzymany wysiłek, nie najdłuższy: szukamy najwyższego
  // średniego tętna wśród biegów trwających co najmniej 40 minut.
  // Bieg na 3 godziny w spokojnym tempie nic nie mówi o maksimum.
  const longHard = workouts
    .filter((w) => w.type === "Running" && w.duration >= 40 && w.avgHr)
    .sort((a, b) => b.avgHr - a.avgHr)[0] || null;
  const fromThreshold = longHard ? Math.round(longHard.avgHr / 0.9) : null;

  const z5long = workouts.filter((w) => (w.z5 ?? 0) > 20);

  // Gdy w danych są sesje z długim czasem w strefie 5, wartość obserwowana
  // jest dowodowo za niska — wtedy propozycja opiera się na progu.
  let suggested;
  if (z5long.length && observed) suggested = Math.max(fromThreshold ?? 0, observed + 5);
  else suggested = Math.max(observed ?? 0, fromThreshold ?? 0) || 185;

  return {
    observed, hrRest, longHard, fromThreshold,
    fromAge: age ? 220 - age : null,
    z5long, z5max: z5long.length ? Math.max(...z5long.map((w) => w.z5)) : 0,
    suggested,
  };
}

/* --- KPI cyklu -------------------------------------------------------- */

/**
 * Tempo przy zadanym tętnie, skorygowane o przewyższenie.
 * Jedyny wskaźnik w zestawie, który mierzy formę, a nie obciążenie.
 */
export function paceAtHr(workouts, band, adjust = true) {
  const rows = workouts
    .filter((w) => w.type === "Running" && w.pace && w.avgHr && (w.distance ?? 0) >= 3
      && w.avgHr >= band[0] && w.avgHr <= band[1])
    .map((w) => {
      const mPerKm = w.distance ? (w.elevation ?? 0) / w.distance : 0;
      const raw = w.pace * 60;
      return { week: weekStart(w.date), sec: adjust ? raw - (mPerKm / 10) * TERRAIN_SEC_PER_10M : raw, mPerKm };
    });
  const m = new Map();
  for (const r of rows) m.set(r.week, [...(m.get(r.week) || []), r]);
  return [...m.entries()].sort().map(([week, v]) => ({
    week, label: week.slice(5),
    sec: v.reduce((a, b) => a + b.sec, 0) / v.length,
    mPerKm: v.reduce((a, b) => a + b.mPerKm, 0) / v.length,
    n: v.length,
  }));
}

/** Rozkład intensywności biegów. Progi wynikają z kalibracji, nie ze stałych. */
export function intensitySplit(workouts, zones) {
  const runs = workouts.filter((w) => w.type === "Running" && w.avgHr);
  const easyMax = zones[2].lo, midMax = zones[3].hi;
  const m = new Map();
  for (const r of runs) {
    const k = monthKey(r.date);
    const c = m.get(k) || { month: k, easy: 0, mid: 0, hard: 0 };
    if (r.avgHr < easyMax) c.easy++;
    else if (r.avgHr < midMax) c.mid++;
    else c.hard++;
    m.set(k, c);
  }
  const list = [...m.values()].sort((a, b) => a.month.localeCompare(b.month));
  const tot = list.reduce((a, r) => ({ easy: a.easy + r.easy, mid: a.mid + r.mid, hard: a.hard + r.hard }),
    { easy: 0, mid: 0, hard: 0 });
  return { list, tot, n: runs.length, easyMax, midMax };
}

/* --- raport jakości --------------------------------------------------- */

export function qualityReport({ metrics, parsed, dailyRows, calib }) {
  const f = [];
  const push = (lvl, t, d) => f.push({ lvl, t, d });

  if (calib.z5long.length) push("flag",
    `${calib.z5long.length} sesji z ponad 20 minutami w strefie 5`,
    `Najdłuższa: ${Math.round(calib.z5max)} min. Strefa 5 to wysiłek maksymalny — nie da się w niej spędzić godziny. Granice stref z zegarka są za nisko, czyli HR max jest niedoszacowane.`);

  const zero = metrics.filter((m) => m.status === "all_zero");
  if (zero.length) push("flag",
    `${zero.length} kolumn wypełnionych samymi zerami`,
    `${zero.map((m) => m.metric).join(", ")} — komplet wartości, wszystkie zerowe. Nie da się odróżnić braku danych od zera. Odfiltrowane.`);

  const empty = metrics.filter((m) => m.status === "empty");
  if (empty.length) push("info", `${empty.length} kolumn całkowicie pustych`, "Odfiltrowane.");

  const konst = metrics.filter((m) => m.status === "constant");
  if (konst.length) push("warn", `${konst.length} kolumn o stałej wartości`, konst.map((m) => m.metric).join(", "));

  const lowCov = parsed.workouts.filter((w) => w.zoneCoverage != null && w.zoneCoverage < 0.8).length;
  if (lowCov) push("warn", `${lowCov} sesji z pokryciem stref poniżej 0,8`,
    "Luki w pomiarze tętna. Bez wpływu na TRIMP, który liczy ze średniego tętna.");

  if (parsed.overlaps) push("warn", `${parsed.overlaps} sesji nakładających się w czasie`,
    "Minuty liczone raz, żeby nie zawyżać dziennej sumy.");

  if (parsed.duplicates) push("info", `${parsed.duplicates} duplikatów pominiętych`,
    "Wykryte po import_hash — zachodzące eksporty można wgrywać bez obaw.");

  const noise = parsed.workouts.filter((w) => w.isNoise).length;
  if (noise) push("info", `${noise} sesji oznaczonych jako szum`,
    `Rozciąganie i schłodzenie krótsze niż ${NOISE_MAX_MIN} min. Poza obciążeniem.`);

  if (dailyRows.length > 1) {
    const span = Math.round(
      (new Date(dailyRows[dailyRows.length - 1].date) - new Date(dailyRows[0].date)) / 86400000) + 1;
    const gaps = span - dailyRows.length;
    if (gaps > 0) push("warn", `${gaps} dni bez rekordu dziennego`, "Luki w ciągu dat.");
    else push("ok", "Ciąg dat bez luk", `${dailyRows.length} kolejnych dni.`);
  }
  return f;
}
