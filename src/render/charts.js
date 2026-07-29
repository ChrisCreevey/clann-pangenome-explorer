// charts.js — hand-written SVG charts for the pangenome summary (build
// brief §6, Phase 2): frequency-class donut, gene frequency spectrum
// histogram, per-genome gene-count bar chart. No charting library.

const SVG_NS = "http://www.w3.org/2000/svg";

function el(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function emptyNote(container, text) {
  container.innerHTML = "";
  const note = document.createElement("div");
  note.className = "empty-note";
  note.textContent = text;
  container.appendChild(note);
}

/**
 * Wheel-to-zoom / drag-to-pan / double-click-to-reset on `scene` within
 * `svg`, identical interaction model to the heatmap and network graph —
 * factored out here so any chart that gets too dense to read at its
 * default size (many genomes, many bars) can opt in without
 * reimplementing it. Only `scene`'s contents move; anything appended to
 * `svg` directly (axes, labels) stays fixed pixel-for-pixel.
 *
 * `axis: "x"` (vs. the default "both") restricts zoom/pan to horizontal
 * only — for a bar chart, that's what keeps a fixed axis actually usable:
 * with 2D zoom, bars drift vertically away from a fixed baseline/axis
 * line the moment you zoom or pan (the axis was never wrong, it just
 * silently stopped matching the now-transformed bars — confusing, not a
 * rendering bug). Locking the y component to identity means the bars'
 * baseline never moves, so a fixed axis line stays correctly aligned
 * with them at every zoom level, while horizontal zoom still does the
 * one thing this exists for: spreading out bars that are too thin to
 * read at the default width.
 */
function attachPanZoom(svg, scene, { width, height, minScale = 0.5, maxScale = 20, axis = "both" } = {}) {
  const view = { k: 1, x: 0, y: 0 };
  const lockY = axis === "x";
  function applyView() {
    scene.setAttribute("transform", lockY
      ? `translate(${view.x},0) scale(${view.k},1)`
      : `translate(${view.x},${view.y}) scale(${view.k})`);
  }
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * width;
    const my = ((e.clientY - rect.top) / rect.height) * height;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const nk = Math.min(maxScale, Math.max(minScale, view.k * factor));
    view.x = mx - (mx - view.x) * (nk / view.k);
    if (!lockY) view.y = my - (my - view.y) * (nk / view.k);
    view.k = nk;
    applyView();
  }, { passive: false });
  let drag = null;
  svg.addEventListener("pointerdown", (e) => { drag = { x: e.clientX - view.x, y: e.clientY - view.y }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    view.x = e.clientX - drag.x;
    if (!lockY) view.y = e.clientY - drag.y;
    applyView();
  });
  svg.addEventListener("pointerup", () => { drag = null; });
  svg.addEventListener("dblclick", () => { view.k = 1; view.x = 0; view.y = 0; applyView(); });
  return { reset: () => { view.k = 1; view.x = 0; view.y = 0; applyView(); } };
}

const FREQ_CLASS_COLORS = {
  core: "var(--compute-500)",
  softcore: "var(--moss-500)",
  shell: "var(--amber-500)",
  cloud: "var(--clay-500)",
};
const FREQ_CLASS_LABELS = { core: "Core", softcore: "Soft-core", shell: "Shell", cloud: "Cloud" };
const FREQ_CLASS_ORDER = ["core", "softcore", "shell", "cloud"];

/**
 * Render the frequency-class donut chart from { core, softcore, shell, cloud } counts.
 */
export function renderFrequencyDonut(container, counts) {
  const total = FREQ_CLASS_ORDER.reduce((s, k) => s + (counts[k] || 0), 0);
  if (!total) return emptyNote(container, "No groups to summarise.");

  const size = 180, r = 70, cx = size / 2, cy = size / 2, strokeW = 30;
  const circumference = 2 * Math.PI * r;
  const svg = el("svg", { viewBox: `0 0 ${size} ${size}`, class: "chart-svg donut-svg", style: "max-width:220px" });

  let offset = 0;
  for (const key of FREQ_CLASS_ORDER) {
    const count = counts[key] || 0;
    if (!count) continue;
    const frac = count / total;
    const dash = frac * circumference;
    const circle = el("circle", {
      cx, cy, r, fill: "none",
      style: `stroke:${FREQ_CLASS_COLORS[key]}`,
      "stroke-width": strokeW,
      "stroke-dasharray": `${dash} ${circumference - dash}`,
      "stroke-dashoffset": -offset,
      transform: `rotate(-90 ${cx} ${cy})`,
    });
    const title = el("title", {});
    title.textContent = `${FREQ_CLASS_LABELS[key]}: ${count} (${(frac * 100).toFixed(1)}%)`;
    circle.appendChild(title);
    svg.appendChild(circle);
    offset += dash;
  }

  const centreLabel = el("text", { x: cx, y: cy - 4, "text-anchor": "middle", class: "donut-total" });
  centreLabel.textContent = String(total);
  svg.appendChild(centreLabel);
  const centreSub = el("text", { x: cx, y: cy + 12, "text-anchor": "middle", class: "donut-sub" });
  centreSub.textContent = "groups";
  svg.appendChild(centreSub);

  container.innerHTML = "";
  container.appendChild(svg);

  const legend = document.createElement("div");
  legend.className = "chart-legend";
  legend.innerHTML = FREQ_CLASS_ORDER.filter((k) => counts[k])
    .map((k) => `<span class="sw" style="background:${FREQ_CLASS_COLORS[k]}"></span>${FREQ_CLASS_LABELS[k]} (${counts[k]})`)
    .join(" &nbsp; ");
  container.appendChild(legend);
}

/**
 * Render the gene frequency spectrum: a bar per "present in N genomes" bucket.
 * `spectrum` is an array indexed 0..genomeCount-1 (index i = present in i+1 genomes).
 */
export function renderFrequencySpectrum(container, spectrum) {
  const total = spectrum.reduce((s, c) => s + c, 0);
  if (!total) return emptyNote(container, "No groups to summarise.");

  const width = 620, height = 200, pad = 34;
  const maxCount = Math.max(...spectrum) || 1;
  const barW = (width - 2 * pad) / spectrum.length;

  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart-svg" });
  spectrum.forEach((count, i) => {
    const barH = (count / maxCount) * (height - 2 * pad);
    const rect = el("rect", {
      class: "hist-bar",
      x: pad + i * barW,
      y: height - pad - barH,
      width: Math.max(1, barW - 1),
      height: barH,
    });
    const title = el("title", {});
    title.textContent = `Present in ${i + 1} genome${i === 0 ? "" : "s"}: ${count} group${count === 1 ? "" : "s"}`;
    rect.appendChild(title);
    svg.appendChild(rect);
  });
  svg.appendChild(el("line", { class: "axis", x1: pad, x2: width - pad, y1: height - pad, y2: height - pad }));

  const xLabel = el("text", { x: width / 2, y: height - 8, "text-anchor": "middle" });
  xLabel.textContent = "Number of genomes a group is present in →";
  svg.appendChild(xLabel);
  const startLabel = el("text", { x: pad, y: height - pad + 14 });
  startLabel.textContent = "1";
  svg.appendChild(startLabel);
  const endLabel = el("text", { x: width - pad, y: height - pad + 14, "text-anchor": "end" });
  endLabel.textContent = String(spectrum.length);
  svg.appendChild(endLabel);

  container.innerHTML = "";
  container.appendChild(svg);
}

/**
 * Per-genome bar chart: three overlaid metrics (total genes, unique genes,
 * core genes present) per genome, for spotting an outlier genome at a glance.
 */
export function renderGenomeBarChart(container, genomes) {
  if (!genomes.length) return emptyNote(container, "No genomes to summarise.");

  const rowH = 20, groupGap = 6, pad = 8, labelW = 130;
  const barGap = 1, subBarH = (rowH - barGap * 2) / 3;
  const width = 640;
  const height = pad * 2 + genomes.length * (rowH + groupGap);
  const maxVal = Math.max(1, ...genomes.map((g) => g.totalGenes));
  const barAreaW = width - labelW - pad * 2;

  const series = [
    { key: "totalGenes", label: "Total", color: "var(--accent)" },
    { key: "uniqueGenes", label: "Unique", color: "var(--amber-500)" },
    { key: "coreGenesPresent", label: "Core present", color: "var(--moss-500)" },
  ];

  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart-svg genome-bars" });
  genomes.forEach((genome, i) => {
    const y0 = pad + i * (rowH + groupGap);
    const text = el("text", { class: "tax-label", x: labelW - 6, y: y0 + rowH / 2 + 4, "text-anchor": "end" });
    text.textContent = genome.name;
    svg.appendChild(text);

    series.forEach((s, si) => {
      const value = genome[s.key] || 0;
      const barW = (value / maxVal) * barAreaW;
      const y = y0 + si * (subBarH + barGap);
      const rect = el("rect", {
        x: labelW, y, width: Math.max(1, barW), height: subBarH,
        style: `fill:${s.color}`,
      });
      const title = el("title", {});
      title.textContent = `${genome.name} — ${s.label}: ${value}`;
      rect.appendChild(title);
      svg.appendChild(rect);
    });
  });

  container.innerHTML = "";
  // Scroll the bars themselves (a row per genome, so this can get tall with
  // many genomes) but keep the legend always visible, outside the scroll area.
  const scrollWrap = document.createElement("div");
  scrollWrap.className = "genome-bars-scroll";
  scrollWrap.appendChild(svg);
  container.appendChild(scrollWrap);

  const legend = document.createElement("div");
  legend.className = "chart-legend";
  legend.innerHTML = series
    .map((s) => `<span class="sw" style="background:${s.color}"></span>${s.label}`)
    .join(" &nbsp; ");
  container.appendChild(legend);
}

/**
 * Render the pangenome/core-genome accumulation curves (build brief §6,
 * Phase 3) from computeAccumulationCurves()'s output: two lines (pangenome
 * size, core size) against genome count, each with a shaded +/-1 std-dev band.
 */
export function renderAccumulationCurves(container, curves) {
  if (!curves.genomeCounts.length) return emptyNote(container, "No data for accumulation curves.");

  const width = 620, height = 260, pad = 40;
  const n = curves.genomeCounts.length;
  const maxY = Math.max(...curves.pangenomeMean.map((v, i) => v + curves.pangenomeStd[i]), 1);
  const sx = (i) => pad + (i / Math.max(1, n - 1)) * (width - 2 * pad);
  const sy = (v) => height - pad - (v / maxY) * (height - 2 * pad);

  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart-svg" });
  svg.appendChild(el("line", { class: "axis", x1: pad, x2: width - pad, y1: height - pad, y2: height - pad }));
  svg.appendChild(el("line", { class: "axis", x1: pad, x2: pad, y1: pad, y2: height - pad }));

  function bandPath(mean, std) {
    const top = mean.map((v, i) => `${sx(i)},${sy(v + std[i])}`);
    const bottom = mean.map((v, i) => `${sx(i)},${sy(v - std[i])}`).reverse();
    return `M${[...top, ...bottom].join("L")}Z`;
  }
  function linePath(mean) {
    return `M${mean.map((v, i) => `${sx(i)},${sy(v)}`).join("L")}`;
  }

  const panBand = el("path", { d: bandPath(curves.pangenomeMean, curves.pangenomeStd), class: "accum-band", style: "fill:var(--accent);opacity:.15" });
  svg.appendChild(panBand);
  const coreBand = el("path", { d: bandPath(curves.coreMean, curves.coreStd), class: "accum-band", style: "fill:var(--moss-500);opacity:.15" });
  svg.appendChild(coreBand);

  svg.appendChild(el("path", { d: linePath(curves.pangenomeMean), class: "accum-line", style: "fill:none;stroke:var(--accent);stroke-width:2" }));
  svg.appendChild(el("path", { d: linePath(curves.coreMean), class: "accum-line", style: "fill:none;stroke:var(--moss-500);stroke-width:2" }));

  const xLabel = el("text", { x: width / 2, y: height - 6, "text-anchor": "middle" });
  xLabel.textContent = "Genomes sampled →";
  svg.appendChild(xLabel);
  const y0 = el("text", { x: pad - 6, y: height - pad + 4, "text-anchor": "end" });
  y0.textContent = "0";
  svg.appendChild(y0);
  const yMaxLabel = el("text", { x: pad - 6, y: pad + 4, "text-anchor": "end" });
  yMaxLabel.textContent = String(Math.round(maxY));
  svg.appendChild(yMaxLabel);

  container.innerHTML = "";
  container.appendChild(svg);

  const legend = document.createElement("div");
  legend.className = "chart-legend";
  legend.innerHTML =
    `<span class="sw" style="background:var(--accent)"></span>Pangenome size &nbsp; ` +
    `<span class="sw" style="background:var(--moss-500)"></span>Core genome size` +
    (curves.approximate ? ` <span style="opacity:.75">— approximate (${curves.permutations} permutations, capped for this genome count)</span>` : ` (${curves.permutations} permutations)`);
  container.appendChild(legend);
}

/**
 * Singleton (genome-unique) group counts, one bar per genome, sorted
 * highest-first so an outlier genome (poor assembly, contamination, wrong
 * species) reads as a spike at the left without scanning a list. Genome
 * names aren't drawn as axis labels — with hundreds or thousands of
 * genomes that's unreadable — they show on hover instead, same trade-off
 * as the gene frequency spectrum histogram.
 */
export function renderSingletonBarChart(container, byGenome) {
  const entries = [...byGenome.entries()].map(([name, groups]) => ({ name, count: groups.length }));
  const total = entries.reduce((s, e) => s + e.count, 0);
  if (!total) return emptyNote(container, "No singleton (genome-unique) groups found.");
  entries.sort((a, b) => b.count - a.count);

  const width = 620, height = 200, pad = 34;
  const maxCount = Math.max(...entries.map((e) => e.count)) || 1;
  const barW = (width - 2 * pad) / entries.length;

  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart-svg" });
  const scene = el("g", { class: "scene" });
  svg.appendChild(scene);
  entries.forEach((e, i) => {
    const barH = (e.count / maxCount) * (height - 2 * pad);
    const rect = el("rect", {
      class: "hist-bar",
      x: pad + i * barW,
      y: height - pad - barH,
      width: Math.max(1, barW - 1),
      height: barH,
    });
    const title = el("title", {});
    title.textContent = `${e.name}: ${e.count} singleton group${e.count === 1 ? "" : "s"}`;
    rect.appendChild(title);
    scene.appendChild(rect);
  });
  svg.appendChild(el("line", { class: "axis", x1: pad, x2: width - pad, y1: height - pad, y2: height - pad }));

  // Y-axis: 0 at the bottom, the actual highest count at the top of the bar area.
  const y0Label = el("text", { x: pad - 6, y: height - pad + 4, "text-anchor": "end" });
  y0Label.textContent = "0";
  svg.appendChild(y0Label);
  const yMaxLabel = el("text", { x: pad - 6, y: pad + 4, "text-anchor": "end" });
  yMaxLabel.textContent = String(maxCount);
  svg.appendChild(yMaxLabel);

  const xLabel = el("text", { x: width / 2, y: height - 8, "text-anchor": "middle" });
  xLabel.textContent = "Genomes, sorted by singleton count (hover a bar for its name) — scroll/pinch to zoom horizontally, drag to pan, double-click to reset →";
  svg.appendChild(xLabel);

  container.innerHTML = "";
  container.appendChild(svg);
  attachPanZoom(svg, scene, { width, height, axis: "x" }); // horizontal-only — keeps the axis line/labels correctly aligned with the bars at every zoom level
}

/**
 * Family-size distribution for the multi-copy candidate groups above the
 * chosen threshold: a histogram over avg-copies-per-genome, binned into
 * up to 12 equal-width bins spanning the candidates' actual range (not a
 * fixed 1-per-genome-count scale like the frequency spectrum, since copy
 * number here is continuous rather than bounded by genome count).
 */
export function renderMultiCopyHistogram(container, candidates) {
  if (!candidates.length) return emptyNote(container, "No multi-copy candidate groups above this threshold.");

  const values = candidates.map((g) => g.avgCopiesPerGenome);
  const minV = Math.min(...values), maxV = Math.max(...values);
  const range = maxV - minV;
  const binCount = range > 0 ? Math.min(12, Math.max(4, Math.ceil(range))) : 1;
  const binWidth = range > 0 ? range / binCount : 1;
  const bins = new Array(binCount).fill(0);
  for (const v of values) {
    const idx = Math.min(binCount - 1, Math.floor((v - minV) / binWidth));
    bins[idx]++;
  }

  const width = 620, height = 200, pad = 34;
  const maxBin = Math.max(...bins) || 1;
  const barW = (width - 2 * pad) / binCount;

  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart-svg" });
  bins.forEach((count, i) => {
    const lo = minV + i * binWidth, hi = minV + (i + 1) * binWidth;
    const barH = (count / maxBin) * (height - 2 * pad);
    const rect = el("rect", {
      class: "hist-bar",
      x: pad + i * barW,
      y: height - pad - barH,
      width: Math.max(1, barW - 1),
      height: barH,
    });
    const title = el("title", {});
    title.textContent = `${lo.toFixed(1)}–${hi.toFixed(1)} avg copies/genome: ${count} group${count === 1 ? "" : "s"}`;
    rect.appendChild(title);
    svg.appendChild(rect);
  });
  svg.appendChild(el("line", { class: "axis", x1: pad, x2: width - pad, y1: height - pad, y2: height - pad }));

  const xLabel = el("text", { x: width / 2, y: height - 8, "text-anchor": "middle" });
  xLabel.textContent = "Average copies per genome →";
  svg.appendChild(xLabel);
  const startLabel = el("text", { x: pad, y: height - pad + 14 });
  startLabel.textContent = minV.toFixed(1);
  svg.appendChild(startLabel);
  const endLabel = el("text", { x: width - pad, y: height - pad + 14, "text-anchor": "end" });
  endLabel.textContent = maxV.toFixed(1);
  svg.appendChild(endLabel);

  container.innerHTML = "";
  container.appendChild(svg);
}

/**
 * Category-by-category association/disassociation summary (build brief
 * §6 Phase 6): one row per unordered category combination (from
 * categoryMatrix()), with a count and an inline proportional bar for
 * associated vs. disassociated pairs — answers "do AMR and virulence
 * genes tend to co-occur" directly.
 */
export function renderCategoryMatrix(container, combos) {
  if (!combos.length) return emptyNote(container, "No resolved pairs to summarise — load CoinFinder association/disassociation files first.");

  const maxTotal = Math.max(...combos.map((c) => c.associated + c.disassociated));
  const table = document.createElement("table");
  table.className = "data-table";
  table.innerHTML = "<thead><tr><th>Category combination</th><th>Associated</th><th>Disassociated</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const combo of combos) {
    const tr = document.createElement("tr");
    const total = combo.associated + combo.disassociated;
    const assocW = total ? (combo.associated / maxTotal) * 100 : 0;
    const disassocW = total ? (combo.disassociated / maxTotal) * 100 : 0;
    tr.innerHTML = `
      <td>${combo.key}</td>
      <td class="num">${combo.associated}</td>
      <td class="num">${combo.disassociated}</td>
      <td style="min-width:140px">
        <div style="display:flex;height:10px;gap:1px">
          <div style="width:${assocW}%;background:var(--compute-500)"></div>
          <div style="width:${disassocW}%;background:var(--clay-500)"></div>
        </div>
      </td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "table-wrap"; // same scroll treatment as the Groups/pair tables — caps height instead of the card growing without bound for a large category list
  wrap.appendChild(table);
  container.appendChild(wrap);
  const legend = document.createElement("div");
  legend.className = "chart-legend";
  legend.innerHTML = `<span class="sw" style="background:var(--compute-500)"></span>Associated &nbsp; <span class="sw" style="background:var(--clay-500)"></span>Disassociated`;
  container.appendChild(legend);
}
