/* =========================
   إدارة مالي — نسخة كاملة مستقرة (محدّثة)
   نواف: كل الأقسام مربوطة ومحفوظة بـ localStorage
========================= */

/* ===== Helpers ===== */
// يستخرج YYYY-MM بدون انزياح توقيت
const ym = (d) => {
  if (!d) return "";
  if (typeof d === "string") return d.slice(0, 7); // "YYYY-MM-DD" من input[type=date]
  const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return t.toISOString().slice(0, 7);
};

// تطبيع أسماء التصنيفات (للجمع والمطابقة)
const normCat = (s) => (s || "").toString().trim().toLowerCase();

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const today = new Date().toISOString().slice(0, 10);

// ✅ الأرقام بالإنجليزية
const fmt = (n) =>
  Number(n || 0).toLocaleString("en", { maximumFractionDigits: 0 }) + " ر.س";

/* ===== Toast ===== */
function showToast(msg, type = "") {
  const t = $("#toast");
  if (!t) return;
  t.className = `toast ${type}`.trim();
  t.innerHTML = msg;
  t.style.display = "block";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (t.style.display = "none"), 2200);
}

/* ===== Storage ===== */
const K = {
  salary: "pf_salary",
  saving: "pf_saving",
  settings: "pf_settings",
  inst: "pf_inst",
  bills: "pf_bills",
  exps: "pf_exps",
  one: "pf_one",
  budgets: "pf_budgets",
  paid: "pf_paid_monthly", // map: { "inst:<id>:YYYY-MM": true }
  roll: "pf_rollovers", // map: { "YYYY-MM": number }
};
const getLS = (k, fallbackJSON) => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? fallbackJSON);
  } catch {
    return JSON.parse(fallbackJSON);
  }
};
const setLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));

/* ===== Common utils ===== */
const payLabel = (p) =>
  ({
    cash: "💵 كاش",
    card: "💳 بطاقة",
    transfer: "🏦 تحويل",
    wallet: "📱 محفظة",
  }[p] ||
  p ||
  "-");
const lastDayOfMonth = (y, m) => new Date(y, m, 0).getDate();
// بعد (مستمر للأبد):
const withinMonthRange = (start, end, yyyymm) => {
  const s = ym(start);
  return yyyymm >= s; // تجاهل end نهائيًا
};
const dueThisMonth = (item, yyyymm) =>
  withinMonthRange(item.start, item.end, yyyymm) ? Number(item.amount || 0) : 0;
const daysUntilDue = (item, yyyymm) => {
  const y = +yyyymm.slice(0, 4),
    m = +yyyymm.slice(5, 7);
  const last = lastDayOfMonth(y, m);
  const d = Math.min(item.dueDay || last, last);
  const due = new Date(y, m - 1, d);
  const one = 86400000;
  return Math.floor((due - new Date()) / one);
};
const prevMonthStr = (yyyymm) => {
  let [y, m] = yyyymm.split("-").map(Number);
  m === 1 ? (y--, (m = 12)) : m--;
  return `${y}-${String(m).padStart(2, "0")}`;
};
/* paid map helpers */
const isPaid = (kind, id, yyyymm) =>
  !!getLS(K.paid, "{}")[`${kind}:${id}:${yyyymm}`];
const setPaid = (kind, id, yyyymm, val) => {
  const m = getLS(K.paid, "{}");
  m[`${kind}:${id}:${yyyymm}`] = !!val;
  setLS(K.paid, m);
};

/* أولوية العرض في الجداول */
function priorityKey(kind, item, yyyymm) {
  const dueAmt = dueThisMonth(item, yyyymm);
  const paid = isPaid(kind, item.id, yyyymm);
  const d = daysUntilDue(item, yyyymm);
  let pri;
  if (dueAmt === 0) pri = 5;
  else if (paid) pri = 4;
  else if (d < 0) pri = 0;
  else if (d <= 3) pri = 1;
  else pri = 2;
  const y = +yyyymm.slice(0, 4),
    m = +yyyymm.slice(5, 7);
  const last = lastDayOfMonth(y, m);
  const day = Math.min(item.dueDay || last, last);
  return [pri, day, item.name || ""];
}

/* حالة/شيب لعنصر الفواتير/الأقساط في هذا الشهر */
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

/* ===== بداية التشغيل ===== */
document.addEventListener("DOMContentLoaded", () => {
  // defaults
  $("#monthPicker").value = ym(new Date());
  $("#expDate").value = today;
  $("#oneDate").value = today;

  applySavedSettings();
  bindUI();
  setupModal();
  setupCharts();
  renderAll();
});

/* ===== إعدادات وثيم ===== */
function applySavedSettings() {
  const salary = +getLS(K.salary, "0");
  const saving = +getLS(K.saving, "0");
  const st = getLS(K.settings, '{"cash":false,"auto":false,"roll":false}');

  $("#salaryInput").value = salary || "";
  $("#savingTargetInput").value = saving || "";
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
  });

  $("#monthPicker").addEventListener("change", () => {
    // خصم تلقائي/ترحيل عند تغيير الشهر
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

  /* ===== النماذج ===== */
  // الأقساط
  $("#instForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#instName").value.trim();
    const amount = +$("#instAmount").value;
    const start = $("#instStart").value;
    const end = $("#instEnd").value || null;
    const dueDay = +$("#instDueDay").value || null;

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
    showToast("✅ تمت إضافة القسط", "success");
    renderInst();
    renderKPIs();
    updateAlerts();
  });

  // الفواتير
  $("#billForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#billName").value.trim();
    const amount = +$("#billAmount").value;
    const start = $("#billStart").value;
    const end = $("#billEnd").value || null;
    const dueDay = +$("#billDueDay").value || null;

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
    showToast("✅ تمت إضافة الفاتورة", "success");
    renderBills();
    renderKPIs();
    updateAlerts();
  });

  // المصروفات
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
    showToast("✅ تمت إضافة المصروف", "success");
    renderExpenses();
    renderBudgets();
    renderKPIs();
    checkBudgetWarn(item.cat);
  });

  // مصروف خارجي
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
    showToast("✅ تمت إضافة المصروف الخارجي", "success");
    renderOne();
    renderKPIs();
  });

  // ✅ الميزانيات (إضافة/تحديث)
  $("#budForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const cat = $("#budCat").value.trim();
    const limit = Number($("#budLimit").value || 0);
    if (!cat || !limit)
      return showToast("⚠️ أدخل التصنيف والحد الأعلى", "warning");

    const L = getLS(K.budgets, "[]");
    const i = L.findIndex((b) => normCat(b.cat) === normCat(cat));
    if (i > -1) {
      L[i].limit = limit;
    } else {
      L.push({
        id: "bud_" + (crypto.randomUUID?.() || Date.now().toString(36)),
        cat,
        limit,
      });
    }
    setLS(K.budgets, L);
    e.target.reset();
    showToast("✅ تم حفظ الميزانية", "success");
    renderBudgets();
  });

  /* بحث وتصدير */
  $("#searchInput").addEventListener("input", renderExpenses);
  $("#exportCSV").addEventListener("click", () =>
    exportCSV($("#monthPicker").value, $("#searchInput").value)
  );
  $("#exportJSON").addEventListener("click", exportJSON);
}

/* ===== Modal (زر +) ===== */
function setupModal() {
  const modal = $("#modal");
  const fab = $(".fab");
  fab?.addEventListener("click", () => modal.classList.add("show"));
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("show");
  });
  document.addEventListener(
    "keydown",
    (e) => e.key === "Escape" && modal.classList.remove("show")
  );
}

/* ===== الحذف/التبديل ===== */
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
  if (kind === "one") {
    const L = getLS(K.one, "[]");
    const i = L.findIndex((x) => x.id === id);
    if (i > -1) {
      L[i].paid = !L[i].paid;
      setLS(K.one, L);
      showToast("✅ تم التحديث", "success");
      renderOne();
      renderKPIs();
    }
    return;
  }
  const val = !isPaid(kind, id, yyyymm);
  setPaid(kind, id, yyyymm, val);
  showToast("✅ تم التحديث", "success");
  if (kind === "inst") renderInst();
  else renderBills();
  renderKPIs();
  updateAlerts();
}
window.togglePaid = togglePaid;

/* ===== دفع متأخر ===== */
function payLate(kind, id) {
  const curM = $("#monthPicker").value;
  const prev = prevMonthStr(curM);
  const month = prompt("أدخل الشهر المراد دفعه بصيغة YYYY-MM", prev);
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    showToast("❌ صيغة غير صحيحة. مثال صحيح: 2025-08", "danger");
    return;
  }
  if (month > curM) {
    showToast("⚠️ لا يمكن دفع شهر مستقبلي", "warning");
    return;
  }
  setPaid(kind, id, month, true);
  showToast(`✅ تم تسجيل دفع شهر ${month}`, "success");

  if (kind === "inst") renderInst();
  else renderBills();
  renderKPIs();
  updateAlerts();
}
window.payLate = payLate;

/* ===== دفع الشهر السابق (متأخر) ===== */
function payPrev(kind, id) {
  const curM = $("#monthPicker").value;
  const prevM = prevMonthStr(curM);
  const list = kind === "inst" ? getLS(K.inst, "[]") : getLS(K.bills, "[]");
  const item = list.find((x) => x.id === id);
  if (!item) return;

  const prevDue = dueThisMonth(item, prevM);
  const prevPaid = isPaid(kind, id, prevM);

  if (prevDue > 0 && !prevPaid) {
    setPaid(kind, id, prevM, true);
    showToast(`✅ تم تسجيل دفع شهر ${prevM}`, "success");
    if (kind === "inst") renderInst();
    else renderBills();
    renderKPIs();
    updateAlerts();
  } else {
    showToast("ℹ️ لا يوجد مبلغ مستحق غير مدفوع في الشهر السابق.", "warning");
  }
}
window.payPrev = payPrev;

/* ===== Rendering tables ===== */
function renderInst() {
  const curM = $("#monthPicker").value;
  const L = getLS(K.inst, "[]");
  const tbody = $("#instTable tbody");
  tbody.innerHTML = "";

  if (!L.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">لا توجد أقساط</td></tr>`;
    return;
  }

  L.sort((a, b) => {
    const [pa, da, na] = priorityKey("inst", a, curM);
    const [pb, db, nb] = priorityKey("inst", b, curM);
    return pa - pb || da - db || na.localeCompare(nb);
  });

  const nowYM = ym(new Date());

  L.forEach((item) => {
    const dueAmt = dueThisMonth(item, curM);
    const paid = isPaid("inst", item.id, curM);
    const status = statusChip(paid, dueAmt, item, curM);
    const y = +curM.slice(0, 4),
      m = +curM.slice(5, 7);
    const last = lastDayOfMonth(y, m);
    const dueDay = Math.min(item.dueDay || last, last);

    // الشهر السابق
    const prevM = prevMonthStr(curM);
    const prevDue = dueThisMonth(item, prevM);
    const prevPaid = isPaid("inst", item.id, prevM);
    const canPayPrev = prevDue > 0 && !prevPaid;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.name}</td>
      <td class="fit">${fmt(item.amount)}</td>
      <td class="fit">${item.start}${item.end ? ` → ${item.end}` : ""}</td>
      <td class="fit">${dueDay}</td>
      <td class="fit">${fmt(dueAmt)}</td>
      <td class="fit">${status}</td>
      <td class="fit">
        <div class="flex gap-4">
          ${
            dueAmt > 0
              ? `<button class="btn ${paid ? "ghost" : "primary"}"
                   onclick="togglePaid('inst','${item.id}','${curM}')">
                   ${
                     paid
                       ? "إلغاء الدفع"
                       : curM < nowYM
                       ? "دفع هذا الشهر (متأخر)"
                       : "تحديد كمدفوع"
                   }
                 </button>`
              : ""
          }
          ${
            canPayPrev
              ? `<button class="btn warning" title="تسجيل دفع الشهر السابق (${prevM})"
                   onclick="payPrev('inst','${item.id}')">دفع متأخر (${prevM})</button>`
              : ""
          }
          <button class="btn danger" onclick="deleteItem('inst','${
            item.id
          }')">حذف</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderBills() {
  const curM = $("#monthPicker").value;
  const L = getLS(K.bills, "[]");
  const tbody = $("#billTable tbody");
  tbody.innerHTML = "";

  if (!L.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">لا توجد فواتير</td></tr>`;
    return;
  }

  L.sort((a, b) => {
    const [pa, da, na] = priorityKey("bills", a, curM);
    const [pb, db, nb] = priorityKey("bills", b, curM);
    return pa - pb || da - db || na.localeCompare(nb);
  });

  const nowYM = ym(new Date());

  L.forEach((item) => {
    const dueAmt = dueThisMonth(item, curM);
    const paid = isPaid("bills", item.id, curM);
    const status = statusChip(paid, dueAmt, item, curM);
    const y = +curM.slice(0, 4),
      m = +curM.slice(5, 7);
    const last = lastDayOfMonth(y, m);
    const dueDay = Math.min(item.dueDay || last, last);

    const prevM = prevMonthStr(curM);
    const prevDue = dueThisMonth(item, prevM);
    const prevPaid = isPaid("bills", item.id, prevM);
    const canPayPrev = prevDue > 0 && !prevPaid;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.name}</td>
      <td class="fit">${fmt(item.amount)}</td>
      <td class="fit">${item.start}${item.end ? ` → ${item.end}` : ""}</td>
      <td class="fit">${dueDay}</td>
      <td class="fit">${fmt(dueAmt)}</td>
      <td class="fit">${status}</td>
      <td class="fit">
        <div class="flex gap-4">
          ${
            dueAmt > 0
              ? `<button class="btn ${paid ? "ghost" : "primary"}"
                   onclick="togglePaid('bills','${item.id}','${curM}')">
                   ${
                     paid
                       ? "إلغاء الدفع"
                       : curM < nowYM
                       ? "دفع هذا الشهر (متأخر)"
                       : "تحديد كمدفوع"
                   }
                 </button>`
              : ""
          }
          ${
            canPayPrev
              ? `<button class="btn warning" title="تسجيل دفع الشهر السابق (${prevM})"
                   onclick="payPrev('bills','${item.id}')">دفع متأخر (${prevM})</button>`
              : ""
          }
          <button class="btn danger" onclick="deleteItem('bills','${
            item.id
          }')">حذف</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderExpenses() {
  const curM = $("#monthPicker").value;
  const q = ($("#searchInput").value || "").toLowerCase();
  const L = getLS(K.exps, "[]")
    .filter(
      (x) =>
        ym(x.date) === curM &&
        (!q || normCat(x.cat).includes(q) || normCat(x.note).includes(q))
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const tbody = $("#expTable tbody");
  tbody.innerHTML = "";
  let total = 0;

  if (!L.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">لا توجد مصروفات</td></tr>`;
  } else {
    L.forEach((item) => {
      total += Number(item.amount || 0);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${item.date}</td>
        <td><span class="chip blue">${item.cat}</span></td>
        <td>${item.note || "-"}</td>
        <td class="fit">${payLabel(item.pay)}</td>
        <td class="fit">${fmt(item.amount)}</td>
        <td class="fit">
          <button class="btn danger" onclick="deleteItem('exps','${
            item.id
          }')">حذف</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }
  $("#expShownTotal").textContent = fmt(total);
}

function renderOne() {
  const curM = $("#monthPicker").value;
  const L = getLS(K.one, "[]")
    .filter((x) => ym(x.date) === curM)
    .sort((a, b) => a.date.localeCompare(b.date));
  const tbody = $("#oneTable tbody");
  tbody.innerHTML = "";

  if (!L.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">لا توجد مصاريف خارجية</td></tr>`;
    return;
  }
  L.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.date}</td>
      <td>${item.cat}</td>
      <td>${item.note || "-"}</td>
      <td class="fit">${fmt(item.amount)}</td>
      <td class="fit"><span class="chip ${item.paid ? "green" : "orange"}">${
      item.paid ? "مدفوع" : "غير مدفوع"
    }</span></td>
      <td class="fit">
        <div class="flex gap-4">
          <button class="btn ${item.paid ? "ghost" : "primary"}"
                  onclick="togglePaid('one','${item.id}','${curM}')">
            ${item.paid ? "إلغاء الدفع" : "تحديد كمدفوع"}
          </button>
          <button class="btn danger" onclick="deleteItem('one','${
            item.id
          }')">حذف</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderBudgets() {
  const curM = $("#monthPicker").value;
  const B = getLS(K.budgets, "[]");
  const E = getLS(K.exps, "[]");
  const tbody = $("#budTable tbody");
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
      <td><span class="chip blue">${b.cat}</span></td>
      <td class="fit">${fmt(b.limit)}</td>
      <td class="fit">${fmt(spent)}</td>
      <td class="fit">
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(
          pct,
          100
        )}%"></div></div>
        <span class="chip ${status}">${pct.toFixed(1)}%</span>
      </td>
      <td class="fit"><button class="btn danger" onclick="deleteItem('budgets','${
        b.id || b.cat
      }')">حذف</button></td>
    `;
    tbody.appendChild(tr);
  });
}

/* ===== KPIs + Summary ===== */
function renderKPIs() {
  const curM = $("#monthPicker").value;
  const salary = +getLS(K.salary, "0");
  const savingTarget = +getLS(K.saving, "0");
  const st = getLS(K.settings, '{"cash":false,"auto":false,"roll":false}');

  const inst = getLS(K.inst, "[]");
  const bills = getLS(K.bills, "[]");
  const exps = getLS(K.exps, "[]")
    .filter((x) => ym(x.date) === curM)
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  const ones = getLS(K.one, "[]")
    .filter((x) => ym(x.date) === curM && (!st.cash || x.paid))
    .reduce((s, x) => s + Number(x.amount || 0), 0);

  let instTotal = 0,
    billsTotal = 0;
  // هذا التجميع يعتمد على نفس المراجع، لذلك includes يعمل كما هو
  [...inst, ...bills].forEach((item) => {
    const kind = inst.includes(item) ? "inst" : "bills";
    const dueAmt = dueThisMonth(item, curM);
    if (dueAmt > 0) {
      const paid = isPaid(kind, item.id, curM);
      if (!st.cash || paid) {
        if (kind === "inst") instTotal += dueAmt;
        else billsTotal += dueAmt;
      }
    }
  });

  const rollMap = getLS(K.roll, "{}");
  const carry = Number(rollMap[curM] || 0);

  const totalOut = instTotal + billsTotal + exps + ones + carry;
  const actualSaving = salary - totalOut;
  const net = actualSaving - savingTarget;

  $("#kpiIncome").textContent = fmt(salary);
  $("#kpiOut").textContent = fmt(totalOut);
  $("#kpiSave").textContent = fmt(actualSaving);
  $("#kpiNet").textContent = fmt(net);
  $("#savingProgress").style.width = salary
    ? Math.min(100, (savingTarget / salary) * 100) + "%"
    : "0%";

  // جدول الملخص
  const table = $("#monthSummary");
  table.innerHTML = `
    <thead>
      <tr><th>البند</th><th class="fit">المبلغ</th><th class="fit">النسبة من الدخل</th></tr>
    </thead>
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
    </tbody>
  `;
}

/* ===== Charts ===== */
let monthlyChart, breakdownChart;
function setupCharts() {
  if (typeof Chart === "undefined") return;

  Chart.defaults.font.family = `'Tajawal', system-ui, -apple-system, 'Segoe UI'`;
  Chart.defaults.color =
    getComputedStyle(document.documentElement).getPropertyValue("--ink") ||
    "#e7ecf3";

  const monthlyCtx = $("#chartMonthly");
  const breakdownCtx = $("#chartBreakdown");

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

  const curM = $("#monthPicker").value;

  // 6 أشهر سابقة حتى الحالي — إنشاء تاريخ محلي آمن
  const labels = [],
    incomeData = [],
    expenseData = [];
  const [cy, cm] = curM.split("-").map(Number);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(cy, cm - 1 - i, 1); // محلي
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    labels.push(m);

    const salary = +getLS(K.salary, "0");
    incomeData.push(salary);

    const inst = getLS(K.inst, "[]").reduce(
      (s, it) => s + dueThisMonth(it, m),
      0
    );
    const bills = getLS(K.bills, "[]").reduce(
      (s, it) => s + dueThisMonth(it, m),
      0
    );
    const exps = getLS(K.exps, "[]")
      .filter((x) => ym(x.date) === m)
      .reduce((s, x) => s + Number(x.amount || 0), 0);
    const ones = getLS(K.one, "[]")
      .filter((x) => ym(x.date) === m)
      .reduce((s, x) => s + Number(x.amount || 0), 0);
    const roll = Number(getLS(K.roll, "{}")[m] || 0);
    expenseData.push(inst + bills + exps + ones + roll);
  }
  monthlyChart.data.labels = labels;
  monthlyChart.data.datasets[0].data = incomeData;
  monthlyChart.data.datasets[1].data = expenseData;
  monthlyChart.update();

  // Breakdown للشهر الحالي حسب التصنيف (تجميع مع تطبيع الاسم)
  const exps = getLS(K.exps, "[]").filter((x) => ym(x.date) === curM);
  const map = {};
  exps.forEach(
    (e) =>
      (map[normCat(e.cat)] = (map[normCat(e.cat)] || 0) + Number(e.amount || 0))
  );
  breakdownChart.data.labels = Object.keys(map);
  breakdownChart.data.datasets[0].data = Object.values(map);
  breakdownChart.update();
}

/* ===== Alerts / Auto / Rollover ===== */
function updateAlerts() {
  const curM = $("#monthPicker").value;
  const alerts = [];
  const inst = getLS(K.inst, "[]");
  const bills = getLS(K.bills, "[]");

  inst.forEach((item) => {
    const dueAmt = dueThisMonth(item, curM);
    if (dueAmt > 0 && !isPaid("inst", item.id, curM)) {
      const d = daysUntilDue(item, curM);
      if (d >= 0 && d <= 3)
        alerts.push(`⏰ ${item.name} (قسط) مستحق خلال ${d} يومًا.`);
      if (d < 0) alerts.push(`⚠️ ${item.name} (قسط) متأخر الدفع.`);
    }
  });
  bills.forEach((item) => {
    const dueAmt = dueThisMonth(item, curM);
    if (dueAmt > 0 && !isPaid("bills", item.id, curM)) {
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
  } else {
    badge.style.display = "none";
  }
}

// ✅ إصلاح: لا تستخدم includes على كائنات محمّلة جديدًا
function autoDeductIfDue(yyyymm) {
  const cur = ym(new Date());
  if (cur !== yyyymm) return;

  // الأقساط
  getLS(K.inst, "[]").forEach((item) => {
    const dueAmt = dueThisMonth(item, yyyymm);
    if (dueAmt > 0 && !isPaid("inst", item.id, yyyymm)) {
      const d = daysUntilDue(item, yyyymm);
      if (d <= 0) setPaid("inst", item.id, yyyymm, true);
    }
  });
  // الفواتير
  getLS(K.bills, "[]").forEach((item) => {
    const dueAmt = dueThisMonth(item, yyyymm);
    if (dueAmt > 0 && !isPaid("bills", item.id, yyyymm)) {
      const d = daysUntilDue(item, yyyymm);
      if (d <= 0) setPaid("bills", item.id, yyyymm, true);
    }
  });
}

function rolloverArrears(yyyymm) {
  const prev = prevMonthStr(yyyymm);
  let total = 0;

  getLS(K.inst, "[]").forEach((item) => {
    const dueAmt = dueThisMonth(item, prev);
    if (dueAmt > 0 && !isPaid("inst", item.id, prev)) total += dueAmt;
  });
  getLS(K.bills, "[]").forEach((item) => {
    const dueAmt = dueThisMonth(item, prev);
    if (dueAmt > 0 && !isPaid("bills", item.id, prev)) total += dueAmt;
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

/* ===== Budget warn (عشان ما يصير ReferenceError) ===== */
function checkBudgetWarn(cat) {
  const curM = $("#monthPicker").value;
  const B = getLS(K.budgets, "[]");
  const b = B.find((x) => normCat(x.cat) === normCat(cat));
  if (!b) return;
  const spent = getLS(K.exps, "[]")
    .filter((x) => ym(x.date) === curM && normCat(x.cat) === normCat(cat))
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  if (!b.limit) return;
  const pct = (spent / b.limit) * 100;
  if (pct >= 100) showToast(`🚫 تعدّيت ميزانية "${b.cat}" (${pct.toFixed(1)}%)`, "danger");
  else if (pct >= 80) showToast(`⚠️ قاربت حد ميزانية "${b.cat}" (${pct.toFixed(1)}%)`, "warning");
}

/* ===== Export ===== */
function exportCSV(month, search = "") {
  const rows = getLS(K.exps, "[]").filter(
    (x) =>
      ym(x.date) === month &&
      (!search ||
        normCat(x.cat).includes(search.toLowerCase()) ||
        normCat(x.note).includes(search.toLowerCase()))
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

/* ===== Master render ===== */
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

// ===== helpers للحساب لشهر معيّن =====
function totalsForMonth(yyyymm) {
  const salary = +getLS(K.salary, "0");
  const st = getLS(K.settings, '{"cash":false,"auto":false,"roll":false}');

  const inst = getLS(K.inst, "[]").reduce(
    (s, it) => s + dueThisMonth(it, yyyymm),
    0
  );
  const bills = getLS(K.bills, "[]").reduce(
    (s, it) => s + dueThisMonth(it, yyyymm),
    0
  );

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
function pct(n, d) {
  return d ? ((n / d) * 100).toFixed(1) : "0.0";
}

// ===== تقرير مفصّل للشهر الحالي =====
function openDetailedReport() {
  const m = $("#monthPicker").value;
  const t = totalsForMonth(m);
  const now = new Date();

  // تفصيل المصروفات حسب التصنيف (تجميع بعد التطبيع)
  const byCat = {};
  getLS(K.exps, "[]")
    .filter((x) => ym(x.date) === m)
    .forEach((e) => {
      const k = normCat(e.cat);
      byCat[k] = (byCat[k] || 0) + Number(e.amount || 0);
    });

  let rows = "";
  Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .forEach(([catKey, amt]) => {
      rows += `<tr><td>${catKey}</td><td class="fit">${fmt(
        amt
      )}</td><td class="fit">${pct(amt, t.salary)}%</td></tr>`;
    });
  if (!rows)
    rows = `<tr><td colspan="3" class="muted">لا توجد مصروفات بعد.</td></tr>`;

  const html = `
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>التقرير المالي المفصّل ${m}</title>
    <style>
      body{background:#0b1220;color:#e7ecf3;font-family:'Tajawal',system-ui;margin:24px}
      .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:16px 0}
      .card{padding:16px;border-radius:14px;background:#101827;border:1px solid #1f2937;text-align:center}
      .ok{color:#22c55e}.bad{color:#ef4444}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{border-bottom:1px solid #1f2937;padding:10px}
      .fit{white-space:nowrap}
      .muted{opacity:.7}
      h1{margin:0 0 6px}
      .section-title{margin-top:22px}
      .pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#111827;border:1px solid #1f2937;font-size:12px}
    </style>
  </head>
  <body>
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
      )}</div><div class="pill">أقساط: ${fmt(t.inst)} — فواتير: ${fmt(
    t.bills
  )}</div></div>
    </div>

    <h2 class="section-title">تفصيل المصروفات حسب التصنيف</h2>
    <table>
      <thead><tr><th>الفئة</th><th class="fit">المبلغ</th><th class="fit">النسبة من الدخل</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <h2 class="section-title">معلومات إضافية</h2>
    <div class="pill">المصاريف الخارجيّة: ${fmt(t.ones)}</div>
    <div class="pill">متأخرات مُرحّلة: ${fmt(t.carry)}</div>
  </body></html>`;

  const w = window.open("about:blank");
  w.document.write(html);
  w.document.close();
}

// ===== مقارنة شهرين: الحالي مقابل السابق =====
function openCompare() {
  const cur = $("#monthPicker").value;
  const prev = prevMonthStr(cur);

  const a = totalsForMonth(prev);
  const b = totalsForMonth(cur);

  function row(label, va, vb) {
    const diff = vb - va;
    const sign = diff === 0 ? "" : diff > 0 ? "▲" : "▼";
    const color = diff > 0 ? "#ef4444" : diff < 0 ? "#22c55e" : "#9ca3af";
    return `
      <tr>
        <td>${label}</td>
        <td class="fit">${fmt(va)}</td>
        <td class="fit">${fmt(vb)}</td>
        <td class="fit" style="color:${color}">${fmt(diff)} ${sign}</td>
      </tr>`;
  }

  const html = `
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>مقارنة الأشهر ${cur} مقابل ${prev}</title>
    <style>
      body{background:#0b1220;color:#e7ecf3;font-family:'Tajawal',system-ui;margin:24px}
      h1{margin:0 0 14px}
      .muted{opacity:.7}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{border-bottom:1px solid #1f2937;padding:10px}
      .fit{white-space:nowrap}
      .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:16px 0}
      .card{padding:16px;border-radius:14px;background:#101827;border:1px solid #1f2937}
      .ok{color:#22c55e}.bad{color:#ef4444}
    </style>
  </head>
  <body>
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

    <table>
      <thead><tr><th>البند</th><th class="fit">${prev}</th><th class="fit">${cur}</th><th class="fit">الفرق</th></tr></thead>
      <tbody>
        ${row("الأقساط + الفواتير", a.inst + a.bills, b.inst + b.bills)}
        ${row("المصروفات اليومية", a.exps, b.exps)}
        ${row("المصاريف الخارجيّة", a.ones, b.ones)}
        ${row("متأخرات مُرحّلة", a.carry, b.carry)}
        ${row("إجمالي المصروفات", a.out, b.out)}
        ${row("الادخار الفعلي", a.saveActual, b.saveActual)}
      </tbody>
    </table>
  </body></html>`;

  const w = window.open("about:blank");
  w.document.write(html);
  w.document.close();
}

// اربط الأزرار
document.addEventListener("DOMContentLoaded", () => {
  $("#btnReport")?.addEventListener("click", openDetailedReport);
  $("#btnCompare")?.addEventListener("click", openCompare);
});

// فتح المودال والتركيز مباشرة على "إضافة مصروف"
document.getElementById("openModalBtn")?.addEventListener("click", () => {
  const modal = document.getElementById("modal");
  modal?.classList.add("show");
  setTimeout(() => {
    document.getElementById("expForm")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    document.getElementById("expCat")?.focus();
  }, 50);
});

// زر الإغلاق
document.getElementById("closeModal")?.addEventListener("click", () => {
  document.getElementById("modal")?.classList.remove("show");
});

// اختصار سريع: اضغط حرف e من أي مكان لإضافة مصروف بسرعة
document.addEventListener("keydown", (e) => {
  const isTyping = /^(input|textarea|select)$/i.test(e.target?.tagName);
  if (!isTyping && e.key.toLowerCase() === "e") {
    e.preventDefault();
    document.getElementById("openModalBtn")?.click();
  }
});
