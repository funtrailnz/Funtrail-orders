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

let orders = [];          // все заказы, загруженные с сервера
let checklistByOrder = {}; // order_id -> [items]
let currentMonth = new Date(); currentMonth.setDate(1);
let selectedDate = todayStr();
let activeView = 'calendar';
let editingOrderId = null;
let editingChecklist = []; // рабочая копия чек-листа в открытой модалке

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
}

// ------------------------------------------------------------
// Переключение вкладок-видов
// ------------------------------------------------------------
const viewTabs = { calendar: document.getElementById('tab-calendar'), upcoming: document.getElementById('tab-upcoming'), all: document.getElementById('tab-all') };
const viewEls = { calendar: document.getElementById('view-calendar'), upcoming: document.getElementById('view-upcoming'), all: document.getElementById('view-all') };
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
  else renderAllOrders();
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
  while (cells.length % 7 !== 0) cells.push({ day: cells.length, otherMonth: true, dateStr: null });

  const today = todayStr();
  cells.forEach(c => {
    const el = document.createElement('div');
    el.className = 'cal-day' + (c.otherMonth ? ' other-month' : '') + (c.dateStr === today ? ' today' : '') + (c.dateStr === selectedDate ? ' selected' : '');
    const num = document.createElement('div'); num.className = 'num'; num.textContent = c.day; el.appendChild(num);
    if (c.dateStr) {
      const dayOrders = ordersOn(c.dateStr);
      if (dayOrders.length) {
        const dots = document.createElement('div'); dots.className = 'dots';
        dayOrders.slice(0, 6).forEach(o => { const dot = document.createElement('div'); dot.className = 'dot status-' + o.status; dots.appendChild(dot); });
        el.appendChild(dots);
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
  document.getElementById('f-notes').value = o?.notes || '';

  editingChecklist = o ? (checklistByOrder[o.id] || []).map(x => ({ ...x })) : [];
  renderChecklistEditor();

  modal.style.display = 'flex';
}

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

document.getElementById('f-checklist-add-btn').onclick = () => {
  const input = document.getElementById('f-checklist-new');
  const title = input.value.trim();
  if (!title) return;
  editingChecklist.push({ title, done: false, _new: true });
  input.value = '';
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
