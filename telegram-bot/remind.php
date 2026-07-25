<?php
/**
 * Funtrail — ежедневный дайджест-напоминание в Telegram (версия для cPanel).
 *
 * Делает то же самое, что telegram-bot/remind.py, но не требует Python —
 * работает на встроенном PHP+cURL, которые есть практически на любом cPanel.
 *
 * Запуск: через cPanel → Cron Jobs, раз в день, командой вида
 *   php /home/USERNAME/telegram-bot/remind.php
 *
 * Секретные ключи вынесены в config.php (см. рядом) — этот файл и config.php
 * НЕ должны лежать внутри public_html, чтобы их нельзя было открыть браузером.
 */

require_once __DIR__ . '/config.php'; // задаёт константы SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, REMINDER_DAYS

const STATUS_LABELS = [
    'new' => 'Новый',
    'confirmed' => 'Подтверждён',
    'deposit_paid' => 'Аванс оплачен',
    'paid_full' => 'Оплачен полностью',
    'completed' => 'Завершён',
    'cancelled' => 'Отменён',
];

function sb_request(string $method, string $path, array $params = [], $body = null) {
    $url = rtrim(SUPABASE_URL, '/') . '/rest/v1/' . $path;
    if ($params) {
        $url .= '?' . http_build_query($params);
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . SUPABASE_SERVICE_KEY,
            'Authorization: Bearer ' . SUPABASE_SERVICE_KEY,
            'Content-Type: application/json',
            'Prefer: return=representation',
        ],
        CURLOPT_TIMEOUT => 30,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    $response = curl_exec($ch);
    if ($response === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new Exception("Ошибка запроса к Supabase ($path): $err");
    }
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code >= 400) {
        throw new Exception("Supabase вернул код $code для $path: $response");
    }
    return json_decode($response, true) ?? [];
}

function sb_get(string $path, array $params) {
    return sb_request('GET', $path, $params);
}

function sb_post(string $path, array $body) {
    return sb_request('POST', $path, [], $body);
}

function already_sent_today(string $reminderType): bool {
    $today = date('Y-m-d');
    $rows = sb_get('reminder_log', [
        'select' => 'id',
        'reminder_type' => "eq.$reminderType",
        'sent_at' => "gte.{$today}T00:00:00",
        'limit' => 1,
    ]);
    return count($rows) > 0;
}

function mark_sent(string $reminderType): void {
    sb_post('reminder_log', ['reminder_type' => $reminderType]);
}

function fetch_active_orders(): array {
    return sb_get('orders', [
        'select' => '*',
        'status' => 'not.in.(completed,cancelled)',
        'order' => 'tour_date.asc',
    ]);
}

function fetch_checklist_open(): array {
    return sb_get('checklist_items', [
        'select' => '*,orders(customer_name,tour_date,tour_type,status)',
        'done' => 'eq.false',
    ]);
}

function days_between(string $fromYmd, string $toYmd): int {
    $from = new DateTime($fromYmd);
    $to = new DateTime($toYmd);
    return (int) $from->diff($to)->format('%r%a');
}

function build_digest(): array {
    $today = date('Y-m-d');
    $orders = fetch_active_orders();
    $reminderDays = REMINDER_DAYS;

    $upcoming = [];
    $overdueDeposit = [];

    foreach ($orders as $o) {
        $daysLeft = days_between($today, $o['tour_date']);
        $label = ($o['customer_name'] ?: '(без имени)') . ' — ' . $o['tour_type'] . ' (' . $o['tour_date'] . ')';

        if (in_array($daysLeft, $reminderDays, true)) {
            $when = $daysLeft === 0 ? 'сегодня' : "через {$daysLeft} дн.";
            $phone = $o['customer_phone'] ?: '—';
            $status = STATUS_LABELS[$o['status']] ?? $o['status'];
            $upcoming[] = "• {$label}, {$when}. Группа: {$o['group_size']} чел. Тел.: {$phone}. Статус: {$status}";
        }

        if (!empty($o['deposit_amount']) && empty($o['deposit_paid']) && !empty($o['deposit_due_date'])
            && $o['deposit_due_date'] <= $today) {
            $currency = $o['currency'] ?? 'NZD';
            $overdueDeposit[] = "• {$label} — аванс {$o['deposit_amount']} {$currency}, срок был {$o['deposit_due_date']}";
        }
    }

    $checklistLines = [];
    $openItems = fetch_checklist_open();
    $maxThreshold = $reminderDays ? max($reminderDays) : 3;
    foreach ($openItems as $it) {
        $order = $it['orders'] ?? null;
        if (!$order || in_array($order['status'], ['completed', 'cancelled'], true)) {
            continue;
        }
        $isDue = !empty($it['due_date']) && $it['due_date'] <= $today;
        $isTourSoon = false;
        if (!empty($order['tour_date'])) {
            $isTourSoon = days_between($today, $order['tour_date']) <= $maxThreshold;
        }
        if ($isDue || $isTourSoon) {
            $cust = $order['customer_name'] ?: '(без имени)';
            $checklistLines[] = "• [{$cust}, " . ($order['tour_date'] ?? '?') . "] {$it['title']}";
        }
    }

    return [$upcoming, $overdueDeposit, $checklistLines];
}

function send_telegram(string $text): void {
    $url = 'https://api.telegram.org/bot' . TELEGRAM_BOT_TOKEN . '/sendMessage';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POSTFIELDS => json_encode([
            'chat_id' => TELEGRAM_CHAT_ID,
            'text' => $text,
            'parse_mode' => 'HTML',
        ]),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_TIMEOUT => 30,
    ]);
    $response = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($response === false || $code >= 400) {
        throw new Exception("Ошибка отправки в Telegram: код $code, ответ: $response");
    }
}

function main(): void {
    if (already_sent_today('daily_digest')) {
        echo "Дайджест на сегодня уже отправлен, выходим.\n";
        return;
    }

    [$upcoming, $overdue, $checklist] = build_digest();

    if (!$upcoming && !$overdue && !$checklist) {
        echo "Нечего напоминать сегодня.\n";
        mark_sent('daily_digest');
        return;
    }

    $parts = ['<b>Funtrail — напоминания на ' . date('d.m.Y') . '</b>'];
    if ($upcoming) {
        $parts[] = "\n🔔 <b>Туры скоро:</b>\n" . implode("\n", $upcoming);
    }
    if ($overdue) {
        $parts[] = "\n💰 <b>Просрочен аванс:</b>\n" . implode("\n", $overdue);
    }
    if ($checklist) {
        $parts[] = "\n📋 <b>Не сделано перед туром:</b>\n" . implode("\n", $checklist);
    }

    send_telegram(implode("\n", $parts));
    mark_sent('daily_digest');
    echo "Дайджест отправлен.\n";
}

try {
    main();
} catch (Throwable $e) {
    fwrite(STDERR, 'Ошибка: ' . $e->getMessage() . "\n");
    exit(1);
}
