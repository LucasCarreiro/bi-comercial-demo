<?php
declare(strict_types=1);
require_once __DIR__ . '/planning_helpers.php';

bi_endpoint(function (): void {
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if (!in_array($method, ['GET', 'PUT'], true)) {
        header('Allow: GET, PUT'); bi_fail(405, 'method_not_allowed', 'Use GET para consultar ou PUT para salvar o planejamento.');
    }
    if ($_GET) { bi_fail(400, 'unexpected_query', 'O planejamento não recebe parâmetros.'); }
    $candidate = $baseRevision = null;
    if ($method === 'PUT') {
        bi_same_origin(bi_config());
        $contentType = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
        if ($contentType !== 'application/json') { bi_fail(415, 'json_required', 'A gravação deve enviar conteúdo application/json.'); }
        if (isset($_SERVER['CONTENT_LENGTH']) && (!ctype_digit((string) $_SERVER['CONTENT_LENGTH']) || (float) $_SERVER['CONTENT_LENGTH'] > BI_MAX_JSON_BYTES)) { bi_fail(413, 'request_too_large', 'O envio ultrapassa o limite de 4 MB.'); }
        $body = file_get_contents('php://input', false, null, 0, BI_MAX_JSON_BYTES + 1);
        if ($body === false || strlen($body) > BI_MAX_JSON_BYTES) { bi_fail(413, 'request_too_large', 'O envio ultrapassa o limite de 4 MB.'); }
        $request = bi_decode($body, 'Conteúdo enviado');
        bi_fields($request, ['baseRevision', 'data'], 'Gravação');
        $baseRevision = bi_revision($request->baseRevision);
        $candidate = bi_validate_planning($request->data);
    }
    $topRetailerIds = null;
    if ($candidate !== null) {
        $auxiliary = bi_auxiliary_transaction(__DIR__ . '/../data/auxiliary.json');
        $topRetailerIds = array_map(static fn(stdClass $row): string => $row->id, $auxiliary->topRetailers);
    }
    bi_json(bi_planning_transaction(__DIR__ . '/../data/planning.json', $candidate, $baseRevision, $topRetailerIds));
});
