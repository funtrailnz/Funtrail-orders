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
