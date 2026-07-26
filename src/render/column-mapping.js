// column-mapping.js — manual column-mapping UI, shown when the generic
// matrix fallback can't unambiguously tell which column holds the
// gene-group ID and which columns are genomes. The student picks the
// group-ID column and ticks which remaining columns are genomes from a
// preview of the first few rows, then re-parses.
// Adapted from clann-blast-explorer/src/render/column-mapping.js.

export function renderColumnMapping(container, opts) {
  const { message, previewHeader, previewRows, onApply, onCancel } = opts;
  container.innerHTML = "";
  const colCount = previewHeader.length;

  const wrap = document.createElement("div");
  wrap.className = "column-mapping";

  const heading = document.createElement("h2");
  heading.textContent = "Manual column mapping";
  wrap.appendChild(heading);

  const msg = document.createElement("p");
  msg.className = "hint";
  msg.textContent = `${message} Pick the gene-group ID column, tick which columns are genomes, then load.`;
  wrap.appendChild(msg);

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "data-table column-mapping-table";

  const idRadios = [];
  const genomeChecks = [];
  const thead = document.createElement("thead");

  const roleRow = document.createElement("tr");
  for (let i = 0; i < colCount; i++) {
    const th = document.createElement("th");
    const idLabel = document.createElement("label");
    const idRadio = document.createElement("input");
    idRadio.type = "radio";
    idRadio.name = "groupIdColumn";
    idRadio.value = String(i);
    idRadios.push(idRadio);
    idLabel.appendChild(idRadio);
    idLabel.append(" group ID");
    th.appendChild(idLabel);

    const genomeLabel = document.createElement("label");
    genomeLabel.style.display = "block";
    const genomeCheck = document.createElement("input");
    genomeCheck.type = "checkbox";
    genomeCheck.value = String(i);
    genomeChecks.push(genomeCheck);
    genomeLabel.appendChild(genomeCheck);
    genomeLabel.append(" genome");
    th.appendChild(genomeLabel);

    th.appendChild(document.createElement("br"));
    const nameSpan = document.createElement("span");
    nameSpan.textContent = previewHeader[i] || `column ${i + 1}`;
    th.appendChild(nameSpan);
    roleRow.appendChild(th);
  }
  thead.appendChild(roleRow);
  table.appendChild(thead);

  idRadios.forEach((radio, i) => {
    radio.addEventListener("change", () => {
      if (radio.checked) genomeChecks[i].checked = false;
    });
  });
  genomeChecks.forEach((check, i) => {
    check.addEventListener("change", () => {
      if (check.checked) idRadios[i].checked = false;
    });
  });
  // best guess: first non-numeric-looking column is the ID, rest are genomes
  const firstDataRow = previewRows[0] || [];
  const guessedIdCol = firstDataRow.findIndex((v) => v !== "" && !/^\d+(\.\d+)?$/.test((v ?? "").trim()));
  idRadios[guessedIdCol >= 0 ? guessedIdCol : 0].checked = true;
  genomeChecks.forEach((check, i) => { if (i !== (guessedIdCol >= 0 ? guessedIdCol : 0)) check.checked = true; });

  const tbody = document.createElement("tbody");
  for (const row of previewRows) {
    const tr = document.createElement("tr");
    for (let i = 0; i < colCount; i++) {
      const td = document.createElement("td");
      td.textContent = row[i] ?? "";
      td.title = row[i] ?? "";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  wrap.appendChild(tableWrap);

  const actions = document.createElement("div");
  actions.className = "column-mapping-actions";
  const applyBtn = document.createElement("button");
  applyBtn.className = "act";
  applyBtn.textContent = "Load with this mapping";
  applyBtn.addEventListener("click", () => {
    const groupIdColumn = idRadios.findIndex((r) => r.checked);
    const genomeColumns = genomeChecks.map((c, i) => (c.checked ? i : -1)).filter((i) => i >= 0);
    if (groupIdColumn < 0) { applyBtn.title = "Pick a group ID column first."; return; }
    if (!genomeColumns.length) { applyBtn.title = "Tick at least one genome column."; return; }
    onApply({ groupIdColumn, genomeColumns });
  });
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "act warn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", onCancel);
  actions.appendChild(applyBtn);
  actions.appendChild(cancelBtn);
  wrap.appendChild(actions);

  container.appendChild(wrap);
}
