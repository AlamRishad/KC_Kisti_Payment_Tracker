let paymentData = [];

fetch("./paymentData.json")
  .then((res) => res.json())
  .then((data) => {
    paymentData = data;
    const yearFilter = document.getElementById("yearFilter");
    const monthFilter = document.getElementById("monthFilter");
    const tableContainer = document.getElementById("tableContainer");
    const nameFilter = document.getElementById("nameFilter");

    let barChart, pieChart;

    // Populate years
    paymentData.forEach((y) => {
      yearFilter.innerHTML += `<option value="${y.year}">${y.year}</option>`;
    });
    function renderPersonYearlySummary(year) {
      const yearData = paymentData.find((y) => y.year == year);
      const personMap = {};

      yearData.months.forEach((month) => {
        month.payments.forEach((p) => {
          if (!personMap[p.name]) {
            personMap[p.name] = { paid: 0, due: 0 };
          }
          if (p.paid) personMap[p.name].paid += p.amount;
          else personMap[p.name].due += p.amount;
        });
      });

      let html = `
    <h2>Person-wise Yearly Summary (${year})</h2>
    <table class="summary-table">
      <tr>
        <th>Name</th>
        <th>Total Paid</th>
        <th>Total Due</th>
        <th>Total</th>
        <th>Paid %</th>
      </tr>
  `;

      Object.keys(personMap).forEach((name) => {
        const paid = personMap[name].paid;
        const due = personMap[name].due;
        const total = paid + due;
        const paidPct = total ? ((paid / total) * 100).toFixed(1) : 0;

        html += `
      <tr>
        <td class="clickable" onclick="showPersonDetails('${name}', ${year})">
          ${name}
        </td>
        <td class="summary-paid">${paid}</td>
        <td class="summary-due">${due}</td>
        <td>${total}</td>
        <td>${paidPct}%</td>
      </tr>
    `;
      });

      html += `</table>`;
      document.getElementById("personSummary").innerHTML = html;

      // clear old detail
      document.getElementById("personDetails").innerHTML = "";
    }

    function populateMonths(year) {
      monthFilter.innerHTML = `<option value="all">All Months</option>`;
      const yearData = paymentData.find((y) => y.year == year);
      yearData.months.forEach((m) => {
        monthFilter.innerHTML += `<option value="${m.month}">${m.month}</option>`;
      });
    }
    function populateNames(year, month) {
      nameFilter.innerHTML = `<option value="all">All Names</option>`;

      const yearData = paymentData.find((y) => y.year == year);

      const months = yearData.months.filter(
        (m) => month === "all" || m.month === month,
      );

      const namesSet = new Set();

      months.forEach((m) => {
        m.payments.forEach((p) => namesSet.add(p.name));
      });

      namesSet.forEach((name) => {
        nameFilter.innerHTML += `<option value="${name}">${name}</option>`;
      });
    }
    function showPersonDetails(name, year) {
      const yearData = paymentData.find((y) => y.year == year);

      let html = `
    <h3>Monthly Breakdown: ${name} (${year})</h3>
    <table>
      <tr>
        <th>Month</th>
        <th>Amount</th>
        <th>Status</th>
      </tr>
  `;

      yearData.months.forEach((month) => {
        const payment = month.payments.find((p) => p.name === name);

        if (payment) {
          html += `
        <tr>
          <td>${month.month}</td>
          <td>${payment.amount}</td>
          <td class="${payment.paid ? "detail-paid" : "detail-due"}">
            ${payment.paid ? "Paid" : "Not Paid"}
          </td>
        </tr>
      `;
        }
      });

      html += `</table>`;
      document.getElementById("personDetails").innerHTML = html;

      // scroll to details (UX 🔥)
      document.getElementById("personDetails").scrollIntoView({
        behavior: "smooth",
      });
    }

    function render(year, month, name) {
      tableContainer.innerHTML = "";
      let totalPaid = 0;
      let totalDue = 0;

      const yearData = paymentData.find((y) => y.year == year);

      yearData.months
        .filter((m) => month === "all" || m.month === month)
        .forEach((m) => {
          let html = `
        <h2>${m.month} (${year})</h2>
        <table>
          <tr>
            <th>Name</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
      `;

          m.payments
            .filter((p) => name === "all" || p.name === name)
            .forEach((p) => {
              if (p.paid) totalPaid += p.amount;
              else totalDue += p.amount;

              html += `
            <tr>
              <td>${p.name}</td>
              <td>${p.amount}</td>
              <td class="${p.paid ? "paid" : "unpaid"}">
                ${p.paid ? "Paid" : "Not Paid"}
              </td>
            </tr>
          `;
            });

          html += `</table>`;
          tableContainer.innerHTML += html;
        });

      updateCharts(totalPaid, totalDue);
    }

    function updateCharts(paid, due) {
      if (barChart) barChart.destroy();
      if (pieChart) pieChart.destroy();

      barChart = new Chart(barChartEl, {
        type: "bar",
        data: {
          labels: ["Paid", "Due"],
          datasets: [
            {
              label: "Amount (Tk)",
              data: [paid, due],
              backgroundColor: ["#22c55e", "#ef4444"],
            },
          ],
        },
      });

      pieChart = new Chart(pieChartEl, {
        type: "pie",
        data: {
          labels: ["Paid", "Due"],
          datasets: [
            {
              data: [paid, due],
              backgroundColor: ["#22c55e", "#ef4444"],
            },
          ],
        },
      });
    }

    const barChartEl = document.getElementById("barChart");
    const pieChartEl = document.getElementById("pieChart");

    yearFilter.addEventListener("change", (e) => {
      const year = e.target.value;
      populateMonths(year);
      populateNames(year, "all");
      render(year, "all", "all");
      renderPersonYearlySummary(year);
    });

    monthFilter.addEventListener("change", (e) => {
      populateNames(yearFilter.value, e.target.value);
      render(yearFilter.value, e.target.value, "all");
    });

    nameFilter.addEventListener("change", (e) => {
      render(yearFilter.value, monthFilter.value, e.target.value);
    });

    // Initial load
    yearFilter.value = paymentData[0].year;
    populateMonths(paymentData[0].year);
    populateNames(paymentData[0].year, "all");
    renderPersonYearlySummary(paymentData[0].year);

    render(paymentData[0].year, "all", "all");
  });
