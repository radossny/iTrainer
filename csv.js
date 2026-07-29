// Parser CSV. Obsługuje pola w cudzysłowach i przecinki w środku pól.
// Świadomie bez biblioteki — jedna zależność mniej, a to jest ~40 linii.

export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;

  // usuń BOM, znormalizuj końce linii
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== "")) rows.push(row);

  if (!rows.length) return { header: [], rows: [] };
  const header = rows[0].map((h) => h.trim());
  const out = rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    return o;
  });
  return { header, rows: out };
}

/** Rozpoznaje typ pliku po nagłówkach. Zwraca 'workouts' | 'daily' | null. */
export function detectKind(header) {
  if (header.includes("startDate") && header.includes("workoutActivityType")) return "workouts";
  if (header.includes("date")) return "daily";
  return null;
}

/** "" i null → null, liczba → liczba. Przecinek dziesiętny obsłużony. */
export function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
