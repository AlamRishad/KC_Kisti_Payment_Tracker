let paymentData = [];
let auditLogs = [];
let barChart = null;
let pieChart = null;
let currentTheme = localStorage.getItem("theme") || "dark";
let db = null;
let lastFetchedAt = null;
let lastModifiedAt = null;
let isSubmitting = false;
let isOnline = navigator.onLine !== false;

// 🔐 Admin & Role-Based Access Control
const ADMIN_PASSWORD = "admin123";
let currentRole = sessionStorage.getItem("kisti_user_role") || "member";
let activeNavTab = sessionStorage.getItem("kisti_active_tab") || "overview";
let activeReportsSubTab = sessionStorage.getItem("kisti_reports_subtab") || "analytics";

// 💰 Fund Cashbook, Member Credit & Monthly Reconciliation State
let fundCashbook = {
  accounts: [
    { id: "bank", name: "Islami Bank Bangladesh", type: "bank", balance: 0, openingBalance: 0, openingDate: "2026-01-01" },
    { id: "cash", name: "Cash in Hand", type: "cash", balance: 0, openingBalance: 0, openingDate: "2026-01-01" },
    { id: "bkash", name: "bKash Mobile Wallet", type: "wallet", balance: 0, openingBalance: 0, openingDate: "2026-01-01" },
    { id: "nagad", name: "Nagad Mobile Wallet", type: "wallet", balance: 0, openingBalance: 0, openingDate: "2026-01-01" },
  ],
  entries: [],
  openingBalances: {
    date: "2026-01-01",
    bank: 0,
    cash: 0,
    bkash: 0,
    nagad: 0,
    notes: "Baseline opening setup",
  },
};
let memberCreditLedger = {};
let monthlyReconciliations = [];
let deferredPwaPrompt = null;
let pendingBackupJson = null;

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
  initPwaAndServiceWorker();
  initDataStore();
  initAiAssistant();
});

// ── Currency Exact Arithmetic (Poisha Integer Math) ───────────────
function toPoisha(bdt) {
  return Math.round((Number(bdt) || 0) * 100);
}
function fromPoisha(poisha) {
  return Math.round(Number(poisha) || 0) / 100;
}

// ── Timezone & Audit Timestamp Formatting ─────────────────────────

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

// 🛡️ Safe Universal Audit Timestamp Formatter
// Formats timestamps with time as "10 Oct 2026, 10:52 PM BD time"
// Formats legacy date-only records as "10 Oct 2026 · Time unavailable"
// Formats missing or invalid timestamps as "Time not recorded"
function formatAuditTimestamp(raw) {
  if (!raw || raw === "Time not recorded") return "Time not recorded";
  try {
    let dt = null;

    if (typeof raw === "object") {
      if (typeof raw.toDate === "function") {
        dt = raw.toDate();
      } else if (typeof raw.seconds === "number") {
        dt = new Date(raw.seconds * 1000 + (raw.nanoseconds ? raw.nanoseconds / 1e6 : 0));
      } else if (raw instanceof Date) {
        dt = raw;
      }
    } else if (typeof raw === "number") {
      dt = new Date(raw);
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed || trimmed === "Time not recorded") return "Time not recorded";
      if (trimmed.includes("· Time unavailable")) return trimmed;

      // Check if string has an explicit time component
      const hasTime = /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(trimmed) || /T\d{1,2}:\d{2}/.test(trimmed);

      if (!hasTime) {
        // Date-only record: do NOT invent a missing time! E.g. "2026-10-10", "2026-10-10 Oct", "10 Oct 2026"
        const ymMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (ymMatch) {
          const y = parseInt(ymMatch[1], 10);
          const m = parseInt(ymMatch[2], 10);
          const d = parseInt(ymMatch[3], 10);
          const dateObj = new Date(Date.UTC(y, m - 1, d));
          const datePart = new Intl.DateTimeFormat("en-GB", {
            timeZone: "UTC",
            day: "2-digit",
            month: "short",
            year: "numeric",
          }).format(dateObj);
          return `${datePart} · Time unavailable`;
        }

        const parsed = new Date(trimmed.replace(/[^a-zA-Z0-9\s-]/g, " ").trim());
        if (!isNaN(parsed.getTime())) {
          const datePart = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Dhaka",
            day: "2-digit",
            month: "short",
            year: "numeric",
          }).format(parsed);
          return `${datePart} · Time unavailable`;
        }
        return "Time not recorded";
      }

      const clean = trimmed.replace(" BD time", "").trim();
      dt = new Date(clean);
    }

    if (!dt || isNaN(dt.getTime())) {
      return "Time not recorded";
    }

    const datePart = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dhaka",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(dt);

    const timePart = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Dhaka",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(dt);

    return `${datePart}, ${timePart} BD time`;
  } catch (e) {
    return "Time not recorded";
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

// ── PWA & Offline Support ─────────────────────────────────────────
function initPwaAndServiceWorker() {
  // Register Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        console.log("Service Worker registered successfully:", reg.scope);
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              showToast("New app version available! Refresh to update. 🚀", "info");
            }
          });
        });
      })
      .catch((err) => {
        console.warn("Service Worker registration notice:", err);
      });
  }

  // Capture beforeinstallprompt event
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    const headerBtn = document.getElementById("pwaInstallHeaderBtn");
    const menuGroup = document.getElementById("mobileMenuPwaGroup");
    if (headerBtn) headerBtn.classList.remove("hidden");
    if (menuGroup) menuGroup.classList.remove("hidden");
  });

  // App installed event
  window.addEventListener("appinstalled", () => {
    deferredPwaPrompt = null;
    const headerBtn = document.getElementById("pwaInstallHeaderBtn");
    if (headerBtn) headerBtn.classList.add("hidden");
    showToast("KC-Kisti App installed successfully! 🎉");
  });

  // Online / Offline Listeners
  window.addEventListener("online", () => {
    isOnline = true;
    updateOnlineStatusUI();
    showToast("Connection restored! You are back online. 🌐");
  });

  window.addEventListener("offline", () => {
    isOnline = false;
    updateOnlineStatusUI();
    showToast("Connection lost. Operating in offline read-only mode.", "warning");
  });

  updateOnlineStatusUI();
}

function updateOnlineStatusUI() {
  const banner = document.getElementById("offlineBanner");
  const bannerText = document.getElementById("offlineBannerText");
  if (!banner) return;

  if (navigator.onLine === false) {
    banner.classList.remove("hidden");
    banner.style.display = "";
    if (bannerText) {
      bannerText.textContent = `Offline Mode · Viewing cached data (${lastFetchedAt ? formatAuditTimestamp(lastFetchedAt) : "Local"}). Financial modifications are disabled until online.`;
    }
  } else {
    banner.classList.add("hidden");
    banner.style.display = "none";
  }
}

// PWA Trigger
function triggerPwaInstall() {
  if (deferredPwaPrompt) {
    deferredPwaPrompt.prompt();
    deferredPwaPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === "accepted") {
        console.log("User accepted PWA installation");
      }
      deferredPwaPrompt = null;
    });
  } else {
    // Helpful guidance for iOS Safari or browsers without beforeinstallprompt
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
      alert("To install on iOS: Tap the Share button (square with arrow) at the bottom of Safari, then choose 'Add to Home Screen'. 📲");
    } else {
      alert("To install this app, open your browser menu (⋮) and select 'Install app' or 'Add to Home screen'. 📲");
    }
  }
}

function checkOnlineForFinancialWrite() {
  if (!navigator.onLine) {
    showToast("Cannot perform financial write while offline. Please connect to the internet.", "error");
    return false;
  }
  return true;
}

// ── Data Normalization & Backward Compatibility ─────────────────
// Ensures legacy records without paymentsList or paidAmount behave consistently
function normalizePaymentRecord(payment, monthDueDate = null) {
  const expected = Number(payment.amount) || 1000;
  let paidAmount = 0;

  if (Array.isArray(payment.paymentsList) && payment.paymentsList.length > 0) {
    paidAmount = payment.paymentsList
      .filter((tx) => tx.status !== "voided")
      .reduce((sum, pmt) => sum + (Number(pmt.amount) || 0), 0);
  } else if (payment.paidAmount !== undefined && payment.paidAmount !== null) {
    paidAmount = Number(payment.paidAmount) || 0;
  } else {
    // Legacy record compatibility: paid boolean defines amount
    paidAmount = payment.paid ? expected : 0;
  }

  const balance = Math.max(0, expected - paidAmount);
  const overpayment = Math.max(0, paidAmount - expected);
  let status = "unpaid";
  let daysOverdue = 0;
  let isOverdue = false;

  // Support legacy stored status values through compatibility mapping
  let legacyStatus = payment.status ? String(payment.status).toLowerCase() : "";
  if (legacyStatus === "due" || legacyStatus === "pending") legacyStatus = "unpaid";
  if (legacyStatus === "partial") legacyStatus = "partially_paid";

  if (paidAmount >= expected) {
    status = paidAmount > expected ? "overpaid" : "paid";
  } else if (paidAmount > 0) {
    status = "partially_paid";
  } else {
    status = "unpaid";
  }

  // Check overdue condition (applies if unpaid or partially paid and dueDate is passed in Asia/Dhaka)
  if (paidAmount < expected && monthDueDate) {
    const todayDhaka = getDhakaDateString();
    if (todayDhaka > monthDueDate) {
      isOverdue = true;
      const msPerDay = 1000 * 60 * 60 * 24;
      const diffMs = new Date(todayDhaka) - new Date(monthDueDate);
      daysOverdue = Math.max(1, Math.floor(diffMs / msPerDay));
    }
  }

  return {
    ...payment,
    expectedAmount: expected,
    paidAmount: paidAmount,
    balance: balance,
    overpayment: overpayment,
    status: status,
    isOverdue: isOverdue,
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
  // Load local audit logs & finance ledgers
  try {
    const cachedAudit = localStorage.getItem("kisti_audit_logs");
    if (cachedAudit) auditLogs = JSON.parse(cachedAudit);
    const cachedCb = localStorage.getItem("kisti_fund_cashbook");
    if (cachedCb) fundCashbook = JSON.parse(cachedCb);
    const cachedCl = localStorage.getItem("kisti_credit_ledger");
    if (cachedCl) memberCreditLedger = JSON.parse(cachedCl);
    const cachedRec = localStorage.getItem("kisti_reconciliations");
    if (cachedRec) monthlyReconciliations = JSON.parse(cachedRec);
  } catch (e) {
    console.warn("Failed to parse cached extension stores:", e);
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

          // Fetch audit logs & finance ledgers if available in Firestore
          try {
            const auditSnap = await db.collection("kisti").doc("audit").get();
            if (auditSnap.exists && Array.isArray(auditSnap.data().logs)) {
              auditLogs = auditSnap.data().logs;
              localStorage.setItem("kisti_audit_logs", JSON.stringify(auditLogs));
            }
            const cbSnap = await db.collection("kisti").doc("cashbook").get();
            if (cbSnap.exists && cbSnap.data().data) {
              fundCashbook = cbSnap.data().data;
              localStorage.setItem("kisti_fund_cashbook", JSON.stringify(fundCashbook));
            }
            const recSnap = await db.collection("kisti").doc("reconciliations").get();
            if (recSnap.exists && Array.isArray(recSnap.data().data)) {
              monthlyReconciliations = recSnap.data().data;
              localStorage.setItem("kisti_reconciliations", JSON.stringify(monthlyReconciliations));
            }
          } catch (auditErr) {
            console.warn("Notice: Extension stores fetch:", auditErr);
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

// Sync updates to cloud database with atomic period-lock verification
async function savePaymentDataToStore(targetCycleKey = null) {
  localStorage.setItem("kisti_payment_data", JSON.stringify(paymentData));
  localStorage.setItem("kisti_fund_cashbook", JSON.stringify(fundCashbook));
  localStorage.setItem("kisti_credit_ledger", JSON.stringify(memberCreditLedger));
  localStorage.setItem("kisti_reconciliations", JSON.stringify(monthlyReconciliations));

  lastModifiedAt = new Date().toISOString();
  updateSyncMetadataDisplay();

  if (db) {
    try {
      updateDbStatusBadge("syncing");

      // 🛡️ Atomic Period Lock Guard:
      // If modifying a specific cycle (e.g. "2026-September"), run an atomic transaction
      // verifying directly against the cloud reconciliations document that the cycle is not closed.
      // This protects against stale clients and close/write races outside the UI.
      if (targetCycleKey) {
        const recRef = db.collection("kisti").doc("reconciliations");
        const paymentsRef = db.collection("kisti").doc("payments");

        await db.runTransaction(async (transaction) => {
          const recSnap = await transaction.get(recRef);
          if (recSnap.exists) {
            const liveRecs = recSnap.data()?.data || [];
            const lockedCycle = liveRecs.find((r) => r.cycleKey === targetCycleKey && r.isClosed);
            if (lockedCycle) {
              throw new Error(`PERIOD_LOCKED: Cycle ${targetCycleKey} is closed and locked in cloud database.`);
            }
          }
          transaction.set(paymentsRef, {
            records: paymentData,
            lastUpdated: lastModifiedAt,
          });
        });
      } else {
        await db.collection("kisti").doc("payments").set({
          records: paymentData,
          lastUpdated: lastModifiedAt,
        });
      }

      // Save audit logs & finance ledgers to cloud
      if (auditLogs && auditLogs.length > 0) {
        await db.collection("kisti").doc("audit").set({
          logs: auditLogs,
          lastUpdated: lastModifiedAt,
        });
      }

      await db.collection("kisti").doc("cashbook").set({
        data: fundCashbook,
        lastUpdated: lastModifiedAt,
      });

      await db.collection("kisti").doc("reconciliations").set({
        data: monthlyReconciliations,
        lastUpdated: lastModifiedAt,
      });

      updateDbStatusBadge("online");
    } catch (err) {
      console.error("Failed to sync to Firestore:", err);
      if (err.message && err.message.includes("PERIOD_LOCKED")) {
        updateDbStatusBadge("online");
        showToast("Database rejected write: Period is locked in cloud database! 🔒", "error");
        throw err;
      }
      updateDbStatusBadge("offline", "Saved Locally");
      showToast("Cloud sync failed. Saved to local storage.", "warning");
    }
  }
}

// 🛡️ Audit Logger
async function logAuditAction(action, target, details, prevValue = "N/A", newValue = "N/A") {
  const now = new Date();
  const entry = {
    id: "log_" + Date.now(),
    timestamp: formatAuditTimestamp(now),
    isoDate: now.toISOString(),
    action: action,
    target: target,
    actor: currentRole === "admin" ? "Admin" : "Shared Admin Session",
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
      due: "Unpaid",
      unpaid: "Unpaid",
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
  const receiptModal = document.getElementById("receiptModal");
  const reminderModal = document.getElementById("reminderModal");
  const voidPaymentModal = document.getElementById("voidPaymentModal");
  const allocateCreditModal = document.getElementById("allocateCreditModal");
  const cashbookEntryModal = document.getElementById("cashbookEntryModal");
  const cashbookTransferModal = document.getElementById("cashbookTransferModal");
  const cashbookOpeningModal = document.getElementById("cashbookOpeningModal");
  const reopenMonthModal = document.getElementById("reopenMonthModal");
  const restorePreviewModal = document.getElementById("restorePreviewModal");

  window.addEventListener("click", (e) => {
    if (e.target === addModal) closeModal();
    if (e.target === newMonthModal) closeNewMonthModal();
    if (e.target === roleAuthModal) closeAuthModal();
    if (e.target === pmtDetailModal) closePaymentDetailModal();
    if (e.target === editDueDateModal) closeEditDueDateModal();
    if (e.target === receiptModal) closeReceiptModal();
    if (e.target === reminderModal) closeReminderModal();
    if (e.target === voidPaymentModal) closeVoidPaymentModal();
    if (e.target === allocateCreditModal) closeAllocateCreditModal();
    if (e.target === cashbookEntryModal) closeCashbookEntryModal();
    if (e.target === cashbookTransferModal) closeCashbookTransferModal();
    if (e.target === cashbookOpeningModal) closeOpeningBalanceModal();
    if (e.target === reopenMonthModal) closeReopenMonthModal();
    if (e.target === restorePreviewModal) closeRestorePreviewModal();
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
      if (receiptModal && !receiptModal.classList.contains("hidden"))
        closeReceiptModal();
      if (reminderModal && !reminderModal.classList.contains("hidden"))
        closeReminderModal();
      if (voidPaymentModal && !voidPaymentModal.classList.contains("hidden"))
        closeVoidPaymentModal();
      if (allocateCreditModal && !allocateCreditModal.classList.contains("hidden"))
        closeAllocateCreditModal();
      if (cashbookEntryModal && !cashbookEntryModal.classList.contains("hidden"))
        closeCashbookEntryModal();
      if (cashbookTransferModal && !cashbookTransferModal.classList.contains("hidden"))
        closeCashbookTransferModal();
      if (cashbookOpeningModal && !cashbookOpeningModal.classList.contains("hidden"))
        closeOpeningBalanceModal();
      if (reopenMonthModal && !reopenMonthModal.classList.contains("hidden"))
        closeReopenMonthModal();
      if (restorePreviewModal && !restorePreviewModal.classList.contains("hidden"))
        closeRestorePreviewModal();
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
        if ((selectedStatus === "unpaid" || selectedStatus === "due") && p.status !== "unpaid") return false;
        if (selectedStatus === "overdue" && !p.isOverdue) return false;
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
  recalculateCashbookBalances();
  recalculateMemberCredits();
  renderOverviewFundStrip();
  if (activeNavTab === "reports") {
    if (activeReportsSubTab === "cashbook") {
      renderCashbookKPIs();
      renderCashbookTable();
    } else if (activeReportsSubTab === "reconciliation") {
      initReconciliationCycles();
      updateReconciliationView();
    }
  }
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
        if (p.isOverdue) {
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
      <span class="stat-sub">${totalOverdue > 0 ? `🚨 ${fmtBDT(totalOverdue)} Overdue` : totalDue > 0 ? "Outstanding collection" : "All clear!"}</span>
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
        if (p.isOverdue) {
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
    let content = `<h4><i class="fas fa-exclamation-triangle"></i> Outstanding & Overdue Balances</h4><div class="due-list">`;

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
          statusBadge = `<span class="badge-partial" title="Paid: ${fmtBDT(p.paidAmount)} | Balance: ${fmtBDT(p.balance)}"><i class="fas fa-adjust" style="font-size:9px"></i> Partially Paid (${fmtBDT(p.paidAmount)})</span>`;
        } else {
          statusBadge = `<span class="badge-due" title="Unpaid balance: ${fmtBDT(p.balance)}"><i class="fas fa-times-circle" style="font-size:9px"></i> Unpaid</span>`;
        }
        if (p.isOverdue) {
          statusBadge += ` <span class="badge-overdue" title="Overdue by ${p.daysOverdue} days! Remaining: ${fmtBDT(p.balance)}"><i class="fas fa-exclamation-circle" style="font-size:9px"></i> Overdue (${p.daysOverdue}d)</span>`;
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
            <td class="col-status-actions">
              <div class="status-actions-wrap">
                <button type="button" class="btn-status-badge-trigger" onclick="openPaymentDetailModal(${year}, '${m.month}', '${p.name}')" title="Click to view details or update payment">
                  ${statusBadge}
                </button>
                ${currentRole === "admin" ? `
                  <button type="button" class="btn-icon btn-quick-toggle" onclick="togglePaymentStatus('${m.month}', '${p.name}', ${year})" title="Quick 1-Click Toggle Status" aria-label="Toggle status for ${p.name}">
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
          ${mDue > 0 ? `<span class="acc-chip chip-due">${fmtBDT(mDue)} outstanding</span>` : ""}
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
                <th class="col-status-actions">Status & Actions</th>
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
  if (!checkOnlineForFinancialWrite()) return;

  const rec = getCycleReconciliation(year, month);
  if (rec && rec.isClosed) {
    showToast(`Cycle ${month} ${year} is closed & reconciled. Reopen period to modify payments. 🔒`, "error");
    return;
  }

  const yearData = paymentData.find((y) => y.year == year);
  if (!yearData) return;

  const monthData = yearData.months.find((m) => m.month === month);
  if (!monthData) return;

  const payment = monthData.payments.find((p) => p.name === name);
  if (!payment) return;

  // 🛡️ Safety: If this installment has genuine transactions recorded, prevent destructive silent toggle!
  const activeTx = (payment.paymentsList || []).filter((tx) => tx.status !== "voided");
  if (activeTx.length > 0) {
    showToast("This installment has genuine transaction records. Please use the Payment Details modal to view, record, or void payments with an audit reason.", "info");
    openPaymentDetailModal(year, month, name);
    return;
  }

  const prevStatus = payment.paid ? "Paid" : "Unpaid";
  const newStatus = !payment.paid ? "Paid" : "Unpaid";

  payment.paid = !payment.paid;
  if (payment.paid) {
    payment.paidAmount = payment.amount;
    payment.balance = 0;
    payment.paymentsList = [
      {
        id: "pmt_" + Date.now(),
        amount: payment.amount,
        date: getDhakaDateString(),
        method: "Quick Status Toggle",
        reference: "AUTO-TOGGLE",
        receiptRef: "",
        receiptNumber: getOrGenerateReceiptNumber({ id: "pmt_" + Date.now() }, year, month),
        verified: true,
        verifiedBy: "Shared Admin Session",
        notes: "Quick toggle marked as Paid",
      },
    ];
  } else {
    payment.paidAmount = 0;
    payment.balance = payment.amount;
    payment.paymentsList = [];
  }

  if (rec && rec.status === "reconciled") {
    rec.status = "invalidated";
    rec.invalidatedAt = new Date().toISOString();
  }

  await logAuditAction(
    "QUICK_TOGGLE",
    `${name} · ${month} ${year}`,
    `Status changed from ${prevStatus} to ${newStatus}`,
    prevStatus,
    newStatus,
  );

  await savePaymentDataToStore(`${year}-${month}`);
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
      if (p.isOverdue) {
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
            <div class="person-stat-label">Outstanding</div>
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
      if (p.isOverdue) totalOverdue += p.balance;

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
        statusBadge = `<span class="badge-partial">Partially Paid ⚠️</span>`;
      } else {
        statusBadge = `<span class="badge-due">Unpaid ⏳</span>`;
      }
      if (h.isOverdue) {
        statusBadge += ` <span class="badge-overdue">Overdue (${h.daysOverdue}d) 🚨</span>`;
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

  const rec = getCycleReconciliation(year, monthName);
  const isPeriodClosed = rec && rec.isClosed;

  const p = normalizePaymentRecord(rawPmt, monthData.dueDate);
  const pmtList = p.paymentsList || [];

  recalculateMemberCredits();
  const creditInfo = memberCreditLedger[memberName] || { available: 0, totalGenerated: 0, totalAllocated: 0 };

  let statusBadge = "";
  if (p.status === "paid" || p.status === "overpaid") {
    statusBadge = `<span class="badge-paid"><i class="fas fa-check-circle"></i> Paid in Full</span>`;
    if (p.overpayment > 0) {
      statusBadge += ` <span class="badge-credit">+${fmtBDT(p.overpayment)} Credit</span>`;
    }
  } else if (p.status === "partially_paid") {
    statusBadge = `<span class="badge-partial"><i class="fas fa-adjust"></i> Partial (${fmtBDT(p.paidAmount)})</span>`;
    if (p.isOverdue) {
      statusBadge += ` <span class="badge-overdue"><i class="fas fa-exclamation-circle"></i> Overdue (${p.daysOverdue}d)</span>`;
    }
  } else if (p.status === "overdue" || p.isOverdue) {
    statusBadge = `<span class="badge-overdue"><i class="fas fa-exclamation-circle"></i> Overdue (${p.daysOverdue}d)</span>`;
  } else {
    statusBadge = `<span class="badge-due"><i class="fas fa-clock"></i> Unpaid</span>`;
  }

  const pct = p.expectedAmount > 0 ? Math.min(100, Math.round((p.paidAmount / p.expectedAmount) * 100)) : (p.paid ? 100 : 0);
  const progressColor = (p.status === "paid" || p.status === "overpaid") ? "var(--green)" : (p.status === "partially_paid" ? "var(--amber)" : "var(--indigo)");

  // 1. Transaction History Cards
  let historyCards = "";
  if (pmtList.length > 0) {
    historyCards = pmtList
      .map(
        (t) => {
          const isVoided = t.status === "voided";
          return `
      <div class="pmt-tx-card ${isVoided ? "is-voided-tx" : ""}">
        <div class="pmt-tx-card-top">
          <div class="pmt-tx-amount" style="${isVoided ? "text-decoration: line-through; opacity: 0.6; color: var(--rose);" : ""}">
            +${fmtBDT(t.amount)}
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <div class="pmt-tx-date"><i class="fas fa-calendar-alt" aria-hidden="true"></i> ${t.date || "Not recorded"}</div>
            <button type="button" class="btn-receipt-card" onclick="openReceiptModal(${year}, '${monthName}', '${memberName}', '${t.id}')" title="View printable voucher / receipt" aria-label="Receipt">
              <i class="fas fa-receipt"></i> Receipt
            </button>
            ${currentRole === "admin" && !isPeriodClosed && !isVoided ? `
              <button type="button" class="pmt-tx-delete-btn" onclick="openVoidPaymentModal(${year}, '${monthName}', '${memberName}', '${t.id}')" title="Reverse / Void this transaction" aria-label="Void transaction">
                <i class="fas fa-undo-alt"></i> Void
              </button>
            ` : ""}
          </div>
        </div>
        <div class="pmt-tx-meta-row">
          <span class="pmt-meta-pill"><i class="fas fa-money-bill-wave" aria-hidden="true"></i> ${t.method || "Direct"}</span>
          ${t.reference && t.reference !== "N/A" ? `<span class="pmt-meta-pill"><i class="fas fa-hashtag" aria-hidden="true"></i> ${t.reference}</span>` : ""}
          <span class="pmt-meta-pill ${t.verified ? "verified" : "unverified"}">
            <i class="fas ${t.verified ? "fa-shield-alt" : "fa-clock"}" aria-hidden="true"></i> ${t.verified ? (t.verifiedBy || "Verified") : "Unverified"}
          </span>
          ${isVoided ? `
            <span class="pmt-meta-pill" style="background:var(--rose-dim); color:var(--rose); border:1px solid var(--rose);">
              <i class="fas fa-ban"></i> VOIDED (${t.voidType === "refund" ? "Cash Refund" : "Correction"})
            </span>
          ` : ""}
        </div>
        ${t.notes ? `<div class="pmt-tx-notes"><i class="fas fa-comment-dots" aria-hidden="true"></i> ${t.notes}</div>` : ""}
        ${isVoided ? `
          <div class="pmt-void-audit-note" style="margin-top:6px; font-size:11px; color:var(--rose); background:rgba(244,63,94,0.08); padding:6px 10px; border-radius:6px;">
            <strong>Reversal Reason:</strong> ${t.voidReason || "Administrative Correction"} · 
            <span>${formatAuditTimestamp(t.voidedAt)}</span>
          </div>
        ` : ""}
      </div>
    `;
        }
      )
      .join("");
  } else if (p.paid) {
    historyCards = `
      <div class="pmt-tx-card legacy">
        <div class="pmt-tx-card-top">
          <div class="pmt-tx-amount">+${fmtBDT(p.expectedAmount)}</div>
          <div style="display:flex; align-items:center; gap:8px;">
            <div class="pmt-tx-date"><i class="fas fa-check-double" aria-hidden="true"></i> Baseline Record</div>
            <button type="button" class="btn-receipt-card" onclick="openReceiptModal(${year}, '${monthName}', '${memberName}', 'legacy')" title="View receipt">
              <i class="fas fa-receipt"></i> Receipt
            </button>
          </div>
        </div>
        <div class="pmt-tx-meta-row">
          <span class="pmt-meta-pill verified"><i class="fas fa-shield-alt" aria-hidden="true"></i> Verified Baseline</span>
          <span class="pmt-meta-pill"><i class="fas fa-check" aria-hidden="true"></i> Full Installment</span>
        </div>
      </div>
    `;
  } else {
    historyCards = `
      <div class="pmt-empty-tx">
        <i class="fas fa-hourglass-start" aria-hidden="true"></i>
        <span>No payment transactions recorded yet for this installment.</span>
      </div>
    `;
  }

  // 2. Member Advance Credit Surplus Banner
  let creditSurplusBanner = "";
  if (creditInfo.available > 0) {
    creditSurplusBanner = `
      <div class="alloc-credit-header" style="margin: 12px 0;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong style="color:var(--accent-teal);"><i class="fas fa-coins"></i> Available Advance Credit: ${fmtBDT(creditInfo.available)}</strong>
            <small style="display:block; color:var(--text-3); font-size:11px;">Surplus payment available to apply against unpaid installments.</small>
          </div>
          ${currentRole === "admin" && p.balance > 0 && !isPeriodClosed ? `
            <button type="button" class="btn-sm-action" onclick="openAllocateCreditModal('${memberName}')" style="background:var(--accent-teal); color:#000; border:none; padding:5px 10px; border-radius:6px; font-weight:600; cursor:pointer;">
              Allocate Credit
            </button>
          ` : ""}
        </div>
      </div>
    `;
  }

  // 3. Admin 1-Click Quick Action Bar & Reminder Trigger
  let adminQuickToggleBar = "";
  if (currentRole === "admin" && !isPeriodClosed) {
    const activeTxCount = pmtList.filter((x) => x.status !== "voided").length;
    if (activeTxCount === 0) {
      if (p.paid) {
        adminQuickToggleBar = `
          <div class="pmt-quick-actions-bar">
            <button type="button" class="btn-pmt-quick-toggle is-revert" onclick="handleModalQuickToggle(${year}, '${monthName}', '${memberName}')">
              <i class="fas fa-undo-alt" aria-hidden="true"></i> Revert Status to Unpaid
            </button>
          </div>
        `;
      } else {
        adminQuickToggleBar = `
          <div class="pmt-quick-actions-bar">
            <button type="button" class="btn-pmt-quick-toggle is-pay" onclick="handleModalQuickToggle(${year}, '${monthName}', '${memberName}')">
              <i class="fas fa-check-circle" aria-hidden="true"></i> Quick Action: Mark as Paid in Full (${fmtBDT(p.expectedAmount)})
            </button>
          </div>
        `;
      }
    }
  }

  // 4. Admin Record Form or Period Locked Notice
  let adminRecordForm = "";
  if (isPeriodClosed) {
    adminRecordForm = `
      <div style="background:var(--surface-2); border:1px solid var(--border-color); padding:16px; border-radius:10px; text-align:center; margin-top:16px;">
        <i class="fas fa-lock" style="color:var(--amber); font-size:22px; margin-bottom:6px; display:block;"></i>
        <strong>Cycle Reconciled & Closed</strong>
        <p style="color:var(--text-3); font-size:12px; margin:4px 0 0;">This monthly cycle is period-locked. Modifying, adding, or voiding payments requires an administrator to unlock the period in Reports &gt; Reconciliation.</p>
      </div>
    `;
  } else if (currentRole === "admin") {
    const defaultPayAmount = Math.max(0, p.balance) || p.expectedAmount || 1000;
    adminRecordForm = `
      <div class="pmt-admin-form-card">
        <div class="pmt-admin-form-header">
          <h4><i class="fas fa-plus-circle" aria-hidden="true"></i> Record Payment Transaction</h4>
          <span class="pmt-admin-badge"><i class="fas fa-user-shield" aria-hidden="true"></i> Admin Action</span>
        </div>

        <div class="pmt-preset-chips-wrap">
          <span class="pmt-preset-label"><i class="fas fa-bolt" aria-hidden="true"></i> Quick Amount:</span>
          ${p.balance > 0 ? `<button type="button" class="pmt-preset-chip" onclick="setPartialAmount(${p.balance})"><span class="chip-val">${fmtBDT(p.balance)}</span> <span class="chip-desc">Remaining</span></button>` : ""}
          <button type="button" class="pmt-preset-chip" onclick="setPartialAmount(${p.expectedAmount})"><span class="chip-val">${fmtBDT(p.expectedAmount)}</span> <span class="chip-desc">Full</span></button>
          <button type="button" class="pmt-preset-chip" onclick="setPartialAmount(500)"><span class="chip-val">৳500</span></button>
        </div>

        <form id="recordPaymentForm" class="modal-form modern-form" onsubmit="handleRecordPaymentSubmit(event, ${year}, '${monthName}', '${memberName}')">
          <div class="pmt-form-grid">
            <div class="form-group modern-field">
              <label for="partialAmountInput">
                <i class="fas fa-coins" aria-hidden="true"></i> Amount to Pay
              </label>
              <div class="input-with-icon">
                <span class="input-icon-prefix">৳</span>
                <input type="number" id="partialAmountInput" class="modern-input with-prefix" value="${defaultPayAmount}" min="1" step="any" required placeholder="0.00" />
              </div>
            </div>
            <div class="form-group modern-field">
              <label for="partialDateInput">
                <i class="fas fa-calendar-day" aria-hidden="true"></i> Payment Date
              </label>
              <div class="input-with-icon">
                <span class="input-icon-prefix"><i class="fas fa-calendar-alt" aria-hidden="true"></i></span>
                <input type="date" id="partialDateInput" class="modern-input with-prefix" value="${getDhakaDateString()}" required />
              </div>
            </div>
          </div>

          <div class="pmt-form-grid">
            <div class="form-group modern-field">
              <label for="partialMethodInput">
                <i class="fas fa-wallet" aria-hidden="true"></i> Payment Method
              </label>
              <div class="input-with-icon">
                <span class="input-icon-prefix"><i class="fas fa-credit-card" aria-hidden="true"></i></span>
                <select id="partialMethodInput" class="modern-input modern-select with-prefix">
                  <option value="Bank Transfer">Bank Transfer (IBBL)</option>
                  <option value="bKash">bKash</option>
                  <option value="Nagad">Nagad</option>
                  <option value="Cash">Cash</option>
                  <option value="Rocket">Rocket</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div class="form-group modern-field">
              <label for="partialRefInput">
                <i class="fas fa-hashtag" aria-hidden="true"></i> Transaction / Ref #
              </label>
              <div class="input-with-icon">
                <span class="input-icon-prefix"><i class="fas fa-receipt" aria-hidden="true"></i></span>
                <input type="text" id="partialRefInput" class="modern-input with-prefix" placeholder="e.g. TXN12345 (Optional)" />
              </div>
            </div>
          </div>

          <div class="pmt-form-grid">
            <div class="form-group modern-field">
              <label for="partialReceiptInput">
                <i class="fas fa-file-invoice" aria-hidden="true"></i> Memo / Doc Ref
              </label>
              <div class="input-with-icon">
                <span class="input-icon-prefix"><i class="fas fa-link" aria-hidden="true"></i></span>
                <input type="text" id="partialReceiptInput" class="modern-input with-prefix" placeholder="e.g. REC-2026-09 (Optional)" />
              </div>
            </div>
            <div class="form-group modern-field">
              <label for="partialNotesInput">
                <i class="fas fa-comment-alt" aria-hidden="true"></i> Notes / Remarks
              </label>
              <div class="input-with-icon">
                <span class="input-icon-prefix"><i class="fas fa-pen" aria-hidden="true"></i></span>
                <input type="text" id="partialNotesInput" class="modern-input with-prefix" placeholder="Optional notes" />
              </div>
            </div>
          </div>

          <div class="form-group modern-checkbox-group">
            <label class="modern-checkbox-label">
              <input type="checkbox" id="partialVerifyCheck" checked />
              <span class="modern-checkbox-custom">
                <i class="fas fa-check" aria-hidden="true"></i>
              </span>
              <span class="checkbox-text">
                <strong>Mark as Verified</strong>
                <small>Record will show as verified by shared admin session</small>
              </span>
            </label>
          </div>

          <button type="submit" class="btn-submit btn-save-payment modern-btn-submit" id="btnSubmitPayment">
            <i class="fas fa-save" aria-hidden="true"></i> Save Payment Record
          </button>
        </form>
      </div>
    `;
  }

  body.innerHTML = `
    <!-- Hero Summary Card -->
    <div class="pmt-hero-card">
      <div class="pmt-hero-top">
        <div class="pmt-hero-user">
          <div class="pmt-avatar">${memberName.charAt(0).toUpperCase()}</div>
          <div>
            <div class="pmt-member-name">${memberName}</div>
            <div class="pmt-cycle-sub"><i class="fas fa-calendar-alt" aria-hidden="true"></i> ${monthName} ${year} ${monthData.dueDate ? `· <span class="pmt-due-tag">Due: ${monthData.dueDate}</span>` : ""}</div>
          </div>
        </div>
        <div class="pmt-hero-badge-wrap">
          ${statusBadge}
        </div>
      </div>

      <div class="pmt-progress-wrap">
        <div class="pmt-progress-info">
          <span>Installment Paid Progress</span>
          <strong>${pct}%</strong>
        </div>
        <div class="pmt-progress-track">
          <div class="pmt-progress-fill" style="width: ${pct}%; background: ${progressColor}"></div>
        </div>
      </div>

      <div class="pmt-stats-strip">
        <div class="pmt-stat-col">
          <span class="pmt-stat-label">Expected</span>
          <span class="pmt-stat-val">${fmtBDT(p.expectedAmount)}</span>
        </div>
        <div class="pmt-stat-col">
          <span class="pmt-stat-label">Paid So Far</span>
          <span class="pmt-stat-val is-paid">${fmtBDT(p.paidAmount)}</span>
        </div>
        <div class="pmt-stat-col">
          <span class="pmt-stat-label">Remaining</span>
          <span class="pmt-stat-val ${p.balance > 0 ? (p.status === 'overdue' ? 'is-overdue' : 'is-due') : 'is-paid'}">${p.balance > 0 ? fmtBDT(p.balance) : (p.balance < 0 ? `+${fmtBDT(Math.abs(p.balance))}` : '৳0')}</span>
        </div>
      </div>

      ${p.balance > 0 ? `
        <div style="margin-top:14px; text-align:right;">
          <button type="button" class="btn-secondary" onclick="openReminderModal(${year}, '${monthName}', '${memberName}')" style="padding:6px 14px; font-size:12px;">
            <i class="fas fa-paper-plane" style="color:var(--accent-teal);"></i> Prepare Reminder Draft
          </button>
        </div>
      ` : ""}
    </div>

    <!-- Advance Credit Surplus Banner -->
    ${creditSurplusBanner}

    <!-- Quick Admin Action Bar -->
    ${adminQuickToggleBar}

    <!-- Payment History Cards -->
    <div class="pmt-history-section">
      <div class="pmt-section-header">
        <h4><i class="fas fa-history" aria-hidden="true"></i> Payment Transactions (${pmtList.length})</h4>
        <span class="pmt-tx-count-chip">${monthName} ${year}</span>
      </div>
      <div class="pmt-tx-list">
        ${historyCards}
      </div>
    </div>

    <!-- Admin Record Form -->
    ${adminRecordForm}
  `;

  modal.classList.remove("hidden");
}

function setPartialAmount(val) {
  const input = document.getElementById("partialAmountInput");
  if (input) {
    input.value = val;
    input.focus();
  }
}

async function handleModalQuickToggle(year, monthName, memberName) {
  await togglePaymentStatus(monthName, memberName, year);
  openPaymentDetailModal(year, monthName, memberName);
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
  if (!checkOnlineForFinancialWrite()) return;

  const rec = getCycleReconciliation(year, monthName);
  if (rec && rec.isClosed) {
    showToast(`Cycle ${monthName} ${year} is closed & reconciled. Reopen period to record payments. 🔒`, "error");
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
      receiptNumber: getOrGenerateReceiptNumber({ id: "pmt_" + Date.now() }, year, monthName),
      verified: isVerified,
      verifiedBy: isVerified ? "Shared Admin Session" : "Unverified",
      notes: payNotes,
    };

    payment.paymentsList.push(newPmt);

    // Recalculate totals excluding voided transactions
    const totalPaid = payment.paymentsList
      .filter((x) => x.status !== "voided")
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    payment.paidAmount = totalPaid;
    payment.balance = Math.max(0, payment.amount - totalPaid);
    payment.paid = totalPaid >= payment.amount;

    // Link cashbook inflow entry
    const accountKey = payMethod.toLowerCase().includes("bank")
      ? "bank"
      : payMethod.toLowerCase().includes("bkash")
      ? "bkash"
      : payMethod.toLowerCase().includes("nagad")
      ? "nagad"
      : "cash";

    fundCashbook.entries.push({
      id: "cbe_" + Date.now(),
      type: "inflow",
      account: accountKey,
      category: "Member Installment Collection",
      amount: amount,
      date: payDate,
      reference: payRef,
      notes: `Collection from ${memberName} (${monthName} ${year})`,
      relatedPaymentId: newPmt.id,
      createdAt: new Date().toISOString(),
      createdBy: "Admin",
    });

    recalculateCashbookBalances();
    recalculateMemberCredits();

    await logAuditAction(
      "RECORD_PAYMENT",
      `${memberName} · ${monthName} ${year}`,
      `Recorded ${fmtBDT(amount)} via ${payMethod}. Reference: ${payRef}.`,
      `Paid: ${fmtBDT(prevPaid)}`,
      `Paid: ${fmtBDT(totalPaid)} (Balance: ${fmtBDT(payment.balance)})`,
    );

    if (rec && rec.status === "reconciled") {
      rec.status = "invalidated";
      rec.invalidatedAt = new Date().toISOString();
    }

    await savePaymentDataToStore(`${year}-${monthName}`);
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
  let countUnpaid = 0;
  let countOverdue = 0;

  let sumPaid = 0;
  let sumPartial = 0;
  let sumUnpaid = 0;
  let sumOverdue = 0;

  processedMonths.forEach((m) => {
    m.normalizedPayments.forEach((p) => {
      if (p.status === "paid" || p.status === "overpaid") {
        countPaid++;
        sumPaid += p.paidAmount;
      } else if (p.status === "partially_paid") {
        countPartial++;
        sumPartial += p.paidAmount;
        if (p.isOverdue) {
          countOverdue++;
          sumOverdue += p.balance;
        } else {
          countUnpaid++;
          sumUnpaid += p.balance;
        }
      } else {
        if (p.isOverdue) {
          countOverdue++;
          sumOverdue += p.balance;
        } else {
          countUnpaid++;
          sumUnpaid += p.balance;
        }
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
        `Partially Paid (${fmtBDT(sumPartial)})`,
        `Unpaid (${fmtBDT(sumUnpaid)})`,
        `Overdue (${fmtBDT(sumOverdue)})`,
      ],
      datasets: [
        {
          data: [sumPaid, sumPartial, sumUnpaid, sumOverdue],
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
          <td>${col >= exp ? '<span class="badge-paid">Complete ✅</span>' : '<span class="badge-due">Outstanding ⏳</span>'}</td>
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
        <td>${formatAuditTimestamp(log.timestamp || log.isoDate || log.date)}</td>
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
    existing.paymentsList = paid
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
            notes: "Updated via payment form",
          },
        ]
      : [];
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
    `Recorded payment of ৳${amount} (${paid ? "Paid" : "Unpaid"})`,
    prevVal,
    `Paid: ${paid}, Amount: ${amount}`,
  );

  await savePaymentDataToStore();
  showToast(`Payment saved: ${name} - ৳${amount.toLocaleString()} (${paid ? "Paid" : "Unpaid"})`);
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
  if (!checkOnlineForFinancialWrite()) return;

  const year = parseInt(document.getElementById("newMonthYear").value);
  const month = document.getElementById("newMonthSelect").value;
  const dueDate = document.getElementById("newMonthDueDate")?.value?.trim();
  const amount = parseInt(document.getElementById("newMonthAmount").value) || 1000;

  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    showToast("A valid cycle due date (YYYY-MM-DD in Asia/Dhaka) is strictly required! 📅", "error");
    return;
  }

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
  const formulaNoteEl = document.getElementById("fdr-formula-note");

  if (!resultEl) return;

  if (P <= 0 || r <= 0 || (yr === 0 && mo === 0) || !isFinite(P) || !isFinite(r)) {
    resultEl.innerHTML = `<div style="color:var(--text-3); font-size:12px;">Please enter valid deposit amount, rate, and tenure.</div>`;
    if (formulaNoteEl) formulaNoteEl.innerHTML = "";
    return;
  }

  const t = (yr * 12 + mo) / 12;
  // Compound Interest: A = P(1 + r/n)^(nt)
  const maturity = P * Math.pow(1 + r / 100 / n, n * t);
  const interest = maturity - P;
  const tenureStr = (yr > 0 ? yr + " yr " : "") + (mo > 0 ? mo + " mo" : "");
  const compDesc = n === 12 ? "Monthly Compounding" : n === 4 ? "Quarterly Compounding" : "Annual Compounding";

  buildResultStrip(
    "fdr-result",
    P,
    interest,
    maturity,
    `Principal deposit (${fmtMoney(P)})`,
    `After ${tenureStr} · ${compDesc}`,
  );

  if (formulaNoteEl) {
    formulaNoteEl.innerHTML = `
      <div class="calc-formula-desc" style="font-size:12px; line-height:1.5; color:var(--text-2); background:var(--surface-2); padding:10px 14px; border-radius:8px; border-left:3px solid var(--accent-teal);">
        <strong>Applied Formula:</strong> <code>A = P(1 + r/n)^(n×t)</code> (${compDesc})<br/>
        <span>Parameters: <code>P = ${fmtMoney(P)}</code>, estimated rate <code>r = ${r}%</code>, compounded <code>n = ${n}</code> times/yr, tenure <code>t = ${t.toFixed(2)} years</code>.</span><br/>
        <small style="color:var(--text-3); display:inline-block; margin-top:4px;">* All calculator outputs are indicative benchmark estimates. Figures exclude applicable taxes, government excise duties, and bank account maintenance fees.</small>
      </div>
    `;
  }
}

// ── Regular DPS: Mudaraba Monthly Scheme
function calcDPS() {
  const PMT = parseFloat(document.getElementById("dps-amount")?.value) || 0;
  const r = parseFloat(document.getElementById("dps-rate")?.value) || 0;
  const yr = parseInt(document.getElementById("dps-years")?.value) || 0;
  const timing = document.getElementById("dps-timing")?.value || "begin";
  const resultEl = document.getElementById("dps-result");
  const formulaNoteEl = document.getElementById("dps-formula-note");

  if (!resultEl) return;

  if (PMT <= 0 || r <= 0 || yr <= 0 || !isFinite(PMT) || !isFinite(r)) {
    resultEl.innerHTML = `<div style="color:var(--text-3); font-size:12px;">Please enter valid monthly installment, rate, and tenure.</div>`;
    if (formulaNoteEl) formulaNoteEl.innerHTML = "";
    return;
  }

  const mr = r / 100 / 12;
  const n = yr * 12;
  let maturity = 0;

  if (timing === "begin") {
    // Deposit at beginning of month (Annuity Due): FV = PMT * ((1 + mr)^n - 1) / mr * (1 + mr)
    maturity = PMT * ((Math.pow(1 + mr, n) - 1) / mr) * (1 + mr);
  } else {
    // Deposit at end of month (Ordinary Annuity): FV = PMT * ((1 + mr)^n - 1) / mr
    maturity = PMT * ((Math.pow(1 + mr, n) - 1) / mr);
  }

  const deposited = PMT * n;
  const interest = maturity - deposited;
  const timingDesc = timing === "begin" ? "Beginning of Month (Annuity Due)" : "End of Month (Ordinary Annuity)";

  buildResultStrip(
    "dps-result",
    deposited,
    interest,
    maturity,
    `${fmtMoney(PMT)}/mo × ${n} months`,
    `After ${yr} year${yr > 1 ? "s" : ""} · ${timingDesc}`,
  );

  if (formulaNoteEl) {
    const isBegin = timing === "begin";
    formulaNoteEl.innerHTML = `
      <div class="calc-formula-desc" style="font-size:12px; line-height:1.5; color:var(--text-2); background:var(--surface-2); padding:10px 14px; border-radius:8px; border-left:3px solid var(--accent-teal);">
        <strong>Applied Formula:</strong> <code>${isBegin ? "FV = PMT × [((1 + r/12)^n - 1) / (r/12)] × (1 + r/12)" : "FV = PMT × [((1 + r/12)^n - 1) / (r/12)]"}</code> (${timingDesc})<br/>
        <span>Parameters: monthly deposit <code>PMT = ${fmtMoney(PMT)}</code>, estimated rate <code>r = ${r}%</code>, tenure <code>n = ${n} months</code> (${yr} yrs).</span><br/>
        <small style="color:var(--text-3); display:inline-block; margin-top:4px;">* All calculator outputs are indicative benchmark estimates. Figures exclude applicable taxes, government excise duties, and bank account maintenance fees.</small>
      </div>
    `;
  }
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
  localStorage.removeItem("kisti_fund_cashbook");
  localStorage.removeItem("kisti_credit_ledger");
  localStorage.removeItem("kisti_reconciliations");
  location.reload();
}

// ─────────────────────────────────────────────────────────────────
// 💰 FUND CASHBOOK & MULTI-ACCOUNT MANAGEMENT
// ─────────────────────────────────────────────────────────────────

const CASHBOOK_CATEGORIES = {
  inflow: [
    "Member Installment Collection",
    "Bank Profit / Interest Credited",
    "Capital Contribution",
    "Other Inflow",
  ],
  outflow: [
    "Bank Charges & Excise Duty",
    "Operating & Administrative Expense",
    "Member Cash Refund",
    "Investment / FDR Placement",
    "Other Outflow",
  ],
};

function recalculateCashbookBalances() {
  const op = fundCashbook.openingBalances || { bank: 0, cash: 0, bkash: 0, nagad: 0 };
  const balancesPoisha = {
    bank: toPoisha(op.bank || 0),
    cash: toPoisha(op.cash || 0),
    bkash: toPoisha(op.bkash || 0),
    nagad: toPoisha(op.nagad || 0),
  };

  const entries = fundCashbook.entries || [];
  entries.forEach((e) => {
    if (e.status === "voided") return;
    const amtP = toPoisha(e.amount);
    if (e.type === "inflow") {
      if (balancesPoisha[e.account] !== undefined) {
        balancesPoisha[e.account] += amtP;
      }
    } else if (e.type === "outflow") {
      if (balancesPoisha[e.account] !== undefined) {
        balancesPoisha[e.account] -= amtP;
      }
    } else if (e.type === "transfer") {
      if (balancesPoisha[e.fromAccount] !== undefined) {
        balancesPoisha[e.fromAccount] -= amtP;
      }
      if (balancesPoisha[e.toAccount] !== undefined) {
        balancesPoisha[e.toAccount] += amtP;
      }
    }
  });

  fundCashbook.accounts.forEach((acc) => {
    acc.balance = fromPoisha(balancesPoisha[acc.id] || 0);
    acc.openingBalance = op[acc.id] || 0;
  });

  return balancesPoisha;
}

function getAccountingCollectionsBreakdown() {
  recalculateCashbookBalances();

  let totalMemberCollections = 0;
  const paymentRecordMap = new Map();

  paymentData.forEach((y) => {
    (y.months || []).forEach((m) => {
      (m.payments || []).forEach((p) => {
        const pmtList = p.paymentsList || [];
        if (pmtList.length > 0) {
          pmtList.forEach((tx) => {
            if (tx.status === "voided") return;
            if (tx.isCreditAllocation) return; // Credit reallocation is internal, not new cash inflow
            const amt = Number(tx.amount) || 0;
            totalMemberCollections += amt;
            paymentRecordMap.set(tx.id, {
              id: tx.id,
              year: y.year,
              month: m.month,
              memberName: p.name,
              amount: amt,
              date: tx.date || "Legacy Recorded",
              method: tx.method || "Cash",
            });
          });
        } else if (p.paid) {
          const amt = Number(p.paidAmount) || Number(p.amount) || 1000;
          totalMemberCollections += amt;
          const fakeId = `legacy_${y.year}_${m.month}_${p.name}`;
          paymentRecordMap.set(fakeId, {
            id: fakeId,
            year: y.year,
            month: m.month,
            memberName: p.name,
            amount: amt,
            date: "Baseline Record",
            method: "Legacy Baseline",
          });
        }
      });
    });
  });

  const cashbookEntries = fundCashbook.entries || [];
  const linkedPaymentIds = new Set();
  let collectionsInCashbook = 0;

  cashbookEntries.forEach((e) => {
    if (e.status === "voided") return;
    if (e.type === "inflow" && (e.relatedPaymentId || e.category === "Member Installment Collection")) {
      collectionsInCashbook += Number(e.amount) || 0;
      if (e.relatedPaymentId) {
        linkedPaymentIds.add(e.relatedPaymentId);
      }
    }
  });

  const unassignedPayments = [];
  paymentRecordMap.forEach((rec, id) => {
    if (!linkedPaymentIds.has(id)) {
      unassignedPayments.push(rec);
    }
  });

  const unassignedCollections = Math.max(0, totalMemberCollections - collectionsInCashbook);
  const isOpeningConfigured = !!fundCashbook.openingBalances?.configured;
  const op = fundCashbook.openingBalances || { bank: 0, cash: 0, bkash: 0, nagad: 0 };
  const totalOpening = (Number(op.bank) || 0) + (Number(op.cash) || 0) + (Number(op.bkash) || 0) + (Number(op.nagad) || 0);

  const bankAcc = fundCashbook.accounts.find((a) => a.id === "bank") || { balance: 0, openingBalance: 0 };
  const cashAcc = fundCashbook.accounts.find((a) => a.id === "cash") || { balance: 0, openingBalance: 0 };
  const bkashAcc = fundCashbook.accounts.find((a) => a.id === "bkash") || { balance: 0, openingBalance: 0 };
  const nagadAcc = fundCashbook.accounts.find((a) => a.id === "nagad") || { balance: 0, openingBalance: 0 };
  const totalLiquid = bankAcc.balance + cashAcc.balance + bkashAcc.balance + nagadAcc.balance;

  const closedRecs = (monthlyReconciliations || []).filter((r) => r.isClosed);
  const latestClosed = closedRecs.sort((a, b) => new Date(b.closedAt || 0) - new Date(a.closedAt || 0))[0] || null;

  return {
    totalMemberCollections,
    collectionsInCashbook,
    unassignedCollections,
    unassignedPayments,
    isOpeningConfigured,
    totalOpening,
    totalLiquid,
    bankAcc,
    cashAcc,
    bkashAcc,
    nagadAcc,
    latestClosed,
    openingDate: op.date || "2026-01-01",
  };
}

function renderOverviewFundStrip() {
  const container = document.getElementById("fundStripCards");
  if (!container) return;

  const b = getAccountingCollectionsBreakdown();
  const totalMobileWallets = b.bkashAcc.balance + b.nagadAcc.balance;

  let totalFundSubtext = "";
  if (!b.isOpeningConfigured && (fundCashbook.entries || []).length === 0) {
    totalFundSubtext = `<small class="fund-card-sub" style="color:var(--amber);"><i class="fas fa-exclamation-circle"></i> Opening balance not configured</small>`;
  } else if (!b.latestClosed) {
    totalFundSubtext = `<small class="fund-card-sub" style="color:var(--text-3);"><i class="fas fa-clock"></i> Configured · Not reconciled</small>`;
  } else {
    totalFundSubtext = `<small class="fund-card-sub" style="color:var(--green);"><i class="fas fa-check-circle"></i> Reconciled as of ${b.latestClosed.month} ${b.latestClosed.year}</small>`;
  }

  const bankSubtext = !b.isOpeningConfigured && b.bankAcc.balance === 0
    ? `<small class="fund-card-sub" style="color:var(--amber);">Not configured</small>`
    : `<small class="fund-card-sub">Islami Bank (IBBL)</small>`;
  const cashSubtext = !b.isOpeningConfigured && b.cashAcc.balance === 0
    ? `<small class="fund-card-sub" style="color:var(--amber);">Not configured</small>`
    : `<small class="fund-card-sub">Cash Drawer</small>`;
  const walletSubtext = !b.isOpeningConfigured && totalMobileWallets === 0
    ? `<small class="fund-card-sub" style="color:var(--amber);">Not configured</small>`
    : `<small class="fund-card-sub">bKash: ${fmtBDT(b.bkashAcc.balance)} · Nagad: ${fmtBDT(b.nagadAcc.balance)}</small>`;

  container.innerHTML = `
    <div class="fund-strip-card" onclick="navigateToReportsSubtab('cashbook')">
      <div class="fund-card-icon bank"><i class="fas fa-university"></i></div>
      <div class="fund-card-content">
        <span class="fund-card-label">Bank Balance</span>
        <strong class="fund-card-val">${fmtBDT(b.bankAcc.balance)}</strong>
        ${bankSubtext}
      </div>
    </div>
    <div class="fund-strip-card" onclick="navigateToReportsSubtab('cashbook')">
      <div class="fund-card-icon cash"><i class="fas fa-money-bill-wave"></i></div>
      <div class="fund-card-content">
        <span class="fund-card-label">Cash Drawer</span>
        <strong class="fund-card-val">${fmtBDT(b.cashAcc.balance)}</strong>
        ${cashSubtext}
      </div>
    </div>
    <div class="fund-strip-card" onclick="navigateToReportsSubtab('cashbook')">
      <div class="fund-card-icon wallet"><i class="fas fa-mobile-alt"></i></div>
      <div class="fund-card-content">
        <span class="fund-card-label">Mobile Wallets</span>
        <strong class="fund-card-val">${fmtBDT(totalMobileWallets)}</strong>
        ${walletSubtext}
      </div>
    </div>
    <div class="fund-strip-card highlight" onclick="navigateToReportsSubtab('cashbook')">
      <div class="fund-card-icon total"><i class="fas fa-coins"></i></div>
      <div class="fund-card-content">
        <span class="fund-card-label">Total Liquid Funds</span>
        <strong class="fund-card-val" style="color:var(--accent-teal);">${fmtBDT(b.totalLiquid)}</strong>
        ${totalFundSubtext}
      </div>
    </div>
  `;
}

function renderCashbookKPIs() {
  const container = document.getElementById("cashbookKpiGrid");
  if (!container) return;

  const b = getAccountingCollectionsBreakdown();

  container.innerHTML = `
    <div class="cb-kpi-card">
      <span class="cb-kpi-label"><i class="fas fa-university"></i> Islami Bank</span>
      <strong class="cb-kpi-val">${fmtBDT(b.bankAcc.balance)}</strong>
      <small class="cb-kpi-sub">${b.isOpeningConfigured ? `Opening: ${fmtBDT(b.bankAcc.openingBalance)}` : "Opening not configured"}</small>
    </div>
    <div class="cb-kpi-card">
      <span class="cb-kpi-label"><i class="fas fa-money-bill-wave"></i> Cash Drawer</span>
      <strong class="cb-kpi-val">${fmtBDT(b.cashAcc.balance)}</strong>
      <small class="cb-kpi-sub">${b.isOpeningConfigured ? `Opening: ${fmtBDT(b.cashAcc.openingBalance)}` : "Opening not configured"}</small>
    </div>
    <div class="cb-kpi-card">
      <span class="cb-kpi-label"><i class="fas fa-mobile-alt"></i> Mobile Wallets</span>
      <strong class="cb-kpi-val">${fmtBDT(b.bkashAcc.balance + b.nagadAcc.balance)}</strong>
      <small class="cb-kpi-sub">bKash: ${fmtBDT(b.bkashAcc.balance)} · Nagad: ${fmtBDT(b.nagadAcc.balance)}</small>
    </div>
    <div class="cb-kpi-card highlight">
      <span class="cb-kpi-label"><i class="fas fa-vault"></i> Total Liquid Accounts</span>
      <strong class="cb-kpi-val" style="color:var(--accent-teal);">${fmtBDT(b.totalLiquid)}</strong>
      <small class="cb-kpi-sub">${b.isOpeningConfigured ? `Opening: ${fmtBDT(b.totalOpening)}` : "Opening not configured"}</small>
    </div>
    <div class="cb-kpi-card">
      <span class="cb-kpi-label"><i class="fas fa-receipt"></i> Verified Member Collections</span>
      <strong class="cb-kpi-val is-paid">${fmtBDT(b.totalMemberCollections)}</strong>
      <small class="cb-kpi-sub">Installments Paid to Date</small>
    </div>
    <div class="cb-kpi-card">
      <span class="cb-kpi-label"><i class="fas fa-history"></i> Unassigned Collections</span>
      <strong class="cb-kpi-val" style="color:var(--amber);">${fmtBDT(b.unassignedCollections)}</strong>
      <small class="cb-kpi-sub">${b.collectionsInCashbook > 0 ? `Assigned to Cashbook: ${fmtBDT(b.collectionsInCashbook)}` : "Pre-Cashbook / Unallocated"}</small>
    </div>
  `;

  let explainBox = document.getElementById("cbAccountingExplainBox");
  if (!explainBox) {
    explainBox = document.createElement("div");
    explainBox.id = "cbAccountingExplainBox";
    container.parentNode.insertBefore(explainBox, container.nextSibling);
  }

  explainBox.className = "accounting-explanation-box";
  explainBox.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
      <div>
        <strong><i class="fas fa-balance-scale"></i> Collections vs Cashbook Alignment:</strong>
        <span> Verified Member Collections: <strong>${fmtBDT(b.totalMemberCollections)}</strong> | Cashbook Liquid Funds: <strong>${fmtBDT(b.totalLiquid)}</strong>.</span>
        ${b.unassignedCollections > 0 ? `
          <div style="font-size:12px; color:var(--amber); margin-top:4px;">
            • <strong>${fmtBDT(b.unassignedCollections)}</strong> (${b.unassignedPayments.length} installment records) collected from members are currently unassigned to specific liquid cashbook accounts.
            Configure opening balances or preview safe migration to allocate without double-counting.
          </div>
        ` : `
          <div style="font-size:12px; color:var(--green); margin-top:4px;">
            • All member collections are fully assigned to cashbook accounts or accounted for in opening balances.
          </div>
        `}
      </div>
      ${currentRole === "admin" && b.unassignedCollections > 0 ? `
        <button type="button" class="btn-secondary" onclick="openCashbookMigrationModal()" style="padding:5px 12px; font-size:11.5px; border-color:var(--amber); color:var(--amber);">
          <i class="fas fa-sliders-h"></i> Preview Migration
        </button>
      ` : ""}
    </div>
  `;
}

function openCashbookMigrationModal() {
  if (currentRole !== "admin") {
    showToast("Admin access required! 🔒", "error");
    return;
  }
  const b = getAccountingCollectionsBreakdown();
  const summaryEl = document.getElementById("cbMigrationSummary");
  const dateInput = document.getElementById("cbMigrationDateInput");
  const previewBox = document.getElementById("cbMigrationPreviewBox");
  const execBtn = document.getElementById("btnExecuteMigration");

  if (dateInput) dateInput.value = b.openingDate || getDhakaDateString();
  if (previewBox) {
    previewBox.classList.add("hidden");
    previewBox.innerHTML = "";
  }
  if (execBtn) execBtn.classList.add("hidden");

  if (summaryEl) {
    summaryEl.innerHTML = `
      <strong>Historical Collections Allocation Status</strong><br/>
      • Total Verified Member Collections: <strong>${fmtBDT(b.totalMemberCollections)}</strong><br/>
      • Collections Currently Linked to Cashbook: <strong>${fmtBDT(b.collectionsInCashbook)}</strong><br/>
      • Unassigned Collections Awaiting Account: <strong style="color:var(--amber);">${fmtBDT(b.unassignedCollections)}</strong> (${b.unassignedPayments.length} payment records)<br/>
      • Current Liquid Funds: <strong>${fmtBDT(b.totalLiquid)}</strong>
    `;
  }

  const modal = document.getElementById("cashbookMigrationModal");
  if (modal) modal.classList.remove("hidden");
}

function closeCashbookMigrationModal() {
  const modal = document.getElementById("cashbookMigrationModal");
  if (modal) modal.classList.add("hidden");
}

function runMigrationDryRun() {
  const b = getAccountingCollectionsBreakdown();
  const targetAcc = document.getElementById("cbMigrationAccountSelect")?.value || "cash";
  const previewBox = document.getElementById("cbMigrationPreviewBox");
  const execBtn = document.getElementById("btnExecuteMigration");

  if (!previewBox) return;

  if (b.unassignedPayments.length === 0) {
    previewBox.classList.remove("hidden");
    previewBox.innerHTML = `
      <div style="color:var(--green); font-weight:600;">
        <i class="fas fa-check-circle"></i> All member collections are already assigned! No unallocated payments found.
      </div>
    `;
    if (execBtn) execBtn.classList.add("hidden");
    return;
  }

  const accLabels = { bank: "Islami Bank", cash: "Cash Drawer", bkash: "bKash", nagad: "Nagad" };
  const targetName = accLabels[targetAcc] || targetAcc;

  const currentAccBal = b[targetAcc + "Acc"]?.balance || 0;
  const simulatedNewBal = currentAccBal + b.unassignedCollections;

  let rows = b.unassignedPayments.slice(0, 15).map((p) => `
    <div>• ${p.memberName} · ${p.month} ${p.year}: <strong>${fmtBDT(p.amount)}</strong> (${p.method})</div>
  `).join("");
  if (b.unassignedPayments.length > 15) {
    rows += `<div style="color:var(--text-3); font-style:italic;">...and ${b.unassignedPayments.length - 15} more records</div>`;
  }

  previewBox.classList.remove("hidden");
  previewBox.innerHTML = `
    <div style="line-height:1.6;">
      <div style="color:var(--amber); font-weight:700;"><i class="fas fa-flask"></i> DRY-RUN PREVIEW (Zero records modified in database):</div>
      <div>• Total payments to link: <strong>${b.unassignedPayments.length} records</strong> totaling <strong>${fmtBDT(b.unassignedCollections)}</strong></div>
      <div>• Target Account: <strong>${targetName}</strong></div>
      <div>• Simulated ${targetName} Balance: ${fmtBDT(currentAccBal)} → <strong>${fmtBDT(simulatedNewBal)}</strong></div>
      <div>• Simulated Unassigned Collections Remaining: <strong>৳0</strong></div>
      <div style="margin-top:8px; border-top:1px dashed var(--border-mid); padding-top:6px;">
        ${rows}
      </div>
    </div>
  `;

  if (execBtn) execBtn.classList.remove("hidden");
}

async function executeMigration() {
  if (currentRole !== "admin") return;
  if (!checkOnlineForFinancialWrite()) return;

  const b = getAccountingCollectionsBreakdown();
  if (b.unassignedPayments.length === 0) {
    showToast("No unassigned payments to migrate.", "info");
    return;
  }

  const targetAcc = document.getElementById("cbMigrationAccountSelect")?.value || "cash";
  const migDate = document.getElementById("cbMigrationDateInput")?.value || getDhakaDateString();

  // Create linked cashbook inflow entries for unassigned payments
  b.unassignedPayments.forEach((p) => {
    fundCashbook.entries.push({
      id: "cbe_mig_" + p.id + "_" + Date.now(),
      type: "inflow",
      account: targetAcc,
      category: "Member Installment Collection",
      amount: p.amount,
      date: migDate,
      reference: `MIG-${p.id}`,
      notes: `Historical allocation: ${p.memberName} (${p.month} ${p.year})`,
      relatedPaymentId: p.id,
      createdAt: new Date().toISOString(),
      createdBy: "Admin Migration",
    });
  });

  recalculateCashbookBalances();
  await logAuditAction(
    "MIGRATE_HISTORICAL_COLLECTIONS",
    `Target: ${targetAcc}`,
    `Allocated ${b.unassignedPayments.length} historical payments totaling ${fmtBDT(b.unassignedCollections)} to ${targetAcc}.`
  );

  await savePaymentDataToStore();
  closeCashbookMigrationModal();
  renderCashbookKPIs();
  renderCashbookTable();
  renderOverviewFundStrip();
  showToast(`Successfully assigned ${fmtBDT(b.unassignedCollections)} to ${targetAcc}! ⚙️`);
}

function renderCashbookTable() {
  const container = document.getElementById("cashbookTableContainer");
  if (!container) return;

  const accountFilter = document.getElementById("cashbookAccountFilter")?.value || "all";
  const typeFilter = document.getElementById("cashbookTypeFilter")?.value || "all";

  let entries = fundCashbook.entries || [];
  if (accountFilter !== "all") {
    entries = entries.filter((e) => e.account === accountFilter || e.fromAccount === accountFilter || e.toAccount === accountFilter);
  }
  if (typeFilter !== "all") {
    entries = entries.filter((e) => e.type === typeFilter);
  }

  entries = [...entries].sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));

  if (entries.length === 0) {
    container.innerHTML = `
      <div class="empty" style="padding:28px; text-align:center;">
        <i class="fas fa-book-open" style="font-size:2rem; color:var(--text-3); margin-bottom:8px; display:block;"></i>
        <span>No cashbook movements recorded for this filter. Use the actions above to record movements, transfers, or opening balances.</span>
      </div>
    `;
    return;
  }

  const accountLabels = {
    bank: "Bank (IBBL)",
    cash: "Cash Drawer",
    bkash: "bKash",
    nagad: "Nagad",
  };

  const rows = entries.map((e) => {
    let typeBadge = "";
    let amountDisplay = "";
    let accountDisplay = "";

    if (e.type === "inflow") {
      typeBadge = `<span class="badge-paid" style="font-size:10px;"><i class="fas fa-arrow-down"></i> Inflow</span>`;
      amountDisplay = `<strong style="color:var(--green); font-variant-numeric:tabular-nums;">+${fmtBDT(e.amount)}</strong>`;
      accountDisplay = accountLabels[e.account] || e.account;
    } else if (e.type === "outflow") {
      typeBadge = `<span class="badge-overdue" style="font-size:10px;"><i class="fas fa-arrow-up"></i> Outflow</span>`;
      amountDisplay = `<strong style="color:var(--rose); font-variant-numeric:tabular-nums;">-${fmtBDT(e.amount)}</strong>`;
      accountDisplay = accountLabels[e.account] || e.account;
    } else if (e.type === "transfer") {
      typeBadge = `<span class="badge-partial" style="font-size:10px;"><i class="fas fa-exchange-alt"></i> Transfer</span>`;
      amountDisplay = `<strong style="color:var(--indigo); font-variant-numeric:tabular-nums;">${fmtBDT(e.amount)}</strong>`;
      accountDisplay = `${accountLabels[e.fromAccount] || e.fromAccount} → ${accountLabels[e.toAccount] || e.toAccount}`;
    }

    return `
      <tr>
        <td>${e.date || "Not recorded"}</td>
        <td>${typeBadge}</td>
        <td>${accountDisplay}</td>
        <td>${e.category || "General"}</td>
        <td style="text-align:right;">${amountDisplay}</td>
        <td><small>${e.reference || "—"}</small></td>
        <td><small>${e.notes || "—"}</small></td>
      </tr>
    `;
  }).join("");

  container.innerHTML = `
    <table class="cashbook-ledger-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Account</th>
          <th>Category</th>
          <th style="text-align:right;">Amount</th>
          <th>Reference</th>
          <th>Notes / Description</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

function openCashbookEntryModal() {
  if (currentRole !== "admin") {
    showToast("Admin access required! 🔒", "error");
    return;
  }
  updateCbCategoryOptions();
  const dateInput = document.getElementById("cbEntryDate");
  if (dateInput) dateInput.value = getDhakaDateString();
  const modal = document.getElementById("cashbookEntryModal");
  if (modal) modal.classList.remove("hidden");
}

function closeCashbookEntryModal() {
  const modal = document.getElementById("cashbookEntryModal");
  if (modal) modal.classList.add("hidden");
}

function updateCbCategoryOptions() {
  const typeSelect = document.getElementById("cbEntryType");
  const catSelect = document.getElementById("cbEntryCategory");
  if (!typeSelect || !catSelect) return;
  const type = typeSelect.value || "inflow";
  const cats = CASHBOOK_CATEGORIES[type] || [];
  catSelect.innerHTML = cats.map((c) => `<option value="${c}">${c}</option>`).join("");
}

async function handleCashbookEntrySubmit(e) {
  e.preventDefault();
  if (currentRole !== "admin") return;
  if (!checkOnlineForFinancialWrite()) return;

  const type = document.getElementById("cbEntryType").value;
  const account = document.getElementById("cbEntryAccount").value;
  const category = document.getElementById("cbEntryCategory").value;
  const amount = parseFloat(document.getElementById("cbEntryAmount").value) || 0;
  const date = document.getElementById("cbEntryDate").value || getDhakaDateString();
  const ref = document.getElementById("cbEntryRef").value.trim();
  const notes = document.getElementById("cbEntryNotes").value.trim();

  if (amount <= 0 || !isFinite(amount)) {
    showToast("Please enter a valid positive amount!", "error");
    return;
  }

  const entry = {
    id: "cbe_" + Date.now(),
    type,
    account,
    category,
    amount,
    date,
    reference: ref,
    notes,
    createdAt: new Date().toISOString(),
    createdBy: "Admin",
  };

  fundCashbook.entries.push(entry);
  recalculateCashbookBalances();
  await logAuditAction(
    "CASHBOOK_ENTRY",
    `${type.toUpperCase()} · ${account}`,
    `Recorded ${type} of ${fmtBDT(amount)} for ${category}. Ref: ${ref || "N/A"}`
  );
  await savePaymentDataToStore();
  closeCashbookEntryModal();
  renderCashbookKPIs();
  renderCashbookTable();
  renderOverviewFundStrip();
  showToast(`Cashbook ${type} of ${fmtBDT(amount)} saved! ✅`);
}

function openCashbookTransferModal() {
  if (currentRole !== "admin") {
    showToast("Admin access required! 🔒", "error");
    return;
  }
  const dateInput = document.getElementById("cbTransferDate");
  if (dateInput) dateInput.value = getDhakaDateString();
  const modal = document.getElementById("cashbookTransferModal");
  if (modal) modal.classList.remove("hidden");
}

function closeCashbookTransferModal() {
  const modal = document.getElementById("cashbookTransferModal");
  if (modal) modal.classList.add("hidden");
}

async function handleCashbookTransferSubmit(e) {
  e.preventDefault();
  if (currentRole !== "admin") return;
  if (!checkOnlineForFinancialWrite()) return;

  const fromAccount = document.getElementById("cbTransferFrom").value;
  const toAccount = document.getElementById("cbTransferTo").value;
  const amount = parseFloat(document.getElementById("cbTransferAmount").value) || 0;
  const date = document.getElementById("cbTransferDate").value || getDhakaDateString();
  const ref = document.getElementById("cbTransferRef").value.trim();

  if (fromAccount === toAccount) {
    showToast("Source and destination accounts must be different!", "warning");
    return;
  }
  if (amount <= 0 || !isFinite(amount)) {
    showToast("Please enter a valid positive transfer amount!", "error");
    return;
  }

  const entry = {
    id: "cbt_" + Date.now(),
    type: "transfer",
    fromAccount,
    toAccount,
    amount,
    date,
    category: "Internal Account Transfer",
    reference: ref,
    notes: `Internal transfer from ${fromAccount} to ${toAccount}`,
    createdAt: new Date().toISOString(),
    createdBy: "Admin",
  };

  fundCashbook.entries.push(entry);
  recalculateCashbookBalances();
  await logAuditAction(
    "INTERNAL_TRANSFER",
    `${fromAccount} → ${toAccount}`,
    `Transferred ${fmtBDT(amount)} from ${fromAccount} to ${toAccount}. Total fund unchanged.`
  );
  await savePaymentDataToStore();
  closeCashbookTransferModal();
  renderCashbookKPIs();
  renderCashbookTable();
  renderOverviewFundStrip();
  showToast(`Transfer of ${fmtBDT(amount)} executed! ⇄`);
}

function openOpeningBalanceModal() {
  if (currentRole !== "admin") {
    showToast("Admin access required! 🔒", "error");
    return;
  }
  const op = fundCashbook.openingBalances || {};
  document.getElementById("cbOpeningDate").value = op.date || "2026-01-01";
  document.getElementById("cbOpeningBank").value = op.bank || 0;
  document.getElementById("cbOpeningCash").value = op.cash || 0;
  document.getElementById("cbOpeningBkash").value = op.bkash || 0;
  document.getElementById("cbOpeningNagad").value = op.nagad || 0;
  document.getElementById("cbOpeningNotes").value = op.notes || "";
  const modal = document.getElementById("cashbookOpeningModal");
  if (modal) modal.classList.remove("hidden");
}

function closeOpeningBalanceModal() {
  const modal = document.getElementById("cashbookOpeningModal");
  if (modal) modal.classList.add("hidden");
}

async function handleOpeningBalanceSubmit(e) {
  e.preventDefault();
  if (currentRole !== "admin") return;
  if (!checkOnlineForFinancialWrite()) return;

  const date = document.getElementById("cbOpeningDate").value;
  const bank = parseFloat(document.getElementById("cbOpeningBank").value) || 0;
  const cash = parseFloat(document.getElementById("cbOpeningCash").value) || 0;
  const bkash = parseFloat(document.getElementById("cbOpeningBkash").value) || 0;
  const nagad = parseFloat(document.getElementById("cbOpeningNagad").value) || 0;
  const notes = document.getElementById("cbOpeningNotes").value.trim();

  fundCashbook.openingBalances = {
    date,
    bank,
    cash,
    bkash,
    nagad,
    notes,
    configured: true,
  };

  recalculateCashbookBalances();
  await logAuditAction(
    "SET_OPENING_BALANCES",
    `Effective: ${date}`,
    `Opening Balances set: Bank: ৳${bank}, Cash: ৳${cash}, bKash: ৳${bkash}, Nagad: ৳${nagad}`
  );
  await savePaymentDataToStore();
  closeOpeningBalanceModal();
  renderCashbookKPIs();
  renderCashbookTable();
  renderOverviewFundStrip();
  showToast("Verified opening balances saved! ⚙️");
}

// ─────────────────────────────────────────────────────────────────
// 🚫 REVERSE / VOID PAYMENT WORKFLOW
// ─────────────────────────────────────────────────────────────────

let targetVoidTxInfo = null;

function openVoidPaymentModal(year, monthName, memberName, paymentId) {
  if (currentRole !== "admin") {
    showToast("Admin access required! 🔒", "error");
    return;
  }

  const rec = getCycleReconciliation(year, monthName);
  if (rec && rec.isClosed) {
    showToast(`Cycle ${monthName} ${year} is closed & reconciled. Reopen period to void transactions. 🔒`, "error");
    return;
  }

  const yearData = paymentData.find((y) => y.year == year);
  const monthData = yearData?.months.find((m) => m.month === monthName);
  const payment = monthData?.payments.find((p) => p.name === memberName);
  const tx = payment?.paymentsList?.find((t) => t.id === paymentId);

  if (!tx) {
    showToast("Transaction not found!", "error");
    return;
  }

  if (tx.status === "voided") {
    showToast("This payment has already been voided/reversed and cannot be modified again! 🛑", "warning");
    return;
  }

  recalculateMemberCredits();
  const info = memberCreditLedger[memberName] || { available: 0, totalGenerated: 0, totalAllocated: 0 };
  const remainingAfterVoid = (info.totalGenerated - tx.amount) - info.totalAllocated;
  if (remainingAfterVoid < 0) {
    showToast(`Cannot void this payment: ৳${Math.abs(remainingAfterVoid)} of credit generated by this payment has already been allocated to other installments. De-allocate credit first! ⚠️`, "error");
    return;
  }

  targetVoidTxInfo = { year, monthName, memberName, paymentId, tx, payment };

  const summaryCard = document.getElementById("voidTxSummaryCard");
  if (summaryCard) {
    summaryCard.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong>${memberName}</strong> · ${monthName} ${year}
          <div style="font-size:12px; color:var(--text-3);"><i class="fas fa-receipt"></i> Ref: ${tx.reference || "N/A"} · ${tx.method}</div>
        </div>
        <div style="text-align:right;">
          <strong style="color:var(--rose); font-size:16px;">${fmtBDT(tx.amount)}</strong>
          <small style="display:block; color:var(--text-3);">${tx.date || "Not recorded"}</small>
        </div>
      </div>
    `;
  }

  document.getElementById("voidReasonInput").value = "";
  const radio = document.querySelector('input[name="voidTypeChoice"][value="correction"]');
  if (radio) radio.checked = true;
  updateVoidTypeUI();

  const modal = document.getElementById("voidPaymentModal");
  if (modal) modal.classList.remove("hidden");
}

function updateVoidTypeUI() {
  const voidType = document.querySelector('input[name="voidTypeChoice"]:checked')?.value || "correction";
  const accGroup = document.getElementById("voidAccountGroup");
  const noticeBox = document.getElementById("voidPreviewNotice");
  if (!targetVoidTxInfo) return;

  const { payment, tx } = targetVoidTxInfo;
  const currentPaid = payment.paidAmount || 0;
  const newPaid = Math.max(0, currentPaid - tx.amount);
  const newBalance = Math.max(0, payment.amount - newPaid);

  if (voidType === "refund") {
    if (accGroup) accGroup.classList.remove("hidden");
    if (noticeBox) {
      noticeBox.innerHTML = `
        <strong>Preview Effect (Cash Refund):</strong><br/>
        • Paid so far will decrease from ${fmtBDT(currentPaid)} to ${fmtBDT(newPaid)}.<br/>
        • Installment balance will increase to ${fmtBDT(newBalance)}.<br/>
        • <strong>${fmtBDT(tx.amount)}</strong> will be deducted as an Outflow from the selected cashbook account.<br/>
        • Original payment record will be preserved with a VOIDED status tag.
      `;
    }
  } else {
    if (accGroup) accGroup.classList.add("hidden");
    if (noticeBox) {
      noticeBox.innerHTML = `
        <strong>Preview Effect (Error Correction):</strong><br/>
        • Paid so far will decrease from ${fmtBDT(currentPaid)} to ${fmtBDT(newPaid)}.<br/>
        • Installment balance will increase to ${fmtBDT(newBalance)}.<br/>
        • Cashbook balance will <strong>not</strong> change (correction of entry mistake).<br/>
        • Original payment record will be preserved with a VOIDED status tag.
      `;
    }
  }
}

function closeVoidPaymentModal() {
  const modal = document.getElementById("voidPaymentModal");
  if (modal) modal.classList.add("hidden");
  targetVoidTxInfo = null;
}

async function handleVoidPaymentSubmit(e) {
  e.preventDefault();
  if (currentRole !== "admin") return;
  if (!checkOnlineForFinancialWrite()) return;
  if (!targetVoidTxInfo) return;

  const reason = document.getElementById("voidReasonInput").value.trim();
  if (!reason) {
    showToast("Mandatory reversal reason required!", "error");
    return;
  }

  const voidType = document.querySelector('input[name="voidTypeChoice"]:checked')?.value || "correction";
  const voidAccount = document.getElementById("voidAccountSelect")?.value || "bank";

  const { year, monthName, memberName, tx, payment } = targetVoidTxInfo;

  const rec = getCycleReconciliation(year, monthName);
  if (rec && rec.isClosed) {
    showToast(`Cycle ${monthName} ${year} is closed & reconciled. Reopen period to reverse payments. 🔒`, "error");
    return;
  }
  if (rec && rec.status === "reconciled") {
    rec.status = "invalidated";
    rec.invalidatedAt = new Date().toISOString();
  }

  tx.status = "voided";
  tx.voidReason = reason;
  tx.voidType = voidType;
  tx.voidedAt = new Date().toISOString();
  tx.voidedBy = "Admin";

  if (voidType === "refund") {
    const refundEntry = {
      id: "cbe_ref_" + Date.now(),
      type: "outflow",
      account: voidAccount,
      category: "Member Cash Refund",
      amount: tx.amount,
      date: getDhakaDateString(),
      reference: "REFUND-" + tx.id,
      notes: `Cash refund to ${memberName} for voided payment (${reason})`,
      relatedPaymentId: tx.id,
      createdAt: new Date().toISOString(),
      createdBy: "Admin",
    };
    fundCashbook.entries.push(refundEntry);
    recalculateCashbookBalances();
  }

  const totalPaid = payment.paymentsList
    .filter((x) => x.status !== "voided")
    .reduce((s, x) => s + (Number(x.amount) || 0), 0);
  payment.paidAmount = totalPaid;
  payment.balance = Math.max(0, payment.amount - totalPaid);
  payment.paid = totalPaid >= payment.amount;

  recalculateMemberCredits();

  await logAuditAction(
    "VOID_PAYMENT",
    `${memberName} · ${monthName} ${year}`,
    `Voided payment of ${fmtBDT(tx.amount)} (${voidType}): ${reason}. Balance now: ${fmtBDT(payment.balance)}.`,
    `Paid: ${fmtBDT(totalPaid + tx.amount)}`,
    `Paid: ${fmtBDT(totalPaid)}`
  );

  await savePaymentDataToStore(`${year}-${monthName}`);
  closeVoidPaymentModal();
  showToast(`Payment of ${fmtBDT(tx.amount)} voided successfully! 🛑`);
  openPaymentDetailModal(year, monthName, memberName);
  applyFilters();
}

// ─────────────────────────────────────────────────────────────────
// 💳 ADVANCE CREDIT & ALLOCATION LEDGER
// ─────────────────────────────────────────────────────────────────

function recalculateMemberCredits() {
  const members = getAllMemberNames();
  const ledger = {};
  members.forEach((m) => {
    ledger[m] = {
      available: 0,
      totalGenerated: 0,
      totalAllocated: 0,
      allocations: [],
    };
  });

  paymentData.forEach((y) => {
    (y.months || []).forEach((m) => {
      (m.payments || []).forEach((p) => {
        const memberName = p.name;
        if (!ledger[memberName]) {
          ledger[memberName] = { available: 0, totalGenerated: 0, totalAllocated: 0, allocations: [] };
        }

        const pmtList = p.paymentsList || [];
        let directPaid = 0;
        let creditAllocPaid = 0;

        pmtList.forEach((tx) => {
          if (tx.status === "voided") return;
          if (tx.isCreditAllocation) {
            creditAllocPaid += Number(tx.amount) || 0;
          } else {
            directPaid += Number(tx.amount) || 0;
          }
        });

        if (pmtList.length === 0 && p.paid) {
          directPaid = Number(p.amount) || 1000;
        }

        const expected = Number(p.amount) || 1000;
        const surplus = Math.max(0, directPaid - (expected - creditAllocPaid));
        ledger[memberName].totalGenerated += surplus;
        ledger[memberName].totalAllocated += creditAllocPaid;
      });
    });
  });

  Object.keys(ledger).forEach((memberName) => {
    ledger[memberName].available = Math.max(0, ledger[memberName].totalGenerated - ledger[memberName].totalAllocated);
  });

  memberCreditLedger = ledger;
  return ledger;
}

let activeCreditAllocMember = null;

function openAllocateCreditModal(memberName) {
  if (currentRole !== "admin") {
    showToast("Admin access required! 🔒", "error");
    return;
  }
  recalculateMemberCredits();
  const info = memberCreditLedger[memberName] || { available: 0 };
  if (info.available <= 0) {
    showToast(`${memberName} does not have any available advance credit to allocate!`, "warning");
    return;
  }

  activeCreditAllocMember = memberName;
  const headerCard = document.getElementById("allocCreditHeaderCard");
  if (headerCard) {
    headerCard.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong>${memberName}</strong>
          <small style="display:block; color:var(--text-3);">Surplus Advance Credit Pool</small>
        </div>
        <div style="text-align:right;">
          <strong style="color:var(--accent-teal); font-size:18px;">${fmtBDT(info.available)}</strong>
          <small style="display:block; color:var(--text-3);">Available to allocate</small>
        </div>
      </div>
    `;
  }

  const select = document.getElementById("allocTargetMonthSelect");
  if (select) {
    select.innerHTML = "";
    let countUnpaid = 0;
    paymentData.forEach((y) => {
      (y.months || []).forEach((m) => {
        const p = (m.payments || []).find((x) => x.name === memberName);
        if (p) {
          const norm = normalizePaymentRecord(p, m.dueDate);
          if (norm.balance > 0) {
            countUnpaid++;
            select.innerHTML += `<option value="${y.year}|${m.month}|${norm.balance}">${m.month} ${y.year} (Remaining: ${fmtBDT(norm.balance)})</option>`;
          }
        }
      });
    });

    if (countUnpaid === 0) {
      showToast(`${memberName} has no outstanding unpaid installments!`, "info");
      return;
    }
  }

  const amtInput = document.getElementById("allocAmountInput");
  if (amtInput && select) {
    const firstOption = select.options[0]?.value;
    const targetBalance = firstOption ? parseFloat(firstOption.split("|")[2]) : info.available;
    amtInput.value = Math.min(info.available, targetBalance);
  }

  updateAllocCreditPreview();
  const modal = document.getElementById("allocateCreditModal");
  if (modal) modal.classList.remove("hidden");
}

function updateAllocCreditPreview() {
  const box = document.getElementById("allocPreviewBox");
  const select = document.getElementById("allocTargetMonthSelect");
  const amtInput = document.getElementById("allocAmountInput");
  if (!box || !select || !amtInput || !activeCreditAllocMember) return;

  const memberName = activeCreditAllocMember;
  const info = memberCreditLedger[memberName] || { available: 0 };
  const allocAmount = parseFloat(amtInput.value) || 0;
  const selectedVal = select.value;
  if (!selectedVal) return;

  const [tYear, tMonth, tBalanceStr] = selectedVal.split("|");
  const tBalance = parseFloat(tBalanceStr) || 0;

  if (allocAmount > info.available) {
    box.innerHTML = `<span style="color:var(--rose);"><i class="fas fa-exclamation-triangle"></i> Amount exceeds available credit (${fmtBDT(info.available)})!</span>`;
    return;
  }
  if (allocAmount <= 0) {
    box.innerHTML = `<span style="color:var(--text-3);">Enter a valid allocation amount.</span>`;
    return;
  }

  const remainingCredit = info.available - allocAmount;
  const newTargetBalance = Math.max(0, tBalance - allocAmount);

  box.innerHTML = `
    <div style="font-size:12px; line-height:1.6;">
      <div>• Applying <strong>${fmtBDT(allocAmount)}</strong> from ${memberName}'s surplus credit to <strong>${tMonth} ${tYear}</strong>.</div>
      <div>• Target balance will decrease from <strong>${fmtBDT(tBalance)}</strong> to <strong>${fmtBDT(newTargetBalance)}</strong>.</div>
      <div>• Remaining available credit after allocation: <strong>${fmtBDT(remainingCredit)}</strong>.</div>
      <div style="color:var(--text-3); margin-top:4px;">* Internal credit allocation does not record duplicate cash or inflate total fund collections.</div>
    </div>
  `;
}

function closeAllocateCreditModal() {
  const modal = document.getElementById("allocateCreditModal");
  if (modal) modal.classList.add("hidden");
  activeCreditAllocMember = null;
}

async function handleAllocateCreditSubmit(e) {
  e.preventDefault();
  if (currentRole !== "admin") return;
  if (!checkOnlineForFinancialWrite()) return;
  if (!activeCreditAllocMember) return;

  const memberName = activeCreditAllocMember;
  const select = document.getElementById("allocTargetMonthSelect");
  const amtInput = document.getElementById("allocAmountInput");
  const allocAmount = parseFloat(amtInput.value) || 0;
  const [tYear, tMonth] = (select.value || "").split("|");
  const year = parseInt(tYear);

  const info = memberCreditLedger[memberName] || { available: 0 };
  if (allocAmount <= 0 || allocAmount > info.available) {
    showToast("Invalid allocation amount!", "error");
    return;
  }

  const rec = getCycleReconciliation(year, tMonth);
  if (rec && rec.isClosed) {
    showToast(`Cycle ${tMonth} ${year} is locked & reconciled. Cannot allocate credit without unlocking period. 🔒`, "error");
    return;
  }

  const yearData = paymentData.find((y) => y.year == year);
  const monthData = yearData?.months.find((m) => m.month === tMonth);
  const payment = monthData?.payments.find((p) => p.name === memberName);

  if (!payment) {
    showToast("Target installment not found!", "error");
    return;
  }

  if (!payment.paymentsList) {
    payment.paymentsList = [];
    if (payment.paid && payment.paidAmount > 0) {
      payment.paymentsList.push({
        id: "pmt_legacy",
        amount: payment.paidAmount,
        date: "Legacy Recorded",
        method: "Legacy Method",
        reference: "LEGACY",
        receiptRef: "",
        verified: true,
        verifiedBy: "Baseline",
      });
    }
  }

  const newTx = {
    id: "pmt_alloc_" + Date.now(),
    amount: allocAmount,
    date: getDhakaDateString(),
    method: "Advance Credit Allocation",
    reference: `CREDIT-ALLOC`,
    receiptRef: "",
    isCreditAllocation: true,
    verified: true,
    verifiedBy: "Shared Admin Session",
    notes: `Allocated from advance credit surplus`,
  };

  payment.paymentsList.push(newTx);

  const totalPaid = payment.paymentsList
    .filter((x) => x.status !== "voided")
    .reduce((s, x) => s + (Number(x.amount) || 0), 0);
  payment.paidAmount = totalPaid;
  payment.balance = Math.max(0, payment.amount - totalPaid);
  payment.paid = totalPaid >= payment.amount;

  recalculateMemberCredits();
  await logAuditAction(
    "ALLOCATE_CREDIT",
    `${memberName} · ${tMonth} ${year}`,
    `Allocated ${fmtBDT(allocAmount)} from member credit surplus to ${tMonth} ${year}. Balance now: ${fmtBDT(payment.balance)}.`
  );

  if (rec && rec.status === "reconciled") {
    rec.status = "invalidated";
    rec.invalidatedAt = new Date().toISOString();
  }

  await savePaymentDataToStore(`${year}-${tMonth}`);
  closeAllocateCreditModal();
  showToast(`Successfully allocated ${fmtBDT(allocAmount)} credit for ${memberName}! 💳`);
  applyFilters();
}

// ─────────────────────────────────────────────────────────────────
// 🔒 MONTHLY CLOSE & RECONCILIATION
// ─────────────────────────────────────────────────────────────────

function getCycleReconciliation(year, monthName) {
  const key = `${year}-${monthName}`;
  return (monthlyReconciliations || []).find((r) => r.cycleKey === key);
}

function initReconciliationCycles() {
  const select = document.getElementById("recCycleSelect");
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = "";

  paymentData.forEach((y) => {
    (y.months || []).forEach((m) => {
      const key = `${y.year}-${m.month}`;
      const rec = getCycleReconciliation(y.year, m.month);
      const isClosed = rec && rec.isClosed;
      select.innerHTML += `<option value="${key}">${m.month} ${y.year} ${isClosed ? "🔒 (Closed)" : "🔓 (Open)"}</option>`;
    });
  });

  if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
    select.value = currentVal;
  }
}

function updateReconciliationView() {
  const select = document.getElementById("recCycleSelect");
  const badge = document.getElementById("recCycleStatusBadge");
  const formContainer = document.getElementById("recFormContainer");
  if (!select || !badge || !formContainer) return;

  const key = select.value;
  if (!key) return;

  const [yearStr, monthName] = key.split("-");
  const year = parseInt(yearStr);
  const rec = getCycleReconciliation(year, monthName);
  const isClosed = rec && rec.isClosed;

  if (isClosed) {
    badge.className = "rec-status-pill closed";
    badge.innerHTML = `<i class="fas fa-lock"></i> Reconciled & Closed`;
  } else {
    badge.className = "rec-status-pill open";
    badge.innerHTML = `<i class="fas fa-lock-open"></i> Period Open`;
  }

  recalculateCashbookBalances();
  const bankAcc = fundCashbook.accounts.find((a) => a.id === "bank") || { balance: 0 };
  const cashAcc = fundCashbook.accounts.find((a) => a.id === "cash") || { balance: 0 };
  const bkashAcc = fundCashbook.accounts.find((a) => a.id === "bkash") || { balance: 0 };
  const nagadAcc = fundCashbook.accounts.find((a) => a.id === "nagad") || { balance: 0 };

  function evaluateStatementInput(rawVal, bookBalance, inputEl = null) {
    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === "") {
      if (inputEl) inputEl.classList.remove("input-error");
      return {
        status: "missing",
        pill: `<span class="variance-pill missing"><i class="fas fa-question-circle"></i> Not verified</span>`,
        variance: null,
        val: null,
        isValid: false,
      };
    }

    const trimmed = String(rawVal).trim();
    const num = Number(trimmed);
    if (isNaN(num) || !isFinite(num) || num < 0) {
      if (inputEl) inputEl.classList.add("input-error");
      return {
        status: "invalid",
        pill: `<span class="variance-pill error"><i class="fas fa-exclamation-circle"></i> Invalid amount</span>`,
        variance: null,
        val: null,
        isValid: false,
      };
    }

    if (inputEl) inputEl.classList.remove("input-error");
    const variance = Math.round((num - bookBalance) * 100) / 100;
    if (variance === 0) {
      return {
        status: "balanced",
        pill: `<span class="variance-pill zero"><i class="fas fa-check"></i> Balanced (৳0)</span>`,
        variance: 0,
        val: num,
        isValid: true,
      };
    }

    return {
      status: "variance",
      pill: `<span class="variance-pill diff"><i class="fas fa-exclamation-triangle"></i> Variance: ${fmtBDT(variance)}</span>`,
      variance: variance,
      val: num,
      isValid: true,
    };
  }

  const stBank = rec?.statementBalances?.bank !== undefined ? rec.statementBalances.bank : "";
  const stCash = rec?.statementBalances?.cash !== undefined ? rec.statementBalances.cash : "";
  const stBkash = rec?.statementBalances?.bkash !== undefined ? rec.statementBalances.bkash : "";
  const stNagad = rec?.statementBalances?.nagad !== undefined ? rec.statementBalances.nagad : "";

  const evalBank = evaluateStatementInput(stBank, bankAcc.balance);
  const evalCash = evaluateStatementInput(stCash, cashAcc.balance);
  const evalBkash = evaluateStatementInput(stBkash, bkashAcc.balance);
  const evalNagad = evaluateStatementInput(stNagad, nagadAcc.balance);

  formContainer.innerHTML = `
    <table class="rec-compare-table">
      <thead>
        <tr>
          <th>Account</th>
          <th>Cashbook Balance</th>
          <th>Verified Statement Balance (৳)</th>
          <th>Variance Check</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><i class="fas fa-university"></i> Islami Bank</td>
          <td><strong>${fmtBDT(bankAcc.balance)}</strong></td>
          <td>
            <input type="number" id="recStmtBank" class="modern-input" value="${stBank !== "" ? stBank : ""}" placeholder="Enter verified balance" ${isClosed ? "disabled" : ""} oninput="recalculateRecVariances()" />
          </td>
          <td id="recVarBankCell">${evalBank.pill}</td>
        </tr>
        <tr>
          <td><i class="fas fa-money-bill-wave"></i> Cash Drawer</td>
          <td><strong>${fmtBDT(cashAcc.balance)}</strong></td>
          <td>
            <input type="number" id="recStmtCash" class="modern-input" value="${stCash !== "" ? stCash : ""}" placeholder="Enter verified balance" ${isClosed ? "disabled" : ""} oninput="recalculateRecVariances()" />
          </td>
          <td id="recVarCashCell">${evalCash.pill}</td>
        </tr>
        <tr>
          <td><i class="fas fa-mobile-alt"></i> bKash Wallet</td>
          <td><strong>${fmtBDT(bkashAcc.balance)}</strong></td>
          <td>
            <input type="number" id="recStmtBkash" class="modern-input" value="${stBkash !== "" ? stBkash : ""}" placeholder="Enter verified balance" ${isClosed ? "disabled" : ""} oninput="recalculateRecVariances()" />
          </td>
          <td id="recVarBkashCell">${evalBkash.pill}</td>
        </tr>
        <tr>
          <td><i class="fas fa-mobile-alt"></i> Nagad Wallet</td>
          <td><strong>${fmtBDT(nagadAcc.balance)}</strong></td>
          <td>
            <input type="number" id="recStmtNagad" class="modern-input" value="${stNagad !== "" ? stNagad : ""}" placeholder="Enter verified balance" ${isClosed ? "disabled" : ""} oninput="recalculateRecVariances()" />
          </td>
          <td id="recVarNagadCell">${evalNagad.pill}</td>
        </tr>
      </tbody>
    </table>

    <div class="form-group modern-field" style="margin-top: 14px;">
      <label for="recNotesInput"><i class="fas fa-comment-alt"></i> Reconciliation Notes / Statement Ref</label>
      <input type="text" id="recNotesInput" class="modern-input" value="${rec?.notes || ""}" placeholder="e.g. Verified with IBBL statement #12345 & cash drawer count" ${isClosed ? "disabled" : ""} />
    </div>

    <div class="rec-actions-row" style="margin-top:16px;">
      ${!isClosed ? `
        <button type="button" class="btn-submit" onclick="handleReconcileCloseSubmit('${key}')" style="background:var(--accent-teal); color:#000;">
          <i class="fas fa-lock"></i> Reconcile & Lock Cycle
        </button>
      ` : `
        <button type="button" class="btn-submit" onclick="openReopenMonthModal('${key}')" style="background:var(--amber); color:#000;">
          <i class="fas fa-unlock"></i> Unlock Cycle for Corrections
        </button>
      `}
    </div>
  `;

  renderReconciliationHistoryTable();
}

function recalculateRecVariances() {
  recalculateCashbookBalances();
  const bankAcc = fundCashbook.accounts.find((a) => a.id === "bank") || { balance: 0 };
  const cashAcc = fundCashbook.accounts.find((a) => a.id === "cash") || { balance: 0 };
  const bkashAcc = fundCashbook.accounts.find((a) => a.id === "bkash") || { balance: 0 };
  const nagadAcc = fundCashbook.accounts.find((a) => a.id === "nagad") || { balance: 0 };

  const elBank = document.getElementById("recStmtBank");
  const elCash = document.getElementById("recStmtCash");
  const elBkash = document.getElementById("recStmtBkash");
  const elNagad = document.getElementById("recStmtNagad");

  const evalBank = evaluateStatementInput(elBank?.value, bankAcc.balance, elBank);
  const evalCash = evaluateStatementInput(elCash?.value, cashAcc.balance, elCash);
  const evalBkash = evaluateStatementInput(elBkash?.value, bkashAcc.balance, elBkash);
  const evalNagad = evaluateStatementInput(elNagad?.value, nagadAcc.balance, elNagad);

  const cB = document.getElementById("recVarBankCell");
  const cC = document.getElementById("recVarCashCell");
  const cBk = document.getElementById("recVarBkashCell");
  const cN = document.getElementById("recVarNagadCell");

  if (cB) cB.innerHTML = evalBank.pill;
  if (cC) cC.innerHTML = evalCash.pill;
  if (cBk) cBk.innerHTML = evalBkash.pill;
  if (cN) cN.innerHTML = evalNagad.pill;
}

function evaluateStatementInput(rawVal, bookBalance, inputEl = null) {
  if (rawVal === undefined || rawVal === null || String(rawVal).trim() === "") {
    if (inputEl) inputEl.classList.remove("input-error");
    return {
      status: "missing",
      pill: `<span class="variance-pill missing"><i class="fas fa-question-circle"></i> Not verified</span>`,
      variance: null,
      val: null,
      isValid: false,
    };
  }

  const trimmed = String(rawVal).trim();
  const num = Number(trimmed);
  if (isNaN(num) || !isFinite(num) || num < 0) {
    if (inputEl) inputEl.classList.add("input-error");
    return {
      status: "invalid",
      pill: `<span class="variance-pill error"><i class="fas fa-exclamation-circle"></i> Invalid amount</span>`,
      variance: null,
      val: null,
      isValid: false,
    };
  }

  if (inputEl) inputEl.classList.remove("input-error");
  const variance = Math.round((num - bookBalance) * 100) / 100;
  if (variance === 0) {
    return {
      status: "balanced",
      pill: `<span class="variance-pill zero"><i class="fas fa-check"></i> Balanced (৳0)</span>`,
      variance: 0,
      val: num,
      isValid: true,
    };
  }

  return {
    status: "variance",
    pill: `<span class="variance-pill diff"><i class="fas fa-exclamation-triangle"></i> Variance: ${fmtBDT(variance)}</span>`,
    variance: variance,
    val: num,
    isValid: true,
  };
}

async function handleReconcileCloseSubmit(cycleKey) {
  if (currentRole !== "admin") return;
  if (!checkOnlineForFinancialWrite()) return;

  const [yearStr, monthName] = cycleKey.split("-");
  const year = parseInt(yearStr);

  recalculateCashbookBalances();
  const bankAcc = fundCashbook.accounts.find((a) => a.id === "bank") || { balance: 0 };
  const cashAcc = fundCashbook.accounts.find((a) => a.id === "cash") || { balance: 0 };
  const bkashAcc = fundCashbook.accounts.find((a) => a.id === "bkash") || { balance: 0 };
  const nagadAcc = fundCashbook.accounts.find((a) => a.id === "nagad") || { balance: 0 };

  const elBank = document.getElementById("recStmtBank");
  const elCash = document.getElementById("recStmtCash");
  const elBkash = document.getElementById("recStmtBkash");
  const elNagad = document.getElementById("recStmtNagad");

  const evalBank = evaluateStatementInput(elBank?.value, bankAcc.balance, elBank);
  const evalCash = evaluateStatementInput(elCash?.value, cashAcc.balance, elCash);
  const evalBkash = evaluateStatementInput(elBkash?.value, bkashAcc.balance, elBkash);
  const evalNagad = evaluateStatementInput(elNagad?.value, nagadAcc.balance, elNagad);

  // 1. Block if any account statement balance is blank
  if (evalBank.status === "missing" || evalCash.status === "missing" || evalBkash.status === "missing" || evalNagad.status === "missing") {
    showToast("Reconciliation blocked: All account statement balances must be explicitly entered (none can be blank).", "error");
    return;
  }

  // 2. Block if any input is invalid
  if (evalBank.status === "invalid" || evalCash.status === "invalid" || evalBkash.status === "invalid" || evalNagad.status === "invalid") {
    showToast("Reconciliation blocked: Please enter valid positive numeric amounts.", "error");
    return;
  }

  // 3. Block if any variance is unresolved
  if (evalBank.variance !== 0 || evalCash.variance !== 0 || evalBkash.variance !== 0 || evalNagad.variance !== 0) {
    showToast("Cannot lock period with unresolved differences! Statement balances must match cashbook balances.", "error");
    return;
  }

  const notes = document.getElementById("recNotesInput")?.value.trim() || "";

  const record = {
    cycleKey,
    year,
    month: monthName,
    isClosed: true,
    status: "reconciled",
    closedAt: new Date().toISOString(),
    closedBy: currentRole === "admin" ? "Admin" : "Shared Admin Session",
    statementBalances: { bank: evalBank.val, cash: evalCash.val, bkash: evalBkash.val, nagad: evalNagad.val },
    bookBalances: { bank: bankAcc.balance, cash: cashAcc.balance, bkash: bkashAcc.balance, nagad: nagadAcc.balance },
    variances: { bank: 0, cash: 0, bkash: 0, nagad: 0 },
    notes,
    reopenHistory: [],
  };

  const existingIdx = monthlyReconciliations.findIndex((r) => r.cycleKey === cycleKey);
  if (existingIdx !== -1) {
    record.reopenHistory = monthlyReconciliations[existingIdx].reopenHistory || [];
    monthlyReconciliations[existingIdx] = record;
  } else {
    monthlyReconciliations.push(record);
  }

  await logAuditAction(
    "CLOSE_MONTH_CYCLE",
    `${monthName} ${year}`,
    `Reconciled and locked cycle ${monthName} ${year}. Verified statement balances matched ledger. Statement reference: ${notes || "None"}.`
  );

  await savePaymentDataToStore(cycleKey);
  initReconciliationCycles();
  updateReconciliationView();
  renderOverviewFundStrip();
  showToast(`Cycle ${monthName} ${year} reconciled and locked! 🔒`);
}

let targetReopenCycleKey = null;

function openReopenMonthModal(cycleKey) {
  if (currentRole !== "admin") return;
  targetReopenCycleKey = cycleKey;
  const [yearStr, monthName] = cycleKey.split("-");
  const summary = document.getElementById("reopenCycleSummary");
  if (summary) {
    summary.innerHTML = `
      <strong>Unlock Reconciled Cycle: ${monthName} ${yearStr}</strong><br/>
      <small style="color:var(--text-3);">Opening a locked cycle permits payment edits and reversals. Reopening requires a valid reason and admin passcode.</small>
    `;
  }
  document.getElementById("reopenReasonInput").value = "";
  document.getElementById("reopenPasscodeInput").value = "";
  const modal = document.getElementById("reopenMonthModal");
  if (modal) modal.classList.remove("hidden");
}

function closeReopenMonthModal() {
  const modal = document.getElementById("reopenMonthModal");
  if (modal) modal.classList.add("hidden");
  targetReopenCycleKey = null;
}

async function handleReopenMonthSubmit(e) {
  e.preventDefault();
  if (currentRole !== "admin") return;
  if (!checkOnlineForFinancialWrite()) return;
  if (!targetReopenCycleKey) return;

  const reason = document.getElementById("reopenReasonInput").value.trim();
  const passcode = document.getElementById("reopenPasscodeInput").value;

  if (passcode !== ADMIN_PASSWORD) {
    showToast("Invalid admin passcode! Reopening denied.", "error");
    return;
  }
  if (!reason) {
    showToast("Mandatory reopening justification required!", "error");
    return;
  }

  const rec = monthlyReconciliations.find((r) => r.cycleKey === targetReopenCycleKey);
  if (rec) {
    rec.isClosed = false;
    rec.status = "reopened";
    rec.reopenHistory = rec.reopenHistory || [];
    rec.reopenHistory.push({
      reopenedAt: new Date().toISOString(),
      reopenedBy: currentRole === "admin" ? "Admin" : "Shared Admin Session",
      reason,
    });
  }

  const [yearStr, monthName] = targetReopenCycleKey.split("-");
  await logAuditAction(
    "REOPEN_MONTH_CYCLE",
    `${monthName} ${yearStr}`,
    `Unlocked reconciled cycle ${monthName} ${yearStr}. Reason: ${reason}`
  );

  await savePaymentDataToStore(targetReopenCycleKey);
  closeReopenMonthModal();
  initReconciliationCycles();
  updateReconciliationView();
  renderOverviewFundStrip();
  showToast(`Cycle ${monthName} ${yearStr} unlocked! 🔓`);
}

function renderReconciliationHistoryTable() {
  const container = document.getElementById("recHistoryContainer");
  if (!container) return;

  if (!monthlyReconciliations || monthlyReconciliations.length === 0) {
    container.innerHTML = `<div class="empty" style="padding:16px;">No reconciliation snapshots saved yet.</div>`;
    return;
  }

  const rows = monthlyReconciliations.map((r) => {
    const totalVar = (r.variances.bank || 0) + (r.variances.cash || 0) + (r.variances.bkash || 0) + (r.variances.nagad || 0);
    let statusPill = "";
    if (r.isClosed) {
      statusPill = `<span class="rec-status-pill closed" style="font-size:10px;">Closed 🔒</span>`;
    } else if (r.status === "invalidated") {
      statusPill = `<span class="rec-status-pill open" style="font-size:10px; color:var(--amber); border-color:var(--amber);">Invalidated ⚠️</span>`;
    } else {
      statusPill = `<span class="rec-status-pill open" style="font-size:10px;">Open 🔓</span>`;
    }

    return `
      <tr>
        <td><strong>${r.month} ${r.year}</strong></td>
        <td>${statusPill}</td>
        <td>${formatAuditTimestamp(r.closedAt)}</td>
        <td>${fmtBDT(r.statementBalances.bank + r.statementBalances.cash + r.statementBalances.bkash + r.statementBalances.nagad)}</td>
        <td>${totalVar === 0 ? '<span style="color:var(--green);">৳0 (Balanced)</span>' : `<span style="color:var(--rose);">${fmtBDT(totalVar)}</span>`}</td>
        <td><small>${r.notes || "—"}</small></td>
      </tr>
    `;
  }).join("");

  container.innerHTML = `
    <table class="audit-table">
      <thead>
        <tr>
          <th>Cycle</th>
          <th>Status</th>
          <th>Reconciled At</th>
          <th>Total Statement</th>
          <th>Net Variance</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

// ─────────────────────────────────────────────────────────────────
// 🧾 PAYMENT RECEIPTS (PRINTABLE / PDF)
// ─────────────────────────────────────────────────────────────────

function getOrGenerateReceiptNumber(tx, year, monthName) {
  if (tx.receiptNumber) return tx.receiptNumber;
  const monthIdx = (CALENDAR_MONTHS.indexOf(monthName) + 1).toString().padStart(2, "0");
  const cleanId = String(tx.id || "").replace(/[^0-9]/g, "");
  const suffix = cleanId ? cleanId.slice(-4).padStart(4, "0") : String(Math.floor(1000 + Math.random() * 9000));
  const rcpNum = `RCP-${year}${monthIdx}-${suffix}`;
  tx.receiptNumber = rcpNum;
  return rcpNum;
}

function openReceiptModal(year, monthName, memberName, paymentId) {
  const yearData = paymentData.find((y) => y.year == year);
  const monthData = yearData?.months.find((m) => m.month === monthName);
  const payment = monthData?.payments.find((p) => p.name === memberName);
  const tx = payment?.paymentsList?.find((t) => t.id === paymentId) || {
    id: "legacy",
    amount: payment?.paidAmount || 1000,
    date: "Preserved Baseline",
    method: "Bank / Direct",
    reference: "BASELINE-01",
    verified: true,
    verifiedBy: "System",
  };

  const receiptNumber = getOrGenerateReceiptNumber(tx, year, monthName);
  const isVoided = tx.status === "voided";

  const container = document.getElementById("receiptPrintContainer");
  if (!container) return;

  container.innerHTML = `
    <div class="receipt-slip ${isVoided ? "is-voided" : ""}">
      ${isVoided ? `<div class="receipt-void-watermark">VOIDED / REVERSED</div>` : ""}
      
      <div class="receipt-header">
        <div class="receipt-brand">
          <h2>KC-KISTI COOPERATIVE FUND</h2>
          <p>Official Member Installment Voucher & Receipt</p>
        </div>
        <div class="receipt-num-box">
          <div class="rcp-label">Receipt Voucher #</div>
          <div class="rcp-num">${receiptNumber}</div>
        </div>
      </div>

      <div class="receipt-meta-grid">
        <div class="rcp-meta-item">
          <span class="rcp-lbl">Member Name:</span>
          <strong class="rcp-val">${memberName}</strong>
        </div>
        <div class="rcp-meta-item">
          <span class="rcp-lbl">Installment Cycle:</span>
          <strong class="rcp-val">${monthName} ${year}</strong>
        </div>
        <div class="rcp-meta-item">
          <span class="rcp-lbl">Payment Date:</span>
          <strong class="rcp-val">${tx.date || "Not recorded"}</strong>
        </div>
        <div class="rcp-meta-item">
          <span class="rcp-lbl">Payment Method:</span>
          <strong class="rcp-val">${tx.method || "Cash / Direct"}</strong>
        </div>
        <div class="rcp-meta-item">
          <span class="rcp-lbl">Transaction Reference:</span>
          <strong class="rcp-val">${tx.reference || "N/A"}</strong>
        </div>
        <div class="rcp-meta-item">
          <span class="rcp-lbl">Verification Status:</span>
          <strong class="rcp-val" style="color:var(--green);">${tx.verified ? (tx.verifiedBy || "Verified") : "Unverified"}</strong>
        </div>
      </div>

      <div class="receipt-amount-banner">
        <span class="rcp-amt-label">Amount Received:</span>
        <span class="rcp-amt-val">${fmtBDT(tx.amount)}</span>
      </div>

      ${isVoided ? `
        <div class="receipt-void-details">
          <strong>Notice: This payment transaction has been VOIDED.</strong><br/>
          <span>Reason: ${tx.voidReason || "Administrative Correction"}</span> · 
          <span>Voided At: ${formatAuditTimestamp(tx.voidedAt)}</span>
        </div>
      ` : ""}

      <div class="receipt-footer">
        <div class="rcp-sig-box">
          <div class="rcp-sig-line"></div>
          <span>Member Signature</span>
        </div>
        <div class="rcp-sig-box">
          <div class="rcp-sig-line"></div>
          <span>Authorized Fund Admin</span>
        </div>
      </div>

      <div class="receipt-stamp-note">
        Generated electronically via KC-Kisti Tracker on ${getDhakaDateString()} (${getDhakaTimeString()} Asia/Dhaka).
      </div>
    </div>
  `;

  const modal = document.getElementById("receiptModal");
  if (modal) modal.classList.remove("hidden");
}

function printReceipt() {
  window.print();
}

function closeReceiptModal() {
  const modal = document.getElementById("receiptModal");
  if (modal) modal.classList.add("hidden");
}

// ─────────────────────────────────────────────────────────────────
// 📩 CUSTOMIZABLE REMINDER DRAFTS
// ─────────────────────────────────────────────────────────────────

let activeReminderInfo = null;

function openReminderModal(year, monthName, memberName) {
  const yearData = paymentData.find((y) => y.year == year);
  const monthData = yearData?.months.find((m) => m.month === monthName);
  const rawPmt = monthData?.payments.find((p) => p.name === memberName);
  if (!rawPmt) return;

  const p = normalizePaymentRecord(rawPmt, monthData.dueDate);
  if (p.balance <= 0) {
    showToast(`${memberName} has already paid in full for ${monthName} ${year}!`, "info");
    return;
  }

  activeReminderInfo = {
    year,
    monthName,
    memberName,
    balance: p.balance,
    dueDate: monthData.dueDate,
  };

  const pill = document.getElementById("reminderMetaPill");
  if (pill) {
    pill.innerHTML = `
      <span><strong>${memberName}</strong></span> · 
      <span>${monthName} ${year}</span> · 
      <span style="color:var(--rose);">Unpaid Balance: ${fmtBDT(p.balance)}</span>
      ${monthData.dueDate ? ` · Due: ${monthData.dueDate}` : ""}
    `;
  }

  switchReminderLang("bn");
  const modal = document.getElementById("reminderModal");
  if (modal) modal.classList.remove("hidden");
}

function switchReminderLang(lang) {
  if (!activeReminderInfo) return;
  const { year, monthName, memberName, balance, dueDate } = activeReminderInfo;
  const textarea = document.getElementById("reminderTextarea");
  document.querySelectorAll(".reminder-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  });

  if (!textarea) return;

  if (lang === "bn") {
    textarea.value = `আসসালামু আলাইকুম ${memberName} ভাই,\nKC-কিস্তি ফান্ডের ${monthName} ${year} মাসের কিস্তির বকেয়া পরিমাণ ${fmtBDT(balance)}।${dueDate ? ` নির্ধারিত শেষ তারিখ ছিল ${dueDate}।` : ""}\nঅনুগ্রহ করে সময়মতো পরিশোধ করার অনুরোধ করা হলো। ধন্যবাদ!`;
  } else {
    textarea.value = `Assalamu Alaikum ${memberName},\nThis is a gentle reminder that your KC-Kisti installment for ${monthName} ${year} has an outstanding balance of ${fmtBDT(balance)}.${dueDate ? ` Due date: ${dueDate}.` : ""}\nPlease arrange to complete your payment at your earliest convenience. Thank you!`;
  }
}

function copyReminderDraft() {
  const textarea = document.getElementById("reminderTextarea");
  if (!textarea) return;
  navigator.clipboard.writeText(textarea.value).then(() => {
    showToast("Reminder draft copied to clipboard! 📋");
  }).catch(() => {
    showToast("Failed to copy automatically. Please copy manually.", "warning");
  });
}

function shareReminderDraft() {
  const textarea = document.getElementById("reminderTextarea");
  if (!textarea) return;
  if (navigator.share) {
    navigator.share({
      title: "KC-Kisti Installment Reminder",
      text: textarea.value,
    }).catch((err) => {
      console.log("Device share cancelled or failed:", err);
    });
  } else {
    copyReminderDraft();
  }
}

function closeReminderModal() {
  const modal = document.getElementById("reminderModal");
  if (modal) modal.classList.add("hidden");
  activeReminderInfo = null;
}

// ─────────────────────────────────────────────────────────────────
// 💾 BACKUP & SAFE RESTORE (VERSIONED JSON v2.0)
// ─────────────────────────────────────────────────────────────────

function exportFullSystemBackup() {
  const backupObject = {
    version: "2.0",
    appName: "KC-Kisti Payment Tracker",
    exportedAt: new Date().toISOString(),
    exportedBy: currentRole,
    paymentData: paymentData,
    auditLogs: auditLogs,
    fundCashbook: fundCashbook,
    memberCreditLedger: memberCreditLedger,
    monthlyReconciliations: monthlyReconciliations,
  };

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupObject, null, 2));
  const dlAnchor = document.createElement("a");
  dlAnchor.setAttribute("href", dataStr);
  dlAnchor.setAttribute("download", `kc-kisti-backup-v2.0-${getDhakaDateString()}.json`);
  document.body.appendChild(dlAnchor);
  dlAnchor.click();
  dlAnchor.remove();

  showToast("Full System Backup (v2.0 JSON) downloaded! 💾");
}

function handleBackupFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const parsed = JSON.parse(event.target.result);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid JSON backup file structure.");
      }

      let pData = parsed.paymentData;
      if (!pData && Array.isArray(parsed)) {
        pData = parsed;
      }

      if (!Array.isArray(pData)) {
        throw new Error("Missing or malformed paymentData array.");
      }

      pendingBackupJson = {
        version: parsed.version || "1.0 (Legacy)",
        exportedAt: parsed.exportedAt || "Unknown date",
        paymentData: pData,
        auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
        fundCashbook: parsed.fundCashbook || fundCashbook,
        memberCreditLedger: parsed.memberCreditLedger || {},
        monthlyReconciliations: Array.isArray(parsed.monthlyReconciliations) ? parsed.monthlyReconciliations : [],
      };

      let totalYears = pData.length;
      let totalMonths = pData.reduce((s, y) => s + (y.months ? y.months.length : 0), 0);
      let totalPaidBDT = 0;
      pData.forEach((y) => {
        (y.months || []).forEach((m) => {
          (m.payments || []).forEach((p) => {
            if (p.paid) totalPaidBDT += Number(p.amount) || 1000;
          });
        });
      });

      const previewContent = document.getElementById("restorePreviewContent");
      if (previewContent) {
        previewContent.innerHTML = `
          <div class="dry-run-card" style="background:var(--surface-2); padding:14px; border-radius:8px; line-height:1.6; font-size:13px;">
            <div style="font-weight:700; color:var(--accent-teal); margin-bottom:8px;">
              <i class="fas fa-check-circle"></i> Schema Validation Successful (Format: ${pendingBackupJson.version})
            </div>
            <div>• Exported At: <strong>${pendingBackupJson.exportedAt}</strong></div>
            <div>• Years in Backup: <strong>${totalYears}</strong> | Monthly Cycles: <strong>${totalMonths}</strong></div>
            <div>• Verified Collections in File: <strong>${fmtBDT(totalPaidBDT)}</strong></div>
            <div>• Cashbook Movements: <strong>${pendingBackupJson.fundCashbook.entries ? pendingBackupJson.fundCashbook.entries.length : 0}</strong></div>
            <div>• Reconciliation Snapshots: <strong>${pendingBackupJson.monthlyReconciliations.length}</strong></div>
            <div style="margin-top:10px; color:var(--amber); font-size:12px;">
              <i class="fas fa-shield-alt"></i> <strong>Safety Snapshot:</strong> A safety rollback snapshot of your current local state will be automatically created before applying.
            </div>
          </div>
        `;
      }

      document.getElementById("restorePasscodeInput").value = "";
      const modal = document.getElementById("restorePreviewModal");
      if (modal) modal.classList.remove("hidden");
    } catch (err) {
      console.error("Backup file parse error:", err);
      showToast("Failed to parse backup file: " + err.message, "error");
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsText(file);
}

function closeRestorePreviewModal() {
  const modal = document.getElementById("restorePreviewModal");
  if (modal) modal.classList.add("hidden");
  pendingBackupJson = null;
}

async function applyRestoreData() {
  if (currentRole !== "admin") return;
  if (!checkOnlineForFinancialWrite()) return;
  if (!pendingBackupJson) return;

  const passcode = document.getElementById("restorePasscodeInput")?.value;
  if (passcode !== ADMIN_PASSWORD) {
    showToast("Invalid admin passcode! Restore cancelled.", "error");
    return;
  }

  const safetySnapshot = {
    timestamp: new Date().toISOString(),
    paymentData: paymentData,
    fundCashbook: fundCashbook,
    memberCreditLedger: memberCreditLedger,
    monthlyReconciliations: monthlyReconciliations,
    auditLogs: auditLogs,
  };
  localStorage.setItem("kisti_pre_restore_safety_snapshot", JSON.stringify(safetySnapshot));

  paymentData = pendingBackupJson.paymentData;
  auditLogs = pendingBackupJson.auditLogs;
  fundCashbook = pendingBackupJson.fundCashbook;
  memberCreditLedger = pendingBackupJson.memberCreditLedger;
  monthlyReconciliations = pendingBackupJson.monthlyReconciliations;

  await logAuditAction(
    "RESTORE_BACKUP",
    `Backup Version ${pendingBackupJson.version}`,
    `Restored system state from backup file. Safety snapshot saved.`
  );

  await savePaymentDataToStore();
  closeRestorePreviewModal();
  showToast("Backup restored successfully! 🎉");
  location.reload();
}

// ─────────────────────────────────────────────────────────────────
// 📑 REPORTS SUB-TAB NAVIGATION
// ─────────────────────────────────────────────────────────────────

function switchReportsSubTab(subtab) {
  activeReportsSubTab = subtab;
  sessionStorage.setItem("kisti_reports_subtab", subtab);

  document.querySelectorAll(".reports-subtab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.subtab === subtab);
  });

  const subpanelMap = {
    analytics: "subtab-analytics",
    cashbook: "subtab-cashbook",
    reconciliation: "subtab-reconciliation",
    backup: "subtab-backup",
    audit: "subtab-audit",
  };

  Object.keys(subpanelMap).forEach((key) => {
    const el = document.getElementById(subpanelMap[key]);
    if (el) {
      el.classList.toggle("hidden", key !== subtab);
      el.classList.toggle("active", key === subtab);
    }
  });

  if (subtab === "cashbook") {
    renderCashbookKPIs();
    renderCashbookTable();
  } else if (subtab === "reconciliation") {
    initReconciliationCycles();
    updateReconciliationView();
  } else if (subtab === "audit") {
    renderAuditHistoryTable();
  }
}

function navigateToReportsSubtab(subtab) {
  switchNavTab("reports", true);
  switchReportsSubTab(subtab);
}

// ================================================================
// 🤖 KC-KISTI AI ASSISTANT MODULE
// ================================================================

let aiChatMessages = [];
let isAiProcessing = false;

// Configured Default Gemini API Key (Can be overridden via UI Settings)
const DEFAULT_GEMINI_API_KEY = typeof atob !== "undefined"
  ? atob("QVEuQWI4Uk42SXFwTTJjOG4wMlBtVlNzcTlwT1JpcmN6NlpMekZrdXRkbFFzMnlJaU16dHc=")
  : "";

function getActiveGeminiApiKey() {
  return localStorage.getItem("kisti_gemini_api_key") || DEFAULT_GEMINI_API_KEY || "";
}

// Bengali phonetic & nickname mapping for members
const AI_MEMBER_ALIASES = {
  "shawon": "Shawon",
  "শাওন": "Shawon",
  "শাওনের": "Shawon",
  "সাওন": "Shawon",
  "fahim": "Fahim",
  "ফাহিম": "Fahim",
  "ফাহিমের": "Fahim",
  "mobin": "Mobin",
  "মোবিন": "Mobin",
  "মোবিনের": "Mobin",
  "মবিন": "Mobin",
  "siam": "Siam",
  "সিয়াম": "Siam",
  "সিয়ামের": "Siam",
  "সিয়াম": "Siam",
  "সিয়ামের": "Siam",
  "rimon": "Rimon",
  "রিমন": "Rimon",
  "রিমানের": "Rimon",
  "শান্তর": "Shanto",
  "শান্ত": "Shanto",
  "shanto": "Shanto",
  "rishad": "Rishad",
  "রিশাদ": "Rishad",
  "রিশাদের": "Rishad",
  "risad": "Rishad"
};

function initAiAssistant() {
  const thread = document.getElementById("aiChatThread");
  if (!thread) return;

  // Restore saved or default Gemini key into settings input
  const savedKey = getActiveGeminiApiKey();
  const keyInput = document.getElementById("aiGeminiKeyInput");
  if (keyInput && savedKey) {
    keyInput.value = savedKey;
  }

  // Initial welcome greeting if chat is empty
  if (aiChatMessages.length === 0) {
    const greetingHtml = `
      <p>আসসালামু আলাইকুম! 👋 আমি <strong>KC-Kisti AI Assistant</strong>।</p>
      <p>আপনি আমাকে যেকোনো সদস্যের জমা, বকেয়া বা ফান্ডের হিসাব নিয়ে বাংলায় সরাসরি প্রশ্ন করতে পারেন। যেমন:</p>
      <ul style="margin:6px 0 6px 16px; padding:0; font-size:12px; line-height:1.6;">
        <li><em>"শাওন কত টাকা দিছে?"</em></li>
        <li><em>"ফাহিমের কয় টাকা বাকি আছে?"</em></li>
        <li><em>"কার কার কিস্তি দেওয়া বাকি?"</em></li>
        <li><em>"মোট ফান্ডের হিসাব কত?"</em></li>
      </ul>
      <p style="margin-bottom:0;">নিচের যেকোনো বাটনে চাপুন অথবা মেসেজ বক্সে লিখুন! 🚀</p>
    `;
    addAiChatMessage("bot", "আসসালামু আলাইকুম! আমি KC-Kisti AI Assistant।", greetingHtml, false);
  }
}

function toggleAiAssistant() {
  const widget = document.getElementById("aiAssistantWidget");
  if (!widget) return;
  const isHidden = widget.classList.contains("hidden");
  if (isHidden) {
    openAiAssistant();
  } else {
    closeAiAssistant();
  }
}

function openAiAssistant() {
  const widget = document.getElementById("aiAssistantWidget");
  if (!widget) return;
  widget.classList.remove("hidden");
  const input = document.getElementById("aiChatInput");
  if (input) {
    setTimeout(() => input.focus(), 150);
  }
  scrollAiThreadToBottom();
}

function closeAiAssistant() {
  const widget = document.getElementById("aiAssistantWidget");
  if (!widget) return;
  widget.classList.add("hidden");
}

function toggleAiSettings() {
  const drawer = document.getElementById("aiSettingsDrawer");
  if (!drawer) return;
  drawer.classList.toggle("hidden");
}

function saveAiSettings() {
  const keyInput = document.getElementById("aiGeminiKeyInput");
  const val = keyInput ? keyInput.value.trim() : "";
  if (val) {
    localStorage.setItem("kisti_gemini_api_key", val);
    showToast("Gemini API Key সংরক্ষিত হয়েছে! 🧠");
  } else {
    localStorage.removeItem("kisti_gemini_api_key");
    showToast("Gemini Key সরানো হয়েছে। Smart Instant NLP সক্রিয়। ⚡");
  }
  toggleAiSettings();
}

function clearAiChat() {
  aiChatMessages = [];
  const thread = document.getElementById("aiChatThread");
  if (thread) thread.innerHTML = "";
  initAiAssistant();
  showToast("চ্যাট হিস্ট্রি ক্লিয়ার করা হয়েছে 🧹");
}

function handleAiChipClick(queryText) {
  const input = document.getElementById("aiChatInput");
  if (input) {
    input.value = queryText;
  }
  const form = document.getElementById("aiChatForm");
  if (form) {
    form.dispatchEvent(new Event("submit", { cancelable: true }));
  }
}

function addAiChatMessage(sender, rawText, htmlContent = null, shouldScroll = true) {
  aiChatMessages.push({ sender, text: rawText, html: htmlContent, time: new Date() });
  const thread = document.getElementById("aiChatThread");
  if (!thread) return;

  const row = document.createElement("div");
  row.className = `ai-msg-row ${sender}`;

  if (sender === "bot") {
    row.innerHTML = `
      <div class="ai-bot-avatar" aria-hidden="true"><i class="fas fa-robot"></i></div>
      <div class="ai-msg-bubble">
        ${htmlContent || `<p>${escapeHTML(rawText)}</p>`}
      </div>
    `;
  } else {
    row.innerHTML = `
      <div class="ai-msg-bubble">
        <p>${escapeHTML(rawText)}</p>
      </div>
    `;
  }

  thread.appendChild(row);
  if (shouldScroll) {
    scrollAiThreadToBottom();
  }
}

function showAiTypingIndicator() {
  const thread = document.getElementById("aiChatThread");
  if (!thread) return;
  const existing = document.getElementById("aiTypingIndicator");
  if (existing) return;

  const row = document.createElement("div");
  row.id = "aiTypingIndicator";
  row.className = "ai-msg-row bot";
  row.innerHTML = `
    <div class="ai-bot-avatar" aria-hidden="true"><i class="fas fa-robot"></i></div>
    <div class="ai-msg-bubble">
      <div class="ai-typing-dots">
        <span class="ai-typing-dot"></span>
        <span class="ai-typing-dot"></span>
        <span class="ai-typing-dot"></span>
      </div>
    </div>
  `;
  thread.appendChild(row);
  scrollAiThreadToBottom();
}

function removeAiTypingIndicator() {
  const el = document.getElementById("aiTypingIndicator");
  if (el) el.remove();
}

function scrollAiThreadToBottom() {
  const thread = document.getElementById("aiChatThread");
  if (thread) {
    thread.scrollTop = thread.scrollHeight;
  }
}

async function handleAiChatSubmit(e) {
  if (e) e.preventDefault();
  if (isAiProcessing) return;

  const input = document.getElementById("aiChatInput");
  if (!input) return;
  const query = input.value.trim();
  if (!query) return;

  // Add User Message
  addAiChatMessage("user", query);
  input.value = "";
  isAiProcessing = true;
  showAiTypingIndicator();

  // Give short realistic micro-delay for smooth experience
  setTimeout(async () => {
    try {
      const geminiApiKey = getActiveGeminiApiKey();
      let botResponse = null;

      // If Gemini Key is present, try Gemini first
      if (geminiApiKey && navigator.onLine) {
        try {
          botResponse = await callGeminiAssistant(query, geminiApiKey);
        } catch (geminiErr) {
          console.warn("Gemini API call failed, falling back to local NLP:", geminiErr);
          botResponse = processAiQueryLocally(query);
        }
      } else {
        botResponse = processAiQueryLocally(query);
      }

      removeAiTypingIndicator();
      addAiChatMessage("bot", botResponse.text, botResponse.html, true);
    } catch (err) {
      console.error("AI Assistant error:", err);
      removeAiTypingIndicator();
      addAiChatMessage("bot", "দুঃখিত, হিসাবটি প্রক্রিয়াকরণ করতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।");
    } finally {
      isAiProcessing = false;
    }
  }, 350);
}

// ── Smart Natural Language Processor (Local Offline Engine) ──────
function processAiQueryLocally(rawQuery) {
  const query = rawQuery.toLowerCase().trim();

  // 1. Resolve Member Mention
  const matchedMember = detectMemberInQuery(query);

  // 2. Identify Intents
  const isPaidIntent = /দিছে|দিসে|দিয়েছে|দিসিলো|জমা|পরিশোধ|পরিশোধিত|paid|payment|collection|koto diche|koto dilo|koy tk diche/.test(query);
  const isDueIntent = /বাকি|বকেয়া|বকেয়া|দিতে হবে|দেনা|due|owed|outstanding|koto baki|koy tk baki|dite hobe/.test(query);
  const isLastPaymentIntent = /লাস্ট|শেষ|কবে দিছে|কবে দিল|কবে দিসিলো|কবে দিলো|last payment|kobe diche|last pmt/.test(query);
  const isStatementIntent = /সব মাসের|সকল মাসের|স্টেটমেন্ট|ফুল স্টেটমেন্ট|লিস্ট|বিস্তারিত|statement|history|all months/.test(query);
  const isDefaultersListIntent = /কার কার|কে কে|কারা কারা|কার বাকি|কে বাকি|বাকি কার|বাকি কারা|unpaid list|unpaid|defaulter|ke ke dey nai|kar kar baki/.test(query);
  const isClearMembersIntent = /সব দিছে|সবাই দিছে|কারো বকেয়া নাই|কারো বাকি নাই|ক্লিয়ার|কার বকেয়া নাই|কার বাকি নাই|সব কিস্তি দিছে|all paid|clear members|zero due/.test(query);
  const isCreditIntent = /কার ক্রেডিট|কার অগ্রিম|ক্রেডিট কার|অগ্রিম জমা|advance credit|credit balance/.test(query);
  const isBankInfoIntent = /ব্যাংক|একাউন্ট|অ্যাকাউন্ট|টাকা পাঠাব|টাকা পাঠাবো|টাকা পাঠানোর|বিকাশ নাম্বার|নগদ নাম্বার|account number|bank details|bank acc/.test(query) && !matchedMember;
  const isRulesIntent = /নিয়ম|নিয়মাবলী|কিস্তির নিয়ম|কত করে|কত টাকা দিতে হয়|rules|policy/.test(query);
  const isFundIntent = /মোট ফান্ড|ফান্ডের অবস্থা|ফান্ড|মোট কালেকশন|মোট টাকা|ব্যাংকে কত|ক্যাশ|ক্যাশে কত|ব্যালেন্স|balance|total collection|fund/.test(query) && !matchedMember && !isBankInfoIntent;
  const isReminderIntent = /তাগাদা|রিমাইন্ডার|মেসেজ|নোটিশ|reminder|draft|message/.test(query);
  const isGreetingIntent = /^(hi|hello|hey|হাই|হ্যালো|সালাম|assalamu|assalamu alaikum|কেমন আছো|help|সাহায্য)/.test(query);

  // ──────────────────────────────────────────────
  // CASE A: Specific Member Queries
  // ──────────────────────────────────────────────
  if (matchedMember) {
    const profile = getMemberFinancialSnapshot(matchedMember);

    // Subcase A1: Reminder Request for Member
    if (isReminderIntent) {
      return generateAiMemberReminder(profile);
    }

    // Subcase A2: Last Payment Date Query
    if (isLastPaymentIntent) {
      return generateAiMemberLastPayment(profile);
    }

    // Subcase A3: Full Itemized Statement Query
    if (isStatementIntent) {
      return generateAiMemberStatement(profile);
    }

    // Subcase A4: Member Due / Outstanding Query
    if (isDueIntent && !isPaidIntent) {
      return generateAiMemberDueResponse(profile);
    }

    // Subcase A5: Member Paid Query
    if (isPaidIntent && !isDueIntent) {
      return generateAiMemberPaidResponse(profile);
    }

    // Subcase A6: Default (Only Member Name written, e.g. "shawon" / "fahim")
    // Returns full 360-degree card showing BOTH total paid & remaining due!
    return generateAiMemberComprehensiveOverview(profile);
  }

  // ──────────────────────────────────────────────
  // CASE B: General Fund & Collective Queries
  // ──────────────────────────────────────────────

  // B1: Bank Account & Payment Details
  if (isBankInfoIntent) {
    return generateAiBankAccountResponse();
  }

  // B2: Who cleared all payments (Zero Due)
  if (isClearMembersIntent) {
    return generateAiAllPaidMembersResponse();
  }

  // B3: Advance Credit Holders
  if (isCreditIntent) {
    return generateAiCreditHoldersResponse();
  }

  // B4: "কার কার কিস্তি বাকি আছে?" (Defaulters List)
  if (isDefaultersListIntent) {
    return generateAiUnpaidListResponse(query);
  }

  // B5: Kisti Rules & Policy
  if (isRulesIntent) {
    return generateAiKistiRulesResponse();
  }

  // B6: "ফান্ডের মোট হিসাব / ক্যাশবুক"
  if (isFundIntent) {
    return generateAiFundOverviewResponse();
  }

  // B7: Greetings & Help
  if (isGreetingIntent) {
    return {
      text: "ওয়ালাইকুমুস সালাম! আমি KC-কিস্তি ফান্ডের AI অ্যাসিস্ট্যান্ট।",
      html: `
        <p>ওয়ালাইকুমুস সালাম! 😊 আমি KC-কিস্তি ফান্ডের সার্বক্ষণিক AI অ্যাসিস্ট্যান্ট।</p>
        <p>আপনি আমাকে কিস্তি ফান্ডের যেকোনো বিষয়ে প্রশ্ন করতে পারেন:</p>
        <ul style="margin:4px 0 6px 16px; padding:0; font-size:12px; line-height:1.6;">
          <li><strong>সদস্যের তথ্য:</strong> শুধু নাম লিখুন, যেমন: <em>"শাওন"</em> বা <em>"ফাহিম"</em></li>
          <li><strong>শেষ পেমেন্ট:</strong> <em>"ফাহিম শেষ কবে টাকা দিছে?"</em></li>
          <li><strong>বকেয়া তালিকা:</strong> <em>"কার কার কিস্তি দেওয়া বাকি?"</em></li>
          <li><strong>সব কিস্তি ক্লিয়ার:</strong> <em>"সব কিস্তি দিছে কে কে?"</em></li>
          <li><strong>ব্যাংক একাউন্ট:</strong> <em>"টাকা পাঠানোর ব্যাংক একাউন্ট দাও"</em></li>
          <li><strong>ফান্ডের হিসাব:</strong> <em>"মোট ফান্ড কালেকশন কত?"</em></li>
          <li><strong>তাগাদা নোটিশ:</strong> <em>"ফাহিম ভাইকে রিমাইন্ডার মেসেজ দাও"</em></li>
        </ul>
      `
    };
  }

  // ──────────────────────────────────────────────
  // CASE E: Fallback / Smart General Response
  // ──────────────────────────────────────────────
  return {
    text: `আমি আপনার প্রশ্নটি বুঝতে সাহায্য করতে চাই। যেমন: শাওন কত দিছে, ফাহিমের কত বাকি, বা কার কার কিস্তি বাকি আছে।`,
    html: `
      <p>💡 আমি নির্দিষ্ট কোনো সদস্যের হিসাব খুঁজে পাইনি।</p>
      <p>আপনি নিচের যেকোনো ফরম্যাটে প্রশ্ন করতে পারেন:</p>
      <div class="ai-card-info">
        <div>• <strong>সদস্যের নাম দিয়ে:</strong> <em>"ফাহিমের কয় টাকা বাকি?"</em>, <em>"শাওন কত টাকা দিছে?"</em></div>
        <div>• <strong>বকেয়া তালিকা:</strong> <em>"কার কার কিস্তি বাকি আছে?"</em></div>
        <div>• <strong>ফান্ডের তথ্য:</strong> <em>"ফান্ডের মোট কালেকশন কত?"</em></div>
      </div>
      <p style="margin-bottom:0; font-size:11.5px; color:var(--text-3);">টিপ: আপনি নিচের সাজেশনের যেকোনো বাটনে ক্লিক করেও জানতে পারেন।</p>
    `
  };
}

// ── Detect Member in Query ─────────────────────────────────────────
function detectMemberInQuery(query) {
  // Check predefined phonetic aliases
  for (const [alias, canonicalName] of Object.entries(AI_MEMBER_ALIASES)) {
    if (query.includes(alias.toLowerCase())) {
      return canonicalName;
    }
  }

  // Dynamically check against any existing member in paymentData
  if (Array.isArray(paymentData) && paymentData.length > 0) {
    const allMembers = new Set();
    paymentData.forEach((y) => {
      (y.months || []).forEach((m) => {
        (m.payments || []).forEach((p) => {
          if (p && p.name) allMembers.add(p.name);
        });
      });
    });

    for (const name of allMembers) {
      if (query.includes(name.toLowerCase())) {
        return name;
      }
    }
  }

  return null;
}

// ── Calculate Complete Snapshot for a Member ──────────────────────
function getMemberFinancialSnapshot(memberName) {
  let totalExpected = 0;
  let totalPaid = 0;
  let totalDue = 0;
  let totalOverdue = 0;
  let lastPayment = null;
  const cycles = [];
  const paidCycles = [];
  const unpaidCycles = [];

  if (Array.isArray(paymentData)) {
    paymentData.forEach((y) => {
      const year = y.year || 2026;
      (y.months || []).forEach((m) => {
        const p = (m.payments || []).find((x) => x.name && x.name.toLowerCase() === memberName.toLowerCase());
        if (p) {
          const norm = normalizePaymentRecord(p, m.dueDate);
          totalExpected += norm.expectedAmount;
          totalPaid += norm.paidAmount;
          const balance = Math.max(0, norm.balance);
          totalDue += balance;
          if (norm.isOverdue) {
            totalOverdue += balance;
          }

          // Track latest payment
          if (Array.isArray(norm.paymentsList) && norm.paymentsList.length > 0) {
            norm.paymentsList.forEach(tx => {
              if (!lastPayment || (tx.date && (!lastPayment.date || tx.date > lastPayment.date))) {
                lastPayment = { ...tx, month: m.month, year };
              }
            });
          } else if (norm.paidAmount > 0) {
            if (!lastPayment) {
              lastPayment = {
                date: p.date || p.paidDate || "ঐতিহাসিক রেকর্ড",
                amount: norm.paidAmount,
                method: p.method || "ক্যাশ / ব্যাংক",
                month: m.month,
                year,
              };
            }
          }

          const cycleItem = {
            year,
            month: m.month,
            expected: norm.expectedAmount,
            paid: norm.paidAmount,
            balance: norm.balance,
            status: norm.status,
            isOverdue: norm.isOverdue,
            dueDate: m.dueDate,
          };
          cycles.push(cycleItem);

          if (norm.status === "paid" || norm.status === "overpaid") {
            paidCycles.push(cycleItem);
          } else {
            unpaidCycles.push(cycleItem);
          }
        }
      });
    });
  }

  // Advance credit
  const creditBalance = (memberCreditLedger && memberCreditLedger[memberName]) ? (memberCreditLedger[memberName].balance || 0) : 0;

  return {
    name: memberName,
    totalExpected,
    totalPaid,
    totalDue,
    totalOverdue,
    lastPayment,
    cycles,
    paidCycles,
    unpaidCycles,
    creditBalance,
    totalCyclesCount: cycles.length,
    paidCount: paidCycles.length,
    unpaidCount: unpaidCycles.length,
  };
}

// ── Response Generator: Member Paid ───────────────────────────────
function generateAiMemberPaidResponse(profile) {
  const name = profile.name;
  const paidFmt = fmtBDT(profile.totalPaid);
  const expectedFmt = fmtBDT(profile.totalExpected);

  let statusText = "";
  if (profile.totalDue === 0 && profile.totalPaid > 0) {
    statusText = `<span class="ai-pill-paid">সব কিস্তি পরিশোধিত ✅</span>`;
  } else if (profile.totalDue > 0) {
    statusText = `<span class="ai-pill-due">বকেয়া আছে: ${fmtBDT(profile.totalDue)} ⏳</span>`;
  }

  const paidMonthsNames = profile.paidCycles.map(c => c.month).join(", ");
  const unpaidMonthsNames = profile.unpaidCycles.map(c => `${c.month} (${fmtBDT(c.balance)})`).join(", ");

  const textSummary = `${name} ভাই মোট ${paidFmt} পরিশোধ করেছেন (${profile.paidCount}টি কিস্তি)।`;

  const html = `
    <p>💰 <strong>${name}</strong> ভাইয়ের পেমেন্ট তথ্য:</p>
    <div class="ai-card-info">
      <div class="ai-card-info-row">
        <span>মোট পরিশোধিত:</span>
        <strong style="color:var(--green); font-size:14px;">${paidFmt}</strong>
      </div>
      <div class="ai-card-info-row">
        <span>পরিশোধিত কিস্তি:</span>
        <span>${profile.paidCount} / ${profile.totalCyclesCount} টি (${statusText})</span>
      </div>
      ${profile.creditBalance > 0 ? `
      <div class="ai-card-info-row">
        <span>অতিরিক্ত ক্রেডিট:</span>
        <strong style="color:var(--accent-teal);">${fmtBDT(profile.creditBalance)}</strong>
      </div>` : ""}
      <div class="ai-card-info-row">
        <span>বকেয়া পরিমাণ:</span>
        <strong style="color:${profile.totalDue > 0 ? 'var(--rose)' : 'var(--green)'};">${fmtBDT(profile.totalDue)}</strong>
      </div>
    </div>
    ${paidMonthsNames ? `<p style="font-size:11.5px; margin-bottom:4px;"><strong>পরিশোধিত মাস:</strong> ${paidMonthsNames}</p>` : ""}
    ${unpaidMonthsNames ? `<p style="font-size:11.5px; color:var(--rose); margin-bottom:0;"><strong>বকেয়া মাস:</strong> ${unpaidMonthsNames}</p>` : ""}
  `;

  return { text: textSummary, html };
}

// ── Response Generator: Member Due / Outstanding ──────────────────
function generateAiMemberDueResponse(profile) {
  const name = profile.name;
  const dueFmt = fmtBDT(profile.totalDue);

  if (profile.totalDue === 0) {
    return {
      text: `মাশাআল্লাহ! ${name} ভাইয়ের কোনো বকেয়া নেই। সব কিস্তি সম্পূর্ণ পরিশোধিত।`,
      html: `
        <p>🎉 <strong>মাশাআল্লাহ! ${name} ভাইয়ের কোনো বকেয়া নেই।</strong></p>
        <div class="ai-card-info">
          <div class="ai-card-info-row">
            <span>মোট কিস্তি লক্ষ্য:</span>
            <span>${fmtBDT(profile.totalExpected)}</span>
          </div>
          <div class="ai-card-info-row">
            <span>মোট পরিশোধ:</span>
            <strong style="color:var(--green);">${fmtBDT(profile.totalPaid)}</strong>
          </div>
          <div class="ai-card-info-row">
            <span>স্ট্যাটাস:</span>
            <span class="ai-pill-paid">সব কিস্তি ক্লিয়ার (৳0 বকেয়া) ✅</span>
          </div>
        </div>
      `
    };
  }

  // There is a due amount
  const unpaidListHtml = profile.unpaidCycles.map(c => `
    <div class="ai-card-info-row">
      <span>${c.month} ${c.year}:</span>
      <span style="font-weight:700; color:var(--rose);">${fmtBDT(c.balance)} ${c.isOverdue ? '<span class="ai-pill-due">Overdue</span>' : ''}</span>
    </div>
  `).join("");

  const textSummary = `${name} ভাইয়ের মোট বকেয়া ${dueFmt} (${profile.unpaidCount}টি কিস্তি)।`;

  const html = `
    <p>⚠️ <strong>${name}</strong> ভাইয়ের বকেয়া তথ্য:</p>
    <div class="ai-card-info">
      <div class="ai-card-info-row">
        <span>মোট বকেয়া:</span>
        <strong style="color:var(--rose); font-size:14px;">${dueFmt}</strong>
      </div>
      <div class="ai-card-info-row">
        <span>বকেয়া কিস্তির সংখ্যা:</span>
        <span>${profile.unpaidCount} টি</span>
      </div>
      ${unpaidListHtml}
    </div>
    <p style="font-size:11.5px; margin-bottom:6px;">
      💡 পূর্ববর্তী <strong>${profile.paidCount}টি কিস্তি</strong> (${fmtBDT(profile.totalPaid)}) পরিশোধিত রয়েছে।
    </p>
    <button type="button" class="ai-copy-btn" onclick="handleAiChipClick('${name} ভাইকে রিমাইন্ডার মেসেজ লিখে দাও')">
      <i class="fas fa-comment-dots"></i> তাগাদা মেসেজ ড্রাফট করুন
    </button>
  `;

  return { text: textSummary, html };
}

// ── Response Generator: 360-Degree Comprehensive Overview for Member ──
function generateAiMemberComprehensiveOverview(profile) {
  const name = profile.name;
  const paidFmt = fmtBDT(profile.totalPaid);
  const dueFmt = fmtBDT(profile.totalDue);

  const statusBadge = profile.totalDue === 0
    ? `<span class="ai-pill-paid">সব কিস্তি ক্লিয়ার ✅</span>`
    : `<span class="ai-pill-due">${profile.unpaidCount}টি বকেয়া ⏳</span>`;

  const textSummary = `${name} ভাই মোট ${paidFmt} পরিশোধ করেছেন। বর্তমান বকেয়া: ${dueFmt}।`;

  const html = `
    <p>👤 <strong>${name}</strong> ভাইয়ের সামগ্রিক প্রোফাইল:</p>
    <div class="ai-card-info">
      <div class="ai-card-info-row">
        <span>পরিশোধিত টাকা:</span>
        <strong style="color:var(--green); font-size:13.5px;">${paidFmt}</strong>
      </div>
      <div class="ai-card-info-row">
        <span>বকেয়া পরিমাণ:</span>
        <strong style="color:${profile.totalDue > 0 ? 'var(--rose)' : 'var(--green)'}; font-size:13.5px;">${dueFmt}</strong>
      </div>
      <div class="ai-card-info-row">
        <span>কিস্তি স্ট্যাটাস:</span>
        <span>${profile.paidCount}/${profile.totalCyclesCount} সম্পন্ন (${statusBadge})</span>
      </div>
      ${profile.lastPayment ? `
      <div class="ai-card-info-row">
        <span>শেষ পেমেন্ট:</span>
        <span>${profile.lastPayment.month} ${profile.lastPayment.year} (${fmtBDT(profile.lastPayment.amount)})</span>
      </div>` : ""}
      ${profile.creditBalance > 0 ? `
      <div class="ai-card-info-row">
        <span>অগ্রিম ক্রেডিট:</span>
        <strong style="color:var(--accent-teal);">${fmtBDT(profile.creditBalance)}</strong>
      </div>` : ""}
    </div>
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">
      <button type="button" class="ai-copy-btn" onclick="handleAiChipClick('${name} ভাইয়ের সব মাসের হিসাব দেখাও')">
        <i class="fas fa-list"></i> সব মাসের হিসাব
      </button>
      ${profile.totalDue > 0 ? `
      <button type="button" class="ai-copy-btn" onclick="handleAiChipClick('${name} ভাইকে রিমাইন্ডার মেসেজ দাও')">
        <i class="fas fa-comment-dots"></i> তাগাদা মেসেজ
      </button>` : ""}
    </div>
  `;

  return { text: textSummary, html };
}

function generateAiMemberOverviewResponse(profile) {
  return generateAiMemberComprehensiveOverview(profile);
}

// ── Response Generator: Last Payment Date ─────────────────────────
function generateAiMemberLastPayment(profile) {
  const name = profile.name;
  if (!profile.lastPayment) {
    return {
      text: `${name} ভাইয়ের কোনো পূর্ববর্তী পেমেন্ট রেকর্ড খুঁজে পাওয়া যায়নি।`,
      html: `<p>ℹ️ <strong>${name}</strong> ভাইয়ের কোনো পেমেন্ট রেকর্ড পাওয়া যায়নি।</p>`
    };
  }

  const lp = profile.lastPayment;
  const textSummary = `${name} ভাই সর্বশেষ ${lp.month} ${lp.year} কিস্তি বাবদ ${fmtBDT(lp.amount)} পরিশোধ করেছেন।`;

  const html = `
    <p>📅 <strong>${name}</strong> ভাইয়ের সর্বশেষ পেমেন্ট তথ্য:</p>
    <div class="ai-card-info">
      <div class="ai-card-info-row">
        <span>কিস্তির সাইকেল:</span>
        <strong>${lp.month} ${lp.year}</strong>
      </div>
      <div class="ai-card-info-row">
        <span>পরিশোধের পরিমাণ:</span>
        <strong style="color:var(--green); font-size:13.5px;">${fmtBDT(lp.amount)}</strong>
      </div>
      <div class="ai-card-info-row">
        <span>তারিখ:</span>
        <span>${lp.date || "ঐতিহাসিক রেকর্ড"}</span>
      </div>
      <div class="ai-card-info-row">
        <span>পেমেন্ট মেথড:</span>
        <span>${lp.method || "ক্যাশ / ব্যাংক"}</span>
      </div>
    </div>
  `;

  return { text: textSummary, html };
}

// ── Response Generator: Full Month-by-Month Statement ─────────────
function generateAiMemberStatement(profile) {
  const name = profile.name;
  const rows = profile.cycles.map(c => `
    <div class="ai-card-info-row">
      <span>${c.month} ${c.year}:</span>
      <span>
        ${c.status === "paid" || c.status === "overpaid"
          ? `<span class="ai-pill-paid">Paid (${fmtBDT(c.paid)})</span>`
          : `<span class="ai-pill-due">Due (${fmtBDT(c.balance)})</span>`}
      </span>
    </div>
  `).join("");

  const textSummary = `${name} ভাইয়ের সম্পূর্ণ স্টেটমেন্ট: মোট পরিশোধ ${fmtBDT(profile.totalPaid)}, বকেয়া ${fmtBDT(profile.totalDue)}।`;

  const html = `
    <p>📋 <strong>${name}</strong> ভাইয়ের সকল মাসের বিবরণী:</p>
    <div class="ai-card-info">
      ${rows}
      <div class="ai-card-info-row" style="margin-top:6px; border-top:1px solid var(--border-mid); padding-top:6px;">
        <span>সর্বমোট পরিশোধ:</span>
        <strong style="color:var(--green);">${fmtBDT(profile.totalPaid)}</strong>
      </div>
      <div class="ai-card-info-row">
        <span>সর্বমোট বকেয়া:</span>
        <strong style="color:${profile.totalDue > 0 ? 'var(--rose)' : 'var(--green)'};">${fmtBDT(profile.totalDue)}</strong>
      </div>
    </div>
  `;

  return { text: textSummary, html };
}

// ── Response Generator: Bank Account Disclosure ───────────────────
function generateAiBankAccountResponse() {
  const textSummary = "Islami Bank Bangladesh Ltd, Account: 20503560301151415 (Savings Account)";
  const html = `
    <p>🏦 <strong>কিস্তির টাকা জমা দেওয়ার ব্যাংক অ্যাকাউন্ট:</strong></p>
    <div class="ai-card-info">
      <div class="ai-card-info-row">
        <span>ব্যাংকের নাম:</span>
        <strong>Islami Bank Bangladesh Ltd.</strong>
      </div>
      <div class="ai-card-info-row">
        <span>হিসাব নম্বর:</span>
        <code style="font-size:13px; font-weight:700; color:var(--accent-teal);">20503560301151415</code>
      </div>
      <div class="ai-card-info-row">
        <span>হিসাবের ধরন:</span>
        <span>Savings Account (সঞ্চয়ী হিসাব)</span>
      </div>
      <div class="ai-card-info-row">
        <span>অন্যান্য মাধ্যম:</span>
        <span>ক্যাশ ইন হ্যান্ড / বিকাশ / নগদ</span>
      </div>
    </div>
    <button type="button" class="ai-copy-btn" onclick="copyAiDraftText(this, '20503560301151415')">
      <i class="fas fa-copy"></i> অ্যাকাউন্ট নম্বর কপি করুন
    </button>
  `;
  return { text: textSummary, html };
}

// ── Response Generator: Who Cleared All Payments (Zero Due) ───────
function generateAiAllPaidMembersResponse() {
  const activeYearData = (paymentData && paymentData[0]) ? paymentData[0] : { year: 2026, months: [] };
  const uniqueNames = new Set();
  (activeYearData.months || []).forEach(m => (m.payments || []).forEach(p => uniqueNames.add(p.name)));

  const clearMembers = [];
  uniqueNames.forEach(name => {
    const snap = getMemberFinancialSnapshot(name);
    if (snap.totalDue === 0 && snap.totalPaid > 0) {
      clearMembers.push({ name: snap.name, paid: snap.totalPaid, count: snap.paidCount });
    }
  });

  if (clearMembers.length === 0) {
    return {
      text: "বর্তমানে সকল কিস্তি পরিশোধকারী কোনো সদস্য নেই।",
      html: "<p>বর্তমানে সব কিস্তি পরিশোধকারী সদস্য নেই।</p>"
    };
  }

  const rows = clearMembers.map(m => `
    <div class="ai-card-info-row">
      <strong>${m.name}</strong>
      <span><span class="ai-pill-paid">সব কিস্তি ক্লিয়ার ✅</span> (${fmtBDT(m.paid)})</span>
    </div>
  `).join("");

  const textSummary = `যাদের কোনো বকেয়া নেই: ${clearMembers.map(m => m.name).join(", ")}।`;

  const html = `
    <p>🎉 <strong>মাশাআল্লাহ! যাদের কোনো বকেয়া নেই (সব কিস্তি ক্লিয়ার):</strong></p>
    <div class="ai-card-info">
      ${rows}
    </div>
    <p style="font-size:11.5px; color:var(--text-3); margin-bottom:0;">
      মোট <strong>${clearMembers.length} জন</strong> সদস্যের সকল কিস্তি সম্পূর্ণ পরিশোধিত।
    </p>
  `;

  return { text: textSummary, html };
}

// ── Response Generator: Advance Credit Holders ────────────────────
function generateAiCreditHoldersResponse() {
  const creditHolders = [];
  if (memberCreditLedger) {
    Object.keys(memberCreditLedger).forEach(name => {
      const bal = memberCreditLedger[name].balance || 0;
      if (bal > 0) {
        creditHolders.push({ name, balance: bal });
      }
    });
  }

  if (creditHolders.length === 0) {
    return {
      text: "বর্তমানে কোনো সদস্যের অব্যবহৃত অগ্রিম ক্রেডিট জমা নেই।",
      html: "<p>ℹ️ বর্তমানে কোনো সদস্যের অগ্রিম ক্রেডিট ব্যালেন্স নেই।</p>"
    };
  }

  const rows = creditHolders.map(m => `
    <div class="ai-card-info-row">
      <strong>${m.name}</strong>
      <strong style="color:var(--accent-teal);">${fmtBDT(m.balance)}</strong>
    </div>
  `).join("");

  const textSummary = `অগ্রিম ক্রেডিট আছে: ${creditHolders.map(m => `${m.name} (${fmtBDT(m.balance)})`).join(", ")}।`;

  const html = `
    <p>💳 <strong>যাদের অতিরিক্ত / অগ্রিম ক্রেডিট জমা আছে:</strong></p>
    <div class="ai-card-info">
      ${rows}
    </div>
    <p style="font-size:11px; color:var(--text-3); margin-bottom:0;">
      * অ্যাডমিন প্যানেল থেকে এই ক্রেডিট বকেয়া কিস্তিতে বরাদ্দ করা যায়।
    </p>
  `;

  return { text: textSummary, html };
}

// ── Response Generator: Kisti Rules & Policy ──────────────────────
function generateAiKistiRulesResponse() {
  const textSummary = "প্রতি সদস্যের মাসিক কিস্তি ৳১,০০০। ডিউ ডেট প্রতি মাসের নির্দিষ্ট তারিখে।";
  const html = `
    <p>📜 <strong>KC-কিস্তি ফান্ডের সাধারণ নিয়মাবলী:</strong></p>
    <div class="ai-card-info">
      <div class="ai-card-info-row">
        <span>মাসিক কিস্তির পরিমাণ:</span>
        <strong style="color:var(--accent-teal);">৳১,০০০ (সদস্যপ্রতি)</strong>
      </div>
      <div class="ai-card-info-row">
        <span>পরিশোধের সময়সীমা:</span>
        <span>প্রতি মাসের নির্ধারিত Due Date-এর মধ্যে</span>
      </div>
      <div class="ai-card-info-row">
        <span>জমার মাধ্যম:</span>
        <span>ইসলামী ব্যাংক / ক্যাশ / বিকাশ / নগদ</span>
      </div>
      <div class="ai-card-info-row">
        <span>অতিরিক্ত জমা:</span>
        <span>পরবর্তী কিস্তির জন্য ক্রেডিট হিসেবে জমা থাকে</span>
      </div>
    </div>
    <p style="font-size:11.5px; color:var(--text-3); margin-bottom:0;">
      * কিস্তির টাকা জমা দিয়ে অ্যাডমিনকে ট্রানজ্যাকশন রেফারেন্স অবহিত করুন।
    </p>
  `;
  return { text: textSummary, html };
}

// ── Response Generator: Reminder Message ──────────────────────────
function generateAiMemberReminder(profile) {
  const name = profile.name;
  if (profile.totalDue === 0) {
    return {
      text: `${name} ভাইয়ের কোনো বকেয়া নেই। তাগাদা মেসেজ পাঠানোর প্রয়োজন নেই।`,
      html: `<p>😊 ${name} ভাইয়ের সব কিস্তি পরিশোধিত আছে। কোনো তাগাদা মেসেজ পাঠানোর প্রয়োজন নেই।</p>`
    };
  }

  const latestUnpaid = profile.unpaidCycles[0] || { month: "বর্তমান", balance: profile.totalDue };
  const dueFmt = fmtBDT(profile.totalDue);

  const draftMessage = `আসসালামু আলাইকুম ${name} ভাই, আশা করি ভালো আছেন। KC-কিস্তি ফান্ডের ${latestUnpaid.month} মাসের কিস্তির বকেয়া পরিমাণ ${dueFmt}। সময়মতো কিস্তির টাকা জমা দেওয়ার জন্য বিনীত অনুরোধ জানাচ্ছি। ধন্যবাদ! - KC-কিস্তি ফান্ড`;

  const html = `
    <p>💬 <strong>${name}</strong> ভাইয়ের জন্য তাগাদা মেসেজ প্রস্তুত:</p>
    <div style="background:var(--surface); border:1px solid var(--border-mid); border-radius:8px; padding:10px 12px; font-size:12px; line-height:1.55; font-style:italic; margin:8px 0;">
      "${escapeHTML(draftMessage)}"
    </div>
    <button type="button" class="ai-copy-btn" onclick="copyAiDraftText(this, \`${escapeJsString(draftMessage)}\`)">
      <i class="fas fa-copy"></i> মেসেজ কপি করুন
    </button>
  `;

  return { text: draftMessage, html };
}

// ── Response Generator: Unpaid Members List (Defaulters) ──────────
function generateAiUnpaidListResponse(query) {
  if (!Array.isArray(paymentData) || paymentData.length === 0) {
    return { text: "কোনো পেমেন্ট ডেটা পাওয়া যায়নি।", html: "<p>কোনো পেমেন্ট ডেটা পাওয়া যায়নি।</p>" };
  }

  // Find latest active month
  const activeYearData = paymentData[0] || { year: 2026, months: [] };
  const latestMonthObj = (activeYearData.months && activeYearData.months.length > 0) ? activeYearData.months[0] : null;

  if (!latestMonthObj) {
    return { text: "কোনো মাসের কিস্তি পাওয়া যায়নি।", html: "<p>কোনো কিস্তি পাওয়া যায়নি।</p>" };
  }

  const latestMonthName = latestMonthObj.month;
  const unpaidMembers = [];
  let totalDueInMonth = 0;

  (latestMonthObj.payments || []).forEach((p) => {
    const norm = normalizePaymentRecord(p, latestMonthObj.dueDate);
    if (norm.status !== "paid" && norm.status !== "overpaid" && norm.balance > 0) {
      unpaidMembers.push({
        name: norm.name,
        balance: norm.balance,
        status: norm.status,
        isOverdue: norm.isOverdue,
      });
      totalDueInMonth += norm.balance;
    }
  });

  if (unpaidMembers.length === 0) {
    return {
      text: `আলহামদুলিল্লাহ! ${latestMonthName} মাসের সকল সদস্যের কিস্তি পরিশোধিত।`,
      html: `<p>🎉 <strong>আলহামদুলিল্লাহ!</strong> ${latestMonthName} ${activeYearData.year} মাসের সকল সদস্যের কিস্তি সম্পূর্ণ পরিশোধিত!</p>`
    };
  }

  const listRows = unpaidMembers.map((m) => `
    <div class="ai-card-info-row">
      <strong>${m.name}</strong>
      <span>
        <span style="color:var(--rose); font-weight:700;">${fmtBDT(m.balance)}</span>
        ${m.isOverdue ? '<span class="ai-pill-due">Overdue</span>' : '<span class="ai-pill-due">Unpaid</span>'}
      </span>
    </div>
  `).join("");

  const textSummary = `${latestMonthName} মাসে মোট ${unpaidMembers.length} জনের কিস্তি বাকি আছে (মোট বকেয়া: ${fmtBDT(totalDueInMonth)})।`;

  const html = `
    <p>📋 <strong>${latestMonthName} ${activeYearData.year}</strong> এ যাদের কিস্তি বাকি আছে:</p>
    <div class="ai-card-info">
      ${listRows}
      <div class="ai-card-info-row" style="margin-top:6px; border-top:1px solid var(--border-mid); padding-top:6px;">
        <span>মোট বাকি (${unpaidMembers.length} জন):</span>
        <strong style="color:var(--rose); font-size:13px;">${fmtBDT(totalDueInMonth)}</strong>
      </div>
    </div>
    <p style="font-size:11px; color:var(--text-3); margin-bottom:0;">
      * নির্দিষ্ট সদস্যের বিস্তারিত জানতে লিখুন, যেমন: <em>"${unpaidMembers[0].name}র কত বাকি?"</em>
    </p>
  `;

  return { text: textSummary, html };
}

// ── Response Generator: Fund & Accounts Overview ──────────────────
function generateAiFundOverviewResponse() {
  const breakdown = getAccountingCollectionsBreakdown();
  const bankAcc = (fundCashbook.accounts || []).find(a => a.id === "bank") || { balance: 0 };
  const cashAcc = (fundCashbook.accounts || []).find(a => a.id === "cash") || { balance: 0 };
  const bkashAcc = (fundCashbook.accounts || []).find(a => a.id === "bkash") || { balance: 0 };
  const nagadAcc = (fundCashbook.accounts || []).find(a => a.id === "nagad") || { balance: 0 };

  const totalFundBalance = (fundCashbook.accounts || []).reduce((acc, a) => acc + (a.balance || 0), 0);

  const textSummary = `মোট সংগৃহীত কিস্তি: ${fmtBDT(breakdown.totalMemberCollections)}, মোট বকেয়া: ${fmtBDT(breakdown.totalOutstanding)}।`;

  const html = `
    <p>🏦 <strong>KC-কিস্তি ফান্ডের সামগ্রিক আর্থিক অবস্থা:</strong></p>
    <div class="ai-card-info">
      <div class="ai-card-info-row">
        <span>মোট সদস্য আদায়:</span>
        <strong style="color:var(--green); font-size:14px;">${fmtBDT(breakdown.totalMemberCollections)}</strong>
      </div>
      <div class="ai-card-info-row">
        <span>মোট বর্তমান বকেয়া:</span>
        <strong style="color:var(--rose);">${fmtBDT(breakdown.totalOutstanding)}</strong>
      </div>
      <div class="ai-card-info-row">
        <span>ইসলামী ব্যাংক ব্যালেন্স:</span>
        <span>${fmtBDT(bankAcc.balance)}</span>
      </div>
      <div class="ai-card-info-row">
        <span>ক্যাশ ড্রয়ার:</span>
        <span>${fmtBDT(cashAcc.balance)}</span>
      </div>
      <div class="ai-card-info-row">
        <span>বিকাশ + নগদ ওয়ালেট:</span>
        <span>${fmtBDT(bkashAcc.balance + nagadAcc.balance)}</span>
      </div>
      <div class="ai-card-info-row" style="border-top:1px solid var(--border-mid); margin-top:4px; padding-top:4px;">
        <span>আন-অ্যাসাইনড ঐতিহাসিক কালেকশন:</span>
        <span style="color:var(--amber); font-weight:600;">${fmtBDT(breakdown.unassignedCollections)}</span>
      </div>
    </div>
    <p style="font-size:11.5px; color:var(--text-3); margin-bottom:0;">
      বিস্তারিত লেজার দেখতে <strong>Reports > Fund Cashbook</strong> মেনুতে যান।
    </p>
  `;

  return { text: textSummary, html };
}

// ── Call Optional Gemini Flash API ─────────────────────────────────
async function callGeminiAssistant(query, apiKey) {
  // Build system context
  const breakdown = getAccountingCollectionsBreakdown();
  const activeYearData = (paymentData && paymentData[0]) ? paymentData[0] : { year: 2026, months: [] };

  const memberSummaries = [];
  const uniqueNames = new Set();
  (activeYearData.months || []).forEach(m => {
    (m.payments || []).forEach(p => uniqueNames.add(p.name));
  });

  uniqueNames.forEach(name => {
    const snap = getMemberFinancialSnapshot(name);
    memberSummaries.push({
      name: snap.name,
      totalPaid: snap.totalPaid,
      totalDue: snap.totalDue,
      paidCyclesCount: snap.paidCount,
      unpaidCyclesCount: snap.unpaidCount,
      unpaidCycles: snap.unpaidCycles.map(c => `${c.month} (${c.balance} BDT)`),
      creditBalance: snap.creditBalance,
    });
  });

  const promptContext = `
You are the polite, concise, and helpful AI Assistant for "KC-Kisti Payment Tracker" (a cooperative kisti savings fund).
Respond in natural, courteous Bengali (or English if the user asks in English).
Keep answers clear, exact, and well-formatted with emojis. Currency is BDT (৳).

FINANCIAL DATA SNAPSHOT:
Total Member Collections: ৳${breakdown.totalMemberCollections}
Total Outstanding Due: ৳${breakdown.totalOutstanding}
Members Data:
${JSON.stringify(memberSummaries, null, 2)}

User Question: "${query}"
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: promptContext }] }]
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API returned status ${response.status}`);
  }

  const json = await response.json();
  const textOutput = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOutput) {
    throw new Error("Empty response from Gemini");
  }

  // Format markdown paragraphs
  const formattedHtml = textOutput
    .split("\n\n")
    .map(para => `<p>${para.replace(/\n/g, "<br>").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")}</p>`)
    .join("");

  return { text: textOutput, html: formattedHtml };
}

// ── Copy Helper for AI Drafts ─────────────────────────────────────
function copyAiDraftText(btnEl, text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast("মেসেজ ক্লিপবোর্ডে কপি হয়েছে! 📋");
      if (btnEl) {
        const orig = btnEl.innerHTML;
        btnEl.innerHTML = '<i class="fas fa-check"></i> কপি হয়েছে!';
        setTimeout(() => { btnEl.innerHTML = orig; }, 2000);
      }
    }).catch(() => {
      fallbackCopyText(text);
    });
  } else {
    fallbackCopyText(text);
  }
}

function escapeHTML(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeJsString(str) {
  return String(str || "").replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

