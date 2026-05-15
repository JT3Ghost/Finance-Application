const categories = [
  "Groceries",
  "Dining",
  "Transport",
  "Bills",
  "Shopping",
  "Health",
  "Travel",
  "Income",
  "Other",
];

const defaultBudgets = {
  Groceries: 450,
  Dining: 260,
  Transport: 180,
  Bills: 900,
  Shopping: 250,
  Health: 160,
  Travel: 300,
  Other: 200,
};

const state = {
  user: null,
  view: "dashboard",
  expenses: [],
  budgets: { ...defaultBudgets },
  filters: { query: "", category: "All", range: "month" },
  pendingReceiptImage: "",
  pendingReceiptText: "",
  stream: null,
  syncStatus: "Saved",
  accountSync: {
    ready: false,
    loading: false,
    error: "",
    token: localStorage.getItem("ghostlabs:syncToken") || "",
    lastPulledAt: "",
  },
};

const app = document.querySelector("#app");
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function userKey(email) {
  return `ghostlabs:user:${email.toLowerCase()}`;
}

function syncKey(email) {
  return `ghostlabs:account-sync:${email.toLowerCase()}`;
}

function legacyUserKey(email) {
  return `spendlens:user:${email.toLowerCase()}`;
}

function migrateLegacyAccount(email) {
  const previous = readJSON(legacyUserKey(email), null);
  if (previous && !localStorage.getItem(userKey(email))) {
    writeJSON(userKey(email), previous);
  }
}

function isLocalPreview() {
  return ["localhost", "127.0.0.1", "", "::1"].includes(window.location.hostname);
}

function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function syncConfig() {
  return window.GHOSTLABS_ACCOUNT_SYNC || {};
}

function hasAccountSyncConfig() {
  return Boolean(syncConfig().apiBaseUrl);
}

function syncUrl(path) {
  return `${syncConfig().apiBaseUrl.replace(/\/$/, "")}${path}`;
}

async function syncRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (state.accountSync.token) {
    headers.Authorization = `Bearer ${state.accountSync.token}`;
  }
  const response = await fetch(syncUrl(path), {
    ...options,
    headers,
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.message || body?.error || `Sync request failed (${response.status})`);
  }
  return body;
}

function ledgerPayload() {
  return {
    profile: state.user,
    expenses: state.expenses,
    budgets: state.budgets,
    updatedAt: new Date().toISOString(),
  };
}

function applyLedger(payload) {
  if (!payload) return;
  state.user = payload.profile || state.user;
  state.expenses = payload.expenses || [];
  state.budgets = { ...defaultBudgets, ...(payload.budgets || {}) };
  if (state.user?.email) writeJSON(userKey(state.user.email), payload);
}

async function signIntoAccountSync(email, password, name) {
  if (!hasAccountSyncConfig() || !password) return false;
  state.accountSync.loading = true;
  try {
    const session = await syncRequest("/auth/session", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    });
    state.accountSync.token = session.token;
    localStorage.setItem("ghostlabs:syncToken", session.token);
    state.accountSync.ready = true;
    state.accountSync.error = "";
    return true;
  } catch (error) {
    state.accountSync.error = error.message;
    state.syncStatus = "Account sync unavailable";
    return false;
  } finally {
    state.accountSync.loading = false;
  }
}

async function saveAccountLedger() {
  if (!state.user || !state.accountSync.ready || !state.accountSync.token) return false;
  await syncRequest("/ledger", {
    method: "PUT",
    body: JSON.stringify(ledgerPayload()),
  });
  state.syncStatus = "Account synced";
  return true;
}

async function loadAccountLedger() {
  if (!state.accountSync.ready || !state.accountSync.token) return false;
  const payload = await syncRequest("/ledger");
  if (payload) {
    applyLedger(payload);
    state.accountSync.lastPulledAt = new Date().toISOString();
    state.syncStatus = "Account loaded";
    return true;
  }
  await saveAccountLedger();
  return false;
}

async function signIn(profile) {
  const account = { name: profile.name, email: profile.email };
  state.user = account;
  localStorage.setItem("ghostlabs:currentUser", account.email);
  migrateLegacyAccount(account.email);
  const saved = readJSON(userKey(account.email), null);
  if (saved) {
    state.expenses = saved.expenses || [];
    state.budgets = { ...defaultBudgets, ...(saved.budgets || {}) };
  } else {
    state.expenses = [];
    state.budgets = { ...defaultBudgets };
    persist();
  }
  if (profile.password && (await signIntoAccountSync(account.email, profile.password, account.name))) {
    await loadAccountLedger();
  } else if (!hasAccountSyncConfig()) {
    state.syncStatus = "Local only";
  }
  render();
}

async function signOut() {
  stopCamera();
  state.accountSync.ready = false;
  state.accountSync.token = "";
  localStorage.removeItem("ghostlabs:syncToken");
  localStorage.removeItem("ghostlabs:currentUser");
  localStorage.removeItem("spendlens:currentUser");
  state.user = null;
  state.expenses = [];
  render();
}

function persist(sync = false) {
  if (!state.user) return;
  const payload = ledgerPayload();
  writeJSON(userKey(state.user.email), payload);
  if (sync) {
    writeJSON(syncKey(state.user.email), payload);
    saveAccountLedger()
      .then((saved) => {
        if (!saved) state.syncStatus = hasAccountSyncConfig() ? "Account sign-in needed" : "Local only";
        render();
      })
      .catch(() => {
        state.syncStatus = "Account sync failed";
        render();
      });
  } else {
    state.syncStatus = state.accountSync.ready ? "Account syncing" : "Saved locally";
    saveAccountLedger()
      .then((saved) => {
        if (!saved) state.syncStatus = hasAccountSyncConfig() ? "Saved locally" : "Local only";
        render();
      })
      .catch(() => {
        state.syncStatus = "Saved locally";
        render();
      });
  }
}

function monthKey(value) {
  return value.slice(0, 7);
}

function currentMonthExpenses() {
  const current = new Date().toISOString().slice(0, 7);
  return state.expenses.filter((expense) => monthKey(expense.date) === current);
}

function totalFor(expenses) {
  return expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
}

function byCategory(expenses = currentMonthExpenses()) {
  return expenses.reduce((acc, expense) => {
    if (expense.category === "Income") return acc;
    acc[expense.category] = (acc[expense.category] || 0) + Number(expense.amount || 0);
    return acc;
  }, {});
}

function filteredExpenses() {
  const query = state.filters.query.trim().toLowerCase();
  const now = new Date();
  return state.expenses
    .filter((expense) => {
      const haystack = `${expense.merchant} ${expense.note} ${expense.payment}`.toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesCategory =
        state.filters.category === "All" || expense.category === state.filters.category;
      const date = new Date(`${expense.date}T00:00:00`);
      const days = (now - date) / (1000 * 60 * 60 * 24);
      const matchesRange =
        state.filters.range === "all" ||
        (state.filters.range === "week" && days <= 7) ||
        (state.filters.range === "month" && monthKey(expense.date) === now.toISOString().slice(0, 7)) ||
        (state.filters.range === "year" && expense.date.slice(0, 4) === String(now.getFullYear()));
      return matchesQuery && matchesCategory && matchesRange;
    })
    .sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
}

function icon(name) {
  const icons = {
    dashboard: "▦",
    plus: "+",
    history: "◷",
    scan: "▣",
    income: "$",
    sync: "↻",
    out: "↪",
    trash: "×",
    camera: "◉",
    upload: "↑",
  };
  return icons[name] || "•";
}

function authTemplate() {
  return `
    <section class="auth-screen">
      <div class="auth-copy">
        <div class="brand-mark">GL</div>
        <h1>GhostLabs</h1>
        <p>Track budgets, save every expense to your account space, and turn receipt photos into reviewable entries before they land in your history.</p>
        <div class="receipt-stack" aria-hidden="true">
          <div class="mini-receipt">
            <div class="receipt-line"></div><div class="receipt-line short"></div><div class="receipt-line"></div><div class="receipt-line total"></div>
          </div>
          <div class="mini-receipt">
            <div class="receipt-line short"></div><div class="receipt-line"></div><div class="receipt-line short"></div><div class="receipt-line total"></div>
          </div>
          <div class="mini-receipt">
            <div class="receipt-line"></div><div class="receipt-line"></div><div class="receipt-line short"></div><div class="receipt-line total"></div>
          </div>
        </div>
      </div>
      <form class="auth-panel form-grid" id="signin-form">
        <h2>Sign in</h2>
        <p class="muted">Use any name and email to open an account-scoped workspace on this device.</p>
        <label>Name <input name="name" autocomplete="name" required placeholder="Alex Morgan" /></label>
        <label>Email <input name="email" type="email" autocomplete="email" required placeholder="alex@example.com" /></label>
        <label>Password <input name="password" type="password" minlength="6" autocomplete="current-password" placeholder="Required for account sync" /></label>
        <button class="btn accent" type="submit">Sign in securely</button>
      </form>
    </section>
  `;
}

function shellTemplate() {
  return `
    <section class="workspace">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">GL</span><span>GhostLabs</span></div>
        <nav class="nav" aria-label="Primary">
          ${navButton("dashboard", "Dashboard")}
          ${navButton("add", "Add Expense")}
          ${navButton("income", "Income")}
          ${navButton("history", "History")}
          ${navButton("scan", "Scan Receipt")}
          ${navButton("budgets", "Budgets")}
        </nav>
        <div class="account-box">
          <span class="sync-pill"><span class="sync-dot"></span>${state.syncStatus}</span>
          <strong>${escapeHTML(state.user.name)}</strong>
          <span>${escapeHTML(state.user.email)}</span>
          <div class="button-row">
            <button class="btn secondary" data-action="sync">${icon("sync")} Sync</button>
            <button class="btn secondary" data-action="share">Share</button>
            <button class="icon-btn" title="Sign out" data-action="signout">${icon("out")}</button>
          </div>
          ${isLocalPreview() ? `<span>This is a local preview. Deploy it before sharing the link.</span>` : ""}
        </div>
      </aside>
      <div class="content">
        ${viewTemplate()}
      </div>
    </section>
  `;
}

function navButton(id, label) {
  return `<button class="${state.view === id ? "active" : ""}" data-view="${id}">${icon(id)} ${label}</button>`;
}

function viewTemplate() {
  if (state.view === "add") return addExpenseTemplate();
  if (state.view === "income") return incomeTemplate();
  if (state.view === "history") return historyTemplate();
  if (state.view === "scan") return scanTemplate();
  if (state.view === "budgets") return budgetsTemplate();
  return dashboardTemplate();
}

function dashboardTemplate() {
  const month = currentMonthExpenses();
  const spent = totalFor(month.filter((expense) => expense.category !== "Income"));
  const income = totalFor(month.filter((expense) => expense.category === "Income"));
  const remaining = income - spent;
  const spentPercent = income > 0 ? (spent / income) * 100 : 0;
  const savedPercent = income > 0 ? (remaining / income) * 100 : 0;
  const budgetLimit = Object.values(state.budgets).reduce((sum, value) => sum + Number(value || 0), 0);
  const budgetPercent = budgetLimit > 0 ? (spent / budgetLimit) * 100 : 0;
  const categoryTotals = byCategory(month);
  const topCategory =
    Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || "No spend yet";
  return `
    <header class="topbar">
      <div><h1>Dashboard</h1><p class="muted">This month at a glance.</p></div>
      <div class="button-row">
        <button class="btn secondary" data-view="income">${icon("income")} Add income</button>
        <button class="btn accent" data-view="scan">${icon("scan")} Scan receipt</button>
      </div>
    </header>
    <section class="dashboard-grid">
      <div class="stat-card"><span class="muted">Monthly spend</span><strong>${currency.format(spent)}</strong></div>
      <div class="stat-card"><span class="muted">Tracked income</span><strong>${currency.format(income)}</strong></div>
      <div class="stat-card"><span class="muted">After expenses</span><strong>${currency.format(remaining)}</strong></div>
    </section>
    <section class="insight-grid">
      <div class="panel">
        <div class="panel-head">
          <div><h2>Expense mix</h2><p class="muted">Category share of monthly spending.</p></div>
          <span class="tag">${topCategory}</span>
        </div>
        ${expensePieChart(categoryTotals)}
      </div>
      <div class="panel">
        <div class="panel-head">
          <div><h2>Income wheels</h2><p class="muted">How spending compares with money coming in.</p></div>
        </div>
        <div class="wheel-grid">
          ${percentageWheel("Spent", spentPercent, currency.format(spent), "coral")}
          ${percentageWheel("Remaining", savedPercent, currency.format(remaining), "accent")}
          ${percentageWheel("Budget used", budgetPercent, `${Math.round(budgetPercent)}%`, "gold")}
        </div>
      </div>
    </section>
    <section class="layout-grid">
      <div class="panel">
        <h2>Quick add</h2>
        ${expenseFormTemplate("quick-expense-form")}
      </div>
      <div class="panel">
        <h2>Recent history</h2>
        <div class="expense-list">${expenseCards(state.expenses.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 5))}</div>
      </div>
    </section>
  `;
}

function incomeTemplate() {
  const month = currentMonthExpenses();
  const incomes = month
    .filter((expense) => expense.category === "Income")
    .sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
  return `
    <header class="topbar">
      <div><h1>Income</h1><p class="muted">Add paychecks, freelance payments, transfers, or any money coming in.</p></div>
    </header>
    <section class="layout-grid">
      <div class="panel">
        <h2>Add income</h2>
        ${incomeFormTemplate()}
      </div>
      <div class="panel">
        <h2>This month</h2>
        <div class="expense-list">${expenseCards(incomes)}</div>
      </div>
    </section>
  `;
}

function incomeFormTemplate() {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <form class="form-grid" id="income-form">
      <div class="split-grid">
        <label>Source <input name="merchant" required placeholder="Employer, client, transfer" /></label>
        <label>Amount <input name="amount" required type="number" min="0" step="0.01" placeholder="0.00" /></label>
      </div>
      <div class="split-grid">
        <label>Date <input name="date" type="date" required value="${today}" /></label>
        <label>Deposit method <input name="payment" placeholder="Direct deposit, check, cash" /></label>
      </div>
      <label>Note <textarea name="note" placeholder="Pay period, invoice, bonus, or other details"></textarea></label>
      <button class="btn accent" type="submit">${icon("income")} Save income</button>
    </form>
  `;
}

function addExpenseTemplate() {
  return `
    <header class="topbar"><div><h1>Add expense</h1><p class="muted">Create a clean record for anything you spend or earn.</p></div></header>
    <section class="panel">${expenseFormTemplate("expense-form")}</section>
  `;
}

function expensePieChart(categoryTotals) {
  const entries = Object.entries(categoryTotals).filter(([, value]) => value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) {
    return `<div class="empty">Add expenses to see your category breakdown.</div>`;
  }
  const palette = ["#0f8b8d", "#ef6f61", "#f7c948", "#5661b3", "#2f855a", "#d7e360", "#9b5de5", "#667085"];
  let cursor = 0;
  const stops = entries
    .map(([category, value], index) => {
      const start = cursor;
      const end = cursor + (value / total) * 100;
      cursor = end;
      return `${palette[index % palette.length]} ${start}% ${end}%`;
    })
    .join(", ");
  return `
    <div class="chart-wrap">
      <div class="pie-chart" style="background: conic-gradient(${stops});" role="img" aria-label="Expense category pie chart"></div>
      <div class="chart-legend">
        ${entries
          .map(([category, value], index) => {
            const pct = Math.round((value / total) * 100);
            return `<div><span class="swatch" style="background:${palette[index % palette.length]}"></span><strong>${category}</strong><span>${pct}% · ${currency.format(value)}</span></div>`;
          })
          .join("")}
      </div>
    </div>
  `;
}

function percentageWheel(label, value, detail, tone) {
  const percent = Math.max(0, Math.min(value, 100));
  return `
    <div class="wheel-card">
      <div class="percent-wheel ${tone}" style="--percent:${percent}%;">
        <span>${Math.round(percent)}%</span>
      </div>
      <strong>${label}</strong>
      <span class="muted">${detail}</span>
    </div>
  `;
}

function expenseFormTemplate(id, values = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <form class="form-grid" id="${id}">
      <div class="split-grid">
        <label>Merchant <input name="merchant" required placeholder="Store or payee" value="${escapeHTML(values.merchant || "")}" /></label>
        <label>Amount <input name="amount" required type="number" min="0" step="0.01" placeholder="0.00" value="${escapeHTML(values.amount || "")}" /></label>
      </div>
      <div class="split-grid">
        <label>Category <select name="category">${categories.map((cat) => `<option ${cat === values.category ? "selected" : ""}>${cat}</option>`).join("")}</select></label>
        <label>Date <input name="date" type="date" required value="${values.date || today}" /></label>
      </div>
      <div class="split-grid">
        <label>Payment <input name="payment" placeholder="Card, cash, wallet" value="${escapeHTML(values.payment || "")}" /></label>
        <label>Receipt image <input name="receiptImage" readonly value="${state.pendingReceiptImage ? "Attached from scanner" : ""}" /></label>
      </div>
      <label>Note <textarea name="note" placeholder="Add context, project, trip, or receipt details">${escapeHTML(values.note || "")}</textarea></label>
      <button class="btn accent" type="submit">${icon("plus")} Save expense</button>
    </form>
  `;
}

function historyTemplate() {
  return `
    <header class="topbar">
      <div><h1>Expense history</h1><p class="muted">Search every saved transaction.</p></div>
      <button class="btn secondary" data-action="export">Export CSV</button>
    </header>
    <section class="panel">
      <div class="history-tools">
        <input id="filter-query" placeholder="Search merchant, note, payment" value="${escapeHTML(state.filters.query)}" />
        <select id="filter-category"><option>All</option>${categories.map((cat) => `<option ${cat === state.filters.category ? "selected" : ""}>${cat}</option>`).join("")}</select>
        <select id="filter-range">
          ${["week", "month", "year", "all"].map((range) => `<option value="${range}" ${range === state.filters.range ? "selected" : ""}>${range[0].toUpperCase() + range.slice(1)}</option>`).join("")}
        </select>
      </div>
      <div class="expense-list" id="history-list">${expenseCards(filteredExpenses())}</div>
    </section>
  `;
}

function budgetsTemplate() {
  const totals = byCategory();
  return `
    <header class="topbar"><div><h1>Budgets</h1><p class="muted">Set monthly category limits and watch progress update automatically.</p></div></header>
    <section class="layout-grid">
      <form class="panel form-grid" id="budget-form">
        <h2>Monthly limits</h2>
        ${Object.entries(defaultBudgets)
          .map(([category]) => `<label>${category}<input name="${category}" type="number" min="0" step="1" value="${state.budgets[category] || 0}" /></label>`)
          .join("")}
        <button class="btn accent" type="submit">Save budgets</button>
      </form>
      <div class="panel">
        <h2>Progress</h2>
        <div class="budget-list">
          ${Object.entries(defaultBudgets)
            .map(([category]) => budgetRow(category, totals[category] || 0, state.budgets[category] || 0))
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function budgetRow(category, spent, limit) {
  const percent = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
  const tone = percent >= 100 ? "over" : percent >= 80 ? "warning" : "";
  return `
    <div class="budget-row">
      <div class="budget-head"><span>${category}</span><span>${currency.format(spent)} / ${currency.format(limit)}</span></div>
      <div class="meter" aria-label="${category} budget progress"><span class="${tone}" style="width:${percent}%"></span></div>
    </div>
  `;
}

function scanTemplate() {
  const parsed = parseReceiptText(state.pendingReceiptText);
  return `
    <header class="topbar"><div><h1>Scan receipt</h1><p class="muted">Capture or upload a receipt, then confirm the parsed expense before saving.</p></div></header>
    <section class="scanner-grid">
      <div class="panel">
        <div class="button-row">
          <button class="btn accent" data-action="start-camera" type="button">${icon("camera")} Start camera</button>
          <button class="btn secondary" data-action="capture" type="button">Capture</button>
          <label class="btn secondary">${icon("upload")} Upload<input id="receipt-upload" type="file" accept="image/*" capture="environment" class="hidden" /></label>
        </div>
        <div class="scanner-preview" id="scanner-preview">
          <video id="camera-feed" autoplay playsinline class="${state.stream ? "" : "hidden"}"></video>
          ${state.pendingReceiptImage ? `<img class="receipt-photo" alt="Captured receipt" src="${state.pendingReceiptImage}" />` : ""}
          ${!state.stream && !state.pendingReceiptImage ? `<div class="empty">Camera or receipt image preview</div>` : ""}
        </div>
        <label>Receipt text <textarea id="receipt-text" placeholder="Paste OCR text here, or type the main receipt lines after taking a photo.">${escapeHTML(state.pendingReceiptText)}</textarea></label>
        <button class="btn secondary" data-action="parse-receipt" type="button">Parse receipt text</button>
      </div>
      <div class="panel">
        <h2>Review expense</h2>
        ${expenseFormTemplate("receipt-expense-form", parsed)}
      </div>
    </section>
  `;
}

function expenseCards(expenses) {
  if (!expenses.length) return `<div class="empty">No expenses found.</div>`;
  return expenses
    .map(
      (expense) => `
      <article class="expense-card">
        <div>
          <h3>${escapeHTML(expense.merchant)}</h3>
          <div class="expense-meta">
            <span class="tag">${escapeHTML(expense.category)}</span>
            <span>${escapeHTML(expense.date)}</span>
            <span>${escapeHTML(expense.payment || "No payment method")}</span>
            ${expense.receiptImage ? `<span>Receipt attached</span>` : ""}
          </div>
          ${expense.note ? `<p class="muted">${escapeHTML(expense.note)}</p>` : ""}
        </div>
        <div>
          <div class="amount">${currency.format(Number(expense.amount))}</div>
          <button class="icon-btn" title="Delete expense" data-delete="${expense.id}">${icon("trash")}</button>
        </div>
      </article>
    `,
    )
    .join("");
}

function parseReceiptText(text) {
  if (!text.trim()) return {};
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const merchant = lines[0] || "";
  const dateMatch = text.match(/\b(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})\b/);
  const totalLine = lines.find((line) => /total|amount due|balance/i.test(line)) || text;
  const amounts = [...totalLine.matchAll(/\$?\s?(\d+[,.]\d{2})/g)].map((match) =>
    Number(match[1].replace(",", ".")),
  );
  const amount = amounts.length ? Math.max(...amounts).toFixed(2) : "";
  return {
    merchant,
    amount,
    category: guessCategory(text),
    date: normalizeDate(dateMatch?.[0]) || new Date().toISOString().slice(0, 10),
    payment: /visa|mastercard|amex|debit|credit/i.test(text) ? "Card" : "",
    note: lines.slice(1, 8).join(" | "),
  };
}

function normalizeDate(value) {
  if (!value) return "";
  const parts = value.replace(/[/.]/g, "-").split("-").map(Number);
  if (parts[0] > 1900) {
    return `${parts[0]}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}`;
  }
  return `${parts[2]}-${String(parts[0]).padStart(2, "0")}-${String(parts[1]).padStart(2, "0")}`;
}

function guessCategory(text) {
  const lower = text.toLowerCase();
  if (/market|grocery|foods|super/i.test(lower)) return "Groceries";
  if (/cafe|restaurant|pizza|bar|grill/i.test(lower)) return "Dining";
  if (/fuel|uber|lyft|rail|parking|taxi/i.test(lower)) return "Transport";
  if (/pharmacy|clinic|medical/i.test(lower)) return "Health";
  return "Other";
}

function addExpense(form) {
  const data = Object.fromEntries(new FormData(form));
  state.expenses.unshift({
    id: crypto.randomUUID(),
    merchant: data.merchant.trim(),
    amount: Number(data.amount),
    category: data.category,
    date: data.date,
    payment: data.payment.trim(),
    note: data.note.trim(),
    receiptImage: state.pendingReceiptImage,
    createdAt: Date.now(),
  });
  state.pendingReceiptImage = "";
  state.pendingReceiptText = "";
  persist();
  toast("Expense saved");
  state.view = "history";
  render();
}

function addIncome(form) {
  const data = Object.fromEntries(new FormData(form));
  state.expenses.unshift({
    id: crypto.randomUUID(),
    merchant: data.merchant.trim(),
    amount: Number(data.amount),
    category: "Income",
    date: data.date,
    payment: data.payment.trim(),
    note: data.note.trim(),
    receiptImage: "",
    createdAt: Date.now(),
  });
  persist();
  toast("Income saved");
  render();
}

function exportCSV() {
  const rows = [["Date", "Merchant", "Category", "Amount", "Payment", "Note"]];
  filteredExpenses().forEach((expense) => {
    rows.push([expense.date, expense.merchant, expense.category, expense.amount, expense.payment, expense.note]);
  });
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ghostlabs-expenses.csv";
  link.click();
  URL.revokeObjectURL(url);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Camera access is not available in this browser context");
    return;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    const video = document.querySelector("#camera-feed");
    if (video) video.srcObject = state.stream;
    render();
    const refreshed = document.querySelector("#camera-feed");
    if (refreshed) refreshed.srcObject = state.stream;
  } catch {
    toast("Camera permission was blocked or unavailable");
  }
}

function stopCamera() {
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
}

function captureReceipt() {
  const video = document.querySelector("#camera-feed");
  if (!video || !video.videoWidth) {
    toast("Start the camera before capturing");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  state.pendingReceiptImage = canvas.toDataURL("image/jpeg", 0.82);
  stopCamera();
  toast("Receipt image attached");
  render();
}

function handleUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.pendingReceiptImage = reader.result;
    toast("Receipt image attached");
    render();
  };
  reader.readAsDataURL(file);
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

async function shareApp() {
  const url = window.location.href;
  if (isLocalPreview()) {
    toast("Local preview links only work on this computer. Publish the app, then share the public URL.");
    return;
  }
  const shareData = {
    title: "GhostLabs Budget Tracker",
    text: "Track budgets, expenses, and receipts with GhostLabs.",
    url,
  };
  if (navigator.share) {
    await navigator.share(shareData);
    return;
  }
  await navigator.clipboard.writeText(url);
  toast("Share link copied");
}

function updateHistoryList() {
  const list = document.querySelector("#history-list");
  if (list) {
    list.innerHTML = expenseCards(filteredExpenses());
    bindDeleteButtons();
  }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bindDeleteButtons() {
  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      state.expenses = state.expenses.filter((expense) => expense.id !== button.dataset.delete);
      persist();
      toast("Expense deleted");
      render();
    });
  });
}

function bindEvents() {
  document.querySelector("#signin-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await signIn({
        name: data.name.trim(),
        email: data.email.trim(),
        password: data.password,
      });
    } catch (error) {
      toast(error.message || "Sign-in failed");
    }
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      render();
    });
  });

  document.querySelectorAll("#expense-form, #quick-expense-form, #receipt-expense-form").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      addExpense(event.currentTarget);
    });
  });

  document.querySelector("#income-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    addIncome(event.currentTarget);
  });

  document.querySelector("#budget-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    Object.keys(defaultBudgets).forEach((category) => {
      state.budgets[category] = Number(data[category] || 0);
    });
    persist();
    toast("Budgets saved");
    render();
  });

  document.querySelector("[data-action='sync']")?.addEventListener("click", async () => {
    persist(true);
    toast(hasAccountSyncConfig() ? "Syncing account" : "Add an account sync API URL to sync across devices");
    render();
  });

  document.querySelector("[data-action='share']")?.addEventListener("click", shareApp);
  document.querySelector("[data-action='signout']")?.addEventListener("click", signOut);
  document.querySelector("[data-action='export']")?.addEventListener("click", exportCSV);
  document.querySelector("[data-action='start-camera']")?.addEventListener("click", startCamera);
  document.querySelector("[data-action='capture']")?.addEventListener("click", captureReceipt);
  document.querySelector("[data-action='parse-receipt']")?.addEventListener("click", () => {
    state.pendingReceiptText = document.querySelector("#receipt-text")?.value || "";
    render();
    toast("Receipt text parsed");
  });

  document.querySelector("#receipt-upload")?.addEventListener("change", (event) => {
    handleUpload(event.target.files?.[0]);
  });

  document.querySelector("#filter-query")?.addEventListener("input", (event) => {
    state.filters.query = event.target.value;
    updateHistoryList();
  });
  document.querySelector("#filter-category")?.addEventListener("change", (event) => {
    state.filters.category = event.target.value;
    updateHistoryList();
  });
  document.querySelector("#filter-range")?.addEventListener("change", (event) => {
    state.filters.range = event.target.value;
    updateHistoryList();
  });

  bindDeleteButtons();
}

function render() {
  app.innerHTML = state.user ? shellTemplate() : authTemplate();
  bindEvents();
}

function boot() {
  const email =
    localStorage.getItem("ghostlabs:currentUser") || localStorage.getItem("spendlens:currentUser");
  if (email) {
    migrateLegacyAccount(email);
    localStorage.setItem("ghostlabs:currentUser", email);
    const saved = readJSON(userKey(email), null);
    if (saved?.profile) {
      state.user = saved.profile;
      state.expenses = saved.expenses || [];
      state.budgets = { ...defaultBudgets, ...(saved.budgets || {}) };
    }
  }
  render();
}

boot();
