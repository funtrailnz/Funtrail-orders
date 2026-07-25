<?php
/**
 * Секретные настройки для remind.php.
 *
 * ВАЖНО: этот файл должен лежать ВНЕ папки public_html (например прямо в
 * домашней папке аккаунта, рядом с public_html, а не внутри неё) — тогда его
 * невозможно открыть напрямую через браузер по ссылке.
 */

// Project URL из Supabase → Project Settings → API
define('SUPABASE_URL', 'https://ВАШ-ПРОЕКТ.supabase.co');

// service_role key из Supabase → Project Settings → API (СЕКРЕТНЫЙ, не anon key!)
define('SUPABASE_SERVICE_KEY', 'ВАШ-SERVICE-ROLE-KEY');

// Токен бота от @BotFather
define('TELEGRAM_BOT_TOKEN', 'ВАШ-ТОКЕН-БОТА');

// chat_id группы/чата команды (см. README, раздел про Telegram-бота)
define('TELEGRAM_CHAT_ID', 'ВАШ-CHAT-ID');

// За сколько дней до тура напоминать (0 = в день тура)
define('REMINDER_DAYS', [3, 1, 0]);
