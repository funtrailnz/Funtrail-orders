#!/usr/bin/env python3
"""
Funtrail — ежедневный дайджест-напоминание в Telegram.

Что делает:
  1. Находит туры, до которых осталось REMINDER_DAYS дней (по умолчанию 3, 1, 0).
  2. Находит заказы с просроченным авансом (deposit_due_date <= сегодня, не оплачен).
  3. Находит невыполненные пункты чек-листа с истёкшим/сегодняшним сроком.
  4. Собирает всё в одно сообщение и отправляет в Telegram (группу/чат команды).
  5. Пишет в reminder_log, чтобы не слать один и тот же дайджест дважды в один день.

Требуемые переменные окружения (задаются как GitHub Actions secrets):
  SUPABASE_URL          — https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY  — service_role key (Project Settings → API). НЕ анонимный ключ!
  TELEGRAM_BOT_TOKEN    — токен бота от @BotFather
  TELEGRAM_CHAT_ID      — id чата/группы, куда слать сообщения
  TELEGRAM_THREAD_ID    — необязательно: id темы (топика) внутри группы,
                          если нужно слать именно в неё, а не в общую тему
  REMINDER_DAYS         — необязательно, напр. "3,1,0"
"""

import os
import sys
from datetime import date, timedelta
import requests

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TELEGRAM_CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]
TELEGRAM_THREAD_ID = os.environ.get("TELEGRAM_THREAD_ID", "").strip()
REMINDER_DAYS = [int(x) for x in os.environ.get("REMINDER_DAYS", "3,1,0").split(",") if x.strip() != ""]

HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}

STATUS_LABELS = {
    "new": "Новый",
    "confirmed": "Подтверждён",
    "deposit_paid": "Аванс оплачен",
    "paid_full": "Оплачен полностью",
    "completed": "Завершён",
    "cancelled": "Отменён",
}


def sb_get(path, params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def sb_post(path, body):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{path}", headers=HEADERS, json=body, timeout=30)
    r.raise_for_status()


def already_sent_today(reminder_type: str) -> bool:
    today = date.today().isoformat()
    rows = sb_get(
        "reminder_log",
        {
            "select": "id",
            "reminder_type": f"eq.{reminder_type}",
            "sent_at": f"gte.{today}T00:00:00",
            "limit": 1,
        },
    )
    return len(rows) > 0


def mark_sent(reminder_type: str):
    sb_post("reminder_log", {"reminder_type": reminder_type})


def fetch_active_orders():
    """Все заказы, которые ещё не завершены и не отменены."""
    return sb_get(
        "orders",
        {
            "select": "*",
            "status": "not.in.(completed,cancelled)",
            "order": "tour_date.asc",
        },
    )


def fetch_checklist_open():
    return sb_get(
        "checklist_items",
        {
            "select": "*,orders(customer_name,tour_date,tour_type,status)",
            "done": "eq.false",
        },
    )


def build_digest():
    today = date.today()
    orders = fetch_active_orders()

    upcoming_lines = []
    overdue_deposit_lines = []

    for o in orders:
        tour_date = date.fromisoformat(o["tour_date"])
        days_left = (tour_date - today).days
        label = f'{o.get("customer_name") or "(без имени)"} — {o.get("tour_type")} ({o["tour_date"]})'

        if days_left in REMINDER_DAYS:
            when = "сегодня" if days_left == 0 else f"через {days_left} дн."
            group = o.get("group_size")
            phone = o.get("customer_phone") or "—"
            upcoming_lines.append(f"• {label}, {when}. Группа: {group} чел. Тел.: {phone}. Статус: {STATUS_LABELS.get(o['status'], o['status'])}")

        deposit_due = o.get("deposit_due_date")
        if (
            o.get("deposit_amount")
            and not o.get("deposit_paid")
            and deposit_due
            and date.fromisoformat(deposit_due) <= today
        ):
            overdue_deposit_lines.append(f"• {label} — аванс {o['deposit_amount']} {o.get('currency','NZD')}, срок был {deposit_due}")

    checklist_lines = []
    open_items = fetch_checklist_open()
    for it in open_items:
        due = it.get("due_date")
        order_info = it.get("orders") or {}
        if order_info.get("status") in ("completed", "cancelled"):
            continue
        is_due = (due and date.fromisoformat(due) <= today)
        # если срок не указан — напоминаем, когда тур уже близко (в пределах порога)
        tour_date = order_info.get("tour_date")
        is_tour_soon = False
        if tour_date:
            days_left = (date.fromisoformat(tour_date) - today).days
            is_tour_soon = days_left <= max(REMINDER_DAYS, default=3)
        if is_due or is_tour_soon:
            cust = order_info.get("customer_name") or "(без имени)"
            checklist_lines.append(f"• [{cust}, {tour_date or '?'}] {it['title']}")

    return upcoming_lines, overdue_deposit_lines, checklist_lines


def send_telegram(text: str):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"}
    if TELEGRAM_THREAD_ID:
        payload["message_thread_id"] = int(TELEGRAM_THREAD_ID)
    r = requests.post(url, json=payload, timeout=30)
    r.raise_for_status()


def main():
    if already_sent_today("daily_digest"):
        print("Дайджест на сегодня уже отправлен, выходим.")
        return

    upcoming, overdue, checklist = build_digest()

    if not upcoming and not overdue and not checklist:
        print("Нечего напоминать сегодня.")
        mark_sent("daily_digest")
        return

    parts = [f"<b>Funtrail — напоминания на {date.today().strftime('%d.%m.%Y')}</b>"]

    if upcoming:
        parts.append("\n🔔 <b>Туры скоро:</b>\n" + "\n".join(upcoming))
    if overdue:
        parts.append("\n💰 <b>Просрочен аванс:</b>\n" + "\n".join(overdue))
    if checklist:
        parts.append("\n📋 <b>Не сделано перед туром:</b>\n" + "\n".join(checklist))

    text = "\n".join(parts)
    send_telegram(text)
    mark_sent("daily_digest")
    print("Дайджест отправлен.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"Ошибка: {exc}", file=sys.stderr)
        sys.exit(1)
