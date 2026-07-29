// pangenome.js — interactive UI orchestrator: mountExplorer(container, data).
// Phase 2: pangenome summary only (frequency-class donut + table, gene
// frequency spectrum, per-genome gene-count bar chart). Later phases add
// the heatmap, accumulation curves, filtering, annotation/tagging, and the
// CoinFinder pair/network views as additional cards or mode tabs here.

import { frequencyClassCounts, frequencySpectrum } from "./analysis/frequency.js";
import { computeAccumulationCurves } from "./analysis/accumulation.js";
import { flagGenomeOutliers, describeQcReason, DEFAULT_QC_THRESHOLDS } from "./analysis/genome-qc.js";
import { renderFrequencyDonut, renderFrequencySpectrum, renderGenomeBarChart, renderAccumulationCurves } from "./render/charts.js";
import { renderHeatmap } from "./render/heatmap.js";
import { mountGroupsCard, mountTopFilterExtras } from "./render/topfilter-ui.js";
import { mountCoinfinderCards } from "./render/coinfinder-ui.js";

const FREQ_CLASS_LABELS = { core: "Core", softcore: "Soft-core", shell: "Shell", cloud: "Cloud" };

function card(titleText) {
  const card = document.createElement("div");
  card.className = "card";
  const h3 = document.createElement("h3");
  h3.textContent = titleText;
  card.appendChild(h3);
  return card;
}

function renderFrequencyClassTable(container, data) {
  const counts = frequencyClassCounts(data);
  const table = document.createElement("table");
  table.className = "data-table";
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>Class</th><th>Groups</th><th>% of pangenome</th></tr>";
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const key of ["core", "softcore", "shell", "cloud"]) {
    const count = counts[key] || 0;
    const pct = data.meta.groupCount ? (count / data.meta.groupCount) * 100 : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${FREQ_CLASS_LABELS[key]}</td><td class="num">${count}</td><td class="num">${pct.toFixed(1)}%</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

export function mountExplorer(container, data) {
  container.innerHTML = "";
  const panel = document.createElement("div");
  panel.className = "mode-panel";
  container.appendChild(panel);

  const freqCard = card("Frequency classes");
  const freqChartDiv = document.createElement("div");
  freqCard.appendChild(freqChartDiv);
  renderFrequencyDonut(freqChartDiv, frequencyClassCounts(data));
  const freqTableDiv = document.createElement("div");
  freqTableDiv.style.marginTop = "10px";
  freqCard.appendChild(freqTableDiv);
  renderFrequencyClassTable(freqTableDiv, data);
  panel.appendChild(freqCard);

  // heatmapHandle/coinfinderHandles are assigned once those cards mount,
  // below — the Groups card mounts first (so the detailed group list
  // appears upfront), but onFilterChange only actually fires on a later
  // filter edit, by which point everything else has already mounted.
  // Groups-filter changes always propagate to the pair table, annotation
  // summary, and network graph too (both sides of a pair must be in the
  // filtered set — see filterPairs()'s groupIds criterion), not just the
  // heatmap.
  let heatmapHandle = null;
  let coinfinderHandles = null;
  const onGroupsFilterChange = (groups) => {
    heatmapHandle?.setGroups(groups);
    const groupIds = new Set(groups.map((g) => g.groupId));
    coinfinderHandles?.pairCardHandle?.setGroupFilter(groupIds);
    coinfinderHandles?.networkHandle?.setGroupFilter(groupIds);
  };
  mountGroupsCard(panel, data, { onFilterChange: onGroupsFilterChange });

  const spectrumCard = card("Gene frequency spectrum");
  const spectrumDiv = document.createElement("div");
  spectrumCard.appendChild(spectrumDiv);
  renderFrequencySpectrum(spectrumDiv, frequencySpectrum(data));
  panel.appendChild(spectrumCard);

  const genomeCard = card("Per-genome gene counts");
  const qcControls = document.createElement("div");
  qcControls.className = "chart-controls";
  qcControls.innerHTML = `
    <label>Flag core genes present below <input type="number" id="qcLowCorePct" min="1" max="100" step="1" value="${DEFAULT_QC_THRESHOLDS.lowCorePct}" style="width:60px">% of median</label>
    <label>Flag unique genes above <input type="number" id="qcHighUniqueX" min="1" step="0.5" value="${DEFAULT_QC_THRESHOLDS.highUniqueMultiplier}" style="width:60px">× median</label>
  `;
  genomeCard.appendChild(qcControls);
  const qcSummary = document.createElement("div");
  qcSummary.className = "hint";
  genomeCard.appendChild(qcSummary);
  const genomeDiv = document.createElement("div");
  genomeCard.appendChild(genomeDiv);
  panel.appendChild(genomeCard);

  function drawGenomeChart() {
    const thresholds = {
      lowCorePct: Number(qcControls.querySelector("#qcLowCorePct").value) || DEFAULT_QC_THRESHOLDS.lowCorePct,
      highUniqueMultiplier: Number(qcControls.querySelector("#qcHighUniqueX").value) || DEFAULT_QC_THRESHOLDS.highUniqueMultiplier,
    };
    const { flagged } = flagGenomeOutliers(data.genomes, thresholds);
    const flaggedReasons = new Map(flagged.map(({ genome, reasons }) => [genome.name, reasons.map(describeQcReason)]));
    qcSummary.textContent = flagged.length
      ? `${flagged.length} genome(s) flagged: ` + flagged.map(({ genome, reasons }) => `${genome.name} (${reasons.map(describeQcReason).join("; ")})`).join(" · ")
      : "No genomes flagged at these thresholds — purely descriptive comparisons against the population median, not a formal test, so use judgement on borderline cases.";
    renderGenomeBarChart(genomeDiv, data.genomes, { flaggedReasons });
  }
  qcControls.querySelectorAll("input").forEach((input) => input.addEventListener("input", drawGenomeChart));
  drawGenomeChart();

  const accumCard = card("Pangenome and core-genome accumulation");
  const accumDiv = document.createElement("div");
  accumCard.appendChild(accumDiv);
  renderAccumulationCurves(accumDiv, computeAccumulationCurves(data));
  panel.appendChild(accumCard);

  const heatmapCard = card("Presence/absence heatmap");
  const heatmapHint = document.createElement("div");
  heatmapHint.className = "hint";
  heatmapHint.textContent = "Rows follow the sidebar filters (Filters panel) — narrowing them also shrinks the clustering problem.";
  heatmapCard.appendChild(heatmapHint);
  const heatmapDiv = document.createElement("div");
  heatmapCard.appendChild(heatmapDiv);
  panel.appendChild(heatmapCard); // must be in the document before renderHeatmap wires up its controls via getElementById
  heatmapHandle = renderHeatmap(heatmapDiv, data);

  mountTopFilterExtras(panel, data);
  // The Groups filter defaults to every group at mount (see
  // topfilter-ui.js's DEFAULT_CRITERIA), so an initial groupIds of null
  // (unrestricted) is equivalent — it only becomes a real Set once the
  // user edits a Groups filter, via onGroupsFilterChange above.
  coinfinderHandles = mountCoinfinderCards(panel, data, { groupIds: null });

  return {
    setData(newData) {
      return mountExplorer(container, newData);
    },
  };
}
