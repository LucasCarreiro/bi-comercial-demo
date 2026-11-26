<?php
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

bi_endpoint(function (): void {
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if ($method !== 'GET' && $method !== 'PUT') {
        header('Allow: GET, PUT');
        bi_fail(405, 'method_not_allowed', 'Use GET para consultar ou PUT para salvar o JSON auxiliar.');
    }
    if ($_GET) {
        bi_fail(400, 'unexpected_query', 'A consulta do JSON auxiliar não recebe parâmetros.');
    }
    $candidate = null;
    $baseRevision = null;
    if ($method === 'PUT') {
        bi_same_origin(bi_config());
        $contentType = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
        if ($contentType !== 'application/json') {
            bi_fail(415, 'json_required', 'A gravação deve enviar conteúdo application/json.');
        }
        if (isset($_SERVER['CONTENT_LENGTH']) && (!ctype_digit((string) $_SERVER['CONTENT_LENGTH']) || (float) $_SERVER['CONTENT_LENGTH'] > BI_MAX_JSON_BYTES)) {
            bi_fail(413, 'request_too_large', 'O envio ultrapassa o limite de 4 MB.');
        }
        $body = file_get_contents('php://input', false, null, 0, BI_MAX_JSON_BYTES + 1);
        if ($body === false || strlen($body) > BI_MAX_JSON_BYTES) {
            bi_fail(413, 'request_too_large', 'Não foi possível receber o JSON dentro do limite de 4 MB.');
        }
        $request = bi_decode($body, 'Conteúdo enviado');
        bi_fields($request, ['baseRevision', 'data'], 'Gravação');
        $baseRevision = bi_revision($request->baseRevision);
        $candidate = bi_validate_auxiliary($request->data);
    }
    $path = __DIR__ . '/../data/auxiliary.json';
    bi_json(bi_auxiliary_transaction($path, $candidate, $baseRevision));
});
