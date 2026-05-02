let paymentData = [];
let barChart, pieChart;
let currentTheme = localStorage.getItem("theme") || "dark";

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  applyTheme(currentTheme);

  fetch("./paymentData.json")
    .then((res) => res.json())
    .then((data) => {
      paymentData = data;
      initDashboard();
    })
    .catch((err) => {
      console.error("Failed to load data:", err);
      showToast("Failed to load payment data!", "error");
    });
});

function initDashboard() {
  const yearFilter = document.getElementById("yearFilter");
  const monthFilter = document.getElementById("monthFilter");
  const nameFilter = document.getElementById("nameFilter");
  const searchInput = document.getElementById("searchInput");

  // Populate years
  paymentData.forEach((y) => {
    yearFilter.innerHTML += `<option value="${y.year}">${y.year}</option>`;
  });

  // Theme Toggle
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);

  // Search functionality
  searchInput.addEventListener("input", (e) => {
    render(
      yearFilter.value,
      monthFilter.value,
      nameFilter.value,
      e.target.value,
    );
  });

  // Filter events
  yearFilter.addEventListener("change", (e) => {
    const year = e.target.value;
    populateMonths(year);
    populateNames(year, "all");
    populateModalFields(year);
    render(year, "all", "all", searchInput.value);
    renderPersonYearlySummary(year);
    updateStats(year, "all");
    updateProgress(year, "all");
    checkDueAlerts(year, "all");
  });

  monthFilter.addEventListener("change", (e) => {
    populateNames(yearFilter.value, e.target.value);
    render(yearFilter.value, e.target.value, "all", searchInput.value);
    updateStats(yearFilter.value, e.target.value);
    updateProgress(yearFilter.value, e.target.value);
    checkDueAlerts(yearFilter.value, e.target.value);
  });

  nameFilter.addEventListener("change", (e) => {
    render(
      yearFilter.value,
      monthFilter.value,
      e.target.value,
      searchInput.value,
    );
  });

  // Form submit for adding payment
  document
    .getElementById("addForm")
    .addEventListener("submit", handleAddPayment);

  // Initial load
  const firstYear = paymentData[0].year;
  yearFilter.value = firstYear;
  populateMonths(firstYear);
  populateNames(firstYear, "all");
  populateModalFields(firstYear);
  renderPersonYearlySummary(firstYear);
  render(firstYear, "all", "all", "");
  updateStats(firstYear, "all");
  updateProgress(firstYear, "all");
  checkDueAlerts(firstYear, "all");
}

// 🌓 Theme Toggle
function toggleTheme() {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(currentTheme);
  localStorage.setItem("theme", currentTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const icon = document.querySelector("#themeToggle i");
  if (icon) {
    icon.className = theme === "dark" ? "fas fa-moon" : "fas fa-sun";
  }
}

// 📊 Stats Cards
function updateStats(year, month) {
  const yearData = paymentData.find((y) => y.year == year);
  const months = yearData.months.filter(
    (m) => month === "all" || m.month === month,
  );

  let totalPaid = 0,
    totalDue = 0,
    totalMembers = new Set();

  months.forEach((m) => {
    m.payments.forEach((p) => {
      totalMembers.add(p.name);
      if (p.paid) totalPaid += p.amount;
      else totalDue += p.amount;
    });
  });

  const total = totalPaid + totalDue;
  const rate = total ? ((totalPaid / total) * 100).toFixed(1) : 0;

  const statsGrid = document.getElementById("statsGrid");
  statsGrid.innerHTML = `
    <div class="stat-card highlight">
      <span class="stat-label">Total Collected</span>
      <span class="stat-value paid">৳${totalPaid.toLocaleString()}</span>
      <span class="stat-sub">${months.length} month${months.length > 1 ? "s" : ""}</span>
    </div>
    <div class="stat-card warning">
      <span class="stat-label">Pending</span>
      <span class="stat-value due">৳${totalDue.toLocaleString()}</span>
      <span class="stat-sub">${totalDue > 0 ? "Needs attention" : "All clear!"}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Active Members</span>
      <span class="stat-value">${totalMembers.size}</span>
      <span class="stat-sub">Registered</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Collection Rate</span>
      <span class="stat-value">${rate}%</span>
      <span class="stat-sub">${rate >= 80 ? "🎯 Great!" : rate >= 50 ? "📈 Improving" : "⚠️ Low"}</span>
    </div>
  `;
}

// 📈 Progress Bar
function updateProgress(year, month) {
  const yearData = paymentData.find((y) => y.year == year);
  const months = yearData.months.filter(
    (m) => month === "all" || m.month === month,
  );

  let paid = 0,
    total = 0;
  months.forEach((m) => {
    m.payments.forEach((p) => {
      total += p.amount;
      if (p.paid) paid += p.amount;
    });
  });

  const percent = total ? Math.round((paid / total) * 100) : 0;
  document.getElementById("progressFill").style.width = `${percent}%`;
  document.getElementById("progressText").textContent = `${percent}%`;
}

// 🔔 Due Alerts
function checkDueAlerts(year, month) {
  const yearData = paymentData.find((y) => y.year == year);
  const months = yearData.months.filter(
    (m) => month === "all" || m.month === month,
  );

  const dueMembers = new Set();
  months.forEach((m) => {
    m.payments.filter((p) => !p.paid).forEach((p) => dueMembers.add(p.name));
  });

  const alertBox = document.getElementById("dueAlerts");
  if (dueMembers.size > 0) {
    alertBox.classList.remove("hidden");
    alertBox.innerHTML = `
      <h4><i class="fas fa-exclamation-triangle"></i> Pending Payments</h4>
      <div class="due-list">
        ${Array.from(dueMembers)
          .map((name) => `<span class="due-badge">${name}</span>`)
          .join("")}
      </div>
    `;
  } else {
    alertBox.classList.add("hidden");
  }
}

// 🔍 Search Filter Helper
function matchesSearch(name, query) {
  if (!query) return true;
  return name.toLowerCase().includes(query.toLowerCase());
}

// 🎨 Render Table with Search
function render(year, month, name, searchQuery) {
  const tableContainer = document.getElementById("tableContainer");
  tableContainer.innerHTML = "";
  let totalPaid = 0,
    totalDue = 0;

  const yearData = paymentData.find((y) => y.year == year);

  yearData.months
    .filter((m) => month === "all" || m.month === month)
    .forEach((m) => {
      const filteredPayments = m.payments.filter(
        (p) =>
          (name === "all" || p.name === name) &&
          matchesSearch(p.name, searchQuery),
      );

      if (filteredPayments.length === 0) return;

      let html = `
        <h2>${m.month} (${year})</h2>
        <div class="table-wrap">
        <table>
          <tr><th>Name</th><th>Amount</th><th>Status</th></tr>
      `;

      filteredPayments.forEach((p) => {
        if (p.paid) totalPaid += p.amount;
        else totalDue += p.amount;
        html += `
          <tr>
            <td>${p.name}</td>
            <td>${p.amount}</td>
            <td class="${p.paid ? "paid" : "unpaid"}">
              ${p.paid ? '<i class="fas fa-check"></i> Paid' : '<i class="fas fa-clock"></i> Pending'}
            </td>
          </tr>
        `;
      });

      html += `</table></div>`;
      tableContainer.innerHTML += html;
    });

  if (tableContainer.innerHTML === "") {
    tableContainer.innerHTML = `<div class="empty">No records found. Try adjusting filters.</div>`;
  }

  updateCharts(totalPaid, totalDue);
}

// 📥 Export to CSV
function exportToCSV() {
  const year = document.getElementById("yearFilter").value;
  const month = document.getElementById("monthFilter").value;
  const yearData = paymentData.find((y) => y.year == year);

  let csv = "Name,Month,Amount,Status,Year\n";

  yearData.months
    .filter((m) => month === "all" || m.month === month)
    .forEach((m) => {
      m.payments.forEach((p) => {
        csv += `${p.name},${m.month},${p.amount},${p.paid ? "Paid" : "Pending"},${year}\n`;
      });
    });

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kisti-report-${year}-${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  showToast("Report exported successfully! ✅");
}

// 📋 Copy Account Number
function copyAccount() {
  const acc = "20503560301151415";
  navigator.clipboard.writeText(acc).then(() => {
    const btn = document.querySelector(".copy-btn");
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
    btn.classList.add("copied");
    setTimeout(() => {
      btn.innerHTML = original;
      btn.classList.remove("copied");
    }, 2000);
    showToast("Account number copied! 📋");
  });
}

// 🔔 Toast Notification
function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  const msg = document.getElementById("toastMsg");
  msg.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3000);
}

// ➕ Modal Functions
function populateModalFields(year) {
  const yearData = paymentData.find((y) => y.year == year);
  const names = [
    ...new Set(yearData.months.flatMap((m) => m.payments.map((p) => p.name))),
  ];
  const months = yearData.months.map((m) => m.month);

  const nameSelect = document.getElementById("modalName");
  const monthSelect = document.getElementById("modalMonth");

  nameSelect.innerHTML = names
    .map((n) => `<option value="${n}">${n}</option>`)
    .join("");
  monthSelect.innerHTML = months
    .map((m) => `<option value="${m}">${m}</option>`)
    .join("");
}

function openModal() {
  document.getElementById("addModal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("addModal").classList.add("hidden");
}

function handleAddPayment(e) {
  e.preventDefault();
  const name = document.getElementById("modalName").value;
  const month = document.getElementById("modalMonth").value;
  const amount = parseInt(document.getElementById("modalAmount").value);
  const paid = document.getElementById("modalPaid").checked;
  const year = document.getElementById("yearFilter").value;

  // Demo: Just show success (real app would save to backend/localStorage)
  showToast(
    `Payment added: ${name} - ৳${amount} (${paid ? "Paid" : "Pending"})`,
  );
  closeModal();

  // Refresh view
  render(year, month, "all", "");
  updateStats(year, month);
  updateProgress(year, month);
}

// 📊 Charts
function updateCharts(paid, due) {
  const barChartEl = document.getElementById("barChart");
  const pieChartEl = document.getElementById("pieChart");

  if (barChart) barChart.destroy();
  if (pieChart) pieChart.destroy();

  const isDark = currentTheme === "dark";
  const textColor = isDark ? "#f0f0f5" : "#1e293b";
  const gridColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";

  barChart = new Chart(barChartEl, {
    type: "bar",
    data: {
      labels: ["Paid", "Due"],
      datasets: [
        {
          label: "Amount (Tk)",
          data: [paid, due],
          backgroundColor: ["#00d4aa", "#ff6b6b"],
          borderRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: { color: textColor },
        },
        x: {
          grid: { display: false },
          ticks: { color: textColor },
        },
      },
    },
  });

  pieChart = new Chart(pieChartEl, {
    type: "pie",
    data: {
      labels: ["Paid", "Due"],
      datasets: [
        {
          data: [paid, due],
          backgroundColor: ["#00d4aa", "#ff6b6b"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { color: textColor } },
      },
    },
  });
}

// 📋 Existing functions (populateMonths, populateNames, renderPersonYearlySummary, showPersonDetails) remain same...
// Just add searchQuery parameter where needed

function populateMonths(year) {
  const monthFilter = document.getElementById("monthFilter");
  monthFilter.innerHTML = `<option value="all">All Months</option>`;
  const yearData = paymentData.find((y) => y.year == year);
  yearData.months.forEach((m) => {
    monthFilter.innerHTML += `<option value="${m.month}">${m.month}</option>`;
  });
}

function populateNames(year, month) {
  const nameFilter = document.getElementById("nameFilter");
  nameFilter.innerHTML = `<option value="all">All Names</option>`;
  const yearData = paymentData.find((y) => y.year == year);
  const months = yearData.months.filter(
    (m) => month === "all" || m.month === month,
  );
  const namesSet = new Set(
    months.flatMap((m) => m.payments.map((p) => p.name)),
  );
  namesSet.forEach((name) => {
    nameFilter.innerHTML += `<option value="${name}">${name}</option>`;
  });
}

function renderPersonYearlySummary(year) {
  const yearData = paymentData.find((y) => y.year == year);
  const personMap = {};

  yearData.months.forEach((month) => {
    month.payments.forEach((p) => {
      if (!personMap[p.name]) personMap[p.name] = { paid: 0, due: 0 };
      if (p.paid) personMap[p.name].paid += p.amount;
      else personMap[p.name].due += p.amount;
    });
  });

  let html = `
    <h2>Person-wise Yearly Summary (${year})</h2>
    <div class="table-wrap">
    <table class="summary-table">
      <tr><th>Name</th><th>Total Paid</th><th>Total Due</th><th>Total</th><th>Paid %</th></tr>
  `;

  Object.keys(personMap).forEach((name) => {
    const paid = personMap[name].paid;
    const due = personMap[name].due;
    const total = paid + due;
    const paidPct = total ? ((paid / total) * 100).toFixed(1) : 0;
    html += `
      <tr>
        <td class="clickable" onclick="showPersonDetails('${name}', ${year})">${name}</td>
        <td class="summary-paid">৳${paid}</td>
        <td class="summary-due">৳${due}</td>
        <td>৳${total}</td>
        <td>${paidPct}%</td>
      </tr>
    `;
  });

  html += `</table></div>`;
  document.getElementById("personSummary").innerHTML = html;
  document.getElementById("personDetails").innerHTML = "";
}

function showPersonDetails(name, year) {
  const yearData = paymentData.find((y) => y.year == year);
  let html = `
    <h3>Monthly Breakdown: ${name} (${year})</h3>
    <div class="table-wrap">
    <table>
      <tr><th>Month</th><th>Amount</th><th>Status</th></tr>
  `;

  yearData.months.forEach((month) => {
    const payment = month.payments.find((p) => p.name === name);
    if (payment) {
      html += `
        <tr>
          <td>${month.month}</td>
          <td>৳${payment.amount}</td>
          <td class="${payment.paid ? "detail-paid" : "detail-due"}">
            ${payment.paid ? '<i class="fas fa-check"></i> Paid' : '<i class="fas fa-clock"></i> Pending'}
          </td>
        </tr>
      `;
    }
  });

  html += `</table></div>`;
  document.getElementById("personDetails").innerHTML = html;
  document
    .getElementById("personDetails")
    .scrollIntoView({ behavior: "smooth" });
}
function renderPersonYearlySummary(year) {
  const yearData = paymentData.find((y) => y.year == year);
  const personMap = {};

  yearData.months.forEach((month) => {
    month.payments.forEach((p) => {
      if (!personMap[p.name]) personMap[p.name] = { paid: 0, due: 0 };
      if (p.paid) personMap[p.name].paid += p.amount;
      else personMap[p.name].due += p.amount;
    });
  });

  const cards = Object.keys(personMap).map((name) => {
    const paid = personMap[name].paid;
    const due = personMap[name].due;
    const total = paid + due;
    const pct = total ? Math.round((paid / total) * 100) : 0;
    const initials = name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2);

    return `
      <div class="person-card" onclick="showPersonDetails('${name}', ${year})">
        <div class="person-card-header">
          <div class="person-avatar">${initials}</div>
          <div>
            <div class="person-name">${name}</div>
            <div class="person-role">Member · ${year}</div>
          </div>
        </div>
 
        <div class="person-stats">
          <div class="person-stat">
            <div class="person-stat-label">Paid</div>
            <div class="person-stat-val is-paid">৳${paid.toLocaleString()}</div>
          </div>
          <div class="person-stat">
            <div class="person-stat-label">Pending</div>
            <div class="person-stat-val is-due">৳${due.toLocaleString()}</div>
          </div>
        </div>
 
        <div class="person-bar-wrap">
          <div class="person-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="person-bar-footer">
          <span>Collection rate</span>
          <span class="pct">${pct}%</span>
        </div>
      </div>
    `;
  });

  document.getElementById("personSummary").innerHTML = cards.join("");
  document.getElementById("personDetails").innerHTML = "";
}

function showPersonDetails(name, year) {
  const yearData = paymentData.find((y) => y.year == year);
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2);

  // Gather stats
  let totalPaid = 0,
    totalDue = 0;
  yearData.months.forEach((m) => {
    const p = m.payments.find((p) => p.name === name);
    if (p) {
      if (p.paid) totalPaid += p.amount;
      else totalDue += p.amount;
    }
  });
  const grandTotal = totalPaid + totalDue;
  const pct = grandTotal ? Math.round((totalPaid / grandTotal) * 100) : 0;

  // Month tiles
  const tiles = yearData.months
    .map((month) => {
      const payment = month.payments.find((p) => p.name === name);
      if (!payment) return "";

      const isPaid = payment.paid;
      return `
      <div class="month-tile ${isPaid ? "is-paid" : "is-due"}">
        <div class="month-tile-name">${month.month}</div>
        <div class="month-tile-amount">৳${payment.amount.toLocaleString()}</div>
        <div class="month-tile-status ${isPaid ? "s-paid" : "s-due"}">
          <span class="month-tile-dot ${isPaid ? "d-paid" : "d-due"}"></span>
          ${isPaid ? "Paid" : "Pending"}
        </div>
      </div>
    `;
    })
    .join("");

  const html = `
    <div class="person-detail-panel">
      <div class="person-detail-header">
        <div class="person-detail-title">
          <div class="person-detail-avatar">${initials}</div>
          <div>
            <div class="person-detail-name">${name}</div>
            <div class="person-detail-sub">Monthly breakdown · ${year}</div>
          </div>
        </div>
        <div class="person-detail-kpis">
          <div class="person-kpi">
            <div class="person-kpi-label">Paid</div>
            <div class="person-kpi-val kpi-paid">৳${totalPaid.toLocaleString()}</div>
          </div>
          <div class="person-kpi">
            <div class="person-kpi-label">Pending</div>
            <div class="person-kpi-val kpi-due">৳${totalDue.toLocaleString()}</div>
          </div>
          <div class="person-kpi">
            <div class="person-kpi-label">Total · ${pct}%</div>
            <div class="person-kpi-val kpi-total">৳${grandTotal.toLocaleString()}</div>
          </div>
        </div>
      </div>
 
      <div class="person-months-grid">
        ${tiles}
      </div>
    </div>
  `;

  document.getElementById("personDetails").innerHTML = html;
  document
    .getElementById("personDetails")
    .scrollIntoView({ behavior: "smooth", block: "start" });
}
// ─────────────────────────────────────────────────────────────
// DROP-IN REPLACEMENT for the render() function in script.js
// Replace the entire render() function with this one.
// ─────────────────────────────────────────────────────────────

function render(year, month, name, searchQuery) {
  const tableContainer = document.getElementById("tableContainer");
  tableContainer.innerHTML = "";
  let totalPaid = 0,
    totalDue = 0;

  const yearData = paymentData.find((y) => y.year == year);

  const filteredMonths = yearData.months
    .filter((m) => month === "all" || m.month === month)
    .map((m) => ({
      ...m,
      payments: m.payments.filter(
        (p) =>
          (name === "all" || p.name === name) &&
          matchesSearch(p.name, searchQuery),
      ),
    }))
    .filter((m) => m.payments.length > 0);

  if (filteredMonths.length === 0) {
    tableContainer.innerHTML = `<div class="empty">No records found. Try adjusting filters.</div>`;
    updateCharts(0, 0);
    return;
  }

  // Build accordion
  const accordion = document.createElement("div");
  accordion.className = "accordion";

  filteredMonths.forEach((m, idx) => {
    let mPaid = 0,
      mDue = 0;
    m.payments.forEach((p) => {
      if (p.paid) {
        mPaid += p.amount;
        totalPaid += p.amount;
      } else {
        mDue += p.amount;
        totalDue += p.amount;
      }
    });

    // Auto-open the first (most recent) accordion item
    const isOpen = idx === 0;

    const rows = m.payments
      .map(
        (p) => `
      <tr>
        <td>${p.name}</td>
        <td style="font-variant-numeric:tabular-nums">৳${p.amount.toLocaleString()}</td>
        <td>
          ${
            p.paid
              ? `<span class="badge-paid"><i class="fas fa-check" style="font-size:9px"></i> Paid</span>`
              : `<span class="badge-due"><i class="fas fa-clock" style="font-size:9px"></i> Pending</span>`
          }
        </td>
      </tr>
    `,
      )
      .join("");

    const item = document.createElement("div");
    item.className = `acc-item${isOpen ? " is-open" : ""}`;
    item.innerHTML = `
      <button class="acc-trigger" type="button" aria-expanded="${isOpen}">
        <span class="acc-month-label">${m.month} <span style="font-weight:400;color:var(--text-3);font-size:12px">${year}</span></span>
        <div class="acc-meta">
          ${mPaid > 0 ? `<span class="acc-chip chip-paid">৳${mPaid.toLocaleString()} paid</span>` : ""}
          ${mDue > 0 ? `<span class="acc-chip chip-due">৳${mDue.toLocaleString()} due</span>` : ""}
          <span class="acc-chip chip-count">${m.payments.length} member${m.payments.length !== 1 ? "s" : ""}</span>
        </div>
        <span class="acc-chevron">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </button>
      <div class="acc-body">
        <div class="acc-body-inner">
          <div class="acc-table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Toggle on header click
    item.querySelector(".acc-trigger").addEventListener("click", () => {
      const open = item.classList.toggle("is-open");
      item.querySelector(".acc-trigger").setAttribute("aria-expanded", open);
    });

    accordion.appendChild(item);
  });

  tableContainer.appendChild(accordion);
  updateCharts(totalPaid, totalDue);
}
function switchCalcTab(tab) {
  document
    .querySelectorAll(".calc-tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  document
    .getElementById("panel-fdr")
    .classList.toggle("hidden", tab !== "fdr");
  document
    .getElementById("panel-dps")
    .classList.toggle("hidden", tab !== "dps");
}

function switchDpsMode(mode) {
  document
    .querySelectorAll(".dps-mode-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  document
    .getElementById("dps-regular")
    .classList.toggle("hidden", mode !== "regular");
  document
    .getElementById("dps-kisti")
    .classList.toggle("hidden", mode !== "kisti");
}

// ── Helpers ─────────────────────────────────────────────────
function fmtMoney(n) {
  return "৳" + Math.round(n).toLocaleString("en-IN");
}

function buildResultStrip(
  elId,
  principal,
  interest,
  maturity,
  subPrincipal,
  subMaturity,
) {
  document.getElementById(elId).innerHTML = `
    <div class="calc-res-group">
      <div class="calc-res-label">Total Deposited</div>
      <div class="calc-res-val v-muted">${fmtMoney(principal)}</div>
      <div class="calc-res-sub">${subPrincipal}</div>
    </div>
    <div class="calc-res-divider"></div>
    <div class="calc-res-group">
      <div class="calc-res-label">Interest Earned</div>
      <div class="calc-res-val v-green">${fmtMoney(interest)}</div>
      <div class="calc-res-sub">${((interest / principal) * 100).toFixed(2)}% return</div>
    </div>
    <div class="calc-res-divider"></div>
    <div class="calc-res-group">
      <div class="calc-res-label">Maturity Amount</div>
      <div class="calc-res-val v-indigo">${fmtMoney(maturity)}</div>
      <div class="calc-res-sub">${subMaturity}</div>
    </div>
  `;
}

// ── FDR ─────────────────────────────────────────────────────
function calcFDR() {
  const P = parseFloat(document.getElementById("fdr-amount").value) || 0;
  const r = parseFloat(document.getElementById("fdr-rate").value) || 0;
  const yr = parseInt(document.getElementById("fdr-years").value) || 0;
  const mo = parseInt(document.getElementById("fdr-months").value) || 0;
  const n = parseInt(document.getElementById("fdr-compound").value) || 12;
  const t = (yr * 12 + mo) / 12;
  if (P <= 0 || r <= 0 || t <= 0) return;

  const maturity = P * Math.pow(1 + r / 100 / n, n * t);
  const interest = maturity - P;
  const tenure = (yr > 0 ? yr + "yr " : "") + (mo > 0 ? mo + "mo" : "");

  document.getElementById("fdr-result").innerHTML = `
    <div class="calc-res-group">
      <div class="calc-res-label">Principal</div>
      <div class="calc-res-val v-muted">${fmtMoney(P)}</div>
    </div>
    <div class="calc-res-divider"></div>
    <div class="calc-res-group">
      <div class="calc-res-label">Interest Earned</div>
      <div class="calc-res-val v-green">${fmtMoney(interest)}</div>
      <div class="calc-res-sub">${((interest / P) * 100).toFixed(2)}% of principal</div>
    </div>
    <div class="calc-res-divider"></div>
    <div class="calc-res-group">
      <div class="calc-res-label">Maturity Amount</div>
      <div class="calc-res-val v-indigo">${fmtMoney(maturity)}</div>
      <div class="calc-res-sub">After ${tenure}</div>
    </div>
  `;
}

// ── Regular DPS ──────────────────────────────────────────────
function calcDPS() {
  const PMT = parseFloat(document.getElementById("dps-amount").value) || 0;
  const r = parseFloat(document.getElementById("dps-rate").value) || 0;
  const yr = parseInt(document.getElementById("dps-years").value) || 0;
  if (PMT <= 0 || r <= 0 || yr <= 0) return;

  const mr = r / 100 / 12;
  const n = yr * 12;
  const maturity = PMT * ((Math.pow(1 + mr, n) - 1) / mr);
  const deposited = PMT * n;

  buildResultStrip(
    "dps-result",
    deposited,
    maturity - deposited,
    maturity,
    `${fmtMoney(PMT)}/mo × ${n} months`,
    `After ${yr} year${yr > 1 ? "s" : ""}`,
  );
}

// ── Kisti Variable DPS ───────────────────────────────────────
// Schedule: installment increases ৳1,000 every 6 months
// Months 1–6: ৳1,000 | 7–12: ৳2,000 | ... | 31–36: ৳6,000
// Formula: each payment's future value = PMT × (1 + mr)^(remaining months)
function calcKistiDPS() {
  const r = parseFloat(document.getElementById("kisti-rate").value) || 0;
  if (r <= 0) return;

  const mr = r / 100 / 12;
  const totalMonths = 36;

  // Build month-by-month schedule
  const schedule = [];
  for (let m = 1; m <= totalMonths; m++) {
    const phase = Math.ceil(m / 6); // 1–6
    const pmt = phase * 1000; // ৳1k, ৳2k, ... ৳6k
    schedule.push(pmt);
  }

  // FV = sum of each PMT × (1 + mr)^(months remaining after payment)
  let maturity = 0;
  let totalDeposit = 0;
  schedule.forEach((pmt, idx) => {
    const monthsRemaining = totalMonths - (idx + 1); // 35 down to 0
    maturity += pmt * Math.pow(1 + mr, monthsRemaining);
    totalDeposit += pmt;
  });

  const interest = maturity - totalDeposit;

  buildResultStrip(
    "kisti-result",
    totalDeposit,
    interest,
    maturity,
    "৳1k→৳6k/mo over 36 months",
    "After 3 years",
  );
}

// Auto-run on load
document.addEventListener("DOMContentLoaded", () => {
  calcFDR();
  calcDPS();
  calcKistiDPS();
});
