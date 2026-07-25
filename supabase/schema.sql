-- ============================================================
-- FUNTRAIL — схема базы данных Supabase
-- Выполнить целиком в Supabase → SQL Editor → New query → Run
-- ============================================================

-- Расширение для генерации UUID
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Таблица заказов (туров)
-- ------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),

  tour_date date not null,
  tour_time text,                         -- напр. "08:00"
  tour_type text not null default 'custom', -- CHR1 / CHR2 / CHR3 / custom
  tour_name text not null default '',

  group_size int not null default 1,
  transport text,                         -- минивэн / легковой авто / не выбрано

  customer_name text not null default '',
  customer_phone text,
  customer_email text,

  status text not null default 'new'
    check (status in ('new','confirmed','deposit_paid','paid_full','completed','cancelled')),

  total_price numeric(10,2),
  currency text not null default 'NZD',
  deposit_amount numeric(10,2),
  deposit_due_date date,
  deposit_paid boolean not null default false,
  balance_paid boolean not null default false,

  notes text
);

create index if not exists orders_tour_date_idx on public.orders (tour_date);
create index if not exists orders_status_idx on public.orders (status);

-- ------------------------------------------------------------
-- Чек-лист задач по заказу ("что нужно сделать")
-- ------------------------------------------------------------
create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  due_date date,
  created_at timestamptz not null default now()
);

create index if not exists checklist_order_idx on public.checklist_items (order_id);

-- ------------------------------------------------------------
-- Лог отправленных напоминаний (чтобы бот не дублировал сообщения)
-- ------------------------------------------------------------
create table if not exists public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  checklist_item_id uuid references public.checklist_items(id) on delete cascade,
  reminder_type text not null,   -- 'upcoming_tour' | 'deposit_overdue' | 'checklist_due'
  sent_at timestamptz not null default now(),
  unique (order_id, checklist_item_id, reminder_type, sent_at)
);

-- ------------------------------------------------------------
-- Триггер: автоматически обновлять updated_at
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- Row Level Security: доступ разрешён всем авторизованным
-- пользователям команды (все видят и редактируют все заказы)
-- ------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.checklist_items enable row level security;
alter table public.reminder_log enable row level security;

drop policy if exists "team full access orders" on public.orders;
create policy "team full access orders"
  on public.orders
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "team full access checklist" on public.checklist_items;
create policy "team full access checklist"
  on public.checklist_items
  for all
  to authenticated
  using (true)
  with check (true);

-- reminder_log читает/пишет только сервисная роль (бот), фронтенду не нужен доступ
drop policy if exists "service only reminder_log" on public.reminder_log;
create policy "service only reminder_log"
  on public.reminder_log
  for all
  to service_role
  using (true)
  with check (true);

-- ------------------------------------------------------------
-- Realtime: включить публикацию изменений для синхронизации
-- (Supabase создаёт публикацию supabase_realtime по умолчанию —
-- добавляем в неё наши таблицы)
-- ------------------------------------------------------------
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.checklist_items;

-- ------------------------------------------------------------
-- Готовые шаблоны туров (справочно, можно менять в приложении)
-- CHR1 — Christchurch City, CHR2 — Akaroa, CHR3 — Arthur's Pass
-- Цены НЕ подставляются автоматически — считать отдельно под
-- сезон и группу (см. claude/pricing_reference_cruise_tours.md)
-- ------------------------------------------------------------
