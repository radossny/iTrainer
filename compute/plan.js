// =====================================================================
// Plan: dopasowanie wykonania do zamierzenia + reguły korekty.
// Czyste funkcje, bez DOM i bez bazy — tak jak compute/metrics.js.
// =====================================================================

const DAY = 86400000;
const today = () => new Date().toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / DAY);

const RUN_TYPES = new Set(["Running"]);

/** Typy jednostek, w których liczy się utrzymanie pułapu tętna. */
const CAPPED = new Set(["easy", "long"]);

/**
 * Dopasowuje wykonane treningi do zaplanowanych jednostek — po dacie.
 * Zwraca listę wzbogaconą o status i compliance.
 */
export function matchPlan(sessions, workouts, refDate = today()) {
  const byDate = new Map();
  for (const w of workouts) {
    if (!RUN_TYPES.has(w.type) || w.isNoise) continue;
    const cur = byDate.get(w.date);
    // gdy w danym dniu jest kilka biegów, bierzemy najdłuższy
    if (!cur || w.duration > cur.duration) byDate.set(w.date, w);
  }

  return sessions.map((s) => {
    const done = byDate.get(s.date) || null;
    const past = dayDiff(s.date, refDate) > 0;
    let status = "upcoming";
    if (s.date === refDate) status = done ? "done" : "today";
    else if (past) status = done ? "done" : "missed";

    return { ...s, workout: done, status, compliance: done ? compliance(s, done) : null };
  });
}

/**
 * Ocena zgodności wykonania z przepisem, 0..1, plus czytelne uwagi.
 * Rozdzielone na czas trwania i intensywność, bo to różne rodzaje odstępstwa:
 * krótszy bieg to mniejszy bodziec, za szybki bieg to inny bodziec.
 */
export function compliance(session, w) {
  const notes = [];

  // czas trwania
  let durScore = 1;
  if (session.min) {
    const ratio = w.duration / session.min;
    durScore = Math.max(0, 1 - Math.abs(1 - ratio) * 2);
    if (ratio < 0.8) notes.push(`krócej niż w planie (${w.duration} z ${session.min} min)`);
    else if (ratio > 1.25) notes.push(`dłużej niż w planie (${w.duration} z ${session.min} min)`);
  }

  // intensywność
  let hrScore = 1;
  if (w.avgHr) {
    if (CAPPED.has(session.kind) && session.hrMax) {
      const over = w.avgHr - session.hrMax;
      if (over > 0) {
        hrScore = Math.max(0, 1 - over / 15);
        notes.push(`tętno ${w.avgHr} przy limicie ${session.hrMax} — biegłeś za szybko`);
      }
    } else if (session.hrLo && session.hrHi) {
      // dla akcentów interesuje nas trafienie w pasmo; średnia rozmywa przerwy,
      // więc tolerancja jest szeroka i traktujemy to jako wskazówkę, nie ocenę
      if (w.avgHr < session.hrLo - 12) {
        hrScore = 0.6;
        notes.push(`tętno ${w.avgHr} niżej niż pasmo ${session.hrLo}–${session.hrHi}`);
      } else if (w.avgHr > session.hrHi + 8) {
        hrScore = 0.5;
        notes.push(`tętno ${w.avgHr} powyżej pasma ${session.hrLo}–${session.hrHi}`);
      }
    }
  }

  return { score: Math.round((0.5 * durScore + 0.5 * hrScore) * 100) / 100, notes };
}

/** Najbliższa jednostka: dzisiejsza, a jeśli nie ma — pierwsza przed nami. */
export function nextSession(matched, refDate = today()) {
  return matched.find((s) => s.date === refDate)
      || matched.find((s) => dayDiff(refDate, s.date) > 0)
      || null;
}

/** Tydzień zawierający wskazany dzień (poniedziałek–niedziela). */
export function weekOf(matched, refDate = today()) {
  const d = new Date(refDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const start = d.toISOString().slice(0, 10);
  const end = new Date(d.getTime() + 6 * DAY).toISOString().slice(0, 10);
  return matched.filter((s) => s.date >= start && s.date <= end);
}

export function planSummary(matched, goal, refDate = today()) {
  const done = matched.filter((s) => s.status === "done");
  const missed = matched.filter((s) => s.status === "missed");
  const scored = done.filter((s) => s.compliance);
  return {
    daysToRace: dayDiff(refDate, goal.eventDate),
    done: done.length,
    missed: missed.length,
    total: matched.length,
    avgCompliance: scored.length
      ? Math.round((scored.reduce((a, s) => a + s.compliance.score, 0) / scored.length) * 100)
      : null,
  };
}

/**
 * Warstwa reguł. Sprawdza się codziennie, bez udziału modelu językowego.
 * Progi pochodzą z wartości bazowych użytkownika, nie ze stałych.
 */
export function checkRules({ daily, vitals, bases, matched, refDate = today() }) {
  const out = [];
  const last = (arr, n) => arr.slice(-n);

  // tętno spoczynkowe powyżej progu dwa dni z rzędu
  if (bases.rhr) {
    const two = last(vitals.filter((v) => v.rhr != null), 2);
    if (two.length === 2 && two.every((v) => v.rhr > bases.rhr.hi)) {
      out.push({
        lvl: "flag",
        t: `Tętno spoczynkowe powyżej progu dwa dni z rzędu (${two.map((v) => v.rhr).join(", ")} przy progu ${bases.rhr.hi.toFixed(0)})`,
        d: "Najbliższy akcent zamień na spokojne 40 minut.",
      });
    }
  }

  // HRV poniżej progu trzy dni z rzędu
  if (bases.hrv) {
    const three = last(vitals.filter((v) => v.hrv != null), 3);
    if (three.length === 3 && three.every((v) => v.hrv < bases.hrv.lo)) {
      out.push({
        lvl: "flag",
        t: `HRV poniżej progu trzy dni z rzędu (${three.map((v) => Math.round(v.hrv)).join(", ")} przy progu ${bases.hrv.lo.toFixed(0)})`,
        d: "Opuść jedną jednostkę w tym tygodniu.",
      });
    }
  }

  // skok obciążenia
  const acwr = last(daily.filter((d) => d.acwr != null), 1)[0]?.acwr;
  if (acwr != null && acwr > 1.5) {
    out.push({
      lvl: "warn",
      t: `ACWR ${acwr.toFixed(2)} — skok obciążenia`,
      d: "Nie zwiększaj objętości w kolejnym tygodniu.",
    });
  } else if (acwr != null && acwr < 0.8 && dayDiffToRace(matched) > 14) {
    out.push({
      lvl: "info",
      t: `ACWR ${acwr.toFixed(2)} — obciążenie spada`,
      d: "Poza taperem to sygnał, że objętość jest za niska.",
    });
  }

  // spokojny bieg wykonany za szybko
  const capped = matched.filter((s) => s.status === "done" && CAPPED.has(s.kind) && s.hrMax && s.workout?.avgHr);
  const tooFast = last(capped, 3).filter((s) => s.workout.avgHr > s.hrMax + 3);
  if (tooFast.length >= 2) {
    out.push({
      lvl: "warn",
      t: `${tooFast.length} z ostatnich spokojnych biegów wykonane powyżej limitu tętna`,
      d: "To najczęstszy sposób zmarnowania bloku bazowego. Spokojnie znaczy wolniej, niż się chce.",
    });
  }

  // pominięte jednostki
  const missedRecent = matched.filter((s) => s.status === "missed" && dayDiff2(s.date, refDate) <= 14);
  if (missedRecent.length >= 2) {
    out.push({
      lvl: "warn",
      t: `${missedRecent.length} pominiętych jednostek w ostatnich dwóch tygodniach`,
      d: "Przy trzech bieganiach w tygodniu każda pominięta to jedna trzecia bodźca.",
    });
  }

  // sen
  const sleep = last(vitals.filter((v) => v.sleep != null), 3);
  if (sleep.length === 3 && sleep.every((v) => v.sleep < 6)) {
    out.push({
      lvl: "warn",
      t: "Trzy noce poniżej 6 godzin snu",
      d: "Przesuń akcent tempowy o dzień.",
    });
  }

  if (!out.length) out.push({ lvl: "ok", t: "Brak sygnałów ostrzegawczych", d: "Realizuj plan bez zmian." });
  return out;
}

function dayDiff2(a, b) { return dayDiff(a, b); }
function dayDiffToRace(matched) {
  const race = matched.find((s) => s.kind === "race");
  return race ? dayDiff(today(), race.date) : 999;
}

export const KIND_LABEL = {
  easy: "spokojnie", tempo: "akcent", long: "wybieganie", race: "START", rest: "wolne",
};
export const KIND_COLOR = {
  easy: "#2C6B57", tempo: "#9A6B12", long: "#17395C", race: "#B23A26", rest: "#C3CBD0",
};
