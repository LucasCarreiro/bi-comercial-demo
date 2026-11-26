<?php
declare(strict_types=1);
require_once __DIR__ . '/upstream.php';

bi_endpoint(function (): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        header('Allow: GET');
        bi_fail(405, 'method_not_allowed', 'A consulta comercial aceita apenas GET.');
    }
    $parameters = bi_proxy_parameters($_GET);
    $config = bi_config();
    $url = bi_upstream_url($config, $parameters);
    $body = bi_fetch_upstream($url, $config);
    bi_validate_upstream($body, $parameters);
    // A resposta original evita alterações nos números recebidos da API.
    bi_headers();
    echo $body;
});
