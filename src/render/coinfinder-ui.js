// coinfinder-ui.js — Phase 6 main-panel cards: pair table (with one-click
// cross-category and pure-significance views), category-by-category
// matrix, and the association/disassociation network graph. Mounted
// fresh into the panel on every render (unlike topfilter-ui.js's sidebar,
// nothing here is static markup, so no module-level "bind once" needed).

import { categoryMatrix, filterPairs } from "../analysis/pairs.js";
import { listTags } from "../analysis/tags.js";
import { renderCategoryMatrix } from "./charts.js";
import { renderPairTable } from "./pair-table.js";
import { renderNetworkGraph } from "./network-graph.js";
import { downloadText } from "./download-util.js";
import { pairsToDelimited } from "../../export/pair-export.js";

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

function renderPairCard(panel, data) {
  const c = card("Association / disassociation pairs");
  if (data.unmatchedPairs.length) {
    const note = document.createElement("div");
    note.className = "hint";
    note.textContent = `${data.unmatchedPairs.length} pair(s) referenced a gene-group ID not found in the loaded pangenome and were excluded from the table below (naming mismatch between CoinFinder's input and this file — not silently dropped, just not resolvable).`;
    c.appendChild(note);
  }

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

  const tableDiv = document.createElement("div");
  tableDiv.style.marginTop = "10px";
  c.appendChild(tableDiv);
  panel.appendChild(c);

  let currentPairs = filterPairs(data, data.pairs, DEFAULT_PAIR_CRITERIA);
  const handle = renderPairTable(tableDiv, currentPairs);

  function readCriteria() {
    return {
      direction: [...c.querySelectorAll(".pfDirection:checked")].map((cb) => cb.value),
      crossCategoryOnly: c.querySelector("#pfCrossOnly").checked,
      maxSignificance: c.querySelector("#pfMaxSig").value ? Number(c.querySelector("#pfMaxSig").value) : undefined,
      annotationText: c.querySelector("#pfText").value.trim() || undefined,
      tags: [...c.querySelectorAll(".pfTag:checked")].map((cb) => cb.value),
    };
  }

  function applyFilters() {
    currentPairs = filterPairs(data, data.pairs, readCriteria());
    handle.setPairs(currentPairs);
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

  c.querySelector("#pairExportCsv").addEventListener("click", () => downloadText("pangenome-pairs.csv", pairsToDelimited(currentPairs, ","), "text/csv"));
  c.querySelector("#pairExportTsv").addEventListener("click", () => downloadText("pangenome-pairs.tsv", pairsToDelimited(currentPairs, "\t"), "text/tab-separated-values"));

  const crossLink = document.createElement("div");
  crossLink.className = "hint";
  crossLink.innerHTML = `For a report: export this table, or the network view below as SVG, then stage the underlying sequences in <a href="https://chriscreevey.github.io/clann-blast-explorer/" target="_blank" rel="noopener">Clann BLAST Explorer</a> for a closer look at an interesting pair.`;
  c.appendChild(crossLink);
}

function renderMatrixCard(panel, data) {
  const c = card("Category-by-category summary");
  const div = document.createElement("div");
  c.appendChild(div);
  panel.appendChild(c);
  renderCategoryMatrix(div, categoryMatrix(data));
}

function renderNetworkCard(panel, data) {
  const c = card("Association / disassociation network");
  const div = document.createElement("div");
  c.appendChild(div);
  panel.appendChild(c);
  renderNetworkGraph(div, data);
}

/** Mount the Phase 6 cards into `panel` (already attached to the document) for `data`. */
export function mountCoinfinderCards(panel, data) {
  if (!data.pairs.length && !data.unmatchedPairs.length) return; // nothing loaded yet — no empty cards to show
  renderPairCard(panel, data);
  renderMatrixCard(panel, data);
  renderNetworkCard(panel, data);
}
