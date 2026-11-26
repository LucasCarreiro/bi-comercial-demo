<?php
declare(strict_types=1);
require_once __DIR__ . '/orders_helpers.php';

bi_endpoint(static function (): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        header('Allow: GET');
        bi_fail(405, 'method_not_allowed', 'A consulta de pedidos aceita apenas GET.');
    }
    if ($_GET) {
        bi_fail(400, 'unexpected_query', 'A consulta de pedidos não recebe parâmetros.');
    }
    $config = bi_config();
    // A consulta também grava o histórico; bloqueia chamadas de outros sites.
    bi_same_origin($config);
    $today = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d');
    $parameters = ['inicio' => $today, 'fim' => $today, 'tipo' => null];
    $body = bi_fetch_upstream(bi_upstream_url($config, $parameters), $config);
    bi_validate_upstream($body, $parameters);
    $current = bi_orders_current(bi_decode($body, 'Resposta da API'));
    $history = clone bi_orders_transaction(__DIR__ . '/../data/orders.json', $current);
    unset($history->seen);
    bi_json(['current' => $current, 'history' => $history]);
});
