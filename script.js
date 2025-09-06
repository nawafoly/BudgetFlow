/* =========================
   إدارة مالي — script.js (v3.6)
   تغييرات مضافة:
   - إصلاح today باستخدام التوقيت المحلي (لا يتأثر بانزياح UTC)
   - الراوتر: عناصر DOM تُقرأ بعد التحميل (sections/navLinks كدوال) + تمرير آمن
   - تحديث ألوان الرسوم عند تغيير الثيم + بعد التهيئة
   - دفع جزئي: السماح بمبالغ عشرية (step=0.01) وضبط الحدود
   - fmt يدعم حتى منزلتين عشريتين عند الحاجة
========================= */

// ===== Helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ym = (d) => {
  if (!d) return "";
  if (typeof d === "string") return d.slice(0, 7);
  const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return t.toISOString().slice(0, 7);
};
// كان: const today = new Date().toISOString().slice(0, 10);
const today = (() => {
  const now = new Date();
  const t = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return t.toISOString().slice(0, 10);
})();

const normCat = (s) => (s || "").toString().trim().toLowerCase();
const fmt = (n) =>
  Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " ر.س";
const lastDayOfMonth = (y, m) => new Date(y, m, 0).getDate();
const prevMonthStr = (yyyymm) => {
  let [y, m] = yyyymm.split("-").map(Number);
  m === 1 ? (y--, (m = 12)) : m--;
  return `${y}-${String(m).padStart(2, "0")}`;
};

// ===== Toast
function showToast(msg, type = "") {
  const t = $("#toast");
  if (!t) return;
  t.className = `toast ${type}`.trim();
  t.innerHTML = msg;
  t.style.display = "block";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (t.style.display = "none"), 2200);
}

// ===== Storage Keys
const K = {
  salary: "pf_salary",
  saving: "pf_saving",
  settings: "pf_settings",
  inst: "pf_inst",
  bills: "pf_bills",
  exps: "pf_exps",
  one: "pf_one",
  budgets: "pf_budgets",
  paid: "pf_paid_monthly",
  roll: "pf_rollovers",
  paidAmt: "pf_paid_amounts", // مبالغ الدفع الجزئي لكل شهر
};
const getLS = (k, fbJSON) => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? fbJSON);
  } catch {
    return JSON.parse(fbJSON);
  }
};
const setLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ===== Common (due / paid)
const withinMonthRange = (start, end, yyyymm) => {
  const s = ym(start);
  const e = end ? ym(end) : "9999-12";
  return yyyymm >= s && yyyymm <= e;
};
const dueThisMonth = (item, yyyymm) =>
  withinMonthRange(item.start, item.end, yyyymm) ? Number(item.amount || 0) : 0;

const isPaid = (kind, id, yyyymm) =>
  !!getLS(K.paid, "{}")[`${kind}:${id}:${yyyymm}`];
const setPaid = (kind, id, yyyymm, val) => {
  const m = getLS(K.paid, "{}");
  m[`${kind}:${id}:${yyyymm}`] = !!val;
  setLS(K.paid, m);
};

// ===== Partial amounts
const keyPaidAmt = (kind, id, yyyymm) => `${kind}:${id}:${yyyymm}`;
const getPaidAmt = (kind, id, yyyymm) =>
  Number(getLS(K.paidAmt, "{}")[keyPaidAmt(kind, id, yyyymm)] || 0);
const setPaidAmt = (kind, id, yyyymm, amount) => {
  const m = getLS(K.paidAmt, "{}");
  m[keyPaidAmt(kind, id, yyyymm)] = Math.max(0, Number(amount || 0));
  setLS(K.paidAmt, m);
};
const clearPaidAmt = (kind, id, yyyymm) => {
  const m = getLS(K.paidAmt, "{}");
  delete m[keyPaidAmt(kind, id, yyyymm)];
  setLS(K.paidAmt, m);
};

const daysUntilDue = (item, yyyymm) => {
  const y = +yyyymm.slice(0, 4),
    m = +yyyymm.slice(5, 7);
  const last = lastDayOfMonth(y, m);
  const d = Math.min(item.dueDay || last, last);
  const due = new Date(y, m - 1, d);
  return Math.floor((due - new Date()) / 86400000);
};
const payLabel = (p) =>
  ({
    cash: "💵 كاش",
    card: "💳 بطاقة",
    transfer: "🏦 تحويل",
    wallet: "📱 محفظة",
  }[p] ||
  p ||
  "-");
const methodName = (m) =>
  ({ cash: "كاش", card: "بطاقة", transfer: "تحويل", wallet: "محفظة" }[m] ||
  m ||
  "-");

function ensureLTRNumeric() {
  $$('input[type="number"], input[type="date"], input[type="month"]').forEach(
    (el) => {
      el.setAttribute("dir", "ltr");
      el.style.direction = "ltr";
      if (el.type === "number") el.setAttribute("inputmode", "numeric");
    }
  );
  $("#expAmount")?.setAttribute("inputmode", "decimal");
}

// قيّد مصروف مقابل الدفع الجزئي
function logPartialExpense(kind, item, yyyymm, amount, method = "transfer") {
  const exps = getLS(K.exps, "[]");
  exps.push({
    id: "exp_" + (crypto.randomUUID?.() || Date.now().toString(36)),
    date: today,
    cat: kind === "inst" ? "سداد قسط" : "سداد فاتورة",
    note: `${item.name} | ${yyyymm} | ${methodName(method)}`,
    pay: method,
    amount: Number(amount || 0),
  });
  setLS(K.exps, exps);
}

// ===== واجهة استحقاق هذا الشهر (الأصل + مدفوع + متبقي)
function formatDueHTML(kind, item, yyyymm) {
  const due = dueThisMonth(item, yyyymm);
  if (!due) return "-";

  // لو الشهر مدفوع بالكامل: نعرض شارة خضراء ونخفي تفاصيل الجزئي
  if (isPaid(kind, item.id, yyyymm)) {
    return `<div>${fmt(
      due
    )} <span class="chip green">مدفوع بالكامل</span></div>`;
  }

  // غير مدفوع بالكامل: نعرض (مدفوع/متبقي)
  const paid = getPaidAmt(kind, item.id, yyyymm);
  const remain = Math.max(0, due - paid);
  const chips =
    paid > 0
      ? `<div class="mt-1">
         <span class="chip blue">مدفوع: ${fmt(paid)}</span>
         <span class="chip ${remain > 0 ? "warning" : "green"}">المتبقي: ${fmt(
          remain
        )}</span>
       </div>`
      : "";
  return `<div>${fmt(due)}${chips}</div>`;
}

// ===== Partial Pay Modal
let _ppState = null,
  _ppBound = false;

function ensurePartialPayModal() {
  let el = $("#ppModal");
  if (el) {
    // ⚠️ لو النافذة داخل #modal أو أي عنصر مخفي، انقلها لأعلى <body>
    if (el.parentElement !== document.body) document.body.appendChild(el);
    return;
  }
  // Inject لو مش موجودة
  const wrap = document.createElement("div");
  wrap.innerHTML = `
  <div id="ppModal" class="modal" aria-modal="true" role="dialog">
    <div class="sheet">
      <div class="handle"></div>
      <button id="ppClose" class="btn ghost" aria-label="إغلاق">✕</button>
      <h2>💳 دفع جزئي</h2>
      <div class="grid grid-cols-responsive">
        <div class="card">
          <div class="inst-grid">
            <div class="inst-item"><div class="lbl">العنصر</div><div id="ppName" class="val">—</div></div>
            <div class="inst-item"><div class="lbl">الشهر</div><div class="val"><select id="ppMonth" dir="ltr" lang="en"></select></div></div>
            <div class="inst-item"><div class="lbl">المستحق</div><div id="ppDue" class="val">0 ر.س</div></div>
            <div class="inst-item"><div class="lbl">مدفوع سابقًا</div><div id="ppAlready" class="val">0 ر.س</div></div>
            <div class="inst-item"><div class="lbl">المتبقي</div><div id="ppRemain" class="val">0 ر.س</div></div>
          </div>
        </div>
        <div class="card">
          <label for="ppAmount">المبلغ الجزئي</label>
          <input type="number" id="ppAmount" placeholder="0" dir="ltr" lang="en" inputmode="decimal" pattern="\\d+(\\.\\d{1,2})?" step="0.01">
          <label for="ppMethod" class="mt-2">طريقة الدفع</label>
          <select id="ppMethod">
            <option value="transfer">🏦 تحويل</option>
            <option value="cash">💵 كاش</option>
            <option value="card">💳 بطاقة</option>
            <option value="wallet">📱 محفظة</option>
          </select>
          <button id="ppConfirm" type="button" class="btn primary mt-3">تأكيد الدفع</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(wrap.firstElementChild);
}
function bindPartialPayEvents() {
  if (_ppBound) return;
  $("#ppClose")?.addEventListener("click", closePartialModal);
  $("#ppConfirm")?.addEventListener("click", confirmPartial);
  $("#ppModal")?.addEventListener("click", (e) => {
    if (e.target === $("#ppModal")) closePartialModal();
  });
  document.addEventListener("keydown", (e) => {
    if ($("#ppModal")?.classList.contains("show") && e.key === "Escape")
      closePartialModal();
  });
  _ppBound = true;
}

function monthsBetween(startYM, endYM) {
  let [ys, ms] = startYM.split("-").map(Number),
    [ye, me] = endYM.split("-").map(Number),
    out = [];
  while (ys < ye || (ys === ye && ms <= me)) {
    out.push(`${ys}-${String(ms).padStart(2, "0")}`);
    ms++;
    if (ms > 12) {
      ms = 1;
      ys++;
    }
  }
  return out;
}
function unpaidMonths(kind, item, refYM) {
  const s = ym(item.start);
  const e = item.end ? ym(item.end) : refYM;
  return monthsBetween(s, e).filter((m) => {
    const due = dueThisMonth(item, m);
    if (due <= 0) return false;
    return getPaidAmt(kind, item.id, m) < due;
  });
}

function partialPay(kind, id) {
  ensurePartialPayModal(); // تأكد موجودة وموجودة تحت <body>
  bindPartialPayEvents();

  const curM = $("#monthPicker").value;
  const list = kind === "inst" ? getLS(K.inst, "[]") : getLS(K.bills, "[]");
  const item = list.find((x) => x.id === id);
  if (!item) return;

  const modal = $("#ppModal"),
    sel = $("#ppMonth"),
    nameEl = $("#ppName"),
    dueEl = $("#ppDue"),
    alreadyEl = $("#ppAlready"),
    remainEl = $("#ppRemain"),
    amountEl = $("#ppAmount"),
    confirmBtn = $("#ppConfirm");

  // جهّز الأشهر
  const months = unpaidMonths(kind, item, curM);
  if (!months.length) {
    const s = ym(item.start),
      e = item.end ? ym(item.end) : curM;
    const last = monthsBetween(s, e).pop() || curM;
    sel.innerHTML = `<option value="${last}">${last}</option>`;
  } else {
    sel.innerHTML = months
      .map((m) => `<option value="${m}">${m}</option>`)
      .join("");
    sel.value = months.includes(curM) ? curM : months[months.length - 1];
  }
  nameEl.textContent = `${item.name} (${kind === "inst" ? "قسط" : "فاتورة"})`;

  const refresh = () => {
    const m = sel.value;
    const due = dueThisMonth(item, m);
    const already = getPaidAmt(kind, item.id, m);
    const remain = Math.max(0, due - already);
    dueEl.textContent = fmt(due);
    alreadyEl.textContent = fmt(already);
    remainEl.textContent = fmt(remain);
    amountEl.value = remain > 0 ? remain : "";
    amountEl.min = 0.01;
    amountEl.max = remain || 0;
    confirmBtn.disabled = remain <= 0;
  };
  sel.onchange = refresh;
  refresh();

  _ppState = { kind, itemId: item.id };
  modal.classList.add("show");
  ensureLTRNumeric();
  setTimeout(() => amountEl?.focus(), 20);
}
window.partialPay = partialPay;

function closePartialModal() {
  $("#ppModal")?.classList.remove("show");
  _ppState = null;
}

function confirmPartial() {
  if (!_ppState) return closePartialModal();
  const { kind, itemId } = _ppState;

  const list = kind === "inst" ? getLS(K.inst, "[]") : getLS(K.bills, "[]");
  const item = list.find((x) => x.id === itemId);
  if (!item) return closePartialModal();

  const m = $("#ppMonth").value;
  const add = Number($("#ppAmount").value || 0);
  const method = $("#ppMethod").value || "transfer";

  const due = dueThisMonth(item, m);
  const already = getPaidAmt(kind, itemId, m);
  const remain = Math.max(0, due - already);

  if (!isFinite(add) || add <= 0) return showToast("مبلغ غير صالح.", "danger");
  if (due <= 0) return showToast("لا يوجد استحقاق لهذا الشهر.", "warning");
  if (remain <= 0) return showToast("تم سداد هذا الشهر بالكامل.", "success");
  if (add > remain) return showToast("المبلغ أكبر من المتبقي.", "warning");

  // ✅ لا نتجاوز المستحق
  const newPaid = Math.min(due, already + add);
  setPaidAmt(kind, itemId, m, newPaid);
  setPaid(kind, itemId, m, newPaid >= due);

  // قيّد المصروف النقدي الآن
  logPartialExpense(kind, item, m, add, method);

  // لو الترحيل شغّال، حدّث متأخرات الشهر الحالي
  const st = getLS(K.settings, '{"cash":false,"auto":false,"roll":false}');
  if (st.roll) rolloverArrears($("#monthPicker").value);

  const remainingAfter = Math.max(0, due - newPaid);
  showToast(
    `تم دفع ${fmt(add)} لشهر ${m}. المتبقي: ${fmt(remainingAfter)}`,
    "success"
  );

  closePartialModal();

  if (kind === "inst") renderInst();
  else renderBills();
  renderExpenses();
  renderKPIs();
  updateAlerts();
}

// ===== THEME + Settings
function applySavedSettings() {
  const st = getLS(K.settings, '{"cash":false,"auto":false,"roll":false}');
  $("#salaryInput").value = +getLS(K.salary, "0") || "";
  $("#savingTargetInput").value = +getLS(K.saving, "0") || "";
  $("#cashMode").checked = !!st.cash;
  $("#autoDeduct").checked = !!st.auto;
  $("#rollover").checked = !!st.roll;
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "light") {
    $("#themeToggle").checked = true;
    document.documentElement.classList.add("light");
  }
}

function bindUI() {
  $("#themeToggle")?.addEventListener("change", () => {
    document.documentElement.classList.toggle(
      "light",
      $("#themeToggle").checked
    );
    localStorage.setItem("theme", $("#themeToggle").checked ? "light" : "dark");
    refreshChartThemeColors(); // ✅ حدث ألوان الرسوم مع الثيم
  });

  $("#monthPicker").addEventListener("change", () => {
    const st = getLS(K.settings, '{"cash":false,"auto":false,"roll":false}');
    const curM = $("#monthPicker").value;
    if (st.auto) autoDeductIfDue(curM);
    if (st.roll) rolloverArrears(curM);
    renderAll();
  });

  $("#applySuggestedBtn").addEventListener("click", () => {
    const salary = +($("#salaryInput").value || 0);
    const suggested = Math.round(salary * 0.15);
    $("#savingTargetInput").value = suggested;
    setLS(K.saving, suggested);
    showToast(`💡 تم تطبيق الادخار المقترح: ${fmt(suggested)}`, "success");
    renderKPIs();
  });

  $("#saveSettingsBtn").addEventListener("click", () => {
    setLS(K.salary, +($("#salaryInput").value || 0));
    setLS(K.saving, +($("#savingTargetInput").value || 0));
    setLS(K.settings, {
      cash: $("#cashMode").checked,
      auto: $("#autoDeduct").checked,
      roll: $("#rollover").checked,
    });
    showToast("✅ تم حفظ الإعدادات", "success");
    renderAll();
  });

  // Forms
  $("#instForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#instName").value.trim(),
      amount = +$("#instAmount").value,
      start = $("#instStart").value,
      end = $("#instEnd").value || null,
      dueDay = +$("#instDueDay").value || null;
    if (!name || !start || !amount)
      return showToast("⚠️ أكمل الحقول (الاسم/المبلغ/البداية)", "warning");
    if (dueDay && (dueDay < 1 || dueDay > 31))
      return showToast("⚠️ يوم الاستحقاق 1–31", "warning");
    if (end && start > end)
      return showToast("⚠️ نهاية المدة قبل بدايتها", "warning");
    const L = getLS(K.inst, "[]");
    L.push({
      id: "inst_" + (crypto.randomUUID?.() || Date.now().toString(36)),
      name,
      amount,
      start,
      end,
      dueDay,
    });
    setLS(K.inst, L);
    e.target.reset();
    ensureLTRNumeric();
    showToast("✅ تمت إضافة القسط", "success");
    renderInst();
    renderKPIs();
    updateAlerts();
  });

  $("#billForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#billName").value.trim(),
      amount = +$("#billAmount").value,
      start = $("#billStart").value,
      end = $("#billEnd").value || null,
      dueDay = +$("#billDueDay").value || null;
    if (!name || !start || !amount)
      return showToast("⚠️ أكمل الحقول (الاسم/المبلغ/البداية)", "warning");
    if (dueDay && (dueDay < 1 || dueDay > 31))
      return showToast("⚠️ يوم الاستحقاق 1–31", "warning");
    if (end && start > end)
      return showToast("⚠️ نهاية المدة قبل بدايتها", "warning");
    const L = getLS(K.bills, "[]");
    L.push({
      id: "bill_" + (crypto.randomUUID?.() || Date.now().toString(36)),
      name,
      amount,
      start,
      end,
      dueDay,
    });
    setLS(K.bills, L);
    e.target.reset();
    ensureLTRNumeric();
    showToast("✅ تمت إضافة الفاتورة", "success");
    renderBills();
    renderKPIs();
    updateAlerts();
  });

  $("#expForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const item = {
      id: "exp_" + (crypto.randomUUID?.() || Date.now().toString(36)),
      date: $("#expDate").value,
      cat: $("#expCat").value.trim(),
      note: $("#expNote").value.trim(),
      pay: $("#expPay").value,
      amount: Number($("#expAmount").value || 0),
    };
    if (!item.date || !item.cat || !item.amount)
      return showToast("⚠️ أكمل البيانات", "warning");
    const L = getLS(K.exps, "[]");
    L.push(item);
    setLS(K.exps, L);
    e.target.reset();
    $("#expDate").value = today;
    ensureLTRNumeric();
    showToast("✅ تمت إضافة المصروف", "success");
    renderExpenses();
    renderBudgets();
    renderKPIs();
    checkBudgetWarn(item.cat);
  });

  $("#oneForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const item = {
      id: "one_" + (crypto.randomUUID?.() || Date.now().toString(36)),
      date: $("#oneDate").value,
      cat: $("#oneCat").value.trim(),
      note: $("#oneNote").value.trim(),
      amount: Number($("#oneAmount").value || 0),
      paid: $("#onePaid").checked,
    };
    if (!item.date || !item.cat || !item.amount)
      return showToast("⚠️ أكمل البيانات", "warning");
    const L = getLS(K.one, "[]");
    L.push(item);
    setLS(K.one, L);
    e.target.reset();
    $("#oneDate").value = today;
    ensureLTRNumeric();
    showToast("✅ تمت إضافة المصروف الخارجي", "success");
    renderOne();
    renderKPIs();
  });

  // بحث وتصدير
  $("#searchInput").addEventListener("input", renderExpenses);
  $("#exportCSV").addEventListener("click", () =>
    exportCSV($("#monthPicker").value, $("#searchInput").value)
  );
  $("#exportJSON").addEventListener("click", exportJSON);

  // تقارير (إن وُجدت أزرار خارجية)
  $("#btnReport")?.addEventListener("click", openDetailedReport);
  $("#btnCompare")?.addEventListener("click", openCompare);

  setupModal();
}

// فتح المودال الرئيسي
function openModal() {
  const modal = $("#modal");
  if (!modal) return;
  $("#speedDial")?.classList.remove("open");
  modal.classList.add("show");
  ensureLTRNumeric();
  setTimeout(() => {
    $("#expForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    $("#expCat")?.focus();
  }, 50);
}
function setupModal() {
  const modal = $("#modal");
  $("#closeModal")?.addEventListener("click", () =>
    modal.classList.remove("show")
  );
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("show");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") modal.classList.remove("show");
  });
}

// ===== Delete / Toggle
function deleteItem(kind, id) {
  const map = {
    inst: K.inst,
    bills: K.bills,
    exps: K.exps,
    one: K.one,
    budgets: K.budgets,
  };
  const key = map[kind];
  if (!key) return;
  let L = getLS(key, "[]");
  const before = L.length;
  L = L.filter((x) => x.id !== id);
  setLS(key, L);
  if (L.length < before) {
    showToast("🗑️ تم الحذف", "success");
    if (kind === "inst") renderInst();
    else if (kind === "bills") renderBills();
    else if (kind === "exps") renderExpenses();
    else if (kind === "one") renderOne();
    else if (kind === "budgets") renderBudgets();
    renderKPIs();
    updateAlerts();
  }
}
window.deleteItem = deleteItem;
function togglePaid(kind, id, yyyymm) {
  // ✅ إصلاح: للمصاريف الخارجية نعدّل العلم داخل القائمة نفسها
  if (kind === "one") {
    const L = getLS(K.one, "[]");
    const i = L.findIndex((x) => x.id === id);
    if (i > -1) {
      L[i].paid = !L[i].paid;
      setLS(K.one, L);
      showToast(
        L[i].paid ? "✅ تم التعليم كمدفوع" : "↩️ تم التعليم كغير مدفوع",
        "success"
      );
      renderOne();
      renderKPIs();
      updateAlerts();
    }
    return;
  }

  // الباقي كما هو للأقساط والفواتير
  const m = yyyymm || $("#monthPicker")?.value || ym(new Date());
  const wasPaid = isPaid(kind, id, m);
  setPaid(kind, id, m, !wasPaid);
  if (wasPaid) {
    try {
      clearPaidAmt(kind, id, m);
    } catch {}
  }
  showToast(
    wasPaid ? "↩️ تم إلغاء التعليم كمدفوع" : "✅ تم التعليم كمدفوع",
    "success"
  );
  if (kind === "inst") renderInst();
  else if (kind === "bills") renderBills();
  renderKPIs();
  updateAlerts();
}

window.togglePaid = togglePaid;

// ===== Renderers
function statusChip(paid, dueAmt, item, yyyymm) {
  if (!dueAmt) return `<span class="chip gray">—</span>`;
  if (paid) return `<span class="chip green">مدفوع</span>`;
  const curYM = ym(new Date());
  const d = daysUntilDue(item, yyyymm);
  if (yyyymm < curYM) return `<span class="chip orange">متأخر</span>`;
  if (yyyymm > curYM) return `<span class="chip blue">مستقبلي</span>`;
  if (d < 0) return `<span class="chip orange">متأخر</span>`;
  if (d <= 3) return `<span class="chip warning">قريب (${d}ي)</span>`;
  return `<span class="chip">مستحق هذا الشهر</span>`;
}
function priorityKey(kind, item, yyyymm) {
  const dueAmt = dueThisMonth(item, yyyymm),
    paid = isPaid(kind, item.id, yyyymm),
    d = daysUntilDue(item, yyyymm);
  let pri;
  if (dueAmt === 0) pri = 5;
  else if (paid) pri = 4;
  else if (d < 0) pri = 0;
  else if (d <= 3) pri = 1;
  else pri = 2;
  const y = +yyyymm.slice(0, 4),
    m = +yyyymm.slice(5, 7),
    last = lastDayOfMonth(y, m),
    day = Math.min(item.dueDay || last, last);
  return [pri, day, item.name || ""];
}

function remainingFor(kind, item, yyyymm) {
  const due = dueThisMonth(item, yyyymm);
  if (due <= 0) return 0; // ما فيه استحقاق
  if (isPaid(kind, item.id, yyyymm)) return 0; // الشهر مُعلّم مدفوع
  const partial = getPaidAmt(kind, item.id, yyyymm);
  return Math.max(0, due - partial); // المتبقي الفعلي
}

function renderInst() {
  const curM = $("#monthPicker").value;
  const list = getLS(K.inst, "[]");
  const cardsWrap = $("#instCards");
  const tbody = document.querySelector("#instTable tbody");
  if (tbody) tbody.innerHTML = "";
  cardsWrap.innerHTML = "";
  if (!list.length) {
    if (tbody)
      tbody.innerHTML = `<tr><td class="muted" colspan="7">لا توجد أقساط</td></tr>`;
    cardsWrap.innerHTML = `<div class="inst-card" style="text-align:center;color:var(--muted)">لا توجد أقساط</div>`;
    return;
  }

  const sorted = [...list].sort((a, b) => {
    const pa = priorityKey("inst", a, curM),
      pb = priorityKey("inst", b, curM);
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2].localeCompare(pb[2]);
  });

  sorted.forEach((item) => {
    const range = `${item.start || "—"} → ${item.end || "—"}`,
      dueAmt = dueThisMonth(item, curM);
    const paid = isPaid("inst", item.id, curM),
      status = statusChip(paid, dueAmt, item, curM);
    remain = remainingFor("inst", item, curM); // 👈 جديد
    if (tbody) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td data-label="الاسم">${item.name || "-"}</td>
        <td class="fit" data-label="المبلغ">${fmt(item.amount)}</td>
        <td class="fit" data-label="المدى">${range}</td>
        <td class="fit" data-label="يوم الاستحقاق">${item.dueDay ?? "-"}</td>
        <td class="fit" data-label="استحقاق هذا الشهر">${formatDueHTML(
          "inst",
          item,
          curM
        )}</td>
        <td class="fit" data-label="الحالة">${status}</td>
        <td class="fit" data-label="الإجراءات">
          <div class="flex gap-2">
            <button class="btn ghost" onclick="togglePaid('inst','${
              item.id
            }','${curM}')">${
        paid ? "↩️ إلغاء الدفع" : "✅ تعليم كمدفوع"
      }</button>
            <button class="btn warning" onclick="partialPay('inst','${
              item.id
            }')">💳 دفع جزئي</button>
            <button class="btn danger" onclick="deleteItem('inst','${
              item.id
            }')">🗑️ حذف</button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    }

    const card = document.createElement("div");
    card.className = "inst-card";
    card.innerHTML = `
      <div class="inst-card-head">
        <div><div class="inst-title">${
          item.name || "-"
        }</div><div class="inst-sub">${range}</div></div>
        <div class="inst-status">${status}</div>
      </div>
      <div class="inst-grid">
        <div class="inst-item"><div class="lbl">المبلغ</div><div class="val">${fmt(
          item.amount
        )}</div></div>
        <div class="inst-item"><div class="lbl">يوم الاستحقاق</div><div class="val">${
          item.dueDay ?? "-"
        }</div></div>
        <div class="inst-item"><div class="lbl">استحقاق هذا الشهر</div><div class="val">${formatDueHTML(
          "inst",
          item,
          curM
        )}</div></div>
      </div>
      <div class="inst-actions">
        <button class="btn ghost" onclick="togglePaid('inst','${
          item.id
        }','${curM}')">${paid ? "↩️ إلغاء الدفع" : "✅ تعليم كمدفوع"}</button>
        ${
          remain > 0
            ? `<button class="btn warning" onclick="partialPay('inst','${item.id}')">💳 دفع جزئي</button>`
            : ""
        }
        <button class="btn danger" onclick="deleteItem('inst','${
          item.id
        }')">🗑️ حذف</button>
      </div>`;
    cardsWrap.appendChild(card);
  });
}

function renderBills() {
  const curM = $("#monthPicker").value;
  const list = getLS(K.bills, "[]");
  const cardsWrap = $("#billCards");
  const tbody = document.querySelector("#billTable tbody");
  if (tbody) tbody.innerHTML = "";
  cardsWrap.innerHTML = "";
  if (!list.length) {
    if (tbody)
      tbody.innerHTML = `<tr><td class="muted" colspan="7">لا توجد فواتير</td></tr>`;
    cardsWrap.innerHTML = `<div class="inst-card" style="text-align:center;color:var(--muted)">لا توجد فواتير</div>`;
    return;
  }

  const sorted = [...list].sort((a, b) => {
    const pa = priorityKey("bills", a, curM),
      pb = priorityKey("bills", b, curM);
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2].localeCompare(pb[2]);
  });

  sorted.forEach((bill) => {
    const range = `${bill.start || "—"} → ${bill.end || "—"}`,
      dueAmt = dueThisMonth(bill, curM);
    const paid = isPaid("bills", bill.id, curM),
      status = statusChip(paid, dueAmt, bill, curM);

    if (tbody) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td data-label="الاسم">${bill.name || "-"}</td>
        <td class="fit" data-label="المبلغ">${fmt(bill.amount)}</td>
        <td class="fit" data-label="المدى">${range}</td>
        <td class="fit" data-label="يوم الاستحقاق">${bill.dueDay ?? "-"}</td>
        <td class="fit" data-label="استحقاق هذا الشهر">${formatDueHTML(
          "bills",
          bill,
          curM
        )}</td>
        <td class="fit" data-label="الحالة">${status}</td>
        <td class="fit" data-label="الإجراءات">
          <div class="flex gap-2">
            <button class="btn ghost" onclick="togglePaid('bills','${
              bill.id
            }','${curM}')">${
        paid ? "↩️ إلغاء الدفع" : "✅ تعليم كمدفوع"
      }</button>
            <button class="btn warning" onclick="partialPay('bills','${
              bill.id
            }')">💳 دفع جزئي</button>
            <button class="btn danger" onclick="deleteItem('bills','${
              bill.id
            }')">🗑️ حذف</button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    }

    const card = document.createElement("div");
    card.className = "inst-card";
    card.innerHTML = `
      <div class="inst-card-head">
        <div><div class="inst-title">${
          bill.name || "-"
        }</div><div class="inst-sub">${range}</div></div>
        <div class="inst-status">${status}</div>
      </div>
      <div class="inst-grid">
        <div class="inst-item"><div class="lbl">المبلغ</div><div class="val">${fmt(
          bill.amount
        )}</div></div>
        <div class="inst-item"><div class="lbl">يوم الاستحقاق</div><div class="val">${
          bill.dueDay ?? "-"
        }</div></div>
        <div class="inst-item"><div class="lbl">استحقاق هذا الشهر</div><div class="val">${formatDueHTML(
          "bills",
          bill,
          curM
        )}</div></div>
      </div>
      <div class="inst-actions">
        <button class="btn ghost" onclick="togglePaid('bills','${
          bill.id
        }','${curM}')">${paid ? "↩️ إلغاء الدفع" : "✅ تعليم كمدفوع"}</button>
        <button class="btn warning" onclick="partialPay('bills','${
          bill.id
        }')">💳 دفع جزئي</button>
        <button class="btn danger" onclick="deleteItem('bills','${
          bill.id
        }')">🗑️ حذف</button>
      </div>`;
    cardsWrap.appendChild(card);
  });
}

function renderExpenses() {
  const curM = $("#monthPicker").value;
  const search = ($("#searchInput")?.value || "").toLowerCase().trim();
  const listAll = getLS(K.exps, "[]");
  const list = listAll
    .filter((x) => ym(x.date) === curM)
    .filter(
      (x) =>
        !search ||
        normCat(x.cat).includes(search) ||
        (x.note || "").toLowerCase().includes(search)
    );

  const cardsWrap = $("#expCards");
  const tbody = document.querySelector("#expTable tbody");
  const totalEl = $("#expShownTotal");
  if (tbody) tbody.innerHTML = "";
  cardsWrap.innerHTML = "";

  if (!list.length) {
    if (tbody)
      tbody.innerHTML = `<tr><td class="muted" colspan="6">لا توجد مصروفات</td></tr>`;
    cardsWrap.innerHTML = `<div class="inst-card" style="text-align:center;color:var(--muted)">لا توجد مصروفات</div>`;
    if (totalEl) totalEl.textContent = "0";
    return;
  }

  let shownTotal = 0;
  list
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .forEach((exp) => {
      shownTotal += Number(exp.amount || 0);
      if (tbody) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
        <td data-label="التاريخ">${exp.date}</td>
        <td data-label="التصنيف"><span class="chip blue">${exp.cat}</span></td>
        <td data-label="الوصف">${exp.note || "-"}</td>
        <td class="fit" data-label="الدفع">${payLabel(exp.pay)}</td>
        <td class="fit" data-label="المبلغ">${fmt(exp.amount)}</td>
        <td class="fit" data-label="الإجراءات"><div class="flex gap-2">
          <button class="btn danger" onclick="deleteItem('exps','${
            exp.id
          }')">🗑️ حذف</button></div>
        </td>`;
        tbody.appendChild(tr);
      }
      const card = document.createElement("div");
      card.className = "inst-card";
      card.innerHTML = `
      <div class="inst-card-head">
        <div><div class="inst-title">${exp.cat}</div><div class="inst-sub">${
        exp.date
      }</div></div>
        <div class="inst-amount">${fmt(exp.amount)}</div>
      </div>
      <div class="inst-grid">
        <div class="inst-item"><div class="lbl">الوصف</div><div class="val">${
          exp.note || "-"
        }</div></div>
        <div class="inst-item"><div class="lbl">طريقة الدفع</div><div class="val">${payLabel(
          exp.pay
        )}</div></div>
      </div>
      <div class="inst-actions"><button class="btn danger" onclick="deleteItem('exps','${
        exp.id
      }')">🗑️ حذف</button></div>`;
      cardsWrap.appendChild(card);
    });

  if (totalEl) totalEl.textContent = fmt(shownTotal);
}

function renderOne() {
  const curM = $("#monthPicker").value;
  const list = getLS(K.one, "[]").filter((x) => ym(x.date) === curM);
  const cardsWrap = $("#oneCards");
  const tbody = document.querySelector("#oneTable tbody");
  if (tbody) tbody.innerHTML = "";
  cardsWrap.innerHTML = "";
  if (!list.length) {
    if (tbody)
      tbody.innerHTML = `<tr><td class="muted" colspan="6">لا توجد مصاريف خارجية</td></tr>`;
    cardsWrap.innerHTML = `<div class="inst-card" style="text-align:center;color:var(--muted)">لا توجد مصاريف خارجية</div>`;
    return;
  }
  list
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .forEach((item) => {
      const chip = item.paid
        ? `<span class="chip green">مدفوع</span>`
        : `<span class="chip warning">غير مدفوع</span>`;
      if (tbody) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
        <td data-label="التاريخ">${item.date}</td>
        <td data-label="النوع"><span class="chip blue">${item.cat}</span></td>
        <td data-label="ملاحظة">${item.note || "-"}</td>
        <td class="fit" data-label="المبلغ">${fmt(item.amount)}</td>
        <td class="fit" data-label="الحالة">${chip}</td>
        <td class="fit" data-label="الإجراءات">
          <div class="flex gap-2">
            <button class="btn ghost" onclick="togglePaid('one','${
              item.id
            }')">${
          item.paid ? "↩️ تعليم كغير مدفوع" : "✅ تعليم كمدفوع"
        }</button>
            <button class="btn danger" onclick="deleteItem('one','${
              item.id
            }')">🗑️ حذف</button>
          </div>
        </td>`;
        tbody.appendChild(tr);
      }
      const card = document.createElement("div");
      card.className = "inst-card";
      card.innerHTML = `
      <div class="inst-card-head">
        <div><div class="inst-title">${item.cat}</div><div class="inst-sub">${
        item.date
      }</div></div>
        <div class="inst-amount">${fmt(item.amount)}</div>
      </div>
      <div class="inst-grid">
        <div class="inst-item"><div class="lbl">ملاحظة</div><div class="val">${
          item.note || "-"
        }</div></div>
        <div class="inst-item"><div class="lbl">الحالة</div><div class="val">${chip}</div></div>
      </div>
      <div class="inst-actions">
        <button class="btn ghost" onclick="togglePaid('one','${item.id}')">${
        item.paid ? "↩️ تعليم كغير مدفوع" : "✅ تعليم كمدفوع"
      }</button>
        <button class="btn danger" onclick="deleteItem('one','${
          item.id
        }')">🗑️ حذف</button>
      </div>`;
      cardsWrap.appendChild(card);
    });
}

function renderBudgets() {
  const curM = $("#monthPicker").value,
    B = getLS(K.budgets, "[]"),
    E = getLS(K.exps, "[]");
  const tbody = $("#budTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!B.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">لا توجد ميزانيات</td></tr>`;
    return;
  }
  B.forEach((b) => {
    const spent = E.filter(
      (x) => ym(x.date) === curM && normCat(x.cat) === normCat(b.cat)
    ).reduce((s, x) => s + Number(x.amount || 0), 0);
    const pct = b.limit ? (spent / b.limit) * 100 : 0;
    const status = pct >= 100 ? "danger" : pct >= 80 ? "warning" : "green";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="التصنيف"><span class="chip blue">${b.cat}</span></td>
      <td data-label="الحد المحدد" class="fit">${fmt(b.limit)}</td>
      <td data-label="المصروف الحالي" class="fit">${fmt(spent)}</td>
      <td data-label="النسبة المستخدمة" class="fit">
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(
          pct,
          100
        )}%"></div></div>
        <span class="chip ${status}">${pct.toFixed(1)}%</span>
      </td>
      <td data-label="الإجراءات" class="fit"><button class="btn danger" onclick="deleteItem('budgets','${
        b.id || b.cat
      }')">حذف</button></td>`;
    tbody.appendChild(tr);
  });
}

// ===== KPIs + Month Summary
function renderKPIs() {
  const curM = $("#monthPicker").value,
    salary = +getLS(K.salary, "0"),
    savingTarget = +getLS(K.saving, "0");
  const st = getLS(K.settings, '{"cash":false,"auto":false,"roll":false}');
  const instList = getLS(K.inst, "[]"),
    billsList = getLS(K.bills, "[]");
  let instTotal = 0,
    billsTotal = 0;

  // في وضع الاستحقاق: نحسب المتبقي فقط (المدفوع الجزئي داخل المصروفات)
  // الأقساط
  instList.forEach((item) => {
    const due = dueThisMonth(item, curM);
    if (due <= 0) return;
    const fullyPaid = isPaid("inst", item.id, curM);
    const partial = getPaidAmt("inst", item.id, curM);
    const remaining = fullyPaid ? 0 : Math.max(0, due - partial);
    if (!st.cash) instTotal += remaining;
  });

  // الفواتير
  billsList.forEach((item) => {
    const due = dueThisMonth(item, curM);
    if (due <= 0) return;
    const fullyPaid = isPaid("bills", item.id, curM);
    const partial = getPaidAmt("bills", item.id, curM);
    const remaining = fullyPaid ? 0 : Math.max(0, due - partial);
    if (!st.cash) billsTotal += remaining;
  });

  const exps = getLS(K.exps, "[]")
    .filter((x) => ym(x.date) === curM)
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  const ones = getLS(K.one, "[]")
    .filter((x) => ym(x.date) === curM && (!st.cash || x.paid))
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  const carry = Number(getLS(K.roll, "{}")[curM] || 0);

  const totalOut = instTotal + billsTotal + exps + ones + carry;
  const actualSaving = salary - totalOut,
    net = actualSaving - savingTarget;

  $("#kpiIncome").textContent = fmt(salary);
  $("#kpiOut").textContent = fmt(totalOut);
  $("#kpiSave").textContent = fmt(actualSaving);
  $("#kpiNet").textContent = fmt(net);
  $("#savingProgress").style.width = salary
    ? Math.min(100, (savingTarget / salary) * 100) + "%"
    : "0%";

  const table = $("#monthSummary");
  if (!table) return;
  table.innerHTML = `
    <thead><tr><th>البند</th><th class="fit">المبلغ</th><th class="fit">النسبة من الدخل</th></tr></thead>
    <tbody>
      <tr><td>💰 إجمالي الدخل</td><td class="fit font-bold">${fmt(
        salary
      )}</td><td class="fit">100%</td></tr>
      <tr><td>🏦 الأقساط الثابتة</td><td class="fit">${fmt(
        instTotal
      )}</td><td class="fit">${
    salary ? ((instTotal / salary) * 100).toFixed(1) : 0
  }%</td></tr>
      <tr><td>🧾 الفواتير الشهرية</td><td class="fit">${fmt(
        billsTotal
      )}</td><td class="fit">${
    salary ? ((billsTotal / salary) * 100).toFixed(1) : 0
  }%</td></tr>
      <tr><td>💳 المصاريف اليومية</td><td class="fit">${fmt(
        exps
      )}</td><td class="fit">${
    salary ? ((exps / salary) * 100).toFixed(1) : 0
  }%</td></tr>
      <tr><td>⚠️ المصاريف الخارجية</td><td class="fit">${fmt(
        ones
      )}</td><td class="fit">${
    salary ? ((ones / salary) * 100).toFixed(1) : 0
  }%</td></tr>
      <tr><td>↩️ متأخرات مُرحّلة</td><td class="fit">${fmt(
        carry
      )}</td><td class="fit">${
    salary ? ((carry / salary) * 100).toFixed(1) : 0
  }%</td></tr>
      <tr style="border-top:2px solid var(--border)"><td class="font-bold">💸 إجمالي المصروفات</td><td class="fit font-bold">${fmt(
        totalOut
      )}</td><td class="fit font-bold">${
    salary ? ((totalOut / salary) * 100).toFixed(1) : 0
  }%</td></tr>
      <tr><td class="font-bold">🏦 الادخار الفعلي</td><td class="fit font-bold" style="color:${
        actualSaving >= 0 ? "var(--success)" : "var(--danger)"
      }">${fmt(actualSaving)}</td><td class="fit">${
    salary ? ((actualSaving / salary) * 100).toFixed(1) : 0
  }%</td></tr>
      <tr><td>🎯 الادخار المستهدف</td><td class="fit">${fmt(
        savingTarget
      )}</td><td class="fit">${
    salary ? ((savingTarget / salary) * 100).toFixed(1) : 0
  }%</td></tr>
      <tr><td class="font-bold">💵 الصافي المتبقي</td><td class="fit font-bold" style="color:${
        net >= 0 ? "var(--success)" : "var(--danger)"
      }">${fmt(net)}</td><td class="fit">—</td></tr>
    </tbody>`;
}

// ===== Charts
let monthlyChart, breakdownChart;
function setupCharts() {
  if (typeof Chart === "undefined") return;
  Chart.defaults.font.family = `'Tajawal', system-ui, -apple-system, 'Segoe UI'`;
  Chart.defaults.color =
    getComputedStyle(document.documentElement).getPropertyValue("--ink") ||
    "#e7ecf3";
  const monthlyCtx = $("#chartMonthly"),
    breakdownCtx = $("#chartBreakdown");
  if (monthlyCtx) {
    monthlyChart = new Chart(monthlyCtx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "الدخل",
            data: [],
            borderColor: "#22c55e",
            backgroundColor: "rgba(34,197,94,.15)",
            tension: 0.35,
            fill: true,
          },
          {
            label: "المصروفات",
            data: [],
            borderColor: "#ef4444",
            backgroundColor: "rgba(239,68,68,.15)",
            tension: 0.35,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom" }, title: { display: false } },
      },
    });
  }
  if (breakdownCtx) {
    breakdownChart = new Chart(breakdownCtx, {
      type: "doughnut",
      data: {
        labels: [],
        datasets: [
          {
            data: [],
            backgroundColor: [
              "#4f8cff",
              "#22c55e",
              "#ef4444",
              "#f59e0b",
              "#8b5cf6",
              "#10b981",
              "#e11d48",
              "#14b8a6",
            ],
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom" }, title: { display: false } },
      },
    });
  }
  refreshCharts();
}
function refreshCharts() {
  if (!monthlyChart || !breakdownChart) return;
  const curM = $("#monthPicker").value,
    labels = [],
    incomeData = [],
    expenseData = [];
  const [cy, cm] = curM.split("-").map(Number);
  const st = getLS(K.settings, '{"cash":false,"auto":false,"roll":false}');
  const instList = getLS(K.inst, "[]"),
    billsList = getLS(K.bills, "[]");

  for (let i = 5; i >= 0; i--) {
    const d = new Date(cy, cm - 1 - i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    labels.push(m);

    // الدخل: ثابت حاليًا لكل شهر
    const salary = +getLS(K.salary, "0");
    incomeData.push(salary);

    // أقساط + فواتير: نأخذ المتبقي فقط (وفي وضع الكاش نستبعدها كلها)
    let instTotal = 0,
      billsTotal = 0;
    if (!st.cash) {
      instList.forEach((it) => {
        const due = dueThisMonth(it, m);
        if (!due) return;
        const partial = getPaidAmt("inst", it.id, m);
        const fully = isPaid("inst", it.id, m);
        instTotal += fully ? 0 : Math.max(0, due - partial);
      });
      billsList.forEach((it) => {
        const due = dueThisMonth(it, m);
        if (!due) return;
        const partial = getPaidAmt("bills", it.id, m);
        const fully = isPaid("bills", it.id, m);
        billsTotal += fully ? 0 : Math.max(0, due - partial);
      });
    }

    // مصروفات يومية: دائمًا مجموع المدخلات في ذلك الشهر
    const exps = getLS(K.exps, "[]")
      .filter((x) => ym(x.date) === m)
      .reduce((s, x) => s + Number(x.amount || 0), 0);

    // مصاريف خارجية: في وضع الكاش تُحسب فقط المدفوعة
    const ones = getLS(K.one, "[]")
      .filter((x) => ym(x.date) === m && (!st.cash || x.paid))
      .reduce((s, x) => s + Number(x.amount || 0), 0);

    // متأخرات مُرحّلة لذلك الشهر
    const roll = Number(getLS(K.roll, "{}")[m] || 0);

    expenseData.push(instTotal + billsTotal + exps + ones + roll);
  }

  monthlyChart.data.labels = labels;
  monthlyChart.data.datasets[0].data = incomeData;
  monthlyChart.data.datasets[1].data = expenseData;
  monthlyChart.update();

  // تفصيل المصروفات حسب التصنيف (لنفس الشهر الحالي)
  const expsCur = getLS(K.exps, "[]").filter((x) => ym(x.date) === curM);
  const map = {};
  expsCur.forEach((e) => {
    const k = normCat(e.cat);
    map[k] = (map[k] || 0) + Number(e.amount || 0);
  });
  breakdownChart.data.labels = Object.keys(map);
  breakdownChart.data.datasets[0].data = Object.values(map);
  breakdownChart.update();
}

// ===== Alerts + Auto + Rollover
function updateAlerts() {
  const curM = $("#monthPicker").value,
    alerts = [];
  getLS(K.inst, "[]").forEach((item) => {
    const due = dueThisMonth(item, curM);
    if (due > 0 && !isPaid("inst", item.id, curM)) {
      const d = daysUntilDue(item, curM);
      if (d >= 0 && d <= 3)
        alerts.push(`⏰ ${item.name} (قسط) مستحق خلال ${d} يومًا.`);
      if (d < 0) alerts.push(`⚠️ ${item.name} (قسط) متأخر الدفع.`);
    }
  });
  getLS(K.bills, "[]").forEach((item) => {
    const due = dueThisMonth(item, curM);
    if (due > 0 && !isPaid("bills", item.id, curM)) {
      const d = daysUntilDue(item, curM);
      if (d >= 0 && d <= 3)
        alerts.push(`⏰ ${item.name} (فاتورة) مستحقة خلال ${d} يومًا.`);
      if (d < 0) alerts.push(`⚠️ ${item.name} (فاتورة) متأخرة الدفع.`);
    }
  });

  const badge = $("#alertBadge");
  if (!badge) return;
  if (alerts.length) {
    badge.textContent = `${alerts.length} تنبيهات`;
    badge.style.display = "inline-block";
    badge.onclick = () => showToast(alerts.join("<br>"), "warning");
  } else badge.style.display = "none";
}
function autoDeductIfDue(yyyymm) {
  const cur = ym(new Date());
  if (cur !== yyyymm) return;
  // 🚑 لا تستخدم includes على مصفوفات جديدة — امشِ على القائمتين منفصلتين
  getLS(K.inst, "[]").forEach((item) => {
    const due = dueThisMonth(item, yyyymm);
    if (due > 0 && !isPaid("inst", item.id, yyyymm)) {
      const d = daysUntilDue(item, yyyymm);
      if (d <= 0) setPaid("inst", item.id, yyyymm, true);
    }
  });
  getLS(K.bills, "[]").forEach((item) => {
    const due = dueThisMonth(item, yyyymm);
    if (due > 0 && !isPaid("bills", item.id, yyyymm)) {
      const d = daysUntilDue(item, yyyymm);
      if (d <= 0) setPaid("bills", item.id, yyyymm, true);
    }
  });
}
function rolloverArrears(yyyymm) {
  const prev = prevMonthStr(yyyymm);
  let total = 0;
  getLS(K.inst, "[]").forEach((item) => {
    const due = dueThisMonth(item, prev);
    if (due > 0) {
      const fullyPaid = isPaid("inst", item.id, prev),
        partial = getPaidAmt("inst", item.id, prev);
      total += fullyPaid ? 0 : Math.max(0, due - partial);
    }
  });
  getLS(K.bills, "[]").forEach((item) => {
    const due = dueThisMonth(item, prev);
    if (due > 0) {
      const fullyPaid = isPaid("bills", item.id, prev),
        partial = getPaidAmt("bills", item.id, prev);
      total += fullyPaid ? 0 : Math.max(0, due - partial);
    }
  });
  const R = getLS(K.roll, "{}");
  R[yyyymm] = total;
  setLS(K.roll, R);
  if (total > 0)
    showToast(
      `↩️ تم ترحيل متأخرات بقيمة ${fmt(total)} من الشهر السابق.`,
      "warning"
    );
}

// ===== Export
function exportCSV(month, search = "") {
  const rows = getLS(K.exps, "[]").filter(
    (x) =>
      ym(x.date) === month &&
      (!search ||
        normCat(x.cat).includes(search.toLowerCase()) ||
        (x.note || "").toLowerCase().includes(search.toLowerCase()))
  );
  if (!rows.length) return showToast("🤷 لا توجد بيانات للتصدير", "warning");
  const csv = [
    "التاريخ,التصنيف,الوصف,طريقة الدفع,المبلغ",
    ...rows.map((r) =>
      [r.date, r.cat, r.note || "", r.pay, r.amount].join(",")
    ),
  ].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" })
  );
  a.download = `expenses_${month}.csv`;
  a.click();
  showToast("✅ تم تصدير CSV", "success");
}
function exportJSON() {
  const data = {
    salary: getLS(K.salary, "0"),
    saving: getLS(K.saving, "0"),
    settings: getLS(K.settings, '{"cash":false,"auto":false,"roll":false}'),
    installments: getLS(K.inst, "[]"),
    bills: getLS(K.bills, "[]"),
    expenses: getLS(K.exps, "[]"),
    one: getLS(K.one, "[]"),
    budgets: getLS(K.budgets, "[]"),
    paidMap: getLS(K.paid, "{}"),
    rollovers: getLS(K.roll, "{}"),
  };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  );
  a.download = `my-finance-${$("#monthPicker").value}.json`;
  a.click();
  showToast("✅ تم تصدير JSON", "success");
}

// ===== Budget warn
function checkBudgetWarn(catRaw) {
  const curM = $("#monthPicker").value,
    cat = normCat(catRaw),
    B = getLS(K.budgets, "[]");
  const budget = B.find((b) => normCat(b.cat) === cat);
  if (!budget) return;
  const spent = getLS(K.exps, "[]")
    .filter((x) => ym(x.date) === curM && normCat(x.cat) === cat)
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  if (!budget.limit) return;
  const used = (spent / budget.limit) * 100;
  if (used >= 100)
    showToast(
      `🚫 تجاوزت ميزانية "${budget.cat}" (${used.toFixed(0)}%)`,
      "danger"
    );
  else if (used >= 80)
    showToast(
      `⚠️ اقتربت من ميزانية "${budget.cat}" (${used.toFixed(0)}%)`,
      "warning"
    );
}

// ===== Router
const ROUTES = [
  "summary",
  "installments",
  "bills",
  "expenses",
  "one-time",
  "settings",
];
const sections = () => [...document.querySelectorAll("[data-route]")];
const navLinks = () => [
  ...document.querySelectorAll(".bottom-nav .nav-links a"),
];
const fabBtnScrollKey = (r) => `moneyapp_scroll_${r}`;
let currentRoute = null;
let fabBtn = null;

function applyActive(r) {
  navLinks().forEach((a) => {
    const hash = a.getAttribute("href").replace("#", "");
    a.classList.toggle("active", hash === r);
  });
}
function scrollKey(r) {
  return fabBtnScrollKey(r);
}
function fabConfig(route) {
  const map = {
    installments: {
      label: "＋",
      title: "إضافة قسط",
      action: () => openForm("instForm"),
    },
    bills: {
      label: "＋",
      title: "إضافة فاتورة",
      action: () => openForm("billForm"),
    },
    expenses: {
      label: "＋",
      title: "إضافة مصروف",
      action: () => openForm("expForm"),
    },
    "one-time": {
      label: "＋",
      title: "مصروف خارجي",
      action: () => openForm("oneForm"),
    },
    summary: {
      label: "＋",
      title: "إضافة سريعة",
      action: () => openQuickAdd(),
    },
    settings: {
      label: "＋",
      title: "اختصار سريع",
      action: () => openQuickAdd(),
    },
  };
  return map[route] || map.summary;
}
function showRoute(r) {
  if (!ROUTES.includes(r)) r = "summary";
  if (currentRoute) {
    localStorage.setItem(scrollKey(currentRoute), String(window.scrollY || 0));
  }
  sections().forEach(
    (s) => (s.style.display = s.dataset.route === r ? "" : "none")
  );
  applyActive(r);
  currentRoute = r;
  const cfg = fabConfig(r);
  if (fabBtn) {
    fabBtn.textContent = cfg.label;
    fabBtn.setAttribute("aria-label", cfg.title);
  }
  const prev = Number(localStorage.getItem(scrollKey(r) || "0")) || 0;
  window.scrollTo({ top: prev, behavior: "auto" });
}
function onHash() {
  showRoute((location.hash || "#summary").slice(1));
}
function openForm(id) {
  openModal();
  setTimeout(
    () =>
      document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    60
  );
}
function openQuickAdd() {
  openModal();
}

// ===== تقارير
function totalsForMonth(yyyymm) {
  const salary = +getLS(K.salary, "0");
  const st = getLS(K.settings, '{"cash":false,"auto":false,"roll":false}');
  const instList = getLS(K.inst, "[]"),
    billsList = getLS(K.bills, "[]");

  let inst = 0,
    bills = 0;
  if (!st.cash) {
    instList.forEach((it) => {
      const due = dueThisMonth(it, yyyymm);
      if (!due) return;
      const partial = getPaidAmt("inst", it.id, yyyymm);
      const fully = isPaid("inst", it.id, yyyymm);
      inst += fully ? 0 : Math.max(0, due - partial);
    });
    billsList.forEach((it) => {
      const due = dueThisMonth(it, yyyymm);
      if (!due) return;
      const partial = getPaidAmt("bills", it.id, yyyymm);
      const fully = isPaid("bills", it.id, yyyymm);
      bills += fully ? 0 : Math.max(0, due - partial);
    });
  }

  const exps = getLS(K.exps, "[]")
    .filter((x) => ym(x.date) === yyyymm)
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  const ones = getLS(K.one, "[]")
    .filter((x) => ym(x.date) === yyyymm && (!st.cash || x.paid))
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  const carry = Number(getLS(K.roll, "{}")[yyyymm] || 0);
  const out = inst + bills + exps + ones + carry;
  const saveActual = salary - out;

  return { salary, inst, bills, exps, ones, carry, out, saveActual };
}

const fmtPct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : "0.0");

function openDetailedReport() {
  const m = $("#monthPicker").value,
    t = totalsForMonth(m),
    now = new Date();
  const byCat = {};
  getLS(K.exps, "[]")
    .filter((x) => ym(x.date) === m)
    .forEach((e) => {
      const k = normCat(e.cat);
      byCat[k] = (byCat[k] || 0) + Number(e.amount || 0);
    });
  let rows = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([k, amt]) =>
        `<tr><td>${k}</td><td class="fit">${fmt(
          amt
        )}</td><td class="fit">${fmtPct(amt, t.salary)}%</td></tr>`
    )
    .join("");
  if (!rows)
    rows = `<tr><td colspan="3" class="muted">لا توجد مصروفات بعد.</td></tr>`;
  const html = `<html lang="ar" dir="rtl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>التقرير المالي المفصّل ${m}</title>
  <style>body{background:#0b1220;color:#e7ecf3;font-family:'Tajawal',system-ui;margin:24px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:16px 0}
  .card{padding:16px;border-radius:14px;background:#101827;border:1px solid #1f2937;text-align:center}
  .ok{color:#22c55e}.bad{color:#ef4444}table{width:100%;border-collapse:collapse;margin-top:16px}
  th,td{border-bottom:1px solid #1f2937;padding:10px}.fit{white-space:nowrap}.muted{opacity:.7} h1{margin:0 0 6px}
  .section-title{margin-top:22px}.pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#111827;border:1px solid #1f2937;font-size:12px}</style></head><body>
  <h1>📊 التقرير المالي المفصّل</h1>
  <div class="muted">شهر ${m} — تم إنشاؤه في ${now.toLocaleString(
    "ar-SA"
  )}</div>
  <div class="cards">
    <div class="card"><div>إجمالي الدخل</div><div class="ok" style="font-size:24px">${fmt(
      t.salary
    )}</div></div>
    <div class="card"><div>إجمالي المصروفات</div><div class="bad" style="font-size:24px">${fmt(
      t.out
    )}</div></div>
    <div class="card"><div>الادخار الفعلي</div><div class="${
      t.saveActual >= 0 ? "ok" : "bad"
    }" style="font-size:24px">${fmt(t.saveActual)}</div></div>
    <div class="card"><div>الأقساط والفواتير</div><div style="font-size:24px">${fmt(
      t.inst + t.bills
    )}</div>
      <div class="pill">أقساط: ${fmt(t.inst)} — فواتير: ${fmt(
    t.bills
  )}</div></div>
  </div>
  <h2 class="section-title">تفصيل المصروفات حسب التصنيف</h2>
  <table><thead><tr><th>الفئة</th><th class="fit">المبلغ</th><th class="fit">النسبة من الدخل</th></tr></thead><tbody>${rows}</tbody></table>
  <h2 class="section-title">معلومات إضافية</h2>
  <div class="pill">المصاريف الخارجيّة: ${fmt(t.ones)}</div>
  <div class="pill">متأخرات مُرحّلة: ${fmt(t.carry)}</div>
  </body></html>`;
  const w = window.open("about:blank");
  w.document.write(html);
  w.document.close();
}
function openCompare() {
  const cur = $("#monthPicker").value,
    prev = prevMonthStr(cur),
    a = totalsForMonth(prev),
    b = totalsForMonth(cur);
  const row = (label, va, vb) => {
    const diff = vb - va,
      sign = diff === 0 ? "" : diff > 0 ? "▲" : "▼",
      color = diff > 0 ? "#ef4444" : diff < 0 ? "#22c55e" : "#9ca3af";
    return `<tr><td>${label}</td><td class="fit">${fmt(
      va
    )}</td><td class="fit">${fmt(
      vb
    )}</td><td class="fit" style="color:${color}">${fmt(
      diff
    )} ${sign}</td></tr>`;
  };
  const html = `<html lang="ar" dir="rtl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>مقارنة الأشهر ${cur} مقابل ${prev}</title>
  <style>body{background:#0b1220;color:#e7ecf3;font-family:'Tajawal',system-ui;margin:24px}
  h1{margin:0 0 14px}.muted{opacity:.7} table{width:100%;border-collapse:collapse;margin-top:16px}
  th,td{border-bottom:1px solid #1f2937;padding:10px}.fit{white-space:nowrap}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:16px 0}
  .card{padding:16px;border-radius:14px;background:#101827;border:1px solid #1f2937}
  .ok{color:#22c55e}.bad{color:#ef4444}</style></head><body>
  <h1>📈 مقارنة الأشهر</h1>
  <div class="muted">${prev} مقابل ${cur}</div>
  <div class="cards">
    <div class="card"><div>ادخار فعلي (السابق)</div><div class="${
      a.saveActual >= 0 ? "ok" : "bad"
    }" style="font-size:22px">${fmt(a.saveActual)}</div></div>
    <div class="card"><div>ادخار فعلي (الحالي)</div><div class="${
      b.saveActual >= 0 ? "ok" : "bad"
    }" style="font-size:22px">${fmt(b.saveActual)}</div></div>
    <div class="card"><div>إجمالي المصروفات (السابق)</div><div class="bad" style="font-size:22px">${fmt(
      a.out
    )}</div></div>
    <div class="card"><div>إجمالي المصروفات (الحالي)</div><div class="bad" style="font-size:22px">${fmt(
      b.out
    )}</div></div>
  </div>
  <table><thead><tr><th>البند</th><th class="fit">${prev}</th><th class="fit">${cur}</th><th class="fit">الفرق</th></tr></thead>
  <tbody>
    ${row("الأقساط + الفواتير", a.inst + a.bills, b.inst + b.bills)}
    ${row("المصروفات اليومية", a.exps, b.exps)}
    ${row("المصاريف الخارجيّة", a.ones, b.ones)}
    ${row("متأخرات مُرحّلة", a.carry, b.carry)}
    ${row("إجمالي المصروفات", a.out, b.out)}
    ${row("الادخار الفعلي", a.saveActual, b.saveActual)}
  </tbody></table></body></html>`;
  const w = window.open("about:blank");
  w.document.write(html);
  w.document.close();
}

// ===== Boot
document.addEventListener("DOMContentLoaded", () => {
  $("#monthPicker").value = ym(new Date());
  $("#expDate").value = today;
  $("#oneDate").value = today;
  ensureLTRNumeric();
  applySavedSettings();
  bindUI();

  // مرجع زر الـFAB بعد التحميل
  fabBtn = document.getElementById("openModalBtn");

  // 🔧 أهم نقطتين عشان الدفع الجزئي يشتغل دائمًا
  ensurePartialPayModal(); // تأكد النافذة موجودة ومكانها صحيح
  bindPartialPayEvents(); // اربط أحداثها

  const st = getLS(K.settings, '{"cash":false,"auto":false,"roll":false}');
  const curM = $("#monthPicker").value;
  if (st.auto) autoDeductIfDue(curM);
  if (st.roll) rolloverArrears(curM);

  renderInst();
  renderBills();
  renderExpenses();
  renderOne();
  renderBudgets();
  renderKPIs();

  window.addEventListener("hashchange", onHash);
  onHash();

  const afterFirstPaint = () => {
    setupCharts();
    refreshCharts();
    refreshChartThemeColors(); // ✅ اضبط ألوان الرسوم بعد إنشائها
    updateAlerts();
  };
  if ("requestIdleCallback" in window)
    requestIdleCallback(afterFirstPaint, { timeout: 1000 });
  else setTimeout(afterFirstPaint, 120);
});

// ===== Master render
function renderAll() {
  renderInst();
  renderBills();
  renderExpenses();
  renderOne();
  renderBudgets();
  renderKPIs();
  refreshCharts();
  updateAlerts();
}

// ===== Speed Dial + Long-Press FAB
document.addEventListener("DOMContentLoaded", () => {
  const fab = document.getElementById("openModalBtn"),
    dial = document.getElementById("speedDial");
  if (!fab || !dial) return;
  const closeDial = () => dial.classList.remove("open");
  const openModalDirect = () => window.openModal?.();
  let holdTimer,
    longPress = false;
  fab.addEventListener("click", () => {
    if (longPress) {
      longPress = false;
      return;
    }
    dial.classList.toggle("open");
  });
  const startHold = () => {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      longPress = true;
      closeDial();
      openModalDirect();
    }, 600);
  };
  const endHold = () => clearTimeout(holdTimer);
  ["mousedown", "touchstart"].forEach((ev) =>
    fab.addEventListener(ev, startHold, { passive: true })
  );
  ["mouseup", "mouseleave", "touchend", "touchcancel"].forEach((ev) =>
    fab.addEventListener(ev, endHold)
  );
  document.addEventListener("click", (e) => {
    if (!dial.contains(e.target) && !fab.contains(e.target)) closeDial();
  });
  document.getElementById("sdCompare")?.addEventListener("click", () => {
    closeDial();
    openCompare();
  });
  document.getElementById("sdReport")?.addEventListener("click", () => {
    closeDial();
    openDetailedReport();
  });
});

function refreshChartThemeColors() {
  if (!monthlyChart || !breakdownChart) return;
  const ink =
    getComputedStyle(document.documentElement).getPropertyValue("--ink") ||
    "#0f172a";
  const grid = "rgba(148,163,184,.25)";
  monthlyChart.options.plugins.legend.labels.color = ink;
  monthlyChart.options.scales = {
    x: { ticks: { color: ink }, grid: { color: grid } },
    y: { ticks: { color: ink }, grid: { color: grid } },
  };
  breakdownChart.options.plugins.legend.labels.color = ink;
  monthlyChart.update();
  breakdownChart.update();
}
