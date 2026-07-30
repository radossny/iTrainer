
// Wykresy jako czysty SVG. Zamiast Recharts — zero zależności, pełna kontrola
// nad wyglądem, a potrzebne są tylko dwa typy: słupki z linią i wykres liniowy.

const PAD = { t: 10, r: 44, b: 22, l: 46 };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function scale(min, max, from, to) {
  if (max === min) max = min + 1;
  return (v) => from + ((v - min) / (max - min)) * (to - from);
}

function ticks(min, max, n = 4) {
  const step = (max - min) / n;
  return Array.from({ length: n + 1 }, (_, i) => min + i * step);
}

function frame(w, h, yl, yr, xLabels) {
  const [x0, x1, y0, y1] = [PAD.l, w - PAD.r, PAD.t, h - PAD.b];
  let s = "";
  for (const t of ticks(yl.min, yl.max)) {
    const y = yl.s(t);
    s += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="#EDF0F1"/>`;
    s += `<text x="${x0 - 6}" y="${y + 3}" text-anchor="end" class="ax">${yl.fmt(t)}</text>`;
  }
  if (yr) for (const t of ticks(yr.min, yr.max)) {
    s += `<text x="${x1 + 6}" y="${yr.s(t) + 3}" class="ax">${yr.fmt(t)}</text>`;
  }
  const every = Math.max(1, Math.ceil(xLabels.length / 8));
  xLabels.forEach((l, i) => {
    if (i % every) return;
    const x = x0 + ((i + 0.5) / xLabels.length) * (x1 - x0);
    s += `<text x="${x}" y="${h - 6}" text-anchor="middle" class="ax">${esc(l)}</text>`;
  });
  return s;
}

/**
 * Słupki (lewa oś) plus linia (prawa oś). Używane dla TRIMP + ACWR.
 */
export function comboChart({ data, xKey, barKey, lineKey, refLine, height = 220, barColor = "#17395C", lineColor = "#B23A26" }) {
  const w = 1000, h = height;
  const [x0, x1, y0, y1] = [PAD.l, w - PAD.r, PAD.t, h - PAD.b];
  if (!data.length) return "";

  const bMax = Math.max(...data.map((d) => d[barKey] || 0), 1);
  const yl = { min: 0, max: bMax, s: scale(0, bMax, y1, y0), fmt: (v) => Math.round(v) };
  const lVals = data.map((d) => d[lineKey]).filter((v) => v != null);
  const lMax = Math.max(...lVals, refLine ?? 0, 1) * 1.1;
  const yr = { min: 0, max: lMax, s: scale(0, lMax, y1, y0), fmt: (v) => v.toFixed(1) };

  const bw = ((x1 - x0) / data.length) * 0.7;
  let s = frame(w, h, yl, yr, data.map((d) => d[xKey]));

  data.forEach((d, i) => {
    const cx = x0 + ((i + 0.5) / data.length) * (x1 - x0);
    const v = d[barKey] || 0;
    s += `<rect x="${cx - bw / 2}" y="${yl.s(v)}" width="${bw}" height="${Math.max(0, y1 - yl.s(v))}" fill="${barColor}"><title>${esc(d[xKey])}: ${Math.round(v)}</title></rect>`;
  });

  if (refLine != null) {
    s += `<line x1="${x0}" x2="${x1}" y1="${yr.s(refLine)}" y2="${yr.s(refLine)}" stroke="${lineColor}" stroke-dasharray="4 3" opacity=".6"/>`;
  }

  const pts = data.map((d, i) => d[lineKey] == null ? null
    : [x0 + ((i + 0.5) / data.length) * (x1 - x0), yr.s(d[lineKey])]).filter(Boolean);
  if (pts.length > 1) {
    s += `<polyline fill="none" stroke="${lineColor}" stroke-width="1.6" points="${pts.map((p) => p.join(",")).join(" ")}"/>`;
    s += pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="2" fill="${lineColor}"/>`).join("");
  }
  return `<svg viewBox="0 0 ${w} ${h}" class="chart" preserveAspectRatio="none">${s}</svg>`;
}

/**
 * Wiele serii liniowych. axis: 'l' albo 'r'. reversed odwraca oś (tempo).
 */
export function lineChart({ data, xKey, series, refLine, height = 200, reversed = false, fmt }) {
  const w = 1000, h = height;
  const [x0, x1, y0, y1] = [PAD.l, w - PAD.r, PAD.t, h - PAD.b];
  if (!data.length) return "";

  const collect = (axis) => data.flatMap((d) =>
    series.filter((s) => (s.axis || "l") === axis).map((s) => d[s.key]).filter((v) => v != null));

  const mk = (vals, extra) => {
    const all = [...vals, ...(extra != null ? [extra] : [])];
    if (!all.length) return null;
    const pad = (Math.max(...all) - Math.min(...all)) * 0.1 || 1;
    const min = Math.min(...all) - pad, max = Math.max(...all) + pad;
    return { min, max, s: reversed ? scale(min, max, y0, y1) : scale(min, max, y1, y0), fmt: fmt || ((v) => Math.round(v)) };
  };
  const yl = mk(collect("l"), refLine);
  const yr = mk(collect("r"));
  if (!yl) return "";

  let s = frame(w, h, yl, yr, data.map((d) => d[xKey]));
  if (refLine != null) {
    s += `<line x1="${x0}" x2="${x1}" y1="${yl.s(refLine)}" y2="${yl.s(refLine)}" stroke="#B23A26" stroke-dasharray="4 3" opacity=".7"/>`;
  }
  for (const ser of series) {
    const ax = (ser.axis || "l") === "r" ? yr : yl;
    if (!ax) continue;
    const pts = data.map((d, i) => d[ser.key] == null ? null
      : [x0 + ((i + 0.5) / data.length) * (x1 - x0), ax.s(d[ser.key])]).filter(Boolean);
    if (pts.length < 2) continue;
    s += `<polyline fill="none" stroke="${ser.color}" stroke-width="${ser.width || 1.6}" points="${pts.map((p) => p.join(",")).join(" ")}"/>`;
    if (ser.dots) s += pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="${ser.color}"><title>${esc(data[i][xKey])}</title></circle>`).join("");
  }
  return `<svg viewBox="0 0 ${w} ${h}" class="chart" preserveAspectRatio="none">${s}</svg>`;
}

/** Słupki skumulowane — rozkład intensywności. */
export function stackChart({ data, xKey, keys, height = 170 }) {
  const w = 1000, h = height;
  const [x0, x1, y0, y1] = [PAD.l, w - PAD.r, PAD.t, h - PAD.b];
  if (!data.length) return "";
  const totals = data.map((d) => keys.reduce((a, k) => a + (d[k.key] || 0), 0));
  const max = Math.max(...totals, 1);
  const yl = { min: 0, max, s: scale(0, max, y1, y0), fmt: (v) => Math.round(v) };
  let s = frame(w, h, yl, null, data.map((d) => d[xKey]));
  const bw = ((x1 - x0) / data.length) * 0.6;
  data.forEach((d, i) => {
    const cx = x0 + ((i + 0.5) / data.length) * (x1 - x0);
    let acc = 0;
    for (const k of keys) {
      const v = d[k.key] || 0;
      if (!v) continue;
      const yTop = yl.s(acc + v), yBot = yl.s(acc);
      s += `<rect x="${cx - bw / 2}" y="${yTop}" width="${bw}" height="${yBot - yTop}" fill="${k.color}"><title>${esc(k.label)}: ${v}</title></rect>`;
      acc += v;
    }
  });
  return `<svg viewBox="0 0 ${w} ${h}" class="chart" preserveAspectRatio="none">${s}</svg>`;
}
