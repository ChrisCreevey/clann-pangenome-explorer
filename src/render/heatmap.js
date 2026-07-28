// heatmap.js — presence/absence heatmap (build brief §6, Phase 3). Rows are
// gene groups, columns are genomes; both can be sorted by frequency/original
// order or by similarity clustering independently. Canvas-rendered for
// performance at hundreds of genomes x thousands of groups: presence data
// is rasterised once into an off-screen canvas at one pixel per cell
// (via colOrder/rowOrder index indirection, so reordering either axis is
// just a remap, not a data copy), then the visible canvas just redraws
// that image under a pan/zoom transform (wheel to zoom, drag to pan —
// same interaction model as Tree Viewer's SVG canvas), so re-sorting is
// the only thing that re-rasterises.
//
// Clustering (either axis) has no silent size-based refusal — see
// analysis/clustering.js for why that was removed. Instead: an honest
// time estimate is shown before a large clustering run starts, and the
// header busy spinner (render/busy.js) runs for its duration so the page
// reads as "working", not "hung" — it's the user's call whether to wait.

import { clusterOrder, groupPresenceVector, genomeColumnVector, estimateClusterSeconds } from "../analysis/clustering.js";
import { presenceVector } from "../parse/matrix.js";
import { runBusy } from "./busy.js";

const FREQ_CLASS_RGB = {
  core: [11, 114, 104],       // --compute-500
  softcore: [95, 110, 51],    // --moss-500
  shell: [185, 126, 28],      // --amber-500
  cloud: [169, 75, 46],       // --clay-500
};
const EMPTY_RGB = [230, 226, 214]; // --stone-200-ish, "absent" cell

const MIN_SCALE = 0.2, MAX_SCALE = 40;

/**
 * Mount a heatmap into `container`. `data` is PangenomeData.
 * Returns a handle with setSort(mode) where mode is 'frequency' | 'cluster'.
 */
export function renderHeatmap(container, data) {
  container.innerHTML = "";

  const genomeNames = data.genomes.map((g) => g.name);
  const genomeCount = genomeNames.length;
  const groups = data.groups;

  if (!genomeCount || !groups.length) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = "No data for the heatmap.";
    container.appendChild(note);
    return { setSort() {} };
  }

  const controls = document.createElement("div");
  controls.className = "chart-controls";
  controls.innerHTML = `
    <label>Sort rows by
      <select id="hmSort">
        <option value="frequency">Frequency (core → cloud)</option>
        <option value="cluster">Similarity clustering</option>
      </select>
    </label>
    <label>Sort columns by
      <select id="hmSortCol">
        <option value="original">Original order</option>
        <option value="cluster">Similarity clustering</option>
      </select>
    </label>
    <button class="act" id="hmExportPng" style="width:auto">Export PNG</button>
    <button class="act" id="hmExportSvg" style="width:auto">Export SVG</button>
    <span class="hint" id="hmNote"></span>
    <span class="hint" id="hmNoteCol"></span>
  `;
  container.appendChild(controls);

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "heatmap-wrap";
  container.appendChild(canvasWrap);
  const canvas = document.createElement("canvas");
  canvas.className = "heatmap-canvas";
  canvasWrap.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  let rowOrder = groups.map((_, i) => i);
  let colOrder = data.genomes.map((g) => g.index);
  let offscreen = null;
  let view = { k: 1, x: 0, y: 0 };

  function rowColor(group) {
    return FREQ_CLASS_RGB[group.freqClass] || EMPTY_RGB;
  }

  function rasterise() {
    const w = genomeCount, h = rowOrder.length;
    offscreen = document.createElement("canvas");
    offscreen.width = w;
    offscreen.height = h;
    const octx = offscreen.getContext("2d");
    const imageData = octx.createImageData(w, h);
    const buf = imageData.data;

    rowOrder.forEach((groupIdx, row) => {
      const group = groups[groupIdx];
      const [pr, pg, pb] = rowColor(group);
      const vector = presenceVector(data, group.groupIndex);
      for (let col = 0; col < w; col++) {
        const present = vector[colOrder[col]] > 0;
        const [r, g, b] = present ? [pr, pg, pb] : EMPTY_RGB;
        const idx = (row * w + col) * 4;
        buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = 255;
      }
    });
    octx.putImageData(imageData, 0, 0);
  }

  const MAX_CANVAS_HEIGHT = 500;

  function fitToWidth() {
    const displayW = canvasWrap.clientWidth || 640;
    // Fit both dimensions — using width alone zooms in on only the first few
    // rows whenever there are far more groups than genomes (the common case).
    const kW = displayW / genomeCount;
    const kH = MAX_CANVAS_HEIGHT / rowOrder.length;
    view.k = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(kW, kH)));
    view.x = 0;
    view.y = 0;
  }

  function draw() {
    const displayW = canvasWrap.clientWidth || 640;
    const displayH = Math.min(MAX_CANVAS_HEIGHT, rowOrder.length * view.k + 20);
    canvas.width = displayW;
    canvas.height = Math.max(160, displayH);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "transparent";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(view.k, 0, 0, view.k, view.x, view.y);
    ctx.drawImage(offscreen, 0, 0);
    ctx.restore();
  }

  // Above this estimate, tell the user roughly how long to expect before
  // starting — clustering has no size-based refusal, so this is the
  // honesty mechanism instead of a silent cap.
  const SLOW_WARNING_SECONDS = 1.5;

  function applySort(mode) {
    const note = container.querySelector("#hmNote");
    if (mode === "cluster") {
      const estSeconds = estimateClusterSeconds(groups.length, genomeCount);
      note.textContent = estSeconds > SLOW_WARNING_SECONDS
        ? `Ordering ${groups.length} groups by similarity — roughly ${Math.ceil(estSeconds)}s, page will be unresponsive until it finishes…`
        : `Ordering ${groups.length} groups by similarity…`;
    } else {
      note.textContent = "";
    }
    runBusy(() => {
      if (mode === "cluster") {
        const vectors = groups.map((g) => groupPresenceVector(data, g.groupIndex));
        rowOrder = clusterOrder(vectors, { metric: "jaccard" });
      } else {
        rowOrder = groups
          .map((g, i) => i)
          .sort((a, b) => groups[b].genomesPresentIn - groups[a].genomesPresentIn);
      }
      rasterise();
      fitToWidth();
      draw();
    }).then(() => {
      if (mode === "cluster") note.textContent = `${groups.length} groups ordered by presence similarity.`;
    });
  }

  function applyColumnSort(mode) {
    const noteCol = container.querySelector("#hmNoteCol");
    if (mode === "cluster") {
      const estSeconds = estimateClusterSeconds(genomeCount, groups.length);
      noteCol.textContent = estSeconds > SLOW_WARNING_SECONDS
        ? `Ordering ${genomeCount} genomes by copy-number similarity — roughly ${Math.ceil(estSeconds)}s, page will be unresponsive until it finishes…`
        : `Ordering ${genomeCount} genomes by copy-number similarity…`;
    } else {
      noteCol.textContent = "";
    }
    runBusy(() => {
      if (mode === "cluster") {
        // Copy number (not just presence) — Euclidean distance is more
        // informative here than Jaccard, which would treat 1 copy and 5
        // copies of the same gene as identical.
        const vectors = data.genomes.map((g) => genomeColumnVector(data, g.index));
        colOrder = clusterOrder(vectors, { metric: "euclidean" });
      } else {
        colOrder = data.genomes.map((g) => g.index);
      }
      rasterise();
      fitToWidth();
      draw();
    }).then(() => {
      if (mode === "cluster") noteCol.textContent = `${genomeCount} genomes ordered by copy-number similarity.`;
    });
  }

  // --- zoom (wheel) / pan (drag), same interaction model as Tree Viewer ---
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const nk = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.k * factor));
    view.x = mx - (mx - view.x) * (nk / view.k);
    view.y = my - (my - view.y) * (nk / view.k);
    view.k = nk;
    draw();
  }, { passive: false });

  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX - view.x, y: e.clientY - view.y };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    view.x = e.clientX - drag.x;
    view.y = e.clientY - drag.y;
    draw();
  });
  canvas.addEventListener("pointerup", () => { drag = null; });
  canvas.addEventListener("dblclick", () => { fitToWidth(); draw(); });

  container.querySelector("#hmSort").addEventListener("change", (e) => applySort(e.target.value));
  container.querySelector("#hmSortCol").addEventListener("change", (e) => applyColumnSort(e.target.value));

  container.querySelector("#hmExportPng").addEventListener("click", () => {
    // Upscale from the 1px-per-cell raster so the exported image isn't illegibly tiny.
    const scale = Math.max(2, Math.min(8, Math.round(400 / Math.max(genomeCount, rowOrder.length))));
    const out = document.createElement("canvas");
    out.width = genomeCount * scale;
    out.height = rowOrder.length * scale;
    const octx = out.getContext("2d");
    octx.imageSmoothingEnabled = false;
    octx.drawImage(offscreen, 0, 0, out.width, out.height);
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = "pangenome-heatmap.png";
    a.click();
  });

  container.querySelector("#hmExportSvg").addEventListener("click", () => {
    const cellSize = 4;
    const w = genomeCount * cellSize, h = rowOrder.length * cellSize;
    if (genomeCount * rowOrder.length > 40000) {
      container.querySelector("#hmNote").textContent =
        "Too many cells for an SVG export (would be too large to open) — use Export PNG instead.";
      return;
    }
    const rects = [];
    rowOrder.forEach((groupIdx, row) => {
      const group = groups[groupIdx];
      const [r, g, b] = rowColor(group);
      const vector = presenceVector(data, group.groupIndex);
      for (let col = 0; col < genomeCount; col++) {
        const present = vector[colOrder[col]] > 0;
        const color = present ? `rgb(${r},${g},${b})` : `rgb(${EMPTY_RGB.join(",")})`;
        rects.push(`<rect x="${col * cellSize}" y="${row * cellSize}" width="${cellSize}" height="${cellSize}" fill="${color}"/>`);
      }
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${rects.join("")}</svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pangenome-heatmap.svg";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  window.addEventListener("resize", () => { fitToWidth(); draw(); });

  applySort("frequency");

  return {
    setSort(mode) {
      container.querySelector("#hmSort").value = mode;
      applySort(mode);
    },
    setSortCol(mode) {
      container.querySelector("#hmSortCol").value = mode;
      applyColumnSort(mode);
    },
  };
}
