<?php
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

function bi_proxy_parameters(array $query): array
{
    foreach (array_keys($query) as $key) {
        if (!in_array($key, ['inicio', 'fim', 'tipo'], true)) {
            bi_fail(400, 'unexpected_parameter', 'A consulta aceita apenas inicio, fim e tipo=outros.');
        }
    }
    $inicio = bi_date($query['inicio'] ?? null, 'inicio');
    $fim = bi_date($query['fim'] ?? null, 'fim');
    if ($inicio > $fim) {
        bi_fail(422, 'invalid_period', 'A data inicial deve ser anterior ou igual à data final.');
    }
    $first = new DateTimeImmutable($inicio, new DateTimeZone('UTC'));
    $last = new DateTimeImmutable($fim, new DateTimeZone('UTC'));
    if ((int) $first->diff($last)->days > 3660) {
        bi_fail(422, 'period_too_long', 'Consulte um período de até dez anos por vez.');
    }
    $tipo = $query['tipo'] ?? null;
    if ($tipo !== null && $tipo !== 'outros') {
        bi_fail(400, 'invalid_type', 'O único tipo adicional disponível é outros.');
    }
    return ['inicio' => $inicio, 'fim' => $fim, 'tipo' => $tipo];
}

function bi_upstream_url(array $config, array $parameters): string
{
    // O destino vem exclusivamente do arquivo local de configuração, nunca da
    // URL enviada pelo navegador. Redirecionamentos também são bloqueados.
    $base = $config['api_url'] ?? '';
    if (!is_string($base)) {
        bi_fail(500, 'invalid_upstream_config', 'O endereço fixo da API não está configurado corretamente.');
    }
    $parts = parse_url($base);
    if (!$parts || !isset($parts['scheme'], $parts['host']) || !in_array(strtolower($parts['scheme']), ['http', 'https'], true) || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) {
        bi_fail(500, 'invalid_upstream_config', 'O endereço fixo da API não está configurado corretamente.');
    }
    return rtrim($base, '/') . ($parameters['tipo'] === 'outros' ? '/outros' : '') . '?' . http_build_query(['inicio' => $parameters['inicio'], 'fim' => $parameters['fim']], '', '&', PHP_QUERY_RFC3986);
}

/** @param resource $stream */
function bi_read_upstream_stream($stream, int $timeout, int $maxBytes, $startedAt): string
{
    $body = '';
    while (!feof($stream)) {
        $remaining = $timeout - (hrtime(true) - $startedAt) / 1000000000;
        if ($remaining <= 0) {
            bi_fail(504, 'upstream_timeout', 'A API demorou demais para responder. Tente novamente.');
        }
        stream_set_timeout($stream, max(1, (int) ceil($remaining)));
        $chunk = fread($stream, min(65536, $maxBytes - strlen($body) + 1));
        $metadata = stream_get_meta_data($stream);
        if ((hrtime(true) - $startedAt) / 1000000000 >= $timeout) {
            bi_fail(504, 'upstream_timeout', 'A API demorou demais para responder. Tente novamente.');
        }
        if (($chunk === false || $chunk === '') && ($metadata['timed_out'] ?? false) && !feof($stream)) {
            bi_fail(504, 'upstream_timeout', 'A API demorou demais para responder. Tente novamente.');
        }
        if ($chunk === false) {
            bi_fail(502, 'upstream_read_failed', 'O servidor PHP não conseguiu concluir a leitura da API.');
        }
        if ($chunk !== '') {
            // PHP on Windows can mark a successful partial read as timed_out.
            // Continue while bytes arrive within the monotonic overall deadline.
            $body .= $chunk;
            if (strlen($body) > $maxBytes) {
                bi_fail(502, 'upstream_too_large', 'A resposta da API ultrapassou o limite configurado.');
            }
            continue;
        }
        if (feof($stream)) {
            break;
        }
        bi_fail(502, 'upstream_read_failed', 'A conexão com a API foi interrompida antes de concluir a resposta.');
    }
    return $body;
}

function bi_fetch_upstream(string $url, array $config): string
{
    $timeout = max(1, min(60, (int) ($config['timeout_seconds'] ?? 25)));
    $connectTimeout = max(1, min($timeout, (int) ($config['connect_timeout_seconds'] ?? 5)));
    $maxBytes = max(1024, min(32 * 1024 * 1024, (int) ($config['max_response_bytes'] ?? 16 * 1024 * 1024)));
    $body = '';
    $status = 0;
    if (function_exists('curl_init')) {
        $handle = curl_init($url);
        if ($handle === false) {
            bi_fail(503, 'http_transport_unavailable', 'O PHP não conseguiu iniciar o transporte HTTP para a API.');
        }
        $tooLarge = false;
        try {
            $options = [
                CURLOPT_HTTPGET => true,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_CONNECTTIMEOUT => $connectTimeout,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_HTTPHEADER => ['Accept: application/json'],
                CURLOPT_ENCODING => '',
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_WRITEFUNCTION => static function ($unused, string $chunk) use (&$body, &$tooLarge, $maxBytes): int {
                    if (strlen($body) + strlen($chunk) > $maxBytes) {
                        $tooLarge = true;
                        return 0;
                    }
                    $body .= $chunk;
                    return strlen($chunk);
                },
            ];
            if (defined('CURLOPT_PROTOCOLS') && defined('CURLPROTO_HTTP') && defined('CURLPROTO_HTTPS')) {
                $options[CURLOPT_PROTOCOLS] = CURLPROTO_HTTP | CURLPROTO_HTTPS;
            }
            if (!curl_setopt_array($handle, $options)) {
                bi_fail(503, 'http_transport_unavailable', 'O PHP não conseguiu configurar o transporte HTTP para a API.');
            }
            $ok = curl_exec($handle);
            $errorNumber = curl_errno($handle);
            $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
            if ($tooLarge) {
                bi_fail(502, 'upstream_too_large', 'A resposta da API ultrapassou o limite configurado.');
            }
            if ($ok === false) {
                bi_fail($errorNumber === 28 ? 504 : 502, $errorNumber === 28 ? 'upstream_timeout' : 'upstream_unreachable', $errorNumber === 28 ? 'A API demorou demais para responder. Tente novamente.' : 'O servidor PHP não conseguiu acessar a API da empresa. Verifique a conexão com a rede e o endereço em api/config.php.');
            }
        } finally {
            curl_close($handle);
        }
    } else {
        if (!filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN)) {
            bi_fail(503, 'http_transport_unavailable', 'O PHP precisa da extensão cURL ou de allow_url_fopen habilitado para consultar a API.');
        }
        $started = hrtime(true);
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => "Accept: application/json\r\nConnection: close\r\n",
                'timeout' => $timeout,
                'ignore_errors' => true,
                'follow_location' => 0,
                'max_redirects' => 0,
                'protocol_version' => 1.1,
            ],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);
        $stream = @fopen($url, 'rb', false, $context);
        if ($stream === false) {
            bi_fail(502, 'upstream_unreachable', 'O servidor PHP não conseguiu acessar a API da empresa. Verifique a conexão com a rede e o endereço em api/config.php.');
        }
        try {
            foreach (($http_response_header ?? []) as $header) {
                if (preg_match('/^HTTP\/\S+\s+(\d{3})\b/i', $header, $match)) {
                    $status = (int) $match[1];
                }
            }
            $body = bi_read_upstream_stream($stream, $timeout, $maxBytes, $started);
        } finally {
            fclose($stream);
        }
    }
    if ($status < 200 || $status >= 300) {
        bi_fail(502, 'upstream_http_error', 'A API da empresa retornou uma resposta HTTP sem sucesso.', ['upstreamStatus' => $status]);
    }
    if (str_starts_with($body, "\xEF\xBB\xBF")) {
        $body = substr($body, 3);
    }
    return $body;
}

function bi_validate_upstream(string $body, array $parameters): void
{
    try {
        $data = bi_decode($body, 'Resposta da API');
    } catch (BiHttpError $error) {
        bi_fail(502, 'upstream_invalid_json', 'A API da empresa retornou conteúdo que não é um JSON válido.');
    }
    $collection = $parameters['tipo'] === 'outros' ? 'produtos' : 'clientes';
    if (!$data instanceof stdClass || !isset($data->$collection) || !is_array($data->$collection) || ($data->inicio ?? null) !== $parameters['inicio'] || ($data->fim ?? null) !== $parameters['fim']) {
        bi_fail(502, 'upstream_invalid_response', 'A resposta da API não corresponde ao período ou ao formato solicitado.');
    }
}
