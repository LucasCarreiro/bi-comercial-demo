<?php
declare(strict_types=1);
require_once __DIR__ . '/upstream.php';

// Códigos já vistos ficam guardados por este prazo para um pedido que some e volta não contar duas vezes.
const BI_ORDERS_SEEN_DAYS = 60;

/**
 * Pedidos em aberto de uma resposta da API. O campo "pedidos" traz só os pedidos
 * ainda não faturados, os mesmos em qualquer período consultado.
 */
function bi_orders_current(stdClass $data): array
{
    try {
        $source = $data->atualizado_em ?? null;
        if (!is_string($source) || !preg_match('/^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/D', $source, $match)) {
            bi_fail(502, 'upstream_invalid_response', 'A API não informou a data de atualização.');
        }
        bi_date($match[1], 'Data de atualização da API');
        $rows = [];
        $seen = [];
        foreach ($data->clientes as $row) {
            if (!$row instanceof stdClass || !property_exists($row, 'pedidos') || !is_array($row->pedidos) || !bi_is_list($row->pedidos)) {
                bi_fail(502, 'upstream_invalid_response', 'A API não trouxe a lista de pedidos dos clientes.');
            }
            if (!$row->pedidos) {
                continue;
            }
            foreach ($row->pedidos as $code) {
                if (!is_int($code) || $code < 1 || isset($seen[$code])) {
                    bi_fail(502, 'upstream_invalid_response', 'A API trouxe um código de pedido inválido ou repetido.');
                }
                $seen[$code] = true;
            }
            $amount = $row->a_faturar ?? null;
            if ((!is_int($amount) && !is_float($amount)) || !is_finite((float) $amount) || $amount < 0) {
                bi_fail(502, 'upstream_invalid_response', 'A API trouxe um valor a faturar inválido.');
            }
            $rows[] = [
                'clientCode' => bi_code($row->cod_cliente ?? null, 'Cliente do pedido'),
                'clientName' => bi_text($row->name ?? null, 'Cliente do pedido', 500, true),
                'city' => bi_text($row->city ?? '', 'Cidade do pedido', 200),
                'repCode' => bi_code($row->cod_rep ?? null, 'Vendedor do pedido'),
                'repName' => bi_text($row->rep ?? null, 'Vendedor do pedido', 300, true),
                'aFaturar' => $amount,
                'orders' => $row->pedidos,
            ];
        }
        return ['sourceUpdatedAt' => $source, 'date' => $match[1], 'rows' => $rows];
    } catch (BiHttpError $error) {
        if ($error->status === 502) {
            throw $error;
        }
        bi_fail(502, 'upstream_invalid_response', 'A API trouxe pedidos em formato inesperado.');
    }
}

function bi_orders_empty(): stdClass
{
    return (object) ['schemaVersion' => 1, 'startedOn' => null, 'snapshots' => [], 'reps' => new stdClass(), 'seen' => new stdClass(), 'newByDay' => new stdClass()];
}

/**
 * Registra uma atualização da API no histórico. Devolve false quando ela já foi
 * registrada ou é mais antiga que a última. Os pedidos já em aberto no primeiro
 * registro formam a base e não contam como novos.
 */
function bi_orders_merge(stdClass $history, array $current): bool
{
    $date = $current['date'];
    foreach ($history->snapshots as $snapshot) {
        if ($snapshot->sourceUpdatedAt === $current['sourceUpdatedAt'] || $snapshot->date > $date) {
            return false;
        }
    }
    $baseline = $history->startedOn === null;
    if ($baseline) {
        $history->startedOn = $date;
    }
    $open = 0;
    foreach ($current['rows'] as $row) {
        $rep = $row['repCode'];
        $history->reps->$rep = $row['repName'];
        foreach ($row['orders'] as $code) {
            $open++;
            $key = (string) $code;
            if (isset($history->seen->$key)) {
                $history->seen->$key->last = $date;
                continue;
            }
            $history->seen->$key = (object) ['rep' => $rep, 'client' => $row['clientCode'], 'first' => $date, 'last' => $date];
            if (!$baseline) {
                if (!isset($history->newByDay->$date)) {
                    $history->newByDay->$date = new stdClass();
                }
                $history->newByDay->$date->$rep = ($history->newByDay->$date->$rep ?? 0) + 1;
            }
        }
    }
    $history->snapshots[] = (object) ['sourceUpdatedAt' => $current['sourceUpdatedAt'], 'date' => $date, 'open' => $open];
    $limit = (new DateTimeImmutable($date, new DateTimeZone('UTC')))->modify('-' . BI_ORDERS_SEEN_DAYS . ' days')->format('Y-m-d');
    foreach (get_object_vars($history->seen) as $key => $item) {
        if ($item->last < $limit) {
            unset($history->seen->$key);
        }
    }
    return true;
}

function bi_read_orders(string $path): stdClass
{
    clearstatcache(true, $path);
    $size = filesize($path);
    $content = ($size !== false && $size <= BI_MAX_JSON_BYTES) ? @file_get_contents($path) : false;
    try {
        if ($content === false) {
            bi_fail(500, 'orders_unreadable', '');
        }
        $history = bi_decode($content, 'Histórico de pedidos');
        $date = '/^\d{4}-\d{2}-\d{2}$/D';
        if (!$history instanceof stdClass || ($history->schemaVersion ?? null) !== 1 || !is_array($history->snapshots ?? null) || !($history->reps ?? null) instanceof stdClass || !($history->seen ?? null) instanceof stdClass || !($history->newByDay ?? null) instanceof stdClass || !property_exists($history, 'startedOn') || !($history->startedOn === null || (is_string($history->startedOn) && preg_match($date, $history->startedOn)))) {
            bi_fail(500, 'orders_invalid', '');
        }
        foreach ($history->snapshots as $snapshot) {
            if (!$snapshot instanceof stdClass || !is_string($snapshot->sourceUpdatedAt ?? null) || !is_string($snapshot->date ?? null) || !preg_match($date, $snapshot->date)) {
                bi_fail(500, 'orders_invalid', '');
            }
        }
        foreach (get_object_vars($history->seen) as $item) {
            if (!$item instanceof stdClass || !is_string($item->last ?? null)) {
                bi_fail(500, 'orders_invalid', '');
            }
        }
        return $history;
    } catch (BiHttpError $error) {
        bi_fail(500, 'orders_invalid', 'O histórico de pedidos (data/orders.json) está ilegível. Ele não foi sobrescrito; a TI deve revisar o arquivo.');
    }
}

/** Lê o histórico e, se houver uma atualização nova da API, grava-a. O arquivo é criado no primeiro registro. */
function bi_orders_transaction(string $path, array $current): stdClass
{
    $lock = @fopen(dirname($path) . '/.orders.lock', 'c');
    if ($lock === false) {
        bi_fail(500, 'orders_lock_failed', 'O PHP não conseguiu abrir o controle de gravação em public/data. Verifique a permissão da pasta.');
    }
    try {
        bi_acquire_lock($lock, true);
        $history = is_file($path) ? bi_read_orders($path) : bi_orders_empty();
        if (bi_orders_merge($history, $current)) {
            bi_write_atomic($path, $history);
        }
        return $history;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
