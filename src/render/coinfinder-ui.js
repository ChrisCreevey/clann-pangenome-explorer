// coinfinder-ui.js — Phase 6 main-panel cards: pair table (with one-click
// cross-category and pure-significance views), category-by-category
// matrix, and the association/disassociation network graph. Mounted
// fresh into the panel on every render (unlike topfilter-ui.js's sidebar,
// nothing here is static markup, so no module-level "bind once" needed).

import { categoryMatrix, filterPairs, groupAssociationSummary } from "../analysis/pairs.js";
import { listTags } from "../analysis/tags.js";
import { renderCategoryMatrix } from "./charts.js";
import { renderPairTable } from "./pair-table.js";
import { renderNetworkGraph } from "./network-graph.js";
import { renderGroupTable, DEFAULT_COLS } from "./group-table.js";
import { openGroupDetail } from "./group-detail.js";
import { runBusy } from "./busy.js";
import { downloadText } from "./download-util.js";
import { pairsToDelimited } from "../../export/pair-export.js";
import { groupAssociationSummaryCsv } from "../../export/group-export.js";

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function card(titleText) {
  const c = document.createElement("div");
  c.className = "card";
  const h3 = document.createElement("h3");
  h3.textContent = titleText;
  c.appendChild(h3);
  return c;
}

const DEFAULT_PAIR_CRITERIA = { direction: ["associated", "disassociated"], crossCategoryOnly: false, maxSignificance: undefined, annotationText: undefined, tags: [] };

/**
 * Mount the pair table card. `opts.groupIds` is the sidebar Groups
 * filter's current selection (or null, unrestricted) — always applied,
 * both sides of a pair must be in it, via filterPairs()'s groupIds
 * criterion. Returns a handle with setGroupFilter(groupIds) so the Groups
 * filter can keep this in sync on every edit, and addDownstreamHandle()
 * so other cards mounted after this one (annotation summary, category
 * matrix) can be kept in sync with the same filtered pairs without each
 * recomputing its own copy of the filter logic.
 */
function renderPairCard(panel, data, opts = {}) {
  let groupIdFilter = opts.groupIds || null;
  const downstreamHandles = [];

  const c = card("Association / disassociation pairs");
  if (data.unmatchedPairs.length) {
    const note = document.createElement("div");
    note.className = "hint";
    note.textContent = `${data.unmatchedPairs.length} pair(s) referenced a gene-group ID not found in the loaded pangenome and were excluded from the table below (naming mismatch between CoinFinder's input and this file — not silently dropped, just not resolvable).`;
    c.appendChild(note);
  }
  const linkNote = document.createElement("div");
  linkNote.className = "hint";
  linkNote.textContent = "Always restricted to the sidebar Groups filter: both sides of a pair must currently pass it, not just one.";
  c.appendChild(linkNote);

  // Filters — the main tool for finding associated/disassociated groups by
  // annotation once the raw pair list runs into the hundreds of thousands
  // of rows (browsing it directly, even sorted, stops being practical).
  const filterRow1 = document.createElement("div");
  filterRow1.className = "chart-controls";
  filterRow1.innerHTML = `
    <label><input type="checkbox" class="pfDirection" value="associated" checked> Associated</label>
    <label><input type="checkbox" class="pfDirection" value="disassociated" checked> Disassociated</label>
    <label><input type="checkbox" id="pfCrossOnly"> Cross-category only</label>
    <label>Max significance <input type="number" id="pfMaxSig" step="any" placeholder="no cap" style="width:90px"></label>
  `;
  c.appendChild(filterRow1);

  const filterRow2 = document.createElement("div");
  filterRow2.className = "chart-controls";
  filterRow2.innerHTML = `<label style="flex:1;min-width:220px">Annotation contains (either side)
    <input type="text" id="pfText" placeholder="e.g. beta-lactamase" style="width:100%"></label>`;
  c.appendChild(filterRow2);

  const tags = listTags(data);
  if (tags.length) {
    const tagRow = document.createElement("div");
    tagRow.className = "chart-controls";
    tagRow.innerHTML = `<label style="flex-basis:100%">Category tag (either side)</label>` + tags.map(({ tag, count }) => `
      <label><input type="checkbox" class="pfTag" value="${tag}"> ${tag} (${count})</label>
    `).join("");
    c.appendChild(tagRow);
  }

  const controls = document.createElement("div");
  controls.className = "chart-controls";
  controls.innerHTML = `
    <button class="act warn" id="pairReset" style="width:auto">Reset filters</button>
    <button class="act" id="pairExportCsv" style="width:auto">Export CSV</button>
    <button class="act" id="pairExportTsv" style="width:auto">Export TSV</button>
  `;
  c.appendChild(controls);

  const countEl = document.createElement("div");
  countEl.className = "hint";
  countEl.id = "pairFilteredCount";
  c.appendChild(countEl);

  const tableDiv = document.createElement("div");
  tableDiv.style.marginTop = "10px";
  c.appendChild(tableDiv);
  panel.appendChild(c);

  function baseCriteria() {
    return { ...DEFAULT_PAIR_CRITERIA, groupIds: groupIdFilter };
  }

  let currentPairs = filterPairs(data, data.pairs, baseCriteria());
  const handle = renderPairTable(tableDiv, currentPairs, { annotationSources: data.meta.annotationSources });
  updateCount();

  function updateCount() {
    countEl.textContent = `${currentPairs.length}/${data.pairs.length} pairs selected`;
  }

  function readCriteria() {
    return {
      direction: [...c.querySelectorAll(".pfDirection:checked")].map((cb) => cb.value),
      crossCategoryOnly: c.querySelector("#pfCrossOnly").checked,
      maxSignificance: c.querySelector("#pfMaxSig").value ? Number(c.querySelector("#pfMaxSig").value) : undefined,
      annotationText: c.querySelector("#pfText").value.trim() || undefined,
      tags: [...c.querySelectorAll(".pfTag:checked")].map((cb) => cb.value),
      groupIds: groupIdFilter,
    };
  }

  function applyFilters() {
    // filterPairs() is an O(n) scan and setPairs() re-sorts + rebuilds every
    // row — cheap for a typical study, but at CoinFinder scale (hundreds of
    // thousands to millions of resolved pairs) both can take real
    // wall-clock time, so run them under the busy spinner rather than
    // leaving a filter click or keystroke looking like it did nothing.
    const criteria = readCriteria();
    runBusy(() => {
      currentPairs = filterPairs(data, data.pairs, criteria);
      handle.setPairs(currentPairs);
      updateCount();
      downstreamHandles.forEach((h) => h.setPairs(currentPairs));
    });
  }

  const debouncedApply = debounce(applyFilters, 200);
  c.querySelectorAll(".pfDirection").forEach((cb) => cb.addEventListener("change", applyFilters));
  c.querySelector("#pfCrossOnly").addEventListener("change", applyFilters);
  c.querySelector("#pfMaxSig").addEventListener("input", debouncedApply);
  c.querySelector("#pfText").addEventListener("input", debouncedApply);
  c.querySelectorAll(".pfTag").forEach((cb) => cb.addEventListener("change", applyFilters));

  c.querySelector("#pairReset").addEventListener("click", () => {
    c.querySelectorAll(".pfDirection").forEach((cb) => (cb.checked = true));
    c.querySelector("#pfCrossOnly").checked = false;
    c.querySelector("#pfMaxSig").value = "";
    c.querySelector("#pfText").value = "";
    c.querySelectorAll(".pfTag").forEach((cb) => (cb.checked = false));
    applyFilters();
  });

  c.querySelector("#pairExportCsv").addEventListener("click", () => downloadText("pangenome-pairs.csv", pairsToDelimited(data, currentPairs, ","), "text/csv"));
  c.querySelector("#pairExportTsv").addEventListener("click", () => downloadText("pangenome-pairs.tsv", pairsToDelimited(data, currentPairs, "\t"), "text/tab-separated-values"));

  const crossLink = document.createElement("div");
  crossLink.className = "hint";
  crossLink.innerHTML = `For a report: export this table, or the network view below as SVG, then stage the underlying sequences in <a href="https://chriscreevey.github.io/clann-blast-explorer/" target="_blank" rel="noopener">Clann BLAST Explorer</a> for a closer look at an interesting pair.`;
  c.appendChild(crossLink);

  return {
    getCurrentPairs: () => currentPairs,
    addDownstreamHandle(handle) { downstreamHandles.push(handle); }, // wired once the summary/matrix cards mount, just below
    setGroupFilter(groupIds) {
      groupIdFilter = groupIds || null;
      applyFilters();
    },
  };
}

/**
 * Category-by-category matrix, kept in sync with the pair table's current
 * selection (same as the annotation summary card) rather than the whole
 * dataset — otherwise this would show counts inconsistent with everything
 * else on the page once a Groups filter or pair-table filter is active.
 */
function renderMatrixCard(panel, data, initialPairs) {
  const c = card("Category-by-category summary");
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Reflects the pair table's current selection above. Combinations involving an uncategorised (untagged) group are omitted — with no tags applied, those are usually most of the pangenome and swamp the category-to-category comparisons this matrix is for.";
  c.appendChild(hint);
  const div = document.createElement("div");
  c.appendChild(div);
  panel.appendChild(c);
  renderCategoryMatrix(div, categoryMatrix(initialPairs));
  return { setPairs: (pairs) => renderCategoryMatrix(div, categoryMatrix(pairs)) };
}

/**
 * Per-group annotation × association rollup ("option A" from the scoping
 * discussion): one row per group appearing in the pair table's current
 * selection, every field the Groups table itself shows (matrix
 * annotation, every uploaded annotation column, tags, frequency class,
 * counts) plus associated/disassociated/total. Kept in sync with the pair
 * table via setPairs(), called from renderPairCard's applyFilters().
 */
function renderSummaryCard(panel, data, initialPairs) {
  const c = card("Annotation association summary");
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "One row per group in the pair table's current selection above, with how many associated/disassociated partners it has.";
  c.appendChild(hint);

  const exportRow = document.createElement("div");
  exportRow.className = "chart-controls";
  exportRow.innerHTML = `<button class="act" id="summaryExportCsv" style="width:auto">Export table (.csv)</button>`;
  c.appendChild(exportRow);

  const tableDiv = document.createElement("div");
  tableDiv.style.marginTop = "10px";
  c.appendChild(tableDiv);
  panel.appendChild(c);

  const columns = [...DEFAULT_COLS];
  const columnLabels = { associated: "Associated", disassociated: "Disassociated", total: "Total" };
  const numericColumns = ["associated", "disassociated", "total"];
  for (const source of data.meta.annotationSources || []) {
    columns.push(`ann_${source.key}`);
    columnLabels[`ann_${source.key}`] = source.header;
    if (source.workflow === "B") {
      columns.push(`annMatched_${source.key}`);
      columnLabels[`annMatched_${source.key}`] = `${source.header} — matched genes`;
      numericColumns.push(`annMatched_${source.key}`);
    }
  }
  columns.push("tags", "associated", "disassociated", "total");

  let currentRows = groupAssociationSummary(initialPairs);
  const handle = renderGroupTable(tableDiv, currentRows, {
    columns, columnLabels, numericColumns, defaultSort: "total",
    onRowClick: (group) => openGroupDetail(data, group),
  });

  exportRow.querySelector("#summaryExportCsv").addEventListener("click", () =>
    downloadText("pangenome-annotation-association-summary.csv", groupAssociationSummaryCsv(data, currentRows, ","), "text/csv"));

  return {
    setPairs(pairs) {
      currentRows = groupAssociationSummary(pairs);
      handle.setGroups(currentRows);
    },
  };
}

function renderNetworkCard(panel, data, opts = {}) {
  const c = card("Association / disassociation network");
  const div = document.createElement("div");
  c.appendChild(div);
  panel.appendChild(c);
  return renderNetworkGraph(div, data, opts);
}

/**
 * Mount the Phase 6 cards into `panel` (already attached to the document)
 * for `data`. `opts.groupIds` (or null, unrestricted) is the sidebar
 * Groups filter's current selection, always applied to every pair-derived
 * view here (pair table, annotation summary, network) — both sides of a
 * pair must be in it. Returns handles for pangenome.js to keep in sync on
 * every Groups-filter edit.
 */
export function mountCoinfinderCards(panel, data, opts = {}) {
  if (!data.pairs.length && !data.unmatchedPairs.length) return null; // nothing loaded yet — no empty cards to show
  const pairCardHandle = renderPairCard(panel, data, opts);
  const matrixHandle = renderMatrixCard(panel, data, pairCardHandle.getCurrentPairs());
  pairCardHandle.addDownstreamHandle(matrixHandle);
  const summaryHandle = renderSummaryCard(panel, data, pairCardHandle.getCurrentPairs());
  pairCardHandle.addDownstreamHandle(summaryHandle);
  const networkHandle = renderNetworkCard(panel, data, opts);
  return { pairCardHandle, networkHandle };
}
