// pangenome.js — interactive UI orchestrator: mountExplorer(container, data).
// Phase 2: pangenome summary only (frequency-class donut + table, gene
// frequency spectrum, per-genome gene-count bar chart). Later phases add
// the heatmap, accumulation curves, filtering, annotation/tagging, and the
// CoinFinder pair/network views as additional cards or mode tabs here.

import { frequencyClassCounts, frequencySpectrum } from "./analysis/frequency.js";
import { computeAccumulationCurves } from "./analysis/accumulation.js";
import { renderFrequencyDonut, renderFrequencySpectrum, renderGenomeBarChart, renderAccumulationCurves } from "./render/charts.js";
import { renderHeatmap } from "./render/heatmap.js";

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

  const spectrumCard = card("Gene frequency spectrum");
  const spectrumDiv = document.createElement("div");
  spectrumCard.appendChild(spectrumDiv);
  renderFrequencySpectrum(spectrumDiv, frequencySpectrum(data));
  panel.appendChild(spectrumCard);

  const genomeCard = card("Per-genome gene counts");
  const genomeDiv = document.createElement("div");
  genomeCard.appendChild(genomeDiv);
  renderGenomeBarChart(genomeDiv, data.genomes);
  panel.appendChild(genomeCard);

  const accumCard = card("Pangenome and core-genome accumulation");
  const accumDiv = document.createElement("div");
  accumCard.appendChild(accumDiv);
  renderAccumulationCurves(accumDiv, computeAccumulationCurves(data));
  panel.appendChild(accumCard);

  const heatmapCard = card("Presence/absence heatmap");
  const heatmapDiv = document.createElement("div");
  heatmapCard.appendChild(heatmapDiv);
  panel.appendChild(heatmapCard); // must be in the document before renderHeatmap wires up its controls via getElementById
  renderHeatmap(heatmapDiv, data);

  return {
    setData(newData) {
      return mountExplorer(container, newData);
    },
  };
}
