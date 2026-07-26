// coinfinder-ui.js — Phase 6 main-panel cards: pair table (with one-click
// cross-category and pure-significance views), category-by-category
// matrix, and the association/disassociation network graph. Mounted
// fresh into the panel on every render (unlike topfilter-ui.js's sidebar,
// nothing here is static markup, so no module-level "bind once" needed).

import { categoryMatrix, crossCategoryPairs, sortBySignificance } from "../analysis/pairs.js";
import { renderCategoryMatrix } from "./charts.js";
import { renderPairTable } from "./pair-table.js";
import { renderNetworkGraph } from "./network-graph.js";
import { downloadText } from "./download-util.js";
import { pairsToDelimited } from "../../export/pair-export.js";

function card(titleText) {
  const c = document.createElement("div");
  c.className = "card";
  const h3 = document.createElement("h3");
  h3.textContent = titleText;
  c.appendChild(h3);
  return c;
}

function renderPairCard(panel, data) {
  const c = card("Association / disassociation pairs");
  if (data.unmatchedPairs.length) {
    const note = document.createElement("div");
    note.className = "hint";
    note.textContent = `${data.unmatchedPairs.length} pair(s) referenced a gene-group ID not found in the loaded pangenome and were excluded from the table below (naming mismatch between CoinFinder's input and this file — not silently dropped, just not resolvable).`;
    c.appendChild(note);
  }
  const controls = document.createElement("div");
  controls.className = "chart-controls";
  controls.innerHTML = `
    <button class="act" id="pairAllBtn" style="width:auto">All pairs</button>
    <button class="act" id="pairCrossBtn" style="width:auto">Cross-category pairs only</button>
    <button class="act" id="pairSigBtn" style="width:auto">Sort by significance (ignore category)</button>
    <button class="act" id="pairExportCsv" style="width:auto">Export CSV</button>
    <button class="act" id="pairExportTsv" style="width:auto">Export TSV</button>
  `;
  c.appendChild(controls);
  const tableDiv = document.createElement("div");
  tableDiv.style.marginTop = "10px";
  c.appendChild(tableDiv);
  panel.appendChild(c);

  let currentPairs = data.pairs;
  const handle = renderPairTable(tableDiv, currentPairs);
  const setPairs = (pairs) => { currentPairs = pairs; handle.setPairs(pairs); };
  c.querySelector("#pairAllBtn").addEventListener("click", () => setPairs(data.pairs));
  c.querySelector("#pairCrossBtn").addEventListener("click", () => setPairs(crossCategoryPairs(data)));
  c.querySelector("#pairSigBtn").addEventListener("click", () => setPairs(sortBySignificance(data.pairs)));
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
