// ============================================================
// Funtrail — Orders App
// ============================================================
const CFG = window.FUNTRAIL_CONFIG;
const { createClient } = supabase;
const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

document.getElementById('company-name').textContent = CFG.COMPANY_NAME || 'Funtrail';

const STATUS_LABELS = {
  new: 'Новый',
  confirmed: 'Подтверждён',
  deposit_paid: 'Аванс оплачен',
  paid_full: 'Оплачен полностью',
  completed: 'Завершён',
  cancelled: 'Отменён'
};

const TOUR_LABELS = {
  'CHR1.1_ChCh_1_day': 'CHR1.1 — Крайстчерч (1 день)',
  'CHR1_ChCh_1_day': 'CHR1 — Крайстчерч (1 день)',
  'CHR1_Christchurch_group20': 'CHR1 — Крайстчерч (группа до 20 чел.)',
  'CHR2.1_Akaroa_1_day_chch-chch': 'CHR2.1 — Акароа (1 день)',
  'CHR2_Akaroa_1_day_chch-chch': 'CHR2 — Акароа (1 день)',
  'CHR3.1_Arthurs_Pass_1_day_chch-chch': 'CHR3.1 — Артурс-Пасс (1 день)',
  'CHR3_Arthurs_Pass_1_day_chch-chch': 'CHR3 — Артурс-Пасс (1 день)',
  'CHR4.1_Kaikoura_Hanmer_Springs_2days': 'CHR4.1 — Кайкоура + Ханмер-Спрингс (2 дня)',
  'CHR6.1_South Island_7_days': 'CHR6.1 — Южный остров (7 дней)',
  custom: 'Тур'
};

// Короткие обозначения тура для тесной ячейки календаря (полное название — в TOUR_LABELS)
const TOUR_SHORT = {
  'CHR1.1_ChCh_1_day': 'CHR1.1',
  'CHR1_ChCh_1_day': 'CHR1',
  'CHR1_Christchurch_group20': 'CHR1×20',
  'CHR2.1_Akaroa_1_day_chch-chch': 'CHR2.1',
  'CHR2_Akaroa_1_day_chch-chch': 'CHR2',
  'CHR3.1_Arthurs_Pass_1_day_chch-chch': 'CHR3.1',
  'CHR3_Arthurs_Pass_1_day_chch-chch': 'CHR3',
  'CHR4.1_Kaikoura_Hanmer_Springs_2days': 'CHR4.1',
  'CHR6.1_South Island_7_days': 'CHR6.1',
  custom: 'Тур'
};

// Цвет ячейки календаря по статусу заказа (плюс аванс для статуса "Подтверждён"):
//   серый     — заказ ещё не подтверждён
//   оранжевый — подтверждён, аванс не получен
//   зелёный   — подтверждён (или "Аванс оплачен"), аванс получен
//   изумрудный— оплачен полностью
//   приглушённый — завершён (уже не актуален)
//   приглушённый красный — отменён
function tourChipClass(o) {
  switch (o.status) {
    case 'cancelled': return 'chip-cancelled';
    case 'completed': return 'chip-completed';
    case 'paid_full': return 'chip-paidfull';
    case 'deposit_paid': return 'chip-green';
    case 'confirmed': return o.deposit_paid ? 'chip-green' : 'chip-orange';
    default: return 'chip-gray'; // new и всё, что не предусмотрено выше
  }
}

let orders = [];          // все заказы, загруженные с сервера
let checklistByOrder = {}; // order_id -> [items]
let businessExpenses = []; // общебизнес расходы (не привязаны к туру)
let currentMonth = new Date(); currentMonth.setDate(1);
let financeMonth = new Date(); financeMonth.setDate(1);
let financeMode = 'month'; // 'month' | 'custom' | 'all' — переключатель периода на вкладке "Финансы"
let financeCustomFrom = null; // 'YYYY-MM-DD', задаётся при первом открытии режима "Период"
let financeCustomTo = null;
let selectedDate = todayStr();
let activeView = 'calendar';
let editingOrderId = null;
let editingChecklist = []; // рабочая копия чек-листа в открытой модалке
let editingExpenseId = null;

// Статьи расходов, которые реально ведёт команда (используется в модалке расхода)
const BUSINESS_EXPENSE_CATEGORIES = [
  'Страховка транспорта',
  'ТО/обслуживание транспорта',
  'Регистрация/техосмотр (WOF/rego)',
  'Хостинг/сайт',
  'Реклама/продвижение',
  'Связь/интернет',
  'Прочее'
];

// Сумма всех расходов по конкретному туру (для расчёта маржи)
function orderCostTotal(o) {
  return (Number(o.cost_transport) || 0) + (Number(o.cost_guide) || 0) + (Number(o.cost_tickets) || 0) +
    (Number(o.cost_accommodation) || 0) + (Number(o.cost_other) || 0);
}

function monthRange(d) {
  const y = d.getFullYear(), m = d.getMonth();
  const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const end = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function fmtMoney(n) {
  return (Math.round((n || 0) * 100) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function fmtDate(d) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}
function daysBetween(a, b) {
  const A = new Date(a + 'T00:00:00'), B = new Date(b + 'T00:00:00');
  return Math.round((B - A) / 86400000);
}

// ------------------------------------------------------------
// Аутентификация
// ------------------------------------------------------------
const authScreen = document.getElementById('auth-screen');
const mainScreen = document.getElementById('main-screen');
const tabSignin = document.getElementById('tab-signin');
const tabSignup = document.getElementById('tab-signup');
let authMode = 'signin';

tabSignin.onclick = () => { authMode = 'signin'; tabSignin.classList.add('active'); tabSignup.classList.remove('active'); document.getElementById('auth-submit').textContent = 'Войти'; };
tabSignup.onclick = () => { authMode = 'signup'; tabSignup.classList.add('active'); tabSignin.classList.remove('active'); document.getElementById('auth-submit').textContent = 'Зарегистрироваться'; };

document.getElementById('auth-submit').onclick = async () => {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const msg = document.getElementById('auth-message');
  msg.textContent = '';
  if (!email || !password) { msg.textContent = 'Заполните email и пароль'; return; }

  if (authMode === 'signin') {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) msg.textContent = error.message;
  } else {
    const { error } = await sb.auth.signUp({ email, password });
    if (error) msg.textContent = error.message;
    else msg.textContent = 'Готово! Проверьте почту для подтверждения (если требуется), затем войдите.';
  }
};

document.getElementById('btn-logout').onclick = async () => {
  await sb.auth.signOut();
};

sb.auth.onAuthStateChange((event, session) => {
  if (session) {
    authScreen.style.display = 'none';
    mainScreen.style.display = 'flex';
    bootAfterLogin();
  } else {
    authScreen.style.display = 'flex';
    mainScreen.style.display = 'none';
  }
});

// проверка текущей сессии при загрузке
sb.auth.getSession().then(({ data }) => {
  if (data.session) {
    authScreen.style.display = 'none';
    mainScreen.style.display = 'flex';
    bootAfterLogin();
  }
});

let booted = false;
async function bootAfterLogin() {
  if (booted) return;
  booted = true;
  await loadAll();
  subscribeRealtime();
  renderCurrentView();
}

// ------------------------------------------------------------
// Загрузка данных
// ------------------------------------------------------------
async function loadAll() {
  const { data: ordersData, error: e1 } = await sb.from('orders').select('*').order('tour_date', { ascending: true });
  if (e1) { console.error(e1); alert('Ошибка загрузки заказов: ' + e1.message); return; }
  orders = ordersData || [];

  const { data: items, error: e2 } = await sb.from('checklist_items').select('*').order('created_at', { ascending: true });
  if (e2) { console.error(e2); return; }
  checklistByOrder = {};
  (items || []).forEach(it => {
    (checklistByOrder[it.order_id] ||= []).push(it);
  });

  const { data: expenses, error: e3 } = await sb.from('business_expenses').select('*').order('expense_date', { ascending: false });
  if (e3) { console.error(e3); return; } // таблица могла быть ещё не создана — тогда просто не показываем расходы
  businessExpenses = expenses || [];
}

function subscribeRealtime() {
  sb.channel('public:orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => {
      await loadAll(); renderCurrentView();
    })
    .subscribe();
  sb.channel('public:checklist_items')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_items' }, async () => {
      await loadAll(); renderCurrentView();
    })
    .subscribe();
  sb.channel('public:business_expenses')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'business_expenses' }, async () => {
      await loadAll(); renderCurrentView();
    })
    .subscribe();
}

// ------------------------------------------------------------
// Переключение вкладок-видов
// ------------------------------------------------------------
const viewTabs = { calendar: document.getElementById('tab-calendar'), upcoming: document.getElementById('tab-upcoming'), all: document.getElementById('tab-all'), finance: document.getElementById('tab-finance') };
const viewEls = { calendar: document.getElementById('view-calendar'), upcoming: document.getElementById('view-upcoming'), all: document.getElementById('view-all'), finance: document.getElementById('view-finance') };
Object.keys(viewTabs).forEach(key => {
  viewTabs[key].onclick = () => {
    activeView = key;
    Object.keys(viewTabs).forEach(k => viewTabs[k].classList.toggle('active', k === key));
    Object.keys(viewEls).forEach(k => viewEls[k].style.display = (k === key ? 'block' : 'none'));
    renderCurrentView();
  };
});

function renderCurrentView() {
  if (activeView === 'calendar') renderCalendar();
  else if (activeView === 'upcoming') renderUpcoming();
  else if (activeView === 'all') renderAllOrders();
  else renderFinance();
}

// ------------------------------------------------------------
// Календарь
// ------------------------------------------------------------
document.getElementById('cal-prev').onclick = () => { currentMonth.setMonth(currentMonth.getMonth() - 1); renderCalendar(); };
document.getElementById('cal-next').onclick = () => { currentMonth.setMonth(currentMonth.getMonth() + 1); renderCalendar(); };

function ordersOn(dateStr) { return orders.filter(o => o.tour_date === dateStr); }

function renderCalendar() {
  const grid = document.getElementById('cal-grid');
  const title = document.getElementById('cal-title');
  title.textContent = currentMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

  grid.innerHTML = '';
  const dow = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  dow.forEach(d => { const el = document.createElement('div'); el.className = 'cal-dow'; el.textContent = d; grid.appendChild(el); });

  const year = currentMonth.getFullYear(), month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  let startOffset = (firstDay.getDay() + 6) % 7; // Пн=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = startOffset; i > 0; i--) cells.push({ day: daysInPrevMonth - i + 1, otherMonth: true, dateStr: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({ day: d, otherMonth: false, dateStr });
  }
  // хвост из дней СЛЕДУЮЩЕГО месяца — раньше здесь ошибочно подставлялся
  // индекс ячейки (cells.length), из-за чего числа уезжали (30, 36, 37...).
  // Правильно — просто считать 1, 2, 3... для следующего месяца.
  let nextMonthDay = 1;
  while (cells.length % 7 !== 0) cells.push({ day: nextMonthDay++, otherMonth: true, dateStr: null });

  const today = todayStr();
  const MAX_CHIPS = 3;
  cells.forEach(c => {
    const el = document.createElement('div');
    el.className = 'cal-day' + (c.otherMonth ? ' other-month' : '') + (c.dateStr === today ? ' today' : '') + (c.dateStr === selectedDate ? ' selected' : '');
    const num = document.createElement('div'); num.className = 'num'; num.textContent = c.day; el.appendChild(num);
    if (c.dateStr) {
      const dayOrders = ordersOn(c.dateStr);
      if (dayOrders.length) {
        const chipsBox = document.createElement('div'); chipsBox.className = 'chips';
        dayOrders.slice(0, MAX_CHIPS).forEach(o => {
          const chip = document.createElement('div');
          chip.className = 'tour-chip ' + tourChipClass(o);
          chip.innerHTML = `<span class="tcode">${escapeHtml(TOUR_SHORT[o.tour_type] || o.tour_type)}</span><span class="tstatus">${escapeHtml(STATUS_LABELS[o.status] || o.status)}</span>`;
          chipsBox.appendChild(chip);
        });
        if (dayOrders.length > MAX_CHIPS) {
          const more = document.createElement('div');
          more.className = 'tour-chip more';
          more.textContent = `+${dayOrders.length - MAX_CHIPS}`;
          chipsBox.appendChild(more);
        }
        el.appendChild(chipsBox);
      }
      el.onclick = () => { selectedDate = c.dateStr; renderCalendar(); renderDayOrders(); };
    }
    grid.appendChild(el);
  });

  renderDayOrders();
}

function renderDayOrders() {
  const box = document.getElementById('day-orders');
  const list = ordersOn(selectedDate);
  box.innerHTML = `<h3>${fmtDate(selectedDate)}</h3>`;
  if (!list.length) {
    box.innerHTML += `<div class="empty-hint">Заказов на этот день нет</div>`;
    return;
  }
  list.forEach(o => box.appendChild(orderCard(o)));
}

// ------------------------------------------------------------
// Ближайшие заказы
// ------------------------------------------------------------
function renderUpcoming() {
  const box = document.getElementById('view-upcoming');
  box.innerHTML = '';
  const today = todayStr();
  const list = orders.filter(o => o.tour_date >= today && o.status !== 'cancelled' && o.status !== 'completed')
    .sort((a,b) => a.tour_date.localeCompare(b.tour_date));
  if (!list.length) { box.innerHTML = '<div class="empty-hint">Нет предстоящих заказов</div>'; return; }
  list.forEach(o => box.appendChild(orderCard(o, true)));
}

// ------------------------------------------------------------
// Все заказы
// ------------------------------------------------------------
function renderAllOrders() {
  const box = document.getElementById('view-all');
  box.innerHTML = '';
  const list = [...orders].sort((a,b) => b.tour_date.localeCompare(a.tour_date));
  if (!list.length) { box.innerHTML = '<div class="empty-hint">Заказов пока нет</div>'; return; }
  list.forEach(o => box.appendChild(orderCard(o, true)));
}

// ------------------------------------------------------------
// Финансы
// ------------------------------------------------------------
function renderFinance() {
  const box = document.getElementById('view-finance');

  // При первом переключении в режим "Период" — задать разумный диапазон по умолчанию
  if (financeMode === 'custom' && (!financeCustomFrom || !financeCustomTo)) {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    financeCustomFrom = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-01`;
    financeCustomTo = todayStr();
  }

  let periodOrders, periodExpenses, periodLabel, filenameSuffix;
  if (financeMode === 'all') {
    periodOrders = orders.filter(o => o.status !== 'cancelled');
    periodExpenses = businessExpenses.slice();
    periodLabel = 'За всё время';
    filenameSuffix = 'all-time';
  } else if (financeMode === 'custom') {
    const from = financeCustomFrom, to = financeCustomTo;
    periodOrders = orders.filter(o => o.tour_date >= from && o.tour_date <= to && o.status !== 'cancelled');
    periodExpenses = businessExpenses.filter(e => e.expense_date >= from && e.expense_date <= to);
    periodLabel = `${fmtDate(from)} – ${fmtDate(to)}`;
    filenameSuffix = `${from}_${to}`;
  } else {
    const { start, end } = monthRange(financeMonth);
    periodOrders = orders.filter(o => o.tour_date >= start && o.tour_date <= end && o.status !== 'cancelled');
    periodExpenses = businessExpenses.filter(e => e.expense_date >= start && e.expense_date <= end);
    periodLabel = financeMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    filenameSuffix = `${financeMonth.getFullYear()}-${String(financeMonth.getMonth() + 1).padStart(2, '0')}`;
  }

  const revenue = periodOrders.reduce((s, o) => s + (Number(o.total_price) || 0), 0);
  const tourCosts = periodOrders.reduce((s, o) => s + orderCostTotal(o), 0);
  const bizCosts = periodExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const profit = revenue - tourCosts - bizCosts;
  const avgCheck = periodOrders.length ? revenue / periodOrders.length : 0;

  // прибыльность по маршрутам
  const byType = {};
  periodOrders.forEach(o => {
    const key = o.tour_type || 'custom';
    if (!byType[key]) byType[key] = { count: 0, revenue: 0, cost: 0 };
    byType[key].count++;
    byType[key].revenue += Number(o.total_price) || 0;
    byType[key].cost += orderCostTotal(o);
  });
  const byTypeRows = Object.entries(byType)
    .map(([type, v]) => ({
      type, ...v,
      profit: v.revenue - v.cost,
      margin: v.revenue ? Math.round((v.revenue - v.cost) / v.revenue * 100) : 0
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // динамика по месяцам — в режимах "Период" и "Всё время", чтобы видеть рост бизнеса
  let monthlyRows = [];
  if (financeMode === 'all' || financeMode === 'custom') {
    const monthlySourceOrders = financeMode === 'all' ? orders.filter(o => o.status !== 'cancelled') : periodOrders;
    const monthlySourceExpenses = financeMode === 'all' ? businessExpenses : periodExpenses;
    const byMonth = {};
    monthlySourceOrders.forEach(o => {
      const key = (o.tour_date || '').slice(0, 7);
      if (!key) return;
      if (!byMonth[key]) byMonth[key] = { revenue: 0, cost: 0, biz: 0, count: 0 };
      byMonth[key].revenue += Number(o.total_price) || 0;
      byMonth[key].cost += orderCostTotal(o);
      byMonth[key].count++;
    });
    monthlySourceExpenses.forEach(e => {
      const key = (e.expense_date || '').slice(0, 7);
      if (!key) return;
      if (!byMonth[key]) byMonth[key] = { revenue: 0, cost: 0, biz: 0, count: 0 };
      byMonth[key].biz += Number(e.amount) || 0;
    });
    monthlyRows = Object.entries(byMonth)
      .map(([key, v]) => ({
        key,
        label: new Date(key + '-01T00:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
        revenue: v.revenue, tourCost: v.cost, biz: v.biz, count: v.count,
        profit: v.revenue - v.cost - v.biz
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  // просроченные авансы — всегда "на сейчас", независимо от выбранного периода
  const today = todayStr();
  const overdue = orders.filter(o =>
    o.status !== 'cancelled' && o.status !== 'completed' &&
    o.deposit_amount && !o.deposit_paid && o.deposit_due_date && o.deposit_due_date <= today
  );

  box.innerHTML = `
    <div class="fin-mode-toggle">
      <button class="${financeMode === 'month' ? 'active' : ''}" id="fin-mode-month">Месяц</button>
      <button class="${financeMode === 'custom' ? 'active' : ''}" id="fin-mode-custom">Период</button>
      <button class="${financeMode === 'all' ? 'active' : ''}" id="fin-mode-all">Всё время</button>
    </div>

    ${financeMode === 'month' ? `
    <div class="cal-nav">
      <button class="ghost" id="fin-prev">←</button>
      <h2>${periodLabel}</h2>
      <button class="ghost" id="fin-next">→</button>
    </div>` : financeMode === 'custom' ? `
    <div class="fin-range-picker">
      <div>
        <label>С</label>
        <input type="date" id="fin-custom-from" value="${financeCustomFrom}" />
      </div>
      <div>
        <label>По</label>
        <input type="date" id="fin-custom-to" value="${financeCustomTo}" />
      </div>
    </div>` : `
    <div class="cal-nav" style="justify-content:center;">
      <h2 style="text-transform:none;">${periodLabel}</h2>
    </div>`}

    <div class="fin-cards">
      <div class="fin-card"><div class="label">Выручка</div><div class="value">${fmtMoney(revenue)} NZD</div></div>
      <div class="fin-card cost"><div class="label">Расходы по турам</div><div class="value">${fmtMoney(tourCosts)} NZD</div></div>
      <div class="fin-card cost"><div class="label">Общебизнес расходы</div><div class="value">${fmtMoney(bizCosts)} NZD</div></div>
      <div class="fin-card profit"><div class="label">Чистая прибыль</div><div class="value">${fmtMoney(profit)} NZD</div></div>
    </div>
    <div class="fin-cards fin-cards-2">
      <div class="fin-card"><div class="label">Туров ${financeMode === 'month' ? 'за месяц' : (financeMode === 'all' ? 'всего' : 'за период')}</div><div class="value">${periodOrders.length}</div></div>
      <div class="fin-card"><div class="label">Средний чек</div><div class="value">${fmtMoney(avgCheck)} NZD</div></div>
    </div>

    ${(financeMode === 'all' || financeMode === 'custom') ? `
    <div class="section-title">Динамика по месяцам</div>
    ${monthlyRows.length ? `
    <table class="fin-table">
      <thead><tr><th>Месяц</th><th class="num">Туров</th><th class="num">Выручка</th><th class="num">Расходы по турам</th><th class="num">Общебизнес</th><th class="num">Прибыль</th></tr></thead>
      <tbody>
        ${monthlyRows.map(r => `
          <tr>
            <td>${escapeHtml(r.label)}</td>
            <td class="num">${r.count}</td>
            <td class="num">${fmtMoney(r.revenue)}</td>
            <td class="num">${fmtMoney(r.tourCost)}</td>
            <td class="num">${fmtMoney(r.biz)}</td>
            <td class="num">${fmtMoney(r.profit)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>` : `<div class="empty-hint">Данных пока нет</div>`}
    ` : ''}

    <div class="section-title">Прибыльность по маршрутам</div>
    ${byTypeRows.length ? `
    <table class="fin-table">
      <thead><tr><th>Маршрут</th><th class="num">Туров</th><th class="num">Выручка</th><th class="num">Расходы</th><th class="num">Прибыль</th><th class="num">Маржа</th></tr></thead>
      <tbody>
        ${byTypeRows.map(r => `
          <tr>
            <td>${escapeHtml(TOUR_LABELS[r.type] || r.type)}</td>
            <td class="num">${r.count}</td>
            <td class="num">${fmtMoney(r.revenue)}</td>
            <td class="num">${fmtMoney(r.cost)}</td>
            <td class="num">${fmtMoney(r.profit)}</td>
            <td class="num ${r.margin >= 60 ? 'margin-good' : 'margin-mid'}">${r.margin}%</td>
          </tr>
        `).join('')}
      </tbody>
    </table>` : `<div class="empty-hint">Нет заказов за этот период</div>`}

    <div class="section-title">Непогашенные авансы</div>
    ${overdue.length ? overdue.map(o => `
      <div class="overdue-row">
        <div class="who">${escapeHtml(o.customer_name || '(без имени)')} — ${escapeHtml(TOUR_SHORT[o.tour_type] || o.tour_type)}, ${fmtDate(o.tour_date)}</div>
        <div class="amt">Ждём ${fmtMoney(o.deposit_amount)} ${o.currency || 'NZD'} (срок был ${fmtDate(o.deposit_due_date)})</div>
      </div>
    `).join('') : `<div class="empty-hint">Просроченных авансов нет</div>`}

    <div class="expenses-toolbar">
      <div class="section-title">Общебизнес расходы</div>
      <button class="secondary" id="fin-add-expense">+ Добавить расход</button>
    </div>
    ${periodExpenses.length ? `
    <table class="fin-table">
      <thead><tr><th>Дата</th><th>Категория</th><th>Заметка</th><th class="num">Сумма</th></tr></thead>
      <tbody>
        ${periodExpenses.map(e => `
          <tr class="fin-expense-row" data-id="${e.id}">
            <td>${fmtDate(e.expense_date)}</td>
            <td>${escapeHtml(e.category)}</td>
            <td>${escapeHtml(e.note || '—')}</td>
            <td class="num">${fmtMoney(e.amount)} ${e.currency || 'NZD'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>` : `<div class="empty-hint">Расходов за этот период нет</div>`}

    <div class="footer-actions">
      <button class="secondary" id="fin-export-csv">⬇ Экспорт в CSV${financeMode === 'all' ? ' за всё время' : (financeMode === 'custom' ? ' за период' : ' за этот месяц')}</button>
    </div>
  `;

  document.getElementById('fin-mode-month').onclick = () => { financeMode = 'month'; renderFinance(); };
  document.getElementById('fin-mode-custom').onclick = () => { financeMode = 'custom'; renderFinance(); };
  document.getElementById('fin-mode-all').onclick = () => { financeMode = 'all'; renderFinance(); };
  if (financeMode === 'month') {
    document.getElementById('fin-prev').onclick = () => { financeMonth.setMonth(financeMonth.getMonth() - 1); renderFinance(); };
    document.getElementById('fin-next').onclick = () => { financeMonth.setMonth(financeMonth.getMonth() + 1); renderFinance(); };
  }
  if (financeMode === 'custom') {
    document.getElementById('fin-custom-from').onchange = (e) => {
      financeCustomFrom = e.target.value || financeCustomFrom;
      if (financeCustomFrom > financeCustomTo) financeCustomTo = financeCustomFrom;
      renderFinance();
    };
    document.getElementById('fin-custom-to').onchange = (e) => {
      financeCustomTo = e.target.value || financeCustomTo;
      if (financeCustomTo < financeCustomFrom) financeCustomFrom = financeCustomTo;
      renderFinance();
    };
  }
  document.getElementById('fin-add-expense').onclick = () => openExpenseModal(null);
  document.getElementById('fin-export-csv').onclick = () => exportFinanceCsv(periodOrders, periodExpenses, periodLabel, filenameSuffix);
  box.querySelectorAll('.fin-expense-row').forEach(row => {
    row.onclick = () => openExpenseModal(row.dataset.id);
  });
}

// ------------------------------------------------------------
// Модалка общебизнес расхода
// ------------------------------------------------------------
const expenseModal = document.getElementById('expense-modal');

function openExpenseModal(expenseId) {
  editingExpenseId = expenseId;
  const e = expenseId ? businessExpenses.find(x => x.id === expenseId) : null;
  document.getElementById('fe-date').value = e?.expense_date || todayStr();
  document.getElementById('fe-category').value = e?.category || BUSINESS_EXPENSE_CATEGORIES[0];
  document.getElementById('fe-amount').value = e?.amount ?? '';
  document.getElementById('fe-note').value = e?.note || '';
  document.getElementById('fe-delete').style.display = e ? 'inline-block' : 'none';
  expenseModal.style.display = 'flex';
}

function closeExpenseModal() {
  expenseModal.style.display = 'none';
  editingExpenseId = null;
}

document.getElementById('fe-cancel').onclick = () => closeExpenseModal();

document.getElementById('fe-save').onclick = async () => {
  const payload = {
    expense_date: document.getElementById('fe-date').value,
    category: document.getElementById('fe-category').value,
    amount: parseFloat(document.getElementById('fe-amount').value) || 0,
    note: document.getElementById('fe-note').value || null
  };
  if (!payload.expense_date) { alert('Укажите дату'); return; }

  if (editingExpenseId) {
    const { error } = await sb.from('business_expenses').update(payload).eq('id', editingExpenseId);
    if (error) { alert('Ошибка сохранения: ' + error.message); return; }
  } else {
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from('business_expenses').insert({ ...payload, created_by: user?.id });
    if (error) { alert('Ошибка сохранения: ' + error.message); return; }
  }

  await loadAll();
  renderCurrentView();
  closeExpenseModal();
};

document.getElementById('fe-delete').onclick = async () => {
  if (!editingExpenseId) return;
  if (!confirm('Удалить этот расход? Действие необратимо.')) return;
  await sb.from('business_expenses').delete().eq('id', editingExpenseId);
  await loadAll();
  renderCurrentView();
  closeExpenseModal();
};

// ------------------------------------------------------------
// Экспорт финансового отчёта в CSV
// ------------------------------------------------------------
function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportFinanceCsv(periodOrders, periodExpenses, periodLabel, filenameSuffix) {
  const rows = [];
  rows.push([`Funtrail — финансовый отчёт (${periodLabel})`]);
  rows.push([]);
  rows.push(['ЗАКАЗЫ']);
  rows.push(['Дата тура', 'Клиент', 'Маршрут', 'Статус', 'Стоимость', 'Валюта', 'Аванс', 'Транспорт', 'Гид', 'Билеты', 'Проживание', 'Прочее', 'Расходы итого', 'Прибыль']);
  periodOrders.forEach(o => {
    const cost = orderCostTotal(o);
    rows.push([
      o.tour_date, o.customer_name || '', TOUR_LABELS[o.tour_type] || o.tour_type, STATUS_LABELS[o.status] || o.status,
      o.total_price ?? '', o.currency || 'NZD', o.deposit_amount ?? '',
      o.cost_transport ?? '', o.cost_guide ?? '', o.cost_tickets ?? '', o.cost_accommodation ?? '', o.cost_other ?? '',
      cost, (Number(o.total_price) || 0) - cost
    ]);
  });
  rows.push([]);
  rows.push(['ОБЩЕБИЗНЕС РАСХОДЫ']);
  rows.push(['Дата', 'Категория', 'Заметка', 'Сумма', 'Валюта']);
  periodExpenses.forEach(e => {
    rows.push([e.expense_date, e.category, e.note || '', e.amount, e.currency || 'NZD']);
  });

  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM — чтобы Excel правильно показал кириллицу
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `funtrail-finance-${filenameSuffix}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------
// Карточка заказа
// ------------------------------------------------------------
function orderCard(o, showDate) {
  const card = document.createElement('div');
  card.className = 'order-card';
  const badgeClass = 'status-' + o.status;
  const items = checklistByOrder[o.id] || [];
  const doneCount = items.filter(i => i.done).length;

  const daysLeft = daysBetween(todayStr(), o.tour_date);
  let warnLine = '';
  if (o.status !== 'cancelled' && o.status !== 'completed') {
    if (daysLeft >= 0 && daysLeft <= (CFG.UPCOMING_DAYS_THRESHOLD || 3)) {
      warnLine += `<div class="warn-line">⏰ Тур через ${daysLeft === 0 ? 'сегодня' : daysLeft + ' дн.'}</div>`;
    }
    if (o.deposit_amount && !o.deposit_paid && o.deposit_due_date && o.deposit_due_date <= todayStr()) {
      warnLine += `<div class="warn-line">💰 Просрочен аванс (${o.deposit_amount} ${o.currency})</div>`;
    }
  }

  card.innerHTML = `
    <div class="row1">
      <div class="title">${escapeHtml(o.customer_name || '(без имени)')} — ${TOUR_LABELS[o.tour_type] || o.tour_type}</div>
      <div class="badge ${badgeClass}">${STATUS_LABELS[o.status] || o.status}</div>
    </div>
    <div class="meta">
      ${showDate ? `📅 ${fmtDate(o.tour_date)}${o.tour_time ? ', ' + o.tour_time : ''}<br/>` : (o.tour_time ? `🕐 ${o.tour_time}<br/>` : '')}
      👥 ${o.group_size} чел. ${o.transport ? '· ' + escapeHtml(o.transport) : ''}<br/>
      ${o.customer_phone ? '📞 ' + escapeHtml(o.customer_phone) + '<br/>' : ''}
      ${o.total_price ? '💵 ' + o.total_price + ' ' + o.currency + (o.deposit_amount ? ' (аванс ' + o.deposit_amount + (o.deposit_paid ? ', оплачен' : ', ожидается') + ')' : '') + '<br/>' : ''}
    </div>
    ${warnLine}
    ${items.length ? `<div class="checklist-mini">✅ Чек-лист: ${doneCount}/${items.length}</div>` : ''}
  `;
  card.onclick = () => openOrderModal(o.id);
  return card;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ------------------------------------------------------------
// Модалка заказа
// ------------------------------------------------------------
const modal = document.getElementById('order-modal');
document.getElementById('btn-new-order').onclick = () => openOrderModal(null);
document.getElementById('f-cancel').onclick = () => closeModal();

function closeModal() { modal.style.display = 'none'; editingOrderId = null; editingChecklist = []; }

function openOrderModal(orderId) {
  editingOrderId = orderId;
  const o = orderId ? orders.find(x => x.id === orderId) : null;
  document.getElementById('order-modal-title').textContent = o ? 'Редактировать заказ' : 'Новый заказ';
  document.getElementById('f-delete').style.display = o ? 'inline-block' : 'none';

  document.getElementById('f-tour-date').value = o?.tour_date || selectedDate || todayStr();
  document.getElementById('f-tour-time').value = o?.tour_time || '';
  document.getElementById('f-tour-type').value = o?.tour_type || 'CHR1_ChCh_1_day';
  document.getElementById('f-tour-name').value = o?.tour_name || '';
  document.getElementById('f-group-size').value = o?.group_size || 1;
  document.getElementById('f-transport').value = o?.transport || '';
  document.getElementById('f-customer-name').value = o?.customer_name || '';
  document.getElementById('f-customer-phone').value = o?.customer_phone || '';
  document.getElementById('f-customer-email').value = o?.customer_email || '';
  document.getElementById('f-status').value = o?.status || 'new';
  document.getElementById('f-currency').value = o?.currency || 'NZD';
  document.getElementById('f-total-price').value = o?.total_price ?? '';
  document.getElementById('f-deposit-amount').value = o?.deposit_amount ?? '';
  document.getElementById('f-deposit-due').value = o?.deposit_due_date || '';
  document.getElementById('f-deposit-paid').checked = !!o?.deposit_paid;
  document.getElementById('f-cost-transport').value = o?.cost_transport ?? '';
  document.getElementById('f-cost-guide').value = o?.cost_guide ?? '';
  document.getElementById('f-cost-tickets').value = o?.cost_tickets ?? '';
  document.getElementById('f-cost-accommodation').value = o?.cost_accommodation ?? '';
  document.getElementById('f-cost-other').value = o?.cost_other ?? '';
  document.getElementById('f-notes').value = o?.notes || '';
  updateProfitDisplay();

  editingChecklist = o ? (checklistByOrder[o.id] || []).map(x => ({ ...x })) : [];
  renderChecklistEditor();
  document.getElementById('f-checklist-select').value = '';
  document.getElementById('f-checklist-new').value = '';
  document.getElementById('f-checklist-new').style.display = 'none';

  modal.style.display = 'flex';
}

// Прибыль по туру считается вживую, пока вводите стоимость/расходы —
// сама нигде не сохраняется, это просто подсказка
function updateProfitDisplay() {
  const total = parseFloat(document.getElementById('f-total-price').value) || 0;
  const costIds = ['f-cost-transport', 'f-cost-guide', 'f-cost-tickets', 'f-cost-accommodation', 'f-cost-other'];
  const cost = costIds.reduce((s, id) => s + (parseFloat(document.getElementById(id).value) || 0), 0);
  const profit = total - cost;
  document.getElementById('f-profit-display').value = fmtMoney(profit) + ' ' + (document.getElementById('f-currency').value || 'NZD');
}
['f-total-price', 'f-cost-transport', 'f-cost-guide', 'f-cost-tickets', 'f-cost-accommodation', 'f-cost-other', 'f-currency'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateProfitDisplay);
});

function renderChecklistEditor() {
  const box = document.getElementById('f-checklist');
  box.innerHTML = '';
  editingChecklist.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'checklist-item' + (item.done ? ' done' : '');
    row.innerHTML = `
      <input type="checkbox" ${item.done ? 'checked' : ''} data-idx="${idx}" class="cl-toggle" style="width:auto;" />
      <span style="flex:1;">${escapeHtml(item.title)}</span>
      <button class="ghost cl-remove" data-idx="${idx}">✕</button>
    `;
    box.appendChild(row);
  });
  box.querySelectorAll('.cl-toggle').forEach(cb => cb.onchange = (e) => {
    const idx = +e.target.dataset.idx; editingChecklist[idx].done = e.target.checked; renderChecklistEditor();
  });
  box.querySelectorAll('.cl-remove').forEach(btn => btn.onclick = (e) => {
    const idx = +e.target.dataset.idx;
    editingChecklist.splice(idx, 1);
    renderChecklistEditor();
  });
}

const checklistSelect = document.getElementById('f-checklist-select');
const checklistCustomInput = document.getElementById('f-checklist-new');

checklistSelect.onchange = () => {
  const isCustom = checklistSelect.value === '__custom__';
  checklistCustomInput.style.display = isCustom ? '' : 'none';
  if (isCustom) checklistCustomInput.focus();
};

document.getElementById('f-checklist-add-btn').onclick = () => {
  let title;
  if (checklistSelect.value === '__custom__') {
    title = checklistCustomInput.value.trim();
  } else {
    title = checklistSelect.value;
  }
  if (!title) return;
  editingChecklist.push({ title, done: false, _new: true });
  checklistCustomInput.value = '';
  checklistSelect.value = '';
  checklistCustomInput.style.display = 'none';
  renderChecklistEditor();
};

document.getElementById('f-save').onclick = async () => {
  const payload = {
    tour_date: document.getElementById('f-tour-date').value,
    tour_time: document.getElementById('f-tour-time').value || null,
    tour_type: document.getElementById('f-tour-type').value,
    tour_name: document.getElementById('f-tour-name').value,
    group_size: parseInt(document.getElementById('f-group-size').value) || 1,
    transport: document.getElementById('f-transport').value || null,
    customer_name: document.getElementById('f-customer-name').value,
    customer_phone: document.getElementById('f-customer-phone').value || null,
    customer_email: document.getElementById('f-customer-email').value || null,
    status: document.getElementById('f-status').value,
    currency: document.getElementById('f-currency').value || 'NZD',
    total_price: document.getElementById('f-total-price').value || null,
    deposit_amount: document.getElementById('f-deposit-amount').value || null,
    deposit_due_date: document.getElementById('f-deposit-due').value || null,
    deposit_paid: document.getElementById('f-deposit-paid').checked,
    cost_transport: document.getElementById('f-cost-transport').value ? parseFloat(document.getElementById('f-cost-transport').value) : null,
    cost_guide: document.getElementById('f-cost-guide').value ? parseFloat(document.getElementById('f-cost-guide').value) : null,
    cost_tickets: document.getElementById('f-cost-tickets').value ? parseFloat(document.getElementById('f-cost-tickets').value) : null,
    cost_accommodation: document.getElementById('f-cost-accommodation').value ? parseFloat(document.getElementById('f-cost-accommodation').value) : null,
    cost_other: document.getElementById('f-cost-other').value ? parseFloat(document.getElementById('f-cost-other').value) : null,
    notes: document.getElementById('f-notes').value || null
  };

  if (!payload.tour_date) { alert('Укажите дату тура'); return; }

  let orderId = editingOrderId;
  if (orderId) {
    const { error } = await sb.from('orders').update(payload).eq('id', orderId);
    if (error) { alert('Ошибка сохранения: ' + error.message); return; }
  } else {
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb.from('orders').insert({ ...payload, created_by: user?.id }).select().single();
    if (error) { alert('Ошибка сохранения: ' + error.message); return; }
    orderId = data.id;
  }

  // синхронизация чек-листа
  const original = checklistByOrder[orderId] || [];
  const keepIds = editingChecklist.filter(x => x.id).map(x => x.id);
  const removed = original.filter(o => !keepIds.includes(o.id));
  for (const r of removed) await sb.from('checklist_items').delete().eq('id', r.id);
  for (const item of editingChecklist) {
    if (item.id) {
      await sb.from('checklist_items').update({ title: item.title, done: item.done, due_date: item.due_date || null }).eq('id', item.id);
    } else {
      await sb.from('checklist_items').insert({ order_id: orderId, title: item.title, done: item.done || false });
    }
  }

  await loadAll();
  renderCurrentView();
  closeModal();
};

document.getElementById('f-delete').onclick = async () => {
  if (!editingOrderId) return;
  if (!confirm('Удалить этот заказ? Действие необратимо.')) return;
  await sb.from('orders').delete().eq('id', editingOrderId);
  await loadAll();
  renderCurrentView();
  closeModal();
};

// ------------------------------------------------------------
// Регистрация service worker (для установки на устройство)
// ------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(console.error);
  });
}
