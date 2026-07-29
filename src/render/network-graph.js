// network-graph.js — association/disassociation network graph (build
// brief §6 Phase 6, the view a student will screenshot for their report).
// Nodes are gene groups appearing in at least one resolved pair, coloured
// by category (or frequency class when no categories are defined); edges
// are pairs, styled by direction. A short synchronous force simulation
// lays the graph out (no dependency), then it's pannable/zoomable with
// the same wheel/drag interaction as the heatmap and Tree Viewer.

import { categoryFor, filterPairs, sortBySignificance } from "../analysis/pairs.js";
import { runBusy } from "./busy.js";
import { downloadText } from "./download-util.js";
import { pairsToCytoscapeEdgeTable } from "../../export/pair-export.js";

const DEFAULT_TOP_N = 500;

const FREQ_CLASS_COLOR = { core: "#0B7268", softcore: "#5F6E33", shell: "#B97E1C", cloud: "#A94B2E" };
const ASSOC_COLOR = "#0B7268", DISASSOC_COLOR = "#A94B2E";

const ITERATIONS = 200;
// Benchmarked in Node against this file's actual Map-based repulsion loop
// (~2e7 pairwise comparisons/sec) — a real browser tab may be somewhat
// slower. Same measure-and-warn approach as analysis/clustering.js's
// estimateClusterSeconds(), which this mirrors.
const BENCHMARKED_PAIR_OPS_PER_SECOND = 2e7;
// Circuit breakers only, not a UX judgment (see clustering.js's
// ABSOLUTE_MAX_ITEMS=20000 and its rationale) — layoutNodes does
// ITERATIONS passes over every node pair, a 200x-larger constant than
// clustering's single pass, so this sits far lower than clustering's cap.
// ABSOLUTE_MAX_EDGES is a separate, DOM-element budget: every edge is its
// own <line>, and that cost doesn't depend on the (possibly small) node
// count a dense pair set can still produce.
const ABSOLUTE_MAX_NODES = 5000;
const ABSOLUTE_MAX_EDGES = 20000;
// Below this estimate, drawing happens immediately on any filter change,
// same threshold heatmap.js uses for its own clustering warning.
const SLOW_WARNING_SECONDS = 1.5;
// Same bounds as heatmap.js's own wheel-zoom, for consistency across the two SVG canvases.
const MIN_ZOOM = 0.2, MAX_ZOOM = 40;

/** Rough wall-clock estimate for laying out `nodeCount` nodes, for UI hinting only. */
export function estimateLayoutSeconds(nodeCount, iterations = ITERATIONS) {
  return ((nodeCount * (nodeCount - 1)) / 2 * iterations) / BENCHMARKED_PAIR_OPS_PER_SECOND;
}

/**
 * Restrict to the `topN` highest-degree nodes (by edge count within this
 * filtered selection) and the induced edges among them — i.e. drop edges
 * to any excluded node, then drop nodes left with no edges as a result.
 * There's no value in laying out a graph's low-connectivity long tail
 * (the common case once a CoinFinder file resolves against a large
 * pangenome): a node's rough position in a force layout is driven by its
 * neighbours, so a barely-connected node just drifts to wherever there's
 * space and adds nothing readable. `topN` of `null`/`Infinity` (or a
 * count already at or under it) is a no-op.
 */
export function degreeCap(nodeIds, edges, topN) {
  if (topN == null || nodeIds.length <= topN) return { nodeIds, edges };

  const degree = new Map(nodeIds.map((id) => [id, 0]));
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) || 0) + 1);
    degree.set(e.b, (degree.get(e.b) || 0) + 1);
  }
  const topIds = new Set(
    [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([id]) => id)
  );
  const cappedEdges = edges.filter((e) => topIds.has(e.a) && topIds.has(e.b));
  const usedIds = [...new Set(cappedEdges.flatMap((e) => [e.a, e.b]))];
  return { nodeIds: usedIds, edges: cappedEdges };
}

function categoryColor(categories, category) {
  const idx = categories.indexOf(category);
  return `hsl(${(idx * 47) % 360} 55% 45%)`;
}

/**
 * Node degree (edge count) within `edges` — used both as a centrality
 * proxy for node sizing and to build connected components. True
 * betweenness centrality is O(V*E) (Brandes' algorithm) — too expensive
 * to run synchronously on the main thread alongside an already-O(n^2)
 * layout, so degree is used instead: cheap (O(edges)), and for "which
 * nodes are hubs" it's a reasonable stand-in.
 */
export function degreeOf(nodeIds, edges) {
  const degree = new Map(nodeIds.map((id) => [id, 0]));
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) || 0) + 1);
    degree.set(e.b, (degree.get(e.b) || 0) + 1);
  }
  return degree;
}

/**
 * Connected components over ASSOCIATED edges only — disassociation means
 * "these don't tend to co-occur," so it shouldn't be what defines a
 * cluster's membership, only (below, in layoutNodes) an extra force
 * pushing disassociated pairs apart. A node touched only by disassociated
 * edges ends up in its own singleton component, which is the right
 * outcome: it isn't part of any associated cluster.
 */
export function connectedComponents(nodeIds, edges) {
  const adj = new Map(nodeIds.map((id) => [id, []]));
  for (const e of edges) {
    if (e.pair.direction !== "associated") continue;
    adj.get(e.a).push(e.b);
    adj.get(e.b).push(e.a);
  }
  const compOf = new Map();
  let compCount = 0;
  for (const start of nodeIds) {
    if (compOf.has(start)) continue;
    const compId = compCount++;
    const stack = [start];
    compOf.set(start, compId);
    while (stack.length) {
      const cur = stack.pop();
      for (const nb of adj.get(cur)) {
        if (!compOf.has(nb)) { compOf.set(nb, compId); stack.push(nb); }
      }
    }
  }
  return { compOf, compCount };
}

/**
 * Merge every singleton (size-1) connected component into one shared
 * pseudo-component. A node touched only by disassociated edges — very
 * common in a real CoinFinder result — lands in its own singleton per
 * connectedComponents' doc comment above; componentCenters below then gave
 * each one its own grid cell, the same size as a 200-node cluster's,
 * scattered across the whole grid by draw order. That's what put isolated
 * nodes far from everything else: each was pulled toward its own lonely
 * cell rather than toward any shared "everything unclustered" area. Real
 * clusters (size >= 2) are left untouched — this only affects true
 * singletons.
 */
export function mergeSingletonComponents(compOf, compCount) {
  const sizes = new Array(compCount).fill(0);
  for (const compId of compOf.values()) sizes[compId]++;
  const singletonIds = new Set();
  for (let i = 0; i < compCount; i++) if (sizes[i] === 1) singletonIds.add(i);
  if (singletonIds.size <= 1) return { compOf, compCount }; // nothing to gain by merging 0 or 1 singleton

  // Renumber non-singleton components into a dense 0..k-1 range, then give
  // every former singleton one shared final slot.
  const remap = new Map();
  let next = 0;
  for (let i = 0; i < compCount; i++) {
    if (singletonIds.has(i)) continue;
    remap.set(i, next++);
  }
  const orphanCompId = next;
  const mergedCompOf = new Map();
  for (const [id, compId] of compOf.entries()) {
    mergedCompOf.set(id, singletonIds.has(compId) ? orphanCompId : remap.get(compId));
  }
  return { compOf: mergedCompOf, compCount: next + 1 };
}

/** A grid cell (roughly proportional to component size) for each component, largest first, so bigger clusters get more room. */
export function componentCenters(compCount, compOf, width, height) {
  const sizes = new Array(compCount).fill(0);
  for (const compId of compOf.values()) sizes[compId]++;
  const cols = Math.max(1, Math.ceil(Math.sqrt(compCount)));
  const rows = Math.max(1, Math.ceil(compCount / cols));
  const cellW = width / cols, cellH = height / rows;
  const order = [...sizes.keys()].sort((a, b) => sizes[b] - sizes[a]);
  const centers = new Array(compCount);
  order.forEach((compId, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    centers[compId] = { x: cellW * (col + 0.5), y: cellH * (row + 0.5) };
  });
  return centers;
}

/**
 * Evenly spaced points around a circle — an O(n) alternative to the
 * force-directed layout, for when its O(n^2) cost isn't worth paying (a
 * very large graph) or its clustering just isn't the arrangement wanted.
 * Doesn't look at edges at all, so it's always instant regardless of
 * node/edge count (short of the hard DOM-element circuit breaker).
 */
export function circularLayout(nodeIds, width, height) {
  const cx = width / 2, cy = height / 2, r = Math.min(width, height) / 2 - 30;
  const pos = new Map();
  nodeIds.forEach((id, i) => {
    const angle = (i / Math.max(1, nodeIds.length)) * 2 * Math.PI;
    pos.set(id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  });
  return pos;
}

/**
 * A grid, nodes sorted by category first so same-category nodes end up
 * adjacent — a second O(n) alternative, grouping by the same category
 * that already drives node colour rather than by connectivity.
 */
export function gridLayout(nodeIds, width, height, categoryOf) {
  const sorted = [...nodeIds].sort((a, b) => categoryOf(a).localeCompare(categoryOf(b)));
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const rows = Math.max(1, Math.ceil(sorted.length / cols));
  const cellW = width / cols, cellH = height / rows;
  const pos = new Map();
  sorted.forEach((id, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    pos.set(id, { x: cellW * (col + 0.5), y: cellH * (row + 0.5) });
  });
  return pos;
}

// Disassociated edges push apart on top of the generic pairwise repulsion
// every node pair already gets — this factor is how much *extra* push a
// specifically-disassociated pair gets beyond that baseline, so they read
// as visually further apart than two merely-unrelated nodes.
const DISASSOCIATION_REPULSION_FACTOR = 1.5;

/**
 * Force-directed layout: repulsion (every node pair) + direction-aware
 * springs (associated edges pull together, disassociated edges push
 * apart) + a centering pull toward each node's own connected-component
 * center rather than one shared canvas center. That last part is what
 * actually separates distinct clusters — pulling every node toward the
 * same global center, as a single unified simulation naively does,
 * guarantees everything collapses into one indistinguishable "ball"
 * once repulsion and attraction reach equilibrium, regardless of how
 * the connectivity is structured.
 */
function layoutNodes(nodeIds, edges, { width, height, iterations = ITERATIONS }) {
  const rng = (() => { let s = 42; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const n = nodeIds.length;
  if (n <= 1) return new Map(nodeIds.map((id) => [id, { x: width / 2, y: height / 2 }]));

  const raw = connectedComponents(nodeIds, edges);
  const { compOf, compCount } = mergeSingletonComponents(raw.compOf, raw.compCount);
  const centers = componentCenters(compCount, compOf, width, height);
  const jitter = Math.min(width, height) / Math.max(4, Math.sqrt(compCount));
  const pos = new Map(nodeIds.map((id) => {
    const c = centers[compOf.get(id)];
    return [id, { x: c.x + (rng() - 0.5) * jitter, y: c.y + (rng() - 0.5) * jitter }];
  }));

  // Associated-degree (not overall degree — a node can have plenty of
  // disassociated edges and still be "unclustered") drives how hard each
  // node gets pulled back toward its component center below. A node with
  // no associated edges has nothing but repulsion/disassociation-push
  // acting on it, so the same 1% pull everyone else gets is nowhere near
  // enough to keep it from drifting arbitrarily far over 200 iterations.
  const assocDegree = new Map(nodeIds.map((id) => [id, 0]));
  for (const e of edges) {
    if (e.pair.direction !== "associated") continue;
    assocDegree.set(e.a, (assocDegree.get(e.a) || 0) + 1);
    assocDegree.set(e.b, (assocDegree.get(e.b) || 0) + 1);
  }

  const k = Math.sqrt((width * height) / n); // ideal spring length
  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map(nodeIds.map((id) => [id, { x: 0, y: 0 }]));

    // repulsion between every pair of nodes
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos.get(nodeIds[i]), b = pos.get(nodeIds[j]);
        let dx = a.x - b.x, dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        dx = (dx / dist) * force; dy = (dy / dist) * force;
        disp.get(nodeIds[i]).x += dx; disp.get(nodeIds[i]).y += dy;
        disp.get(nodeIds[j]).x -= dx; disp.get(nodeIds[j]).y -= dy;
      }
    }
    // direction-aware springs along edges
    for (const e of edges) {
      const a = pos.get(e.a), b = pos.get(e.b);
      if (!a || !b) continue;
      let dx = a.x - b.x, dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      if (e.pair.direction === "associated") {
        const force = (dist * dist) / k; // Fruchterman-Reingold spring: pulls harder the further apart they are
        dx = (dx / dist) * force; dy = (dy / dist) * force;
        disp.get(e.a).x -= dx; disp.get(e.a).y -= dy;
        disp.get(e.b).x += dx; disp.get(e.b).y += dy;
      } else {
        const force = ((k * k) / dist) * DISASSOCIATION_REPULSION_FACTOR; // extra repulsion-shaped push: stronger the closer they are
        dx = (dx / dist) * force; dy = (dy / dist) * force;
        disp.get(e.a).x += dx; disp.get(e.a).y += dy;
        disp.get(e.b).x -= dx; disp.get(e.b).y -= dy;
      }
    }
    // apply displacement (capped) + mild pull toward this node's own component center
    const temp = width * 0.1 * (1 - iter / iterations);
    for (const id of nodeIds) {
      const d = disp.get(id);
      const dist = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
      const capped = Math.min(dist, Math.max(temp, 1));
      const p = pos.get(id);
      p.x += (d.x / dist) * capped;
      p.y += (d.y / dist) * capped;
      const c = centers[compOf.get(id)];
      const pull = (assocDegree.get(id) || 0) > 0 ? 0.01 : 0.06; // ~6x stronger for a node with no associated edges to otherwise anchor it
      p.x += (c.x - p.x) * pull;
      p.y += (c.y - p.y) * pull;
    }
  }

  // Normalise into the viewBox regardless of how the simulation drifted —
  // repulsion can push a sparse or disconnected graph's bounding box well
  // past the canvas size, and a weak centering pull alone doesn't guarantee
  // convergence within it.
  //
  // Bound on a percentile of positions, not the literal min/max, once
  // there are enough nodes for that to be meaningful (n<20: too few points
  // for a percentile to mean anything different from the min/max anyway,
  // so just use those directly). A single still-remote node — the pull
  // strength above makes this rare but doesn't guarantee it never happens
  // — would otherwise single-handedly dictate the scale for every other
  // node, shrinking the whole graph just to keep that one point on-screen.
  // Clamping (not dropping) it back inside the margins after scaling means
  // it's still drawn, just pinned near the edge instead of controlling the
  // zoom level for everyone else.
  const margin = 24;
  const xsAll = [...pos.values()].map((p) => p.x), ysAll = [...pos.values()].map((p) => p.y);
  let minX, maxX, minY, maxY;
  if (n >= 20) {
    const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))))];
    const xsSorted = [...xsAll].sort((a, b) => a - b), ysSorted = [...ysAll].sort((a, b) => a - b);
    minX = pct(xsSorted, 0.01); maxX = pct(xsSorted, 0.99);
    minY = pct(ysSorted, 0.01); maxY = pct(ysSorted, 0.99);
  } else {
    minX = Math.min(...xsAll); maxX = Math.max(...xsAll);
    minY = Math.min(...ysAll); maxY = Math.max(...ysAll);
  }
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const scale = Math.min((width - 2 * margin) / spanX, (height - 2 * margin) / spanY, 1);
  for (const p of pos.values()) {
    p.x = margin + (p.x - minX) * scale + Math.max(0, (width - 2 * margin - spanX * scale)) / 2;
    p.y = margin + (p.y - minY) * scale + Math.max(0, (height - 2 * margin - spanY * scale)) / 2;
    p.x = Math.min(width - margin, Math.max(margin, p.x));
    p.y = Math.min(height - margin, Math.max(margin, p.y));
  }

  return pos;
}

/**
 * Mount the network graph into `container` for `data` (PangenomeData with
 * resolved data.pairs). Returns a handle with setFilters(opts) and
 * refresh() so the pair table's category/direction filters can drive the
 * same graph if wired together later.
 */
export function renderNetworkGraph(container, data, opts = {}) {
  container.innerHTML = "";

  if (!data.pairs.length) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = "No resolved pairs to graph — load CoinFinder association/disassociation files first.";
    container.appendChild(note);
    return { refresh() {}, setGroupFilter() {} };
  }

  // groupIds (from the sidebar Groups filter, always applied — both sides
  // of a pair must be in the set) — null means unrestricted.
  let groupIdFilter = opts.groupIds || null;

  const controls = document.createElement("div");
  controls.className = "chart-controls";
  controls.innerHTML = `
    <label>Direction
      <select id="ngDirection">
        <option value="both">Both</option>
        <option value="associated">Associated only</option>
        <option value="disassociated">Disassociated only</option>
      </select>
    </label>
    <label>Layout
      <select id="ngLayoutMode">
        <option value="force">Force-directed (clusters by connectivity)</option>
        <option value="circular">Circular</option>
        <option value="grid">Grid (by category)</option>
      </select>
    </label>
    <label>Max significance <input type="text" id="ngMaxSig" placeholder="no cap" style="width:70px"></label>
    <label>Node size × <input type="number" id="ngNodeScale" min="0.1" max="10" step="0.1" value="1" style="width:60px"></label>
    <label>Edge width × <input type="number" id="ngEdgeScale" min="0.1" max="10" step="0.1" value="1" style="width:60px"></label>
    <label><input type="checkbox" id="ngCrossOnly"> Cross-category only</label>
    <label><input type="checkbox" id="ngHighlightTop"> Highlight top 20 by significance</label>
    <label>Show top <input type="number" id="ngTopN" value="${DEFAULT_TOP_N}" min="10" step="10" style="width:70px"> most-connected groups</label>
    <label><input type="checkbox" id="ngNoCap"> Show all filtered groups (no cap)</label>
    <button class="act" id="ngDraw" style="width:auto">Draw network</button>
    <button class="act" id="ngExportSvg" style="width:auto">Export SVG</button>
    <button class="act" id="ngExportEdges" style="width:auto">Export edge table (.csv)</button>
  `;
  container.appendChild(controls);
  const layoutHint = document.createElement("div");
  layoutHint.className = "hint";
  layoutHint.textContent = "Force-directed: associated groups pull into clusters, separated from other clusters by connectivity; disassociated pairs push apart on top of that. Circular/Grid are instant alternatives that ignore connectivity (Grid groups by category). Node size reflects degree (a cheap centrality proxy); both node size and edge width shrink automatically as the drawn selection gets more crowded (by total node area and by edge count, respectively) — override either with \"Node size ×\"/\"Edge width ×\" if the automatic sizing doesn't suit (both apply instantly, no redraw). Drag a node to reposition it (lost on the next redraw); scroll/pinch to zoom, drag the background to pan.";
  container.appendChild(layoutHint);
  const note = document.createElement("div");
  note.className = "hint";
  note.id = "ngNote";
  container.appendChild(note);

  const svgWrap = document.createElement("div");
  svgWrap.className = "network-wrap";
  container.appendChild(svgWrap);

  const width = 720, height = 480;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "network-svg");
  svgWrap.appendChild(svg);
  const scene = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svg.appendChild(scene);

  const allCategories = [...new Set(data.groups.filter((g) => g.tags.length).flatMap((g) => g.tags))].sort();
  const useCategories = allCategories.length > 0;
  const groupById = new Map(data.groups.map((g) => [g.groupId, g])); // built once, not per node — avoids an O(nodes*groups) Array.find per draw

  // Legend: nothing else on the page explained what a node's colour/size or
  // an edge's colour/style means, so a swatch/label per colour plus a
  // plain-text note for size, on separate lines for nodes vs. edges.
  const legend = document.createElement("div");
  legend.className = "chart-legend";
  if (useCategories) {
    const legendCats = [...allCategories, "uncategorised"];
    legend.innerHTML = legendCats
      .map((cat) => `<span class="sw" style="background:${categoryColor(allCategories, cat)}"></span>${cat}`)
      .join(" &nbsp; ") + " &nbsp; · &nbsp; node size = degree (more connections → bigger)";
  } else {
    const freqLabels = { core: "Core", softcore: "Soft-core", shell: "Shell", cloud: "Cloud" };
    legend.innerHTML = Object.entries(freqLabels)
      .map(([key, label]) => `<span class="sw" style="background:${FREQ_CLASS_COLOR[key]}"></span>${label}`)
      .join(" &nbsp; ") + " &nbsp; · &nbsp; node size = degree (more connections → bigger)";
  }
  container.appendChild(legend);

  const edgeLegend = document.createElement("div");
  edgeLegend.className = "chart-legend";
  edgeLegend.innerHTML =
    `<span class="sw" style="background:${ASSOC_COLOR}"></span>Associated (solid) &nbsp; ` +
    `<span class="sw" style="background:${DISASSOC_COLOR}"></span>Disassociated (dashed) &nbsp; ` +
    `· &nbsp; thicker/more opaque = one of the top 20 by significance, if "Highlight top 20" is checked`;
  container.appendChild(edgeLegend);

  /**
   * Cheap: apply the direction/significance/cross-category filters, no
   * layout, no degree cap. This is "the current selection" for export
   * purposes — associated and disassociated pairs listed together,
   * regardless of what the in-app view is currently capped to drawing.
   * Always also restricted to the sidebar Groups filter (both sides must
   * be in it), via the same filterPairs() the pair table uses.
   */
  function fullSelection() {
    const direction = container.querySelector("#ngDirection").value;
    const maxSigRaw = container.querySelector("#ngMaxSig").value.trim();
    const maxSig = maxSigRaw ? Number(maxSigRaw) : undefined;
    const crossCategoryOnly = container.querySelector("#ngCrossOnly").checked;

    const pairs = filterPairs(data, data.pairs, {
      direction: direction === "both" ? undefined : [direction],
      maxSignificance: Number.isNaN(maxSig) ? undefined : maxSig,
      crossCategoryOnly,
      groupIds: groupIdFilter,
    });

    const nodeIds = [...new Set(pairs.flatMap((p) => [p.groupIdA, p.groupIdB]))];
    const edges = pairs.map((p) => ({ a: p.groupIdA, b: p.groupIdB, pair: p }));
    return { pairs, nodeIds, edges };
  }

  /** The subset actually laid out/drawn: fullSelection() restricted to the top-N most-connected nodes (or uncapped, if "no cap" is checked). */
  function cappedSelection(full) {
    const topN = container.querySelector("#ngNoCap").checked ? null : (Number(container.querySelector("#ngTopN").value) || DEFAULT_TOP_N);
    const { nodeIds, edges } = degreeCap(full.nodeIds, full.edges, topN);
    return { pairs: edges.map((e) => e.pair), nodeIds, edges, cappedFrom: full.nodeIds.length > nodeIds.length ? full.nodeIds.length : null };
  }

  const drawBtn = container.querySelector("#ngDraw");
  let lastFullSelection = null; // for the edge-table export — always uncapped
  let lastCappedNote = ""; // " — showing the top N most-connected of M groups...", reused by runLayout's own note text
  let pendingSelection = null; // the (capped) selection that would be drawn next
  let drawn = false; // whether pendingSelection has actually been laid out yet — guards the "Highlight" checkbox from bypassing the slow-draw gate
  let drawnCircles = []; // {circle, baseRadius, baseBorderWidth}, and drawnLines: {line, baseWidth} — reassigned by runLayout each redraw, read by applyVisualScale()
  let drawnLines = [];

  /**
   * Manual node-size/edge-width multipliers, applied in place (no redraw,
   * no recompute) — just scales what's already drawn from its stored base
   * value. The white node border scales together with the radius (both by
   * nodeScale) rather than staying a fixed "1" — otherwise shrinking nodes
   * down leaves the border a fixed width while the fill shrinks under it,
   * so small nodes end up looking like a white blob with barely any of
   * their actual colour showing.
   */
  function applyVisualScale() {
    const nodeScale = Number(container.querySelector("#ngNodeScale").value) || 1;
    const edgeScale = Number(container.querySelector("#ngEdgeScale").value) || 1;
    drawnCircles.forEach(({ circle, baseRadius, baseBorderWidth }) => {
      circle.setAttribute("r", baseRadius * nodeScale);
      circle.setAttribute("stroke-width", baseBorderWidth * nodeScale);
    });
    drawnLines.forEach(({ line, baseWidth }) => line.setAttribute("stroke-width", baseWidth * edgeScale));
  }

  /**
   * Update the pair/node-count note for the current filter selection and
   * decide whether it's cheap enough to lay out immediately. Laying out a
   * network is far more expensive than the heatmap's own O(n^2) clustering
   * (ITERATIONS=200 passes over every node pair, not one), so above
   * SLOW_WARNING_SECONDS this requires an explicit "Draw network" click
   * rather than auto-redrawing on every filter change — same honesty
   * principle as clustering.js/heatmap.js, adapted with an extra opt-in
   * step because the cost here is high enough that a stray filter tweak
   * could otherwise hang the tab with no warning at all. The top-N degree
   * cap (applied before this gating math, not after) is what keeps typical
   * filtered selections — even a large one — comfortably under
   * SLOW_WARNING_SECONDS without needing that extra click at all.
   */
  function refreshNote({ auto = true } = {}) {
    // Filtering/capping is at minimum an O(pairs) scan, and the cheap tier
    // below also runs the actual layout — all synchronous, so cover the
    // whole thing with the busy spinner rather than just the layout step.
    runBusy(() => {
      const full = fullSelection();
      lastFullSelection = full;
      const { pairs, nodeIds, edges, cappedFrom } = cappedSelection(full);
      const cappedNote = cappedFrom ? ` — showing the top ${nodeIds.length} most-connected of ${cappedFrom} groups in the current filter` : "";
      lastCappedNote = cappedNote;
      const tooManyNodes = nodeIds.length > ABSOLUTE_MAX_NODES;
      const tooManyEdges = edges.length > ABSOLUTE_MAX_EDGES;
      // Circular/Grid are O(n) and never touch the O(n^2) force simulation,
      // so they're always cheap regardless of node count — only the
      // force-directed layout needs the slow-draw estimate/gate below.
      // The DOM-element circuit breaker above still applies to every mode,
      // since that's an SVG element-count budget, not a compute-time one.
      const layoutMode = container.querySelector("#ngLayoutMode").value;
      const estSeconds = layoutMode === "force" ? estimateLayoutSeconds(nodeIds.length) : 0;

      drawn = false;

      if (tooManyNodes || tooManyEdges) {
        note.textContent = `${pairs.length} pairs across ${nodeIds.length} groups${cappedNote} — too many ${tooManyNodes ? `groups (over ${ABSOLUTE_MAX_NODES})` : `pairs (over ${ABSOLUTE_MAX_EDGES})`} to lay out as a network. Lower "Show top", narrow the direction/significance/cross-category filters above, or use the pair table's filters instead.`;
        drawBtn.disabled = true;
        scene.innerHTML = "";
        pendingSelection = null;
        return;
      }

      if (estSeconds > SLOW_WARNING_SECONDS) {
        note.textContent = `${pairs.length} pairs across ${nodeIds.length} groups${cappedNote} — laying this out will take roughly ${Math.ceil(estSeconds)}s and freeze the page until it finishes. Click "Draw network" to continue, or switch Layout to Circular/Grid for an instant (if less informative) alternative.`;
        drawBtn.disabled = false;
        scene.innerHTML = "";
        pendingSelection = { pairs, nodeIds, edges };
        return;
      }

      drawBtn.disabled = false;
      pendingSelection = { pairs, nodeIds, edges };
      if (auto) runLayout(pendingSelection);
    });
  }

  function runLayout({ pairs, nodeIds, edges }) {
    drawn = true;
    const highlightTop = container.querySelector("#ngHighlightTop").checked;
    const topSignificantKeys = highlightTop
      ? new Set(sortBySignificance(data.pairs).slice(0, 20).map((p) => `${p.groupIdA}|${p.groupIdB}|${p.direction}`))
      : null;

    note.textContent = `${pairs.length} pair${pairs.length === 1 ? "" : "s"} shown${lastCappedNote}`;
    scene.innerHTML = "";
    if (!nodeIds.length) return;

    const layoutMode = container.querySelector("#ngLayoutMode").value;
    const pos = layoutMode === "circular" ? circularLayout(nodeIds, width, height)
      : layoutMode === "grid" ? gridLayout(nodeIds, width, height, (id) => categoryFor(groupById.get(id)))
      : layoutNodes(nodeIds, edges, { width, height });
    const degree = degreeOf(nodeIds, edges); // centrality proxy (see layoutNodes' doc comment) — also drives node radius below

    // Node radius before any crowding shrink — degree (centrality proxy)
    // mapped to a 4-14px range. Used both to size each node below and, via
    // its total area, to derive crowdScale just after.
    function unscaledRadius(deg) {
      return 4 + Math.min(10, Math.sqrt(deg || 0) * 2.5);
    }

    // Shrink nodes so their combined area stays within a fixed fraction of
    // the canvas, however that total arises — many small-degree nodes or a
    // few huge-degree ones. The previous formula (22/sqrt(nodeCount)) only
    // looked at node count, so it was essentially a no-op at a few hundred
    // nodes (~0.98 at 500) despite those nodes being drawn at their full
    // degree-scaled size — exactly the case that needed a manual 0.05x
    // override to become readable, at 500 nodes / 6,382 edges (avg degree
    // ~25, i.e. most nodes sat at the 14px radius cap). Basing the shrink on
    // total node *area* instead means a dense, high-degree graph — the kind
    // that actually looks crowded — shrinks much more than a sparse graph
    // with the same node count, which the old formula couldn't distinguish.
    const NODE_INK_BUDGET_FRACTION = 0.18; // node fills target at most ~18% of canvas area
    const MIN_NODE_RADIUS = 1.2;
    let totalUnscaledArea = 0;
    for (const id of nodeIds) {
      const r = unscaledRadius(degree.get(id) || 0);
      totalUnscaledArea += Math.PI * r * r;
    }
    const inkBudgetArea = width * height * NODE_INK_BUDGET_FRACTION;
    const crowdScale = totalUnscaledArea > 0 ? Math.min(1, Math.sqrt(inkBudgetArea / totalUnscaledArea)) : 1;

    // Same idea for edges, scaled by edge count rather than node count —
    // edge clutter is driven by how many lines are drawn, not how many
    // nodes they connect. The previous code had NO density scaling for
    // edge width at all (a flat 1.2px/3px regardless of edge count), which
    // was likely the bigger contributor to the crowding this was reported
    // against — 6,382 same-width lines is a lot of ink regardless of node
    // sizing. EDGE_REFERENCE_COUNT is where this formula returns ~1 (no
    // change from today's default at ordinary, already-workable edge counts).
    const EDGE_REFERENCE_COUNT = 150;
    const MIN_EDGE_WIDTH = 0.15;
    const edgeCrowdScale = Math.min(1, Math.sqrt(EDGE_REFERENCE_COUNT / Math.max(1, edges.length)));

    drawnCircles = []; // {circle, baseRadius} — for applyVisualScale() to rescale in place without a full redraw
    drawnLines = []; // {line, baseWidth}

    const edgeLinesByNode = new Map(nodeIds.map((id) => [id, []])); // for live-updating edges while a node is dragged
    for (const e of edges) {
      const a = pos.get(e.a), b = pos.get(e.b);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
      const isTop = topSignificantKeys && topSignificantKeys.has(`${e.pair.groupIdA}|${e.pair.groupIdB}|${e.pair.direction}`);
      line.setAttribute("stroke", e.pair.direction === "associated" ? ASSOC_COLOR : DISASSOC_COLOR);
      const baseWidth = Math.max(MIN_EDGE_WIDTH, (isTop ? 3 : 1.2) * edgeCrowdScale);
      line.setAttribute("stroke-width", baseWidth);
      line.setAttribute("opacity", isTop ? "0.95" : Math.max(0.15, 0.45 * edgeCrowdScale));
      if (e.pair.direction === "disassociated") line.setAttribute("stroke-dasharray", "4 3");
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = `${e.pair.groupIdA} — ${e.pair.groupIdB} (${e.pair.direction}${e.pair.significance != null ? `, significance ${e.pair.significance}` : ""})`;
      line.appendChild(title);
      scene.appendChild(line);
      edgeLinesByNode.get(e.a).push({ line, end: "x1y1" });
      edgeLinesByNode.get(e.b).push({ line, end: "x2y2" });
      drawnLines.push({ line, baseWidth });
    }

    for (const id of nodeIds) {
      const group = groupById.get(id);
      const p = pos.get(id);
      const color = useCategories ? categoryColor(allCategories, categoryFor(group)) : (FREQ_CLASS_COLOR[group.freqClass] || "#999");
      const baseRadius = Math.max(MIN_NODE_RADIUS, unscaledRadius(degree.get(id) || 0) * crowdScale); // degree (centrality proxy) -> radius, shrunk by crowding, floored so it never vanishes
      const baseBorderWidth = Math.max(0.3, baseRadius * 0.15); // proportional to radius, not a fixed "1" — otherwise a shrunk node is mostly white border
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", p.x); circle.setAttribute("cy", p.y); circle.setAttribute("r", baseRadius);
      circle.setAttribute("fill", color);
      circle.setAttribute("stroke", "#fff"); circle.setAttribute("stroke-width", baseBorderWidth);
      circle.style.cursor = "grab";
      drawnCircles.push({ circle, baseRadius, baseBorderWidth });
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = `${group.groupId}${group.annotation ? ` — ${group.annotation}` : ""} (${useCategories ? categoryFor(group) : group.freqClass}, degree ${degree.get(id) || 0})`;
      circle.appendChild(title);
      scene.appendChild(circle);

      // Manual repositioning: plain pointer drag, no re-simulation — a
      // dragged node just stays where it's put until the next redraw
      // (filter change, "Draw network" click, or a layout-mode switch).
      // stopPropagation() keeps this from also triggering the
      // background pan/zoom's own pointerdown handler.
      circle.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        try { circle.setPointerCapture(e.pointerId); } catch { /* e.g. a non-pointer-backed synthetic event — drag still works without capture, just won't track past the element's own bounds */ }
        circle.style.cursor = "grabbing";
        const start = { x: e.clientX, y: e.clientY };
        const origin = { x: p.x, y: p.y };
        function onMove(ev) {
          p.x = origin.x + (ev.clientX - start.x) / view.k;
          p.y = origin.y + (ev.clientY - start.y) / view.k;
          circle.setAttribute("cx", p.x);
          circle.setAttribute("cy", p.y);
          for (const { line, end } of edgeLinesByNode.get(id)) {
            if (end === "x1y1") { line.setAttribute("x1", p.x); line.setAttribute("y1", p.y); }
            else { line.setAttribute("x2", p.x); line.setAttribute("y2", p.y); }
          }
        }
        function onUp(ev) {
          try { circle.releasePointerCapture(ev.pointerId); } catch { /* see the matching try/catch on setPointerCapture above */ }
          circle.style.cursor = "grab";
          circle.removeEventListener("pointermove", onMove);
          circle.removeEventListener("pointerup", onUp);
        }
        circle.addEventListener("pointermove", onMove);
        circle.addEventListener("pointerup", onUp);
      });
    }

    applyVisualScale(); // re-apply any manual node-size/edge-width multiplier so it survives a redraw
  }

  container.querySelectorAll("#ngNodeScale, #ngEdgeScale").forEach((el) => el.addEventListener("input", applyVisualScale));

  container.querySelectorAll("#ngDirection, #ngLayoutMode, #ngMaxSig, #ngCrossOnly, #ngTopN").forEach((el) => {
    el.addEventListener("input", () => refreshNote());
    el.addEventListener("change", () => refreshNote());
  });
  container.querySelector("#ngNoCap").addEventListener("change", (e) => {
    container.querySelector("#ngTopN").disabled = e.target.checked;
    refreshNote();
  });
  // Highlighting doesn't change which nodes/edges need laying out, just
  // how existing ones are drawn — cheap enough to always redraw immediately
  // using whatever selection is already pending, without re-gating.
  container.querySelector("#ngHighlightTop").addEventListener("change", () => {
    if (drawn && pendingSelection) runLayout(pendingSelection);
  });
  drawBtn.addEventListener("click", () => {
    if (!pendingSelection) return;
    runBusy(() => runLayout(pendingSelection));
  });

  // --- pan/zoom, same model as heatmap.js / Tree Viewer ---
  const view = { k: 1, x: 0, y: 0 };
  function applyView() { scene.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`); }
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * width;
    const my = ((e.clientY - rect.top) / rect.height) * height;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const nk = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor));
    view.x = mx - (mx - view.x) * (nk / view.k);
    view.y = my - (my - view.y) * (nk / view.k);
    view.k = nk;
    applyView();
  }, { passive: false });
  let drag = null;
  svg.addEventListener("pointerdown", (e) => { drag = { x: e.clientX - view.x, y: e.clientY - view.y }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener("pointermove", (e) => { if (!drag) return; view.x = e.clientX - drag.x; view.y = e.clientY - drag.y; applyView(); });
  svg.addEventListener("pointerup", () => { drag = null; });
  svg.addEventListener("dblclick", () => { view.k = 1; view.x = 0; view.y = 0; applyView(); });

  container.querySelector("#ngExportEdges").addEventListener("click", () => {
    const pairs = (lastFullSelection || fullSelection()).pairs;
    downloadText("pangenome-network-edges.csv", pairsToCytoscapeEdgeTable(pairs, ","), "text/csv");
  });

  container.querySelector("#ngExportSvg").addEventListener("click", () => {
    const clone = svg.cloneNode(true);
    clone.querySelector("g").removeAttribute("transform");
    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([xml], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pangenome-network.svg";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  refreshNote();
  return {
    refresh: () => refreshNote(),
    setGroupFilter(groupIds) {
      groupIdFilter = groupIds || null;
      refreshNote();
    },
  };
}
