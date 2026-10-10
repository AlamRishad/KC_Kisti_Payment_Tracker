let paymentData = [];
let auditLogs = [];
let barChart = null;
let pieChart = null;
let currentTheme = localStorage.getItem("theme") || "dark";
let db = null;
let lastFetchedAt = null;
let lastModifiedAt = null;
let isSubmitting = false;

// 🔐 Admin & Role-Based Access Control
const ADMIN_PASSWORD = "admin123"; // Change this default password as desired
let currentRole = sessionStorage.getItem("kisti_user_role") || "member";
let activeNavTab = sessionStorage.getItem("kisti_active_tab") || "overview";

// 🎛️ Shared Filter State
const filterState = {
  year: null,
  month: "all",
  name: "all",
  status: "all",
  search: "",
};

// 🗓️ Calendar Months Constants
const CALENDAR_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Initialize Firebase Firestore
try {
  if (
    typeof firebase !== "undefined" &&
    typeof firebaseConfig !== "undefined" &&
    firebaseConfig.apiKey
  ) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    console.log("Firebase Firestore initialized! 🚀");
  }
} catch (err) {
  console.warn("Firebase initialization notice:", err);
}

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  applyTheme(currentTheme);
  initRoleSystem();
  initModalEvents();
  initNavigationTabs();
  initCalculators();
  initDataStore();
});

// ── Timezone & Currency Helpers ─────────────────────────────────

// Return current date YYYY-MM-DD in Asia/Dhaka
function getDhakaDateString(dateObj = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dateObj);
  } catch (e) {
    return dateObj.toISOString().split("T")[0];
  }
}

// Return human formatted time in Asia/Dhaka
function getDhakaTimeString(dateObj = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(dateObj);
  } catch (e) {
    return dateObj.toLocaleTimeString();
  }
}

// Return compact time without seconds in Asia/Dhaka (e.g. "9:25 PM")
function getDhakaShortTime(dateObj = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Dhaka",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(dateObj);
  } catch (e) {
    return dateObj.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
}

// Consistent Currency Formatting in BDT (৳)
function fmtBDT(amount) {
  const num = Math.round(Number(amount) || 0);
  return "৳" + num.toLocaleString("en-IN");
}

// Consistent Percentage Formatting
function fmtPct(rate) {
  const num = Number(rate) || 0;
  return num.toFixed(1) + "%";
}

// ── Data Normalization & Backward Compatibility ─────────────────
// Ensures legacy records without paymentsList or paidAmount behave consistently
function normalizePaymentRecord(payment, monthDueDate = null) {
  const expected = Number(payment.amount) || 1000;
  let paidAmount = 0;

  if (Array.isArray(payment.paymentsList) && payment.paymentsList.length > 0) {
    paidAmount = payment.paymentsList.reduce(
      (sum, pmt) => sum + (Number(pmt.amount) || 0),
      0,
    );
  } else if (payment.paidAmount !== undefined && payment.paidAmount !== null) {
    paidAmount = Number(payment.paidAmount) || 0;
  } else {
    // Legacy record compatibility: paid boolean defines amount
    paidAmount = payment.paid ? expected : 0;
  }

  const balance = expected - paidAmount;
  let status = "unpaid";
  let daysOverdue = 0;

  if (paidAmount >= expected) {
    status = paidAmount > expected ? "overpaid" : "paid";
  } else if (paidAmount > 0) {
    status = "partially_paid";
  } else {
    // Unpaid - check if overdue
    if (monthDueDate) {
      const todayDhaka = getDhakaDateString();
      if (todayDhaka > monthDueDate) {
        status = "overdue";
        const msPerDay = 1000 * 60 * 60 * 24;
        const diffMs = new Date(todayDhaka) - new Date(monthDueDate);
        daysOverdue = Math.max(1, Math.floor(diffMs / msPerDay));
      } else {
        status = "unpaid";
      }
    } else {
      status = "unpaid";
    }
  }

  return {
    ...payment,
    expectedAmount: expected,
    paidAmount: paidAmount,
    balance: balance,
    status: status,
    daysOverdue: daysOverdue,
    paid: paidAmount >= expected, // Keep boolean in sync
  };
}

// ── Database Status & Sync Management ───────────────────────────

function updateDbStatusBadge(status, customText) {
  const badge = document.getElementById("dbStatusBadge");
  const textEl = document.getElementById("dbStatusText");
  const retryBtn = document.getElementById("dbRetryBtn");
  if (!badge || !textEl) return;

  badge.className = `db-status-badge ${status}`;
  if (customText) {
    textEl.textContent = customText;
  } else if (status === "online") {
    textEl.textContent = "Live Cloud DB";
  } else if (status === "syncing") {
    textEl.textContent = "Syncing...";
  } else if (status === "connecting") {
    textEl.textContent = "Connecting...";
  } else if (status === "offline") {
    textEl.textContent = "Local Mode";
  } else if (status === "error") {
    textEl.textContent = "Connection Error";
  }

  if (retryBtn) {
    if (status === "offline" || status === "error") {
      retryBtn.classList.remove("hidden");
    } else {
      retryBtn.classList.add("hidden");
    }
  }

  // Sync to Mobile Menu
  const mobileDbText = document.getElementById("mobileMenuDbText");
  const mobileRetryBtn = document.getElementById("mobileMenuRetryBtn");
  if (mobileDbText) {
    if (customText) {
      mobileDbText.textContent = customText;
    } else if (status === "online") {
      mobileDbText.textContent = "Live Cloud DB";
    } else if (status === "syncing") {
      mobileDbText.textContent = "Syncing...";
    } else if (status === "connecting") {
      mobileDbText.textContent = "Connecting...";
    } else if (status === "offline") {
      mobileDbText.textContent = "Local Mode";
    } else if (status === "error") {
      mobileDbText.textContent = "Connection Error";
    }
  }
  if (mobileRetryBtn) {
    if (status === "offline" || status === "error") {
      mobileRetryBtn.classList.remove("hidden");
    } else {
      mobileRetryBtn.classList.add("hidden");
    }
  }

  updateSyncMetadataDisplay();
}

function updateSyncMetadataDisplay() {
  const updatedMeta = document.getElementById("lastUpdatedMeta");
  const syncedMeta = document.getElementById("lastSyncedMeta");
  const mobileModifiedText = document.getElementById("mobileMenuModifiedText");
  const mobileSyncedText = document.getElementById("mobileMenuSyncedText");

  if (updatedMeta) {
    if (lastModifiedAt) {
      const dt = new Date(lastModifiedAt);
      updatedMeta.innerHTML = `<i class="fas fa-database" aria-hidden="true"></i> Modified: ${getDhakaShortTime(dt)} BD time`;
      if (mobileModifiedText) mobileModifiedText.textContent = `${getDhakaShortTime(dt)} BD time`;
    } else {
      updatedMeta.innerHTML = `<i class="fas fa-database" aria-hidden="true"></i> Baseline data`;
      if (mobileModifiedText) mobileModifiedText.textContent = "Baseline data";
    }
  }

  if (syncedMeta) {
    if (lastFetchedAt) {
      const dt = new Date(lastFetchedAt);
      syncedMeta.innerHTML = `<i class="fas fa-clock" aria-hidden="true"></i> Synced: ${getDhakaShortTime(dt)} BD time`;
      if (mobileSyncedText) mobileSyncedText.textContent = `${getDhakaShortTime(dt)} BD time`;
    } else {
      syncedMeta.innerHTML = `<i class="fas fa-clock" aria-hidden="true"></i> Local Storage`;
      if (mobileSyncedText) mobileSyncedText.textContent = "Local Storage";
    }
  }
}

// Live Firestore Realtime Sync + Seeding
function initDataStore() {
  // Load local audit logs
  try {
    const cachedAudit = localStorage.getItem("kisti_audit_logs");
    if (cachedAudit) auditLogs = JSON.parse(cachedAudit);
  } catch (e) {
    console.warn("Failed to parse cached audit logs:", e);
  }

  if (db) {
    updateDbStatusBadge("connecting");
    const docRef = db.collection("kisti").doc("payments");

    docRef.onSnapshot(
      async (docSnap) => {
        lastFetchedAt = new Date().toISOString();
        if (
          docSnap.exists &&
          docSnap.data().records &&
          docSnap.data().records.length > 0
        ) {
          paymentData = docSnap.data().records;
          lastModifiedAt = docSnap.data().lastUpdated || lastFetchedAt;
          localStorage.setItem(
            "kisti_payment_data",
            JSON.stringify(paymentData),
          );

          // Fetch audit logs if available
          try {
            const auditSnap = await db.collection("kisti").doc("audit").get();
            if (auditSnap.exists && Array.isArray(auditSnap.data().logs)) {
              auditLogs = auditSnap.data().logs;
              localStorage.setItem("kisti_audit_logs", JSON.stringify(auditLogs));
            }
          } catch (auditErr) {
            console.warn("Notice: Audit log fetch:", auditErr);
          }

          initDashboard();
          updateDbStatusBadge("online");
        } else {
          // Empty database: Seed with current paymentData.json
          console.log("Database empty. Seeding initial data from paymentData.json...");
          updateDbStatusBadge("syncing", "Seeding DB...");
          try {
            const res = await fetch("./paymentData.json");
            const initialData = await res.json();
            paymentData = initialData;
            lastModifiedAt = new Date().toISOString();
            await docRef.set({
              records: initialData,
              lastUpdated: lastModifiedAt,
            });
            localStorage.setItem(
              "kisti_payment_data",
              JSON.stringify(initialData),
            );
            initDashboard();
            updateDbStatusBadge("online");
            showToast("Live Database initialized with your payment data! 🚀");
          } catch (seedErr) {
            console.error("Failed to seed initial data:", seedErr);
            loadOfflineData();
          }
        }
      },
      (err) => {
        console.error("Firestore real-time error:", err);
        updateDbStatusBadge("offline", "Local Mode");
        showToast("Database connection offline. Using local data.", "warning");
        loadOfflineData();
      },
    );
  } else {
    updateDbStatusBadge("offline", "Local Mode");
    loadOfflineData();
  }
}

function loadOfflineData() {
  const cachedData = localStorage.getItem("kisti_payment_data");
  lastFetchedAt = new Date().toISOString();

  if (cachedData) {
    try {
      paymentData = JSON.parse(cachedData);
      initDashboard();
      updateSyncMetadataDisplay();
      return;
    } catch (err) {
      console.warn("Corrupt cached data, reloading from file:", err);
      localStorage.removeItem("kisti_payment_data");
    }
  }

  fetch("./paymentData.json")
    .then((res) => res.json())
    .then((data) => {
      paymentData = data;
      initDashboard();
      updateSyncMetadataDisplay();
    })
    .catch((err) => {
      console.error("Failed to load data:", err);
      showToast("Notice: Could not load data file. Initializing empty view.", "warning");
      paymentData = [];
      initDashboard();
      updateSyncMetadataDisplay();
    });
}

function retryDbConnection() {
  showToast("Re-attempting database connection... 🔄", "info");
  updateDbStatusBadge("connecting");
  initDataStore();
}

// Sync updates to cloud database
async function savePaymentDataToStore() {
  localStorage.setItem("kisti_payment_data", JSON.stringify(paymentData));
  lastModifiedAt = new Date().toISOString();
  updateSyncMetadataDisplay();

  if (db) {
    try {
      updateDbStatusBadge("syncing");
      await db.collection("kisti").doc("payments").set({
        records: paymentData,
        lastUpdated: lastModifiedAt,
      });

      // Save audit logs to cloud
      if (auditLogs && auditLogs.length > 0) {
        await db.collection("kisti").doc("audit").set({
          logs: auditLogs,
          lastUpdated: lastModifiedAt,
        });
      }

      updateDbStatusBadge("online");
    } catch (err) {
      console.error("Failed to sync to Firestore:", err);
      updateDbStatusBadge("offline", "Saved Locally");
      showToast("Cloud sync failed. Saved to local storage.", "warning");
    }
  }
}

// 🛡️ Audit Logger
async function logAuditAction(action, target, details, prevValue = "N/A", newValue = "N/A") {
  const entry = {
    id: "log_" + Date.now(),
    timestamp: getDhakaDateString() + " " + getDhakaTimeString().split(" ")[1],
    isoDate: new Date().toISOString(),
    action: action,
    target: target,
    actor: "Shared Admin Session",
    details: details,
    prevValue: prevValue,
    newValue: newValue,
  };

  auditLogs.unshift(entry);
  if (auditLogs.length > 100) auditLogs.pop(); // Keep latest 100 logs
  localStorage.setItem("kisti_audit_logs", JSON.stringify(auditLogs));

  renderAuditHistoryTable();
}

// ── Navigation & Tabs ───────────────────────────────────────────

function initNavigationTabs() {
  switchNavTab(activeNavTab, false);
}

function switchNavTab(tabName, isUserAction = false) {
  activeNavTab = tabName;
  sessionStorage.setItem("kisti_active_tab", tabName);

  document.querySelectorAll(".nav-tab").forEach((tab) => {
    const isActive = tab.dataset.tab === tabName || tab.id === "tab-" + tabName;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  const paneMap = {
    overview: "sec-overview",
    members: "sec-members",
    reports: "sec-reports",
    calculator: "sec-calculator",
  };

  Object.keys(paneMap).forEach((key) => {
    const pane = document.getElementById(paneMap[key]);
    if (pane) {
      const isCurrent = key === tabName;
      pane.classList.toggle("hidden", !isCurrent);
      pane.setAttribute("aria-hidden", String(!isCurrent));
    }
  });

  // Tab-specific controls visibility:
  // Calculator tab does not show payment/member filters or collection-summary banner
  const mobileFilterBar = document.getElementById("mobileFilterBar");
  const scopeBanner = document.getElementById("scopeBanner");
  if (mobileFilterBar) {
    if (tabName === "calculator") {
      mobileFilterBar.style.display = "none";
    } else {
      mobileFilterBar.style.display = "";
    }
  }
  if (scopeBanner) {
    if (tabName === "calculator") {
      scopeBanner.style.display = "none";
    } else {
      scopeBanner.style.display = "";
    }
  }

  // On explicit user tab change, scroll to the top of the selected tab
  if (isUserAction) {
    const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }

  // Re-trigger layout refreshes on tab activation
  if (tabName === "reports") {
    setTimeout(() => {
      applyFilters();
    }, 50);
  } else if (tabName === "overview" || tabName === "members") {
    applyFilters();
  }
}

// 📱 Mobile UI Handlers: Filter Sheet, Drawer Menu & Navigation Helpers
let lastFocusedBeforeFilterSheet = null;
let lastFocusedBeforeMenu = null;

function openMobileFilterSheet() {
  const wrapper = document.getElementById("filterSheetWrapper");
  const triggerBtn = document.getElementById("mobileFilterTriggerBtn");
  if (!wrapper) return;

  lastFocusedBeforeFilterSheet = document.activeElement;
  wrapper.classList.add("open");
  wrapper.setAttribute("aria-hidden", "false");
  if (triggerBtn) triggerBtn.setAttribute("aria-expanded", "true");

  document.body.style.overflow = "hidden";

  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    setTimeout(() => searchInput.focus(), 80);
  }
}

function closeMobileFilterSheet() {
  const wrapper = document.getElementById("filterSheetWrapper");
  const triggerBtn = document.getElementById("mobileFilterTriggerBtn");
  if (!wrapper) return;

  wrapper.classList.remove("open");
  wrapper.setAttribute("aria-hidden", "true");
  if (triggerBtn) triggerBtn.setAttribute("aria-expanded", "false");

  document.body.style.overflow = "";

  if (lastFocusedBeforeFilterSheet && typeof lastFocusedBeforeFilterSheet.focus === "function") {
    lastFocusedBeforeFilterSheet.focus();
  }
}

function applyAndCloseMobileFilters() {
  applyFilters();
  closeMobileFilterSheet();
}

function updateMobileFilterSummary() {
  const badge = document.getElementById("mobileFilterActiveBadge");
  const summaryText = document.getElementById("mobileFilterSummaryText");
  const resetBtn = document.getElementById("mobileFilterResetBtn");

  const yearFilter = document.getElementById("yearFilter");
  const monthFilter = document.getElementById("monthFilter");
  const nameFilter = document.getElementById("nameFilter");
  const statusFilter = document.getElementById("statusFilter");
  const searchInput = document.getElementById("searchInput");

  let activeCount = 0;
  const parts = [];

  const yVal = yearFilter ? yearFilter.value : "2026";
  const mVal = monthFilter ? monthFilter.value : "all";
  const nVal = nameFilter ? nameFilter.value : "all";
  const sVal = statusFilter ? statusFilter.value : "all";
  const qVal = searchInput ? searchInput.value.trim() : "";

  if (mVal !== "all") {
    activeCount++;
    parts.push(mVal);
  } else {
    parts.push(`All ${yVal}`);
  }

  if (nVal !== "all") {
    activeCount++;
    parts.push(nVal);
  }

  if (sVal !== "all") {
    activeCount++;
    const statusLabels = {
      paid: "Paid",
      partial: "Partially Paid",
      due: "Pending",
      overdue: "Overdue",
    };
    parts.push(statusLabels[sVal] || sVal);
  }

  if (qVal) {
    activeCount++;
    parts.push(`"${qVal}"`);
  }

  if (badge) {
    badge.textContent = activeCount;
    badge.classList.toggle("hidden", activeCount === 0);
  }

  if (resetBtn) {
    resetBtn.classList.toggle("hidden", activeCount === 0);
  }

  if (summaryText) {
    if (activeCount === 0) {
      summaryText.textContent = `All ${yVal} · All Months`;
    } else {
      summaryText.textContent = parts.join(" · ");
    }
  }
}

function openMobileMenu() {
  const sheet = document.getElementById("mobileMenuSheet");
  const triggerBtn = document.getElementById("mobileMenuBtn");
  if (!sheet) return;

  lastFocusedBeforeMenu = document.activeElement;
  sheet.classList.remove("hidden");
  if (triggerBtn) triggerBtn.setAttribute("aria-expanded", "true");

  document.body.style.overflow = "hidden";

  updateMenuAppearanceState();
  updateSyncMetadataDisplay();

  const mobileRoleBadge = document.getElementById("mobileMenuRoleBadge");
  const mobileAuthBtn = document.getElementById("mobileMenuAuthBtn");
  const mobileAuthBtnText = document.getElementById("mobileMenuAuthBtnText");
  if (mobileRoleBadge) {
    if (currentRole === "admin") {
      mobileRoleBadge.className = "role-badge admin";
      mobileRoleBadge.innerHTML = '<i class="fas fa-shield-alt" aria-hidden="true"></i> <span>Admin Mode</span>';
    } else {
      mobileRoleBadge.className = "role-badge member";
      mobileRoleBadge.innerHTML = '<i class="fas fa-eye" aria-hidden="true"></i> <span>Member (View Only)</span>';
    }
  }
  if (mobileAuthBtn && mobileAuthBtnText) {
    if (currentRole === "admin") {
      mobileAuthBtnText.textContent = "Logout";
      const icon = mobileAuthBtn.querySelector("i");
      if (icon) icon.className = "fas fa-sign-out-alt";
    } else {
      mobileAuthBtnText.textContent = "Admin Login";
      const icon = mobileAuthBtn.querySelector("i");
      if (icon) icon.className = "fas fa-lock";
    }
  }
}

function closeMobileMenu() {
  const sheet = document.getElementById("mobileMenuSheet");
  const triggerBtn = document.getElementById("mobileMenuBtn");
  if (!sheet) return;

  sheet.classList.add("hidden");
  if (triggerBtn) triggerBtn.setAttribute("aria-expanded", "false");

  document.body.style.overflow = "";

  if (lastFocusedBeforeMenu && typeof lastFocusedBeforeMenu.focus === "function") {
    lastFocusedBeforeMenu.focus();
  }
}

function updateMenuAppearanceState() {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  const icon = document.getElementById("mobileMenuThemeIcon");
  const text = document.getElementById("mobileMenuThemeText");
  if (icon) icon.className = isLight ? "fas fa-sun" : "fas fa-moon";
  if (text) text.textContent = isLight ? "Light Mode (Tap to switch)" : "Dark Mode (Tap to switch)";
}

function toggleThemeFromMenu() {
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.click();
  }
  updateMenuAppearanceState();
}

function handleAuthSwitchFromMenu() {
  closeMobileMenu();
  handleAuthSwitchClick();
}

function openPaymentAccountFromMenu() {
  closeMobileMenu();
  switchNavTab("overview", true);
  const detailsEl = document.getElementById("mobileBankDetails");
  if (detailsEl) {
    detailsEl.open = true;
    setTimeout(() => {
      detailsEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  }
}

// ── Modal Events ────────────────────────────────────────────────

function initModalEvents() {
  const addModal = document.getElementById("addModal");
  const newMonthModal = document.getElementById("newMonthModal");
  const roleAuthModal = document.getElementById("roleAuthModal");
  const pmtDetailModal = document.getElementById("paymentDetailModal");
  const editDueDateModal = document.getElementById("editDueDateModal");
  const filterSheetWrapper = document.getElementById("filterSheetWrapper");
  const mobileMenuSheet = document.getElementById("mobileMenuSheet");

  window.addEventListener("click", (e) => {
    if (e.target === addModal) closeModal();
    if (e.target === newMonthModal) closeNewMonthModal();
    if (e.target === roleAuthModal) closeAuthModal();
    if (e.target === pmtDetailModal) closePaymentDetailModal();
    if (e.target === editDueDateModal) closeEditDueDateModal();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (addModal && !addModal.classList.contains("hidden")) closeModal();
      if (newMonthModal && !newMonthModal.classList.contains("hidden"))
        closeNewMonthModal();
      if (roleAuthModal && !roleAuthModal.classList.contains("hidden"))
        closeAuthModal();
      if (pmtDetailModal && !pmtDetailModal.classList.contains("hidden"))
        closePaymentDetailModal();
      if (editDueDateModal && !editDueDateModal.classList.contains("hidden"))
        closeEditDueDateModal();
      if (filterSheetWrapper && filterSheetWrapper.classList.contains("open"))
        closeMobileFilterSheet();
      if (mobileMenuSheet && !mobileMenuSheet.classList.contains("hidden"))
        closeMobileMenu();
    }
  });
}

// 🔐 Role System Functions
function initRoleSystem() {
  updateRoleUI();

  const hasPrompted = sessionStorage.getItem("kisti_role_prompted");
  if (!hasPrompted && !sessionStorage.getItem("kisti_user_role")) {
    openAuthModal();
  }
}

function updateRoleUI() {
  document.body.dataset.role = currentRole;
  const badge = document.getElementById("roleBadge");
  const authSwitchBtn = document.getElementById("authSwitchBtn");
  const authSwitchBtnText = document.getElementById("authSwitchBtnText");

  const mobileRoleBadge = document.getElementById("mobileMenuRoleBadge");
  const mobileAuthBtn = document.getElementById("mobileMenuAuthBtn");
  const mobileAuthBtnText = document.getElementById("mobileMenuAuthBtnText");

  if (badge) {
    if (currentRole === "admin") {
      badge.className = "role-badge admin";
      badge.innerHTML = '<i class="fas fa-shield-alt" aria-hidden="true"></i> <span>Admin Mode</span>';
    } else {
      badge.className = "role-badge member";
      badge.innerHTML = '<i class="fas fa-eye" aria-hidden="true"></i> <span>Member (View Only)</span>';
    }
  }

  if (mobileRoleBadge) {
    if (currentRole === "admin") {
      mobileRoleBadge.className = "role-badge admin";
      mobileRoleBadge.innerHTML = '<i class="fas fa-shield-alt" aria-hidden="true"></i> <span>Admin Mode</span>';
    } else {
      mobileRoleBadge.className = "role-badge member";
      mobileRoleBadge.innerHTML = '<i class="fas fa-eye" aria-hidden="true"></i> <span>Member (View Only)</span>';
    }
  }

  if (authSwitchBtn && authSwitchBtnText) {
    if (currentRole === "admin") {
      authSwitchBtnText.textContent = "Logout";
      const icon = authSwitchBtn.querySelector("i");
      if (icon) icon.className = "fas fa-sign-out-alt";
      authSwitchBtn.title = "Logout from Admin mode";
    } else {
      authSwitchBtnText.textContent = "Admin Login";
      const icon = authSwitchBtn.querySelector("i");
      if (icon) icon.className = "fas fa-lock";
      authSwitchBtn.title = "Login as Admin to edit data";
    }
  }

  if (mobileAuthBtn && mobileAuthBtnText) {
    if (currentRole === "admin") {
      mobileAuthBtnText.textContent = "Logout";
      const icon = mobileAuthBtn.querySelector("i");
      if (icon) icon.className = "fas fa-sign-out-alt";
    } else {
      mobileAuthBtnText.textContent = "Admin Login";
      const icon = mobileAuthBtn.querySelector("i");
      if (icon) icon.className = "fas fa-lock";
    }
  }

  if (paymentData && paymentData.length > 0) {
    applyFilters();
  }
}

function openAuthModal() {
  const modal = document.getElementById("roleAuthModal");
  const errEl = document.getElementById("adminLoginError");
  const passInput = document.getElementById("adminPasswordInput");
  if (errEl) errEl.classList.add("hidden");
  if (passInput) passInput.value = "";
  if (modal) modal.classList.remove("hidden");
}

function closeAuthModal() {
  const modal = document.getElementById("roleAuthModal");
  if (modal) modal.classList.add("hidden");
}

function enterAsMember() {
  currentRole = "member";
  sessionStorage.setItem("kisti_user_role", "member");
  sessionStorage.setItem("kisti_role_prompted", "true");
  updateRoleUI();
  closeAuthModal();
  showToast("Entered as General Member (View-Only mode) 👁️");
}

function handleAdminLogin(e) {
  if (e) e.preventDefault();
  const passInput = document.getElementById("adminPasswordInput");
  const errEl = document.getElementById("adminLoginError");
  const password = passInput ? passInput.value.trim() : "";

  if (password === ADMIN_PASSWORD) {
    currentRole = "admin";
    sessionStorage.setItem("kisti_user_role", "admin");
    sessionStorage.setItem("kisti_role_prompted", "true");
    updateRoleUI();
    closeAuthModal();
    showToast("Logged in as Admin! Full edit access unlocked 🛡️");
  } else {
    if (errEl) errEl.classList.remove("hidden");
    if (passInput) {
      passInput.focus();
      passInput.select();
    }
  }
}

function logoutRole() {
  currentRole = "member";
  sessionStorage.setItem("kisti_user_role", "member");
  updateRoleUI();
  showToast("Logged out of Admin. Switched to Member view 👁️");
}

function handleAuthSwitchClick() {
  if (currentRole === "admin") {
    logoutRole();
  } else {
    openAuthModal();
  }
}

// ── Dashboard & Shared Filters ──────────────────────────────────

function initDashboard() {
  const yearFilter = document.getElementById("yearFilter");
  const monthFilter = document.getElementById("monthFilter");
  const nameFilter = document.getElementById("nameFilter");
  const statusFilter = document.getElementById("statusFilter");
  const searchInput = document.getElementById("searchInput");

  if (!paymentData || paymentData.length === 0) {
    renderEmptyState("No payment records found. Please add a month or connect database.");
    return;
  }

  // Populate years
  yearFilter.innerHTML = "";
  paymentData.forEach((y) => {
    yearFilter.innerHTML += `<option value="${y.year}">${y.year}</option>`;
  });

  // Theme Toggle listener
  const themeToggleBtn = document.getElementById("themeToggle");
  if (themeToggleBtn) {
    themeToggleBtn.onclick = toggleTheme;
  }

  // Filter Event Listeners
  yearFilter.onchange = () => {
    populateMonths(yearFilter.value);
    populateNames(yearFilter.value, monthFilter.value);
    populateModalFields(yearFilter.value);
    applyFilters();
  };

  monthFilter.onchange = () => {
    populateNames(yearFilter.value, monthFilter.value);
    applyFilters();
  };

  nameFilter.onchange = () => {
    applyFilters();
  };

  if (statusFilter) {
    statusFilter.onchange = () => {
      applyFilters();
    };
  }

  if (searchInput) {
    searchInput.oninput = () => {
      applyFilters();
    };
  }

  // Forms
  const addForm = document.getElementById("addForm");
  if (addForm) addForm.onsubmit = handleAddPayment;

  const newMonthForm = document.getElementById("newMonthForm");
  if (newMonthForm) newMonthForm.onsubmit = handleCreateNewMonth;

  // Set initial selected values
  const firstYear = paymentData[0].year;
  yearFilter.value = firstYear;
  populateMonths(firstYear);
  populateNames(firstYear, "all");
  populateModalFields(firstYear);

  applyFilters();
}

function populateMonths(year) {
  const monthFilter = document.getElementById("monthFilter");
  if (!monthFilter) return;
  const currentVal = monthFilter.value;
  monthFilter.innerHTML = `<option value="all">All Months</option>`;

  const yearData = paymentData.find((y) => y.year == year);
  if (yearData && yearData.months) {
    yearData.months.forEach((m) => {
      monthFilter.innerHTML += `<option value="${m.month}">${m.month}</option>`;
    });
  }

  if (yearData && yearData.months.some((m) => m.month === currentVal)) {
    monthFilter.value = currentVal;
  } else {
    monthFilter.value = "all";
  }
}

function populateNames(year, month) {
  const nameFilter = document.getElementById("nameFilter");
  if (!nameFilter) return;
  const currentVal = nameFilter.value;
  nameFilter.innerHTML = `<option value="all">All Members</option>`;

  const yearData = paymentData.find((y) => y.year == year);
  if (!yearData) return;

  const months = yearData.months.filter(
    (m) => month === "all" || m.month === month,
  );
  const namesSet = new Set(
    months.flatMap((m) => m.payments.map((p) => p.name)),
  );

  Array.from(namesSet).sort().forEach((name) => {
    nameFilter.innerHTML += `<option value="${name}">${name}</option>`;
  });

  if (namesSet.has(currentVal)) {
    nameFilter.value = currentVal;
  } else {
    nameFilter.value = "all";
  }
}

// 🎛️ Shared Filter Engine
function applyFilters() {
  const yearFilter = document.getElementById("yearFilter");
  const monthFilter = document.getElementById("monthFilter");
  const nameFilter = document.getElementById("nameFilter");
  const statusFilter = document.getElementById("statusFilter");
  const searchInput = document.getElementById("searchInput");

  if (!paymentData || paymentData.length === 0) {
    renderEmptyState("Database is empty or offline.");
    return;
  }

  const selectedYear = parseInt(yearFilter ? yearFilter.value : paymentData[0].year) || paymentData[0].year;
  const selectedMonth = monthFilter ? monthFilter.value : "all";
  const selectedName = nameFilter ? nameFilter.value : "all";
  const selectedStatus = statusFilter ? statusFilter.value : "all";
  const searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : "";

  // Update shared filter state
  filterState.year = selectedYear;
  filterState.month = selectedMonth;
  filterState.name = selectedName;
  filterState.status = selectedStatus;
  filterState.search = searchQuery;

  // Retrieve Year Record
  const yearData = paymentData.find((y) => y.year == selectedYear);
  if (!yearData) {
    renderEmptyState(`No records for year ${selectedYear}.`);
    return;
  }

  // Filter months and normalize payments
  const processedMonths = [];
  let totalMatchingPayments = 0;
  const matchingMembersSet = new Set();
  const allYearMembersSet = new Set();

  yearData.months.forEach((m) => {
    // Record all members present in the year
    m.payments.forEach((p) => allYearMembersSet.add(p.name));

    if (selectedMonth !== "all" && m.month !== selectedMonth) return;

    const normalizedPayments = m.payments.map((p) =>
      normalizePaymentRecord(p, m.dueDate),
    );

    const filteredPayments = normalizedPayments.filter((p) => {
      // Member filter
      if (selectedName !== "all" && p.name !== selectedName) return false;

      // Search filter
      if (searchQuery && !p.name.toLowerCase().includes(searchQuery)) return false;

      // Status filter
      if (selectedStatus !== "all") {
        if (selectedStatus === "paid" && p.status !== "paid" && p.status !== "overpaid") return false;
        if (selectedStatus === "partial" && p.status !== "partially_paid") return false;
        if (selectedStatus === "due" && p.status !== "unpaid") return false;
        if (selectedStatus === "overdue" && p.status !== "overdue") return false;
      }

      return true;
    });

    filteredPayments.forEach((p) => matchingMembersSet.add(p.name));
    totalMatchingPayments += filteredPayments.length;

    processedMonths.push({
      ...m,
      normalizedPayments: filteredPayments,
      allNormalizedPayments: normalizedPayments, // For full month context
    });
  });

  // Update Scope Labels
  updateScopeLabels(selectedYear, selectedMonth, selectedName, selectedStatus, searchQuery, matchingMembersSet.size, allYearMembersSet.size);
  updateMobileFilterSummary();

  // Update All Views with Shared Filter Scope
  updateStats(processedMonths, matchingMembersSet.size, allYearMembersSet.size);
  updateProgress(processedMonths);
  checkDueAlerts(processedMonths);
  render(processedMonths, selectedYear);
  renderPersonSummary(processedMonths, selectedYear, selectedName, searchQuery);
  updateAnalyticsCharts(processedMonths, selectedYear);
  renderTabularReport(processedMonths, selectedYear);
  renderAuditHistoryTable();
}

function updateScopeLabels(year, month, name, status, search, matchingCount, totalCount) {
  const scopeTextEl = document.getElementById("filterScopeText");
  const matchingBadge = document.getElementById("matchingMembersBadge");
  const accordionScopeLabel = document.getElementById("accordionScopeLabel");
  const memberScopeLabel = document.getElementById("memberSummaryScopeLabel");
  const progressScopeLabel = document.getElementById("progressScopeText");

  const parts = [];
  parts.push(year);
  parts.push(month === "all" ? "All Months" : month);
  parts.push(name === "all" ? "All Members" : name);
  if (status !== "all") parts.push(`Status: ${status.replace("_", " ").toUpperCase()}`);
  if (search) parts.push(`Search: "${search}"`);

  const scopeString = parts.join(" · ");
  if (scopeTextEl) scopeTextEl.textContent = scopeString;

  if (matchingBadge) {
    if (name !== "all" || search || status !== "all" || month !== "all") {
      matchingBadge.textContent = `Matching: ${matchingCount} of ${totalCount} Members`;
    } else {
      matchingBadge.textContent = `Active: ${totalCount} Members`;
    }
  }

  if (accordionScopeLabel) accordionScopeLabel.textContent = scopeString;
  if (memberScopeLabel) memberScopeLabel.textContent = scopeString;
  if (progressScopeLabel) progressScopeLabel.textContent = `(${scopeString})`;
}

function clearAllFilters() {
  const monthFilter = document.getElementById("monthFilter");
  const nameFilter = document.getElementById("nameFilter");
  const statusFilter = document.getElementById("statusFilter");
  const searchInput = document.getElementById("searchInput");

  if (monthFilter) monthFilter.value = "all";
  if (nameFilter) nameFilter.value = "all";
  if (statusFilter) statusFilter.value = "all";
  if (searchInput) searchInput.value = "";

  const yearFilter = document.getElementById("yearFilter");
  if (yearFilter) {
    populateMonths(yearFilter.value);
    populateNames(yearFilter.value, "all");
  }

  applyFilters();
  showToast("All filters reset to default 🔄");
}

function renderEmptyState(message) {
  const statsGrid = document.getElementById("statsGrid");
  const tableContainer = document.getElementById("tableContainer");
  const personSummary = document.getElementById("personSummary");

  if (statsGrid) {
    statsGrid.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">Status</span>
        <span class="stat-value" style="font-size: 18px;">No Data</span>
        <span class="stat-sub">${message}</span>
      </div>
    `;
  }
  if (tableContainer) {
    tableContainer.innerHTML = `<div class="empty">${message} <button class="btn-clear-filters" style="margin: 10px auto;" onclick="clearAllFilters()">Reset Filters</button></div>`;
  }
  if (personSummary) {
    personSummary.innerHTML = `<div class="empty">${message}</div>`;
  }
}

// ── Overview Section Renders ────────────────────────────────────

// 📊 Stats Cards (Consistent across shared filter state)
function updateStats(processedMonths, matchingMembersCount, totalActiveMembersCount) {
  let totalExpected = 0;
  let totalPaid = 0;
  let totalDue = 0;
  let totalOverdue = 0;

  processedMonths.forEach((m) => {
    m.normalizedPayments.forEach((p) => {
      totalExpected += p.expectedAmount;
      totalPaid += p.paidAmount;
      if (p.balance > 0) {
        totalDue += p.balance;
        if (p.status === "overdue") {
          totalOverdue += p.balance;
        }
      }
    });
  });

  const rate = totalExpected > 0 ? ((totalPaid / totalExpected) * 100).toFixed(1) : "0.0";
  const statsGrid = document.getElementById("statsGrid");
  if (!statsGrid) return;

  const isFiltered =
    filterState.month !== "all" ||
    filterState.name !== "all" ||
    filterState.status !== "all" ||
    Boolean(filterState.search);

  const memberLabel = isFiltered ? "Matching Members" : "Active Members";
  const memberSub = isFiltered
    ? `${matchingMembersCount} of ${totalActiveMembersCount} total`
    : "Registered Active";

  statsGrid.innerHTML = `
    <div class="stat-card highlight">
      <span class="stat-label">Total Collected</span>
      <span class="stat-value paid">${fmtBDT(totalPaid)}</span>
      <span class="stat-sub">of ${fmtBDT(totalExpected)} Target</span>
    </div>
    <div class="stat-card warning">
      <span class="stat-label">Outstanding Balance</span>
      <span class="stat-value due">${fmtBDT(totalDue)}</span>
      <span class="stat-sub">${totalOverdue > 0 ? `🚨 ${fmtBDT(totalOverdue)} Overdue` : totalDue > 0 ? "Pending collection" : "All clear!"}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">${memberLabel}</span>
      <span class="stat-value">${matchingMembersCount}</span>
      <span class="stat-sub">${memberSub}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Collection Rate</span>
      <span class="stat-value">${rate}%</span>
      <span class="stat-sub">${parseFloat(rate) >= 90 ? "🎯 Excellent" : parseFloat(rate) >= 60 ? "📈 In Progress" : "⚠️ Needs Attention"}</span>
    </div>
  `;
}

// 📈 Progress Bar
function updateProgress(processedMonths) {
  let totalPaid = 0;
  let totalExpected = 0;

  processedMonths.forEach((m) => {
    m.normalizedPayments.forEach((p) => {
      totalExpected += p.expectedAmount;
      totalPaid += p.paidAmount;
    });
  });

  const percent = totalExpected > 0 ? Math.round((totalPaid / totalExpected) * 100) : 0;
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");

  if (progressFill) progressFill.style.width = `${Math.min(100, percent)}%`;
  if (progressText) progressText.textContent = `${percent}%`;
}

// 🔔 Due & Overdue Alerts
function checkDueAlerts(processedMonths) {
  const alertBox = document.getElementById("dueAlerts");
  if (!alertBox) return;

  const dueList = [];
  const overdueList = [];

  processedMonths.forEach((m) => {
    m.normalizedPayments.forEach((p) => {
      if (p.balance > 0) {
        if (p.status === "overdue") {
          overdueList.push({
            name: p.name,
            month: m.month,
            balance: p.balance,
            days: p.daysOverdue,
          });
        } else {
          dueList.push({
            name: p.name,
            month: m.month,
            balance: p.balance,
          });
        }
      }
    });
  });

  if (overdueList.length > 0 || dueList.length > 0) {
    alertBox.classList.remove("hidden");
    let content = `<h4><i class="fas fa-exclamation-triangle"></i> Pending & Overdue Balances</h4><div class="due-list">`;

    overdueList.forEach((item) => {
      content += `<span class="due-badge" style="background: var(--red-dim); border-color: rgba(255,87,87,0.35); color: var(--red);" onclick="openPaymentDetailModal(${filterState.year}, '${item.month}', '${item.name}')">🚨 ${item.name} · ${item.month} (${fmtBDT(item.balance)} · ${item.days}d overdue)</span>`;
    });

    dueList.forEach((item) => {
      content += `<span class="due-badge" onclick="openPaymentDetailModal(${filterState.year}, '${item.month}', '${item.name}')">⏳ ${item.name} · ${item.month} (${fmtBDT(item.balance)})</span>`;
    });

    content += `</div>`;
    alertBox.innerHTML = content;
  } else {
    alertBox.classList.add("hidden");
  }
}

// 🎨 Render Accordion View (Overview Tab)
function render(processedMonths, year) {
  const tableContainer = document.getElementById("tableContainer");
  if (!tableContainer) return;
  tableContainer.innerHTML = "";

  const monthsWithRecords = processedMonths.filter(
    (m) => m.normalizedPayments.length > 0,
  );

  if (monthsWithRecords.length === 0) {
    tableContainer.innerHTML = `<div class="empty">No installment records match current criteria. <br><button class="btn-clear-filters" style="margin-top: 10px;" onclick="clearAllFilters()">Reset Filters</button></div>`;
    return;
  }

  const accordion = document.createElement("div");
  accordion.className = "accordion";

  monthsWithRecords.forEach((m, idx) => {
    let mExpected = 0;
    let mPaid = 0;
    let mDue = 0;

    m.normalizedPayments.forEach((p) => {
      mExpected += p.expectedAmount;
      mPaid += p.paidAmount;
      mDue += Math.max(0, p.balance);
    });

    const isOpen = idx === 0;

    // Due date display for month
    let dueDateBadge = "";
    if (m.dueDate) {
      const todayDhaka = getDhakaDateString();
      const isPast = todayDhaka > m.dueDate && mDue > 0;
      dueDateBadge = `<span class="month-due-badge ${isPast ? "is-overdue" : ""}" title="Due date: ${m.dueDate} in Asia/Dhaka"><i class="fas fa-calendar-day"></i> Due: ${m.dueDate}</span>`;
    }

    const rows = m.normalizedPayments
      .map((p) => {
        let statusBadge = "";
        if (p.status === "paid" || p.status === "overpaid") {
          statusBadge = `<span class="badge-paid" title="Paid in Full: ${fmtBDT(p.paidAmount)}"><i class="fas fa-check-circle" style="font-size:9px"></i> Paid</span>`;
        } else if (p.status === "partially_paid") {
          statusBadge = `<span class="badge-partial" title="Paid: ${fmtBDT(p.paidAmount)} | Balance: ${fmtBDT(p.balance)}"><i class="fas fa-adjust" style="font-size:9px"></i> Partial (${fmtBDT(p.paidAmount)})</span>`;
        } else if (p.status === "overdue") {
          statusBadge = `<span class="badge-overdue" title="Overdue by ${p.daysOverdue} days! Remaining: ${fmtBDT(p.balance)}"><i class="fas fa-exclamation-circle" style="font-size:9px"></i> Overdue (${p.daysOverdue}d)</span>`;
        } else {
          statusBadge = `<span class="badge-due" title="Unpaid balance: ${fmtBDT(p.balance)}"><i class="fas fa-clock" style="font-size:9px"></i> Pending</span>`;
        }

        return `
          <tr>
            <td>
              <strong>${p.name}</strong>
              ${p.balance < 0 ? `<small style="color:var(--green); display:block;">Overpaid: ${fmtBDT(Math.abs(p.balance))}</small>` : ""}
            </td>
            <td style="font-variant-numeric:tabular-nums">${fmtBDT(p.expectedAmount)}</td>
            <td style="font-variant-numeric:tabular-nums; color:${p.paidAmount > 0 ? "var(--green)" : "var(--text-3)"};">${fmtBDT(p.paidAmount)}</td>
            <td style="font-variant-numeric:tabular-nums; color:${p.balance > 0 ? "var(--red)" : "var(--text-3)"};">${p.balance > 0 ? fmtBDT(p.balance) : "৳0"}</td>
            <td>
              <div style="display:flex; align-items:center; gap:8px;">
                <div onclick="openPaymentDetailModal(${year}, '${m.month}', '${p.name}')" style="cursor:pointer;" title="View payment details & history">
                  ${statusBadge}
                </div>
                ${currentRole === "admin" ? `
                  <button class="btn-icon" style="padding:3px 7px; font-size:11px;" onclick="togglePaymentStatus('${m.month}', '${p.name}', ${year})" title="Quick Toggle Status" aria-label="Toggle status for ${p.name}">
                    <i class="fas fa-sync-alt"></i>
                  </button>
                ` : ""}
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    const item = document.createElement("div");
    item.className = `acc-item${isOpen ? " is-open" : ""}`;
    item.innerHTML = `
      <div class="acc-trigger" role="button" tabindex="0" aria-expanded="${isOpen}">
        <span class="acc-month-label">
          ${m.month} <span style="font-weight:400;color:var(--text-3);font-size:12px">${year}</span>
          ${dueDateBadge}
          ${currentRole === "admin" ? `<button class="btn-icon" style="padding:2px 6px; font-size:10px; margin-left:6px;" onclick="event.stopPropagation(); openEditDueDateModal(${year}, '${m.month}')" title="Configure due date"><i class="fas fa-edit"></i> Due Date</button>` : ""}
        </span>
        <div class="acc-meta">
          ${mPaid > 0 ? `<span class="acc-chip chip-paid">${fmtBDT(mPaid)} collected</span>` : ""}
          ${mDue > 0 ? `<span class="acc-chip chip-due">${fmtBDT(mDue)} pending</span>` : ""}
          <span class="acc-chevron"><i class="fas fa-chevron-down"></i></span>
        </div>
      </div>
      <div class="acc-body">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Target</th>
                <th>Paid</th>
                <th>Remaining</th>
                <th>Status & Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Accessible toggle handler
    const trigger = item.querySelector(".acc-trigger");
    const toggleItem = () => {
      const open = item.classList.toggle("is-open");
      trigger.setAttribute("aria-expanded", String(open));
    };

    trigger.addEventListener("click", toggleItem);
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleItem();
      }
    });

    accordion.appendChild(item);
  });

  tableContainer.appendChild(accordion);
}

// ⚡ Quick toggle payment status on click (Admin Only)
async function togglePaymentStatus(month, name, year) {
  if (currentRole !== "admin") {
    showToast("Admin access required to modify payment status! 🔒", "warning");
    return;
  }

  const yearData = paymentData.find((y) => y.year == year);
  if (!yearData) return;

  const monthData = yearData.months.find((m) => m.month === month);
  if (!monthData) return;

  const payment = monthData.payments.find((p) => p.name === name);
  if (!payment) return;

  const prevStatus = payment.paid ? "Paid" : "Pending";
  const newStatus = !payment.paid ? "Paid" : "Pending";

  payment.paid = !payment.paid;
  if (payment.paid) {
    payment.paidAmount = payment.amount;
    payment.balance = 0;
    payment.paymentsList = payment.paymentsList || [];
    payment.paymentsList.push({
      id: "pmt_" + Date.now(),
      amount: payment.amount,
      date: getDhakaDateString(),
      method: "Quick Status Toggle",
      reference: "AUTO-TOGGLE",
      receiptRef: "",
      verified: true,
      verifiedBy: "Shared Admin Session",
      notes: "Quick toggle marked as Paid",
    });
  } else {
    payment.paidAmount = 0;
    payment.balance = payment.amount;
  }

  await logAuditAction(
    "QUICK_TOGGLE",
    `${name} · ${month} ${year}`,
    `Status changed from ${prevStatus} to ${newStatus}`,
    prevStatus,
    newStatus,
  );

  await savePaymentDataToStore();
  showToast(`${name}'s payment for ${month} marked as ${newStatus} ✅`);
  applyFilters();
}

// ── Members Section Renders ─────────────────────────────────────

// Render Member Summary Cards (Filtered Scope Aware)
function renderPersonSummary(processedMonths, year, selectedName, searchQuery) {
  const summaryContainer = document.getElementById("personSummary");
  if (!summaryContainer) return;

  const personMap = {};

  processedMonths.forEach((m) => {
    m.normalizedPayments.forEach((p) => {
      if (!personMap[p.name]) {
        personMap[p.name] = {
          name: p.name,
          expected: 0,
          paid: 0,
          due: 0,
          overdue: 0,
          monthsCount: 0,
        };
      }
      personMap[p.name].expected += p.expectedAmount;
      personMap[p.name].paid += p.paidAmount;
      personMap[p.name].due += Math.max(0, p.balance);
      if (p.status === "overdue") {
        personMap[p.name].overdue += p.balance;
      }
      personMap[p.name].monthsCount += 1;
    });
  });

  const memberNames = Object.keys(personMap).sort();

  if (memberNames.length === 0) {
    summaryContainer.innerHTML = `<div class="empty">No matching members found for current filter.</div>`;
    return;
  }

  const cards = memberNames.map((name) => {
    const data = personMap[name];
    const pct = data.expected > 0 ? Math.round((data.paid / data.expected) * 100) : 0;
    const initials = name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    return `
      <div class="person-card" role="button" tabindex="0" onclick="showPersonDetails('${name}', ${year})" aria-label="View member statement for ${name}">
        <div class="person-card-header">
          <div class="person-avatar" aria-hidden="true">${initials}</div>
          <div>
            <div class="person-name">${name}</div>
            <div class="person-role">Member · ${data.monthsCount} cycle${data.monthsCount !== 1 ? "s" : ""}</div>
          </div>
        </div>
 
        <div class="person-stats">
          <div class="person-stat">
            <div class="person-stat-label">Collected</div>
            <div class="person-stat-val is-paid">${fmtBDT(data.paid)}</div>
          </div>
          <div class="person-stat">
            <div class="person-stat-label">Pending</div>
            <div class="person-stat-val ${data.due > 0 ? "is-due" : "is-paid"}">${fmtBDT(data.due)}</div>
          </div>
        </div>
 
        <div class="person-bar-wrap">
          <div class="person-bar-fill" style="width:${Math.min(100, pct)}%"></div>
        </div>
        <div class="person-bar-footer">
          <span>Scope rate</span>
          <span class="pct">${pct}%</span>
        </div>
      </div>
    `;
  });

  summaryContainer.innerHTML = cards.join("");
}

// Detailed Individual Member Statement Viewer
function showPersonDetails(name, year) {
  const detailsContainer = document.getElementById("personDetails");
  if (!detailsContainer) return;

  const yearData = paymentData.find((y) => y.year == year);
  if (!yearData) return;

  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  let totalExpected = 0;
  let totalPaid = 0;
  let totalDue = 0;
  let totalOverdue = 0;

  const memberHistory = [];

  yearData.months.forEach((m) => {
    const rawPmt = m.payments.find((p) => p.name === name);
    if (rawPmt) {
      const p = normalizePaymentRecord(rawPmt, m.dueDate);
      totalExpected += p.expectedAmount;
      totalPaid += p.paidAmount;
      totalDue += Math.max(0, p.balance);
      if (p.status === "overdue") totalOverdue += p.balance;

      memberHistory.push({
        month: m.month,
        dueDate: m.dueDate || "Not recorded",
        ...p,
      });
    }
  });

  const rate = totalExpected > 0 ? ((totalPaid / totalExpected) * 100).toFixed(1) : "0.0";

  const rows = memberHistory
    .map((h) => {
      let statusBadge = "";
      if (h.status === "paid" || h.status === "overpaid") {
        statusBadge = `<span class="badge-paid">Paid ✅</span>`;
      } else if (h.status === "partially_paid") {
        statusBadge = `<span class="badge-partial">Partial ⚠️</span>`;
      } else if (h.status === "overdue") {
        statusBadge = `<span class="badge-overdue">Overdue (${h.daysOverdue}d) 🚨</span>`;
      } else {
        statusBadge = `<span class="badge-due">Pending ⏳</span>`;
      }

      const pmtList = h.paymentsList || [];
      const paymentDate = pmtList.length > 0 ? pmtList[pmtList.length - 1].date : h.paid ? "Legacy Paid" : "Not recorded";
      const paymentMethod = pmtList.length > 0 ? pmtList[pmtList.length - 1].method : h.paid ? "Not recorded" : "—";

      return `
        <tr>
          <td><strong>${h.month} ${year}</strong></td>
          <td>${h.dueDate}</td>
          <td>${fmtBDT(h.expectedAmount)}</td>
          <td style="color:var(--green); font-weight:600;">${fmtBDT(h.paidAmount)}</td>
          <td style="color:${h.balance > 0 ? "var(--red)" : "var(--text-3)"}; font-weight:600;">${fmtBDT(h.balance)}</td>
          <td>${statusBadge}</td>
          <td>${paymentDate} · ${paymentMethod}</td>
          <td>
            <button class="btn-icon" style="padding:3px 8px; font-size:11px;" onclick="openPaymentDetailModal(${year}, '${h.month}', '${name}')">
              <i class="fas fa-search-plus"></i> View
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  const html = `
    <div class="person-detail-panel" style="margin-top: 24px;">
      <div class="person-detail-header">
        <div class="person-detail-title">
          <div class="person-avatar" aria-hidden="true">${initials}</div>
          <div>
            <div class="person-detail-name">${name}</div>
            <div class="person-detail-sub">Individual Member Statement · ${year}</div>
          </div>
        </div>
        <div class="person-detail-kpis">
          <div class="person-kpi">
            <div class="person-kpi-label">Target</div>
            <div class="person-kpi-val">${fmtBDT(totalExpected)}</div>
          </div>
          <div class="person-kpi">
            <div class="person-kpi-label">Paid</div>
            <div class="person-kpi-val kpi-paid">${fmtBDT(totalPaid)}</div>
          </div>
          <div class="person-kpi">
            <div class="person-kpi-label">Balance</div>
            <div class="person-kpi-val ${totalDue > 0 ? "kpi-due" : "kpi-paid"}">${fmtBDT(totalDue)}</div>
          </div>
          <div class="person-kpi">
            <div class="person-kpi-label">Rate</div>
            <div class="person-kpi-val kpi-total">${rate}%</div>
          </div>
          <button class="person-detail-close" onclick="closePersonDetails()" title="Close details" aria-label="Close member details">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <div class="reports-header-bar" style="margin: 16px 0 10px;">
        <span style="font-size:12px; font-weight:700; color:var(--text-2); text-transform:uppercase;">Cycle Payment Breakdown</span>
        <div class="reports-export-btns">
          <button class="btn-export" style="padding:6px 12px; font-size:11px;" onclick="exportToCSV('${name}')">
            <i class="fas fa-file-csv"></i> Export Member CSV
          </button>
          <button class="btn-print" style="padding:6px 12px; font-size:11px;" onclick="window.print()">
            <i class="fas fa-print"></i> Print Statement
          </button>
        </div>
      </div>

      <div class="tabular-report-wrap">
        <table class="tabular-report-table">
          <thead>
            <tr>
              <th>Cycle</th>
              <th>Due Date</th>
              <th>Expected</th>
              <th>Paid</th>
              <th>Remaining</th>
              <th>Status</th>
              <th>Payment Info</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;

  detailsContainer.innerHTML = html;
  detailsContainer.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closePersonDetails() {
  const detailsContainer = document.getElementById("personDetails");
  if (detailsContainer) detailsContainer.innerHTML = "";
}

// ── Payment Detail & Partial Payment Modal ──────────────────────

function openPaymentDetailModal(year, monthName, memberName) {
  const modal = document.getElementById("paymentDetailModal");
  const body = document.getElementById("pmtDetailBody");
  if (!modal || !body) return;

  const yearData = paymentData.find((y) => y.year == year);
  if (!yearData) return;

  const monthData = yearData.months.find((m) => m.month === monthName);
  if (!monthData) return;

  const rawPmt = monthData.payments.find((p) => p.name === memberName);
  if (!rawPmt) return;

  const p = normalizePaymentRecord(rawPmt, monthData.dueDate);
  const pmtList = p.paymentsList || [];

  let statusBadge = "";
  if (p.status === "paid" || p.status === "overpaid") {
    statusBadge = `<span class="badge-paid">Paid in Full ✅</span>`;
  } else if (p.status === "partially_paid") {
    statusBadge = `<span class="badge-partial">Partially Paid ⚠️</span>`;
  } else if (p.status === "overdue") {
    statusBadge = `<span class="badge-overdue">Overdue (${p.daysOverdue} days) 🚨</span>`;
  } else {
    statusBadge = `<span class="badge-due">Pending ⏳</span>`;
  }

  // Transaction history table
  let historyRows = "";
  if (pmtList.length > 0) {
    historyRows = pmtList
      .map(
        (t, idx) => `
      <tr>
        <td>#${idx + 1}</td>
        <td>${t.date || "Not recorded"}</td>
        <td style="color:var(--green); font-weight:700;">${fmtBDT(t.amount)}</td>
        <td>${t.method || "Not recorded"}</td>
        <td>${t.reference || "Not recorded"}</td>
        <td>${t.receiptRef || "Not recorded"}</td>
        <td>${t.verified ? `<span style="color:var(--green);">Verified ✅</span> (${t.verifiedBy || "Admin"})` : '<span style="color:var(--text-3);">Unverified</span>'}</td>
        <td>${t.notes || "—"}</td>
      </tr>
    `,
      )
      .join("");
  } else if (p.paid) {
    historyRows = `
      <tr>
        <td>#1</td>
        <td>Legacy Record</td>
        <td style="color:var(--green); font-weight:700;">${fmtBDT(p.expectedAmount)}</td>
        <td>Not recorded</td>
        <td>Not recorded</td>
        <td>Not recorded</td>
        <td>Verified by Baseline</td>
        <td>Legacy full installment record</td>
      </tr>
    `;
  } else {
    historyRows = `<tr><td colspan="8" style="text-align:center; color:var(--text-3); padding:16px;">No payments recorded yet for this installment.</td></tr>`;
  }

  // Admin Partial Payment Form
  let adminRecordForm = "";
  if (currentRole === "admin") {
    const defaultPayAmount = Math.max(0, p.balance) || 1000;
    adminRecordForm = `
      <div class="pmt-record-form">
        <h4><i class="fas fa-plus-circle"></i> Record Payment / Partial Payment</h4>
        <form id="recordPaymentForm" onsubmit="handleRecordPaymentSubmit(event, ${year}, '${monthName}', '${memberName}')">
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:10px;">
            <div class="form-group">
              <label for="partialAmountInput">Amount to Pay (৳)</label>
              <input type="number" id="partialAmountInput" value="${defaultPayAmount}" min="1" step="10" required />
            </div>
            <div class="form-group">
              <label for="partialDateInput">Payment Date</label>
              <input type="date" id="partialDateInput" value="${getDhakaDateString()}" required />
            </div>
            <div class="form-group">
              <label for="partialMethodInput">Method</label>
              <select id="partialMethodInput">
                <option value="Bank Transfer">Bank Transfer (IBBL)</option>
                <option value="bKash">bKash</option>
                <option value="Nagad">Nagad</option>
                <option value="Cash">Cash</option>
                <option value="Rocket">Rocket</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="form-group">
              <label for="partialRefInput">Transaction / Ref #</label>
              <input type="text" id="partialRefInput" placeholder="e.g. TXN12345" />
            </div>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:8px;">
            <div class="form-group">
              <label for="partialReceiptInput">Receipt ID / Memo Ref</label>
              <input type="text" id="partialReceiptInput" placeholder="e.g. REC-2026-09" />
            </div>
            <div class="form-group">
              <label for="partialNotesInput">Notes / Comment</label>
              <input type="text" id="partialNotesInput" placeholder="Optional notes" />
            </div>
          </div>
          <div class="form-group checkbox" style="margin: 10px 0;">
            <label><input type="checkbox" id="partialVerifyCheck" checked /> Mark as Verified (Verified by Shared Admin Session)</label>
          </div>
          <button type="submit" class="btn-submit" id="btnSubmitPayment">
            <i class="fas fa-save"></i> Save Payment Record
          </button>
        </form>
      </div>
    `;
  }

  body.innerHTML = `
    <div class="pmt-kpis-grid">
      <div class="pmt-kpi-card">
        <span class="kpi-label">Member & Cycle</span>
        <span class="kpi-val" style="font-size:15px;">${memberName}</span>
        <span class="stat-sub">${monthName} ${year}</span>
      </div>
      <div class="pmt-kpi-card">
        <span class="kpi-label">Expected Installment</span>
        <span class="kpi-val">${fmtBDT(p.expectedAmount)}</span>
        <span class="stat-sub">${monthData.dueDate ? `Due: ${monthData.dueDate}` : "Due date not set"}</span>
      </div>
      <div class="pmt-kpi-card">
        <span class="kpi-label">Paid So Far</span>
        <span class="kpi-val is-paid">${fmtBDT(p.paidAmount)}</span>
        <span class="stat-sub">${pmtList.length} transaction${pmtList.length !== 1 ? "s" : ""}</span>
      </div>
      <div class="pmt-kpi-card">
        <span class="kpi-label">Remaining Balance</span>
        <span class="kpi-val ${p.balance > 0 ? (p.status === "overdue" ? "is-overdue" : "is-due") : "is-paid"}">${fmtBDT(Math.max(0, p.balance))}</span>
        <span class="stat-sub">${p.balance < 0 ? `Overpaid by ${fmtBDT(Math.abs(p.balance))}` : p.status === "overdue" ? `🚨 ${p.daysOverdue}d Overdue` : statusBadge}</span>
      </div>
    </div>

    <div class="pmt-history-section">
      <h4><i class="fas fa-history"></i> Payment History & Audit Records</h4>
      <div class="tabular-report-wrap" style="margin-bottom:0;">
        <table class="pmt-history-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Method</th>
              <th>Reference #</th>
              <th>Receipt</th>
              <th>Verification</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${historyRows}
          </tbody>
        </table>
      </div>
    </div>

    ${adminRecordForm}
  `;

  modal.classList.remove("hidden");
}

function closePaymentDetailModal() {
  const modal = document.getElementById("paymentDetailModal");
  if (modal) modal.classList.add("hidden");
}

async function handleRecordPaymentSubmit(e, year, monthName, memberName) {
  e.preventDefault();
  if (currentRole !== "admin") {
    showToast("Admin access required! 🔒", "error");
    return;
  }

  if (isSubmitting) return;

  const amountInput = document.getElementById("partialAmountInput");
  const dateInput = document.getElementById("partialDateInput");
  const methodInput = document.getElementById("partialMethodInput");
  const refInput = document.getElementById("partialRefInput");
  const receiptInput = document.getElementById("partialReceiptInput");
  const notesInput = document.getElementById("partialNotesInput");
  const verifyCheck = document.getElementById("partialVerifyCheck");
  const btnSubmit = document.getElementById("btnSubmitPayment");

  const amount = parseFloat(amountInput.value);
  if (!amount || amount <= 0 || !isFinite(amount)) {
    showToast("Please enter a valid positive payment amount!", "error");
    return;
  }

  const payDate = dateInput.value || getDhakaDateString();
  const payMethod = methodInput.value || "Cash";
  const payRef = refInput.value.trim() || "N/A";
  const payReceipt = receiptInput.value.trim() || "N/A";
  const payNotes = notesInput.value.trim() || "";
  const isVerified = verifyCheck.checked;

  isSubmitting = true;
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving...`;
  }

  try {
    const yearData = paymentData.find((y) => y.year == year);
    const monthData = yearData.months.find((m) => m.month === monthName);
    const payment = monthData.payments.find((p) => p.name === memberName);

    if (!payment.paymentsList) {
      payment.paymentsList = [];
      if (payment.paid && payment.paidAmount > 0) {
        // preserve legacy base payment
        payment.paymentsList.push({
          id: "pmt_legacy",
          amount: payment.paidAmount,
          date: "Legacy Recorded",
          method: "Legacy Method",
          reference: "LEGACY",
          receiptRef: "",
          verified: true,
          verifiedBy: "Baseline",
          notes: "Preserved historical payment",
        });
      }
    }

    const prevPaid = payment.paidAmount || (payment.paid ? payment.amount : 0);

    const newPmt = {
      id: "pmt_" + Date.now(),
      amount: amount,
      date: payDate,
      method: payMethod,
      reference: payRef,
      receiptRef: payReceipt,
      verified: isVerified,
      verifiedBy: isVerified ? "Shared Admin Session" : "Unverified",
      notes: payNotes,
    };

    payment.paymentsList.push(newPmt);

    // Recalculate totals
    const totalPaid = payment.paymentsList.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    payment.paidAmount = totalPaid;
    payment.balance = payment.amount - totalPaid;
    payment.paid = totalPaid >= payment.amount;

    await logAuditAction(
      "RECORD_PAYMENT",
      `${memberName} · ${monthName} ${year}`,
      `Recorded ${fmtBDT(amount)} via ${payMethod}. Reference: ${payRef}.`,
      `Paid: ${fmtBDT(prevPaid)}`,
      `Paid: ${fmtBDT(totalPaid)} (Balance: ${fmtBDT(payment.balance)})`,
    );

    await savePaymentDataToStore();
    showToast(`Payment of ${fmtBDT(amount)} recorded for ${memberName}! ✅`);
    closePaymentDetailModal();
    applyFilters();
  } catch (err) {
    console.error("Failed to record payment:", err);
    showToast("Error saving payment: " + err.message, "error");
  } finally {
    isSubmitting = false;
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `<i class="fas fa-save"></i> Save Payment Record`;
    }
  }
}

// ── Cycle Due Date Management ───────────────────────────────────

function openEditDueDateModal(year, monthName) {
  if (currentRole !== "admin") {
    showToast("Admin access required! 🔒", "warning");
    return;
  }

  const modal = document.getElementById("editDueDateModal");
  const yearInput = document.getElementById("dueDateTargetYear");
  const monthInput = document.getElementById("dueDateTargetMonth");
  const textInput = document.getElementById("dueDateCycleText");
  const dateInput = document.getElementById("dueDateInput");

  if (!modal) return;

  const yearData = paymentData.find((y) => y.year == year);
  if (!yearData) return;
  const monthData = yearData.months.find((m) => m.month === monthName);
  if (!monthData) return;

  yearInput.value = year;
  monthInput.value = monthName;
  textInput.value = `${monthName} ${year}`;
  dateInput.value = monthData.dueDate || "";

  modal.classList.remove("hidden");
}

function closeEditDueDateModal() {
  const modal = document.getElementById("editDueDateModal");
  if (modal) modal.classList.add("hidden");
}

async function handleSaveDueDate(e) {
  e.preventDefault();
  if (currentRole !== "admin") return;

  const year = parseInt(document.getElementById("dueDateTargetYear").value);
  const month = document.getElementById("dueDateTargetMonth").value;
  const newDate = document.getElementById("dueDateInput").value;

  const yearData = paymentData.find((y) => y.year == year);
  if (!yearData) return;
  const monthData = yearData.months.find((m) => m.month === month);
  if (!monthData) return;

  const prevDate = monthData.dueDate || "Not set";
  monthData.dueDate = newDate;

  await logAuditAction(
    "UPDATE_DUE_DATE",
    `${month} ${year}`,
    `Cycle due date set to ${newDate} (Asia/Dhaka)`,
    prevDate,
    newDate,
  );

  await savePaymentDataToStore();
  showToast(`Due date updated for ${month} ${year} 📅`);
  closeEditDueDateModal();
  applyFilters();
}

// ── Reports & Analytics Renders ─────────────────────────────────

function updateAnalyticsCharts(processedMonths, year) {
  const pieChartEl = document.getElementById("pieChart");
  const barChartEl = document.getElementById("barChart");
  const breakdownScope = document.getElementById("chartBreakdownScope");
  const trendScope = document.getElementById("chartTrendScope");

  if (!pieChartEl || !barChartEl) return;

  if (pieChart) pieChart.destroy();
  if (barChart) barChart.destroy();

  const isDark = currentTheme === "dark";
  const textColor = isDark ? "#e2e8f0" : "#1e293b";
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";

  let countPaid = 0;
  let countPartial = 0;
  let countPending = 0;
  let countOverdue = 0;

  let sumPaid = 0;
  let sumPartial = 0;
  let sumPending = 0;
  let sumOverdue = 0;

  processedMonths.forEach((m) => {
    m.normalizedPayments.forEach((p) => {
      if (p.status === "paid" || p.status === "overpaid") {
        countPaid++;
        sumPaid += p.paidAmount;
      } else if (p.status === "partially_paid") {
        countPartial++;
        sumPartial += p.paidAmount;
        sumPending += p.balance;
      } else if (p.status === "overdue") {
        countOverdue++;
        sumOverdue += p.balance;
      } else {
        countPending++;
        sumPending += p.balance;
      }
    });
  });

  if (breakdownScope) {
    breakdownScope.textContent = `${year} · ${filterState.month === "all" ? "All Months" : filterState.month}`;
  }

  // Chart 1: Collection Distribution (Doughnut)
  pieChart = new Chart(pieChartEl, {
    type: "doughnut",
    data: {
      labels: [
        `Paid (${fmtBDT(sumPaid)})`,
        `Partial (${fmtBDT(sumPartial)})`,
        `Pending (${fmtBDT(sumPending)})`,
        `Overdue (${fmtBDT(sumOverdue)})`,
      ],
      datasets: [
        {
          data: [sumPaid, sumPartial, sumPending, sumOverdue],
          backgroundColor: isDark
            ? ["#00e5a0", "#f59e0b", "#64748b", "#ff5757"]
            : ["#059669", "#d97706", "#94a3b8", "#dc2626"],
          borderWidth: 2,
          borderColor: isDark ? "#111827" : "#ffffff",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: textColor, font: { size: 11, family: "Plus Jakarta Sans" } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ৳${Number(ctx.raw || 0).toLocaleString("en-IN")}`,
          },
        },
      },
      cutout: "68%",
    },
  });

  // Chart 2: Monthly Performance Trend across year
  const yearData = paymentData.find((y) => y.year == year);
  if (!yearData) return;

  const monthLabels = yearData.months.map((m) => m.month);
  const expectedTrend = [];
  const collectedTrend = [];
  const outstandingTrend = [];

  yearData.months.forEach((m) => {
    let exp = 0;
    let col = 0;
    let out = 0;

    m.payments.forEach((raw) => {
      // Filter by name if single member selected
      if (filterState.name !== "all" && raw.name !== filterState.name) return;
      if (filterState.search && !raw.name.toLowerCase().includes(filterState.search)) return;

      const p = normalizePaymentRecord(raw, m.dueDate);
      exp += p.expectedAmount;
      col += p.paidAmount;
      out += Math.max(0, p.balance);
    });

    expectedTrend.push(exp);
    collectedTrend.push(col);
    outstandingTrend.push(out);
  });

  if (trendScope) {
    trendScope.textContent = `Year ${year} Months Trend`;
  }

  barChart = new Chart(barChartEl, {
    type: "bar",
    data: {
      labels: monthLabels,
      datasets: [
        {
          label: "Expected Target",
          data: expectedTrend,
          backgroundColor: isDark ? "rgba(123, 124, 255, 0.4)" : "rgba(79, 70, 229, 0.25)",
          borderColor: isDark ? "#7b7cff" : "#4f46e5",
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: "Collected (Cash)",
          data: collectedTrend,
          backgroundColor: isDark ? "rgba(0, 229, 160, 0.75)" : "rgba(5, 150, 105, 0.8)",
          borderColor: isDark ? "#00e5a0" : "#059669",
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: "Outstanding / Due",
          data: outstandingTrend,
          backgroundColor: isDark ? "rgba(255, 87, 87, 0.7)" : "rgba(220, 38, 38, 0.75)",
          borderColor: isDark ? "#ff5757" : "#dc2626",
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top",
          labels: { color: textColor, font: { size: 11, family: "Plus Jakarta Sans" } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ৳${Number(ctx.raw || 0).toLocaleString("en-IN")}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: {
            color: textColor,
            callback: (val) => "৳" + Number(val).toLocaleString("en-IN"),
          },
        },
        x: {
          grid: { display: false },
          ticks: { color: textColor, font: { size: 10 } },
        },
      },
    },
  });

  // Render Accessible Tabular Alternative Table
  renderAnalyticsTable(monthLabels, expectedTrend, collectedTrend, outstandingTrend);
}

function renderAnalyticsTable(monthLabels, expectedTrend, collectedTrend, outstandingTrend) {
  const container = document.getElementById("analyticsTableContainer");
  if (!container) return;

  let totalExp = 0, totalCol = 0, totalOut = 0;

  const rows = monthLabels
    .map((m, idx) => {
      const exp = expectedTrend[idx] || 0;
      const col = collectedTrend[idx] || 0;
      const out = outstandingTrend[idx] || 0;
      const rate = exp > 0 ? ((col / exp) * 100).toFixed(1) : "0.0";

      totalExp += exp;
      totalCol += col;
      totalOut += out;

      return `
        <tr>
          <td><strong>${m}</strong></td>
          <td style="font-variant-numeric:tabular-nums">${fmtBDT(exp)}</td>
          <td style="font-variant-numeric:tabular-nums; color:var(--green);">${fmtBDT(col)}</td>
          <td style="font-variant-numeric:tabular-nums; color:${out > 0 ? "var(--red)" : "var(--text-3)"};">${fmtBDT(out)}</td>
          <td style="font-variant-numeric:tabular-nums;">${rate}%</td>
          <td>${col >= exp ? '<span class="badge-paid">Complete ✅</span>' : '<span class="badge-due">Pending ⏳</span>'}</td>
        </tr>
      `;
    })
    .join("");

  const totalRate = totalExp > 0 ? ((totalCol / totalExp) * 100).toFixed(1) : "0.0";

  container.innerHTML = `
    <table class="analytics-table">
      <thead>
        <tr>
          <th>Installment Month</th>
          <th>Expected Target</th>
          <th>Collected</th>
          <th>Outstanding</th>
          <th>Collection Rate</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
      <tfoot>
        <tr style="font-weight:700; background:var(--surface-2);">
          <td>Year Total</td>
          <td>${fmtBDT(totalExp)}</td>
          <td style="color:var(--green);">${fmtBDT(totalCol)}</td>
          <td style="color:${totalOut > 0 ? "var(--red)" : "var(--text-3)"};">${fmtBDT(totalOut)}</td>
          <td>${totalRate}%</td>
          <td>${totalCol >= totalExp ? "Target Reached" : "Active Cycles"}</td>
        </tr>
      </tfoot>
    </table>
  `;
}

function renderTabularReport(processedMonths, year) {
  const container = document.getElementById("tabularReportContainer");
  if (!container) return;

  let grandExpected = 0, grandPaid = 0, grandDue = 0;
  const flatRecords = [];

  processedMonths.forEach((m) => {
    m.normalizedPayments.forEach((p) => {
      grandExpected += p.expectedAmount;
      grandPaid += p.paidAmount;
      grandDue += Math.max(0, p.balance);

      const pmtList = p.paymentsList || [];
      const lastPayment = pmtList.length > 0 ? pmtList[pmtList.length - 1] : null;

      flatRecords.push({
        name: p.name,
        month: m.month,
        year: year,
        dueDate: m.dueDate || "Not set",
        expected: p.expectedAmount,
        paid: p.paidAmount,
        balance: p.balance,
        status: p.status,
        lastDate: lastPayment ? lastPayment.date : p.paid ? "Legacy Paid" : "—",
        method: lastPayment ? lastPayment.method : p.paid ? "Not recorded" : "—",
      });
    });
  });

  if (flatRecords.length === 0) {
    container.innerHTML = `<div class="empty">No records match the current filter criteria.</div>`;
    return;
  }

  const rows = flatRecords
    .map(
      (r) => `
      <tr>
        <td><strong>${r.name}</strong></td>
        <td>${r.month} ${r.year}</td>
        <td>${r.dueDate}</td>
        <td style="font-variant-numeric:tabular-nums">${fmtBDT(r.expected)}</td>
        <td style="font-variant-numeric:tabular-nums; color:var(--green); font-weight:600;">${fmtBDT(r.paid)}</td>
        <td style="font-variant-numeric:tabular-nums; color:${r.balance > 0 ? "var(--red)" : "var(--text-3)"};">${fmtBDT(r.balance)}</td>
        <td><span class="${r.status === "paid" || r.status === "overpaid" ? "badge-paid" : r.status === "partially_paid" ? "badge-partial" : r.status === "overdue" ? "badge-overdue" : "badge-due"}">${r.status.toUpperCase()}</span></td>
        <td>${r.lastDate} · ${r.method}</td>
      </tr>
    `,
    )
    .join("");

  container.innerHTML = `
    <table class="tabular-report-table">
      <thead>
        <tr>
          <th>Member Name</th>
          <th>Cycle</th>
          <th>Due Date</th>
          <th>Expected</th>
          <th>Paid</th>
          <th>Balance</th>
          <th>Status</th>
          <th>Payment Record</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
      <tfoot>
        <tr style="font-weight:700; background:var(--surface-2);">
          <td colspan="3">Total (${flatRecords.length} records)</td>
          <td>${fmtBDT(grandExpected)}</td>
          <td style="color:var(--green);">${fmtBDT(grandPaid)}</td>
          <td style="color:${grandDue > 0 ? "var(--red)" : "var(--text-3)"};">${fmtBDT(grandDue)}</td>
          <td colspan="2">${grandExpected > 0 ? ((grandPaid / grandExpected) * 100).toFixed(1) : "0"}% Collected</td>
        </tr>
      </tfoot>
    </table>
  `;
}

function renderAuditHistoryTable() {
  const container = document.getElementById("auditLogContainer");
  if (!container) return;

  if (!auditLogs || auditLogs.length === 0) {
    container.innerHTML = `<div class="empty" style="padding:16px;">No administrative actions recorded yet in this session.</div>`;
    return;
  }

  const rows = auditLogs
    .map(
      (log) => `
      <tr>
        <td>${log.timestamp}</td>
        <td><strong>${log.action}</strong></td>
        <td>${log.target}</td>
        <td>${log.details}</td>
        <td><span style="color:var(--text-3);">${log.prevValue}</span> → <strong>${log.newValue}</strong></td>
        <td><span class="role-badge admin" style="font-size:10px;">${log.actor}</span></td>
      </tr>
    `,
    )
    .join("");

  container.innerHTML = `
    <table class="audit-table">
      <thead>
        <tr>
          <th>Time (Asia/Dhaka)</th>
          <th>Action</th>
          <th>Target</th>
          <th>Details</th>
          <th>Changes</th>
          <th>Actor</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

// ── Export & Print Functions ────────────────────────────────────

// Safe CSV Export with UTF-8 BOM and Formula Injection Defense
function exportToCSV(targetMemberName = null) {
  const year = filterState.year || (paymentData[0] ? paymentData[0].year : 2026);
  const yearData = paymentData.find((y) => y.year == year);
  if (!yearData) {
    showToast("No data to export!", "warning");
    return;
  }

  const records = [];
  let totalExp = 0, totalPaid = 0, totalDue = 0;

  yearData.months.forEach((m) => {
    if (!targetMemberName && filterState.month !== "all" && m.month !== filterState.month) return;

    m.payments.forEach((raw) => {
      if (targetMemberName && raw.name !== targetMemberName) return;
      if (!targetMemberName && filterState.name !== "all" && raw.name !== filterState.name) return;
      if (!targetMemberName && filterState.search && !raw.name.toLowerCase().includes(filterState.search)) return;

      const p = normalizePaymentRecord(raw, m.dueDate);

      if (!targetMemberName && filterState.status !== "all") {
        if (filterState.status === "paid" && p.status !== "paid" && p.status !== "overpaid") return;
        if (filterState.status === "partial" && p.status !== "partially_paid") return;
        if (filterState.status === "due" && p.status !== "unpaid") return;
        if (filterState.status === "overdue" && p.status !== "overdue") return;
      }

      totalExp += p.expectedAmount;
      totalPaid += p.paidAmount;
      totalDue += Math.max(0, p.balance);

      const pmtList = p.paymentsList || [];
      const lastPmt = pmtList.length > 0 ? pmtList[pmtList.length - 1] : null;

      records.push({
        name: p.name,
        month: m.month,
        year: year,
        dueDate: m.dueDate || "Not set",
        expected: p.expectedAmount,
        paid: p.paidAmount,
        balance: p.balance,
        status: p.status,
        method: lastPmt ? lastPmt.method : p.paid ? "Not recorded" : "N/A",
        date: lastPmt ? lastPmt.date : p.paid ? "Legacy Paid" : "N/A",
        ref: lastPmt ? lastPmt.reference : "N/A",
      });
    });
  });

  if (records.length === 0) {
    showToast("No matching records to export!", "warning");
    return;
  }

  // Formula escape helper
  const escapeCSV = (str) => {
    let s = String(str ?? "");
    if (/^[=+@-]/.test(s)) {
      s = "'" + s;
    }
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  // Build CSV content with UTF-8 BOM
  let csv = "\uFEFF"; // Byte Order Mark for Excel Bengali & ৳ support
  csv += `# Report: Kisti Payment Tracker Statement\n`;
  csv += `# Scope: ${targetMemberName ? `Member: ${targetMemberName}` : `Year ${year} · ${filterState.month} · ${filterState.name}`}\n`;
  csv += `# Generated At: ${getDhakaDateString()} ${getDhakaTimeString()} (Asia/Dhaka)\n`;
  csv += `# Total Target: ৳${totalExp.toLocaleString("en-IN")} | Collected: ৳${totalPaid.toLocaleString("en-IN")} | Balance: ৳${totalDue.toLocaleString("en-IN")}\n\n`;

  csv += "Member Name,Cycle Month,Year,Due Date,Target Amount (BDT),Collected (BDT),Balance (BDT),Status,Payment Method,Payment Date,Reference Number\n";

  records.forEach((r) => {
    csv += [
      escapeCSV(r.name),
      escapeCSV(r.month),
      escapeCSV(r.year),
      escapeCSV(r.dueDate),
      escapeCSV(r.expected),
      escapeCSV(r.paid),
      escapeCSV(r.balance),
      escapeCSV(r.status.toUpperCase()),
      escapeCSV(r.method),
      escapeCSV(r.date),
      escapeCSV(r.ref),
    ].join(",") + "\n";
  });

  csv += `\nTotal Target,,,,"${totalExp}","${totalPaid}","${totalDue}",\n`;

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const fileName = targetMemberName
    ? `kisti-statement-${targetMemberName.toLowerCase().replace(/\s+/g, "_")}-${year}.csv`
    : `kisti-report-${year}-${filterState.month}.csv`;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast("CSV report exported safely! ✅");
}

function printFilteredReport() {
  window.print();
}

// 📋 Copy Account Number
function copyAccount() {
  const acc = "20503560301151415";
  navigator.clipboard.writeText(acc).then(() => {
    const btn = document.querySelector(".copy-btn");
    if (btn) {
      const original = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
      btn.classList.add("copied");
      setTimeout(() => {
        btn.innerHTML = original;
        btn.classList.remove("copied");
      }, 2000);
    }
    showToast("Account number copied! 📋");
  });
}

// 🔔 Toast Notification
function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  const msg = document.getElementById("toastMsg");
  if (!toast || !msg) return;

  msg.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3200);
}

// ➕ Quick Add Payment Modal Functions
function populateModalFields(year) {
  const yearData = paymentData.find((y) => y.year == year);
  if (!yearData) return;

  const existingMonths = yearData.months.map((m) => m.month);
  const months = [...new Set([...existingMonths, ...CALENDAR_MONTHS])];

  const names = [
    ...new Set(
      paymentData.flatMap((y) =>
        y.months.flatMap((m) => m.payments.map((p) => p.name)),
      ),
    ),
  ].sort();

  const nameSelect = document.getElementById("modalName");
  const monthSelect = document.getElementById("modalMonth");

  if (nameSelect) {
    nameSelect.innerHTML = names
      .map((n) => `<option value="${n}">${n}</option>`)
      .join("");
  }
  if (monthSelect) {
    monthSelect.innerHTML = months
      .map((m) => `<option value="${m}">${m}</option>`)
      .join("");
    const currentMonthFilter = document.getElementById("monthFilter")?.value;
    if (currentMonthFilter && currentMonthFilter !== "all") {
      monthSelect.value = currentMonthFilter;
    }
  }
}

function openModal() {
  if (currentRole !== "admin") {
    showToast("Admin access required to add/edit payments! 🔒", "warning");
    return;
  }
  const year = document.getElementById("yearFilter")?.value || paymentData[0]?.year;
  populateModalFields(year);
  document.getElementById("addModal")?.classList.remove("hidden");
}

function closeModal() {
  document.getElementById("addModal")?.classList.add("hidden");
}

async function handleAddPayment(e) {
  e.preventDefault();
  if (currentRole !== "admin") {
    showToast("Admin access required to save payments! 🔒", "error");
    return;
  }

  const name = document.getElementById("modalName").value;
  const month = document.getElementById("modalMonth").value;
  const amount = parseInt(document.getElementById("modalAmount").value) || 0;
  const paid = document.getElementById("modalPaid").checked;
  const year = document.getElementById("yearFilter").value;

  if (amount <= 0) {
    showToast("Amount must be greater than zero!", "error");
    return;
  }

  let yearData = paymentData.find((y) => y.year == year);
  if (!yearData) {
    yearData = { year: parseInt(year), months: [] };
    paymentData.unshift(yearData);
  }

  let monthData = yearData.months.find(
    (m) => m.month.toLowerCase() === month.toLowerCase(),
  );
  if (!monthData) {
    monthData = { month: month, payments: [] };
    yearData.months.unshift(monthData);
  }

  const existing = monthData.payments.find(
    (p) => p.name.toLowerCase() === name.toLowerCase(),
  );

  const prevVal = existing ? `Paid: ${existing.paid}, Amount: ${existing.amount}` : "New Entry";

  if (existing) {
    existing.amount = amount;
    existing.paid = paid;
    existing.paidAmount = paid ? amount : 0;
    existing.balance = paid ? 0 : amount;
  } else {
    monthData.payments.push({
      name: name,
      amount: amount,
      paid: paid,
      paidAmount: paid ? amount : 0,
      balance: paid ? 0 : amount,
      paymentsList: paid
        ? [
            {
              id: "pmt_" + Date.now(),
              amount: amount,
              date: getDhakaDateString(),
              method: "Direct Entry",
              reference: "DIRECT",
              receiptRef: "",
              verified: true,
              verifiedBy: "Shared Admin Session",
              notes: "Added via payment form",
            },
          ]
        : [],
    });
  }

  await logAuditAction(
    "ADD_PAYMENT",
    `${name} · ${month} ${year}`,
    `Recorded payment of ৳${amount} (${paid ? "Paid" : "Pending"})`,
    prevVal,
    `Paid: ${paid}, Amount: ${amount}`,
  );

  await savePaymentDataToStore();
  showToast(`Payment saved: ${name} - ৳${amount.toLocaleString()} (${paid ? "Paid" : "Pending"})`);
  closeModal();

  populateMonths(year);
  populateNames(year, month);
  populateModalFields(year);
  applyFilters();
}

// 🗓️ Start New Month Functions
function getAllMemberNames() {
  const names = new Set();
  paymentData.forEach((y) => {
    y.months.forEach((m) => {
      m.payments.forEach((p) => names.add(p.name));
    });
  });
  return Array.from(names).sort();
}

function openNewMonthModal() {
  if (currentRole !== "admin") {
    showToast("Admin access required to start a new month! 🔒", "warning");
    return;
  }
  const modal = document.getElementById("newMonthModal");
  const yearInput = document.getElementById("newMonthYear");
  const monthSelect = document.getElementById("newMonthSelect");
  const dueDateInput = document.getElementById("newMonthDueDate");
  const amountInput = document.getElementById("newMonthAmount");

  let currentYear = parseInt(document.getElementById("yearFilter")?.value);
  if (!currentYear && paymentData.length > 0) currentYear = paymentData[0].year;
  if (!currentYear) currentYear = new Date().getFullYear();

  const yearData = paymentData.find((y) => y.year == currentYear);
  let nextMonth = "January";
  let targetYear = currentYear;

  if (yearData && yearData.months.length > 0) {
    const latestMonth = yearData.months[0].month;
    const latestIdx = CALENDAR_MONTHS.indexOf(latestMonth);
    if (latestIdx !== -1) {
      if (latestIdx < 11) {
        nextMonth = CALENDAR_MONTHS[latestIdx + 1];
      } else {
        nextMonth = "January";
        targetYear = currentYear + 1;
      }
    }
  }

  yearInput.value = targetYear;
  monthSelect.innerHTML = CALENDAR_MONTHS.map(
    (m) => `<option value="${m}" ${m === nextMonth ? "selected" : ""}>${m}</option>`,
  ).join("");

  // Default due date to 15th of the month
  const targetMonthIdx = (CALENDAR_MONTHS.indexOf(nextMonth) + 1).toString().padStart(2, "0");
  if (dueDateInput) {
    dueDateInput.value = `${targetYear}-${targetMonthIdx}-15`;
  }

  amountInput.value = 1000;
  const members = getAllMemberNames();
  renderNewMonthMembersCheckboxes(members);

  modal.classList.remove("hidden");
}

function renderNewMonthMembersCheckboxes(members) {
  const membersList = document.getElementById("newMonthMembersList");
  if (!membersList) return;
  membersList.innerHTML = members
    .map(
      (name) => `
    <label class="member-check-item">
      <input type="checkbox" name="newMonthMember" value="${name}" checked />
      <span>${name}</span>
    </label>
  `,
    )
    .join("");
}

function addNewMemberTag() {
  const input = document.getElementById("newExtraMemberInput");
  const name = input?.value.trim();
  if (!name) return;

  const membersList = document.getElementById("newMonthMembersList");
  const existingCheckboxes = Array.from(
    membersList.querySelectorAll('input[name="newMonthMember"]'),
  ).map((i) => i.value.toLowerCase());

  if (existingCheckboxes.includes(name.toLowerCase())) {
    showToast(`${name} is already in the list!`, "warning");
    input.value = "";
    return;
  }

  const label = document.createElement("label");
  label.className = "member-check-item";
  label.innerHTML = `
    <input type="checkbox" name="newMonthMember" value="${name}" checked />
    <span>${name}</span>
  `;
  membersList.appendChild(label);
  input.value = "";
  showToast(`Added ${name} to list! ✅`);
}

function closeNewMonthModal() {
  document.getElementById("newMonthModal")?.classList.add("hidden");
}

async function handleCreateNewMonth(e) {
  e.preventDefault();
  if (currentRole !== "admin") {
    showToast("Admin access required to create a new month! 🔒", "error");
    return;
  }

  const year = parseInt(document.getElementById("newMonthYear").value);
  const month = document.getElementById("newMonthSelect").value;
  const dueDate = document.getElementById("newMonthDueDate")?.value || "";
  const amount = parseInt(document.getElementById("newMonthAmount").value) || 1000;

  const checkedMembers = Array.from(
    document.querySelectorAll('input[name="newMonthMember"]:checked'),
  ).map((i) => i.value);

  if (checkedMembers.length === 0) {
    showToast("Please select at least one member!", "warning");
    return;
  }

  let yearData = paymentData.find((y) => y.year == year);
  if (!yearData) {
    yearData = { year: year, months: [] };
    paymentData.unshift(yearData);
    paymentData.sort((a, b) => b.year - a.year);
  }

  const monthExists = yearData.months.some(
    (m) => m.month.toLowerCase() === month.toLowerCase(),
  );
  if (monthExists) {
    showToast(`${month} (${year}) already exists!`, "warning");
    return;
  }

  const newPayments = checkedMembers.map((name) => ({
    name: name,
    amount: amount,
    paid: false,
    paidAmount: 0,
    balance: amount,
    paymentsList: [],
  }));

  const newMonthData = {
    month: month,
    dueDate: dueDate,
    payments: newPayments,
  };

  yearData.months.unshift(newMonthData);

  await logAuditAction(
    "CREATE_MONTH",
    `${month} ${year}`,
    `Created cycle with ${checkedMembers.length} members. Target: ৳${amount}/member. Due: ${dueDate || "N/A"}`,
    "None",
    `Created (${checkedMembers.length} members)`,
  );

  await savePaymentDataToStore();
  showToast(`${month} (${year}) started with ${checkedMembers.length} members! 🎉`);
  closeNewMonthModal();

  const yearFilter = document.getElementById("yearFilter");
  yearFilter.innerHTML = "";
  paymentData.forEach((y) => {
    yearFilter.innerHTML += `<option value="${y.year}">${y.year}</option>`;
  });
  yearFilter.value = year;

  populateMonths(year);
  populateNames(year, "all");
  populateModalFields(year);
  applyFilters();
}

// 🌓 Theme Toggle
function toggleTheme() {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(currentTheme);
  localStorage.setItem("theme", currentTheme);
  applyFilters(); // Redraw chart theme colors
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const icon = document.querySelector("#themeToggle i");
  if (icon) {
    icon.className = theme === "dark" ? "fas fa-moon" : "fas fa-sun";
  }
  updateMenuAppearanceState();
}

// ── Savings Calculator Functions ────────────────────────────────

function switchCalcTab(tab) {
  document
    .querySelectorAll(".calc-tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  document
    .getElementById("panel-fdr")
    ?.classList.toggle("hidden", tab !== "fdr");
  document
    .getElementById("panel-dps")
    ?.classList.toggle("hidden", tab !== "dps");
}

function switchDpsMode(mode) {
  document
    .querySelectorAll(".dps-mode-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  document
    .getElementById("dps-regular")
    ?.classList.toggle("hidden", mode !== "regular");
  document
    .getElementById("dps-kisti")
    ?.classList.toggle("hidden", mode !== "kisti");
}

function initCalculators() {
  calcFDR();
  calcDPS();
  calcKistiDPS();
}

function fmtMoney(n) {
  return "৳" + Math.round(Number(n) || 0).toLocaleString("en-IN");
}

function buildResultStrip(elId, principal, interest, maturity, subPrincipal, subMaturity) {
  const el = document.getElementById(elId);
  if (!el) return;

  const returnPct = principal > 0 ? ((interest / principal) * 100).toFixed(2) : "0.00";

  el.innerHTML = `
    <div class="calc-res-group">
      <div class="calc-res-label">Total Deposited</div>
      <div class="calc-res-val v-muted">${fmtMoney(principal)}</div>
      <div class="calc-res-sub">${subPrincipal}</div>
    </div>
    <div class="calc-res-divider"></div>
    <div class="calc-res-group">
      <div class="calc-res-label">Gross Return (Estimated)</div>
      <div class="calc-res-val v-green">${fmtMoney(interest)}</div>
      <div class="calc-res-sub">${returnPct}% profit yield</div>
    </div>
    <div class="calc-res-divider"></div>
    <div class="calc-res-group">
      <div class="calc-res-label">Maturity Balance</div>
      <div class="calc-res-val v-indigo">${fmtMoney(maturity)}</div>
      <div class="calc-res-sub">${subMaturity}</div>
    </div>
  `;
}

// ── FDR: Mudaraba Term Deposit
function calcFDR() {
  const P = parseFloat(document.getElementById("fdr-amount")?.value) || 0;
  const r = parseFloat(document.getElementById("fdr-rate")?.value) || 0;
  const yr = parseInt(document.getElementById("fdr-years")?.value) || 0;
  const mo = parseInt(document.getElementById("fdr-months")?.value) || 0;
  const n = parseInt(document.getElementById("fdr-compound")?.value) || 12;
  const resultEl = document.getElementById("fdr-result");

  if (!resultEl) return;

  if (P <= 0 || r <= 0 || (yr === 0 && mo === 0) || !isFinite(P) || !isFinite(r)) {
    resultEl.innerHTML = `<div style="color:var(--text-3); font-size:12px;">Please enter valid deposit amount, rate, and tenure.</div>`;
    return;
  }

  const t = (yr * 12 + mo) / 12;
  // Compound Interest: A = P(1 + r/n)^(nt)
  const maturity = P * Math.pow(1 + r / 100 / n, n * t);
  const interest = maturity - P;
  const tenureStr = (yr > 0 ? yr + " yr " : "") + (mo > 0 ? mo + " mo" : "");

  buildResultStrip(
    "fdr-result",
    P,
    interest,
    maturity,
    `Principal deposit (${fmtMoney(P)})`,
    `After ${tenureStr} · ${n === 12 ? "Monthly Compounding" : "Annual Compounding"}`,
  );
}

// ── Regular DPS: Mudaraba Monthly Scheme
function calcDPS() {
  const PMT = parseFloat(document.getElementById("dps-amount")?.value) || 0;
  const r = parseFloat(document.getElementById("dps-rate")?.value) || 0;
  const yr = parseInt(document.getElementById("dps-years")?.value) || 0;
  const resultEl = document.getElementById("dps-result");

  if (!resultEl) return;

  if (PMT <= 0 || r <= 0 || yr <= 0 || !isFinite(PMT) || !isFinite(r)) {
    resultEl.innerHTML = `<div style="color:var(--text-3); font-size:12px;">Please enter valid monthly installment, rate, and tenure.</div>`;
    return;
  }

  const mr = r / 100 / 12;
  const n = yr * 12;
  // Ordinary annuity future value: PMT * ((1 + r/12)^n - 1) / (r/12)
  // Deposit at beginning of month: FV = PMT * ((1 + mr)^n - 1) / mr * (1 + mr)
  const maturity = PMT * ((Math.pow(1 + mr, n) - 1) / mr) * (1 + mr);
  const deposited = PMT * n;
  const interest = maturity - deposited;

  buildResultStrip(
    "dps-result",
    deposited,
    interest,
    maturity,
    `${fmtMoney(PMT)}/mo × ${n} months`,
    `After ${yr} year${yr > 1 ? "s" : ""}`,
  );
}

// ── Kisti Variable DPS: Stepped Installment Scheme
// Schedule: installment increases ৳1,000 every 6 months
// Months 1–6: ৳1,000 | 7–12: ৳2,000 | ... | 31–36: ৳6,000
// Principal = 6*1k + 6*2k + 6*3k + 6*4k + 6*5k + 6*6k = ৳1,26,000
function calcKistiDPS() {
  const r = parseFloat(document.getElementById("kisti-rate")?.value) || 0;
  const resultEl = document.getElementById("kisti-result");

  if (!resultEl) return;

  if (r <= 0 || !isFinite(r)) {
    resultEl.innerHTML = `<div style="color:var(--text-3); font-size:12px;">Please enter a valid positive profit rate.</div>`;
    return;
  }

  const mr = r / 100 / 12;
  const totalMonths = 36;

  let maturity = 0;
  let totalDeposit = 0;

  for (let m = 1; m <= totalMonths; m++) {
    const phase = Math.ceil(m / 6); // Phase 1 to 6
    const pmt = phase * 1000;       // ৳1,000 to ৳6,000
    totalDeposit += pmt;

    // Monthly compounding with deposit made at beginning of month
    const monthsInvested = totalMonths - m + 1;
    maturity += pmt * Math.pow(1 + mr, monthsInvested);
  }

  const interest = maturity - totalDeposit;

  buildResultStrip(
    "kisti-result",
    totalDeposit,
    interest,
    maturity,
    `৳1k→৳6k/mo over 36 months (Total ৳1,26,000)`,
    `After 3 years maturity`,
  );
}

// Reset Local Data
function resetToDefaultData() {
  localStorage.removeItem("kisti_payment_data");
  localStorage.removeItem("kisti_audit_logs");
  location.reload();
}
