<?php
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

const BI_MAX_CATALOG_CLIENTS = 10000;
const BI_MAX_GOALS = 5000;

function bi_planning_timestamp($value, string $label): void
{
    if ($value !== null && (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/D', $value))) {
        bi_fail(422, 'invalid_timestamp', $label . ' contém uma data de atualização inválida.');
    }
}

function bi_planning_id($value, string $label): string
{
    $value = bi_text($value, $label, 100, true);
    if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,99}$/D', $value)) {
        bi_fail(422, 'invalid_id', $label . ' contém um identificador inválido.');
    }
    return $value;
}

function bi_validate_client_catalog($data): ?stdClass
{
    if ($data === null) { return null; }
    bi_fields($data, ['source', 'clients'], 'Base de clientes');
    bi_fields($data->source, ['name', 'importedAt', 'rowCount'], 'Origem da base');
    $result = clone $data;
    $result->source = clone $data->source;
    $result->source->name = bi_text($data->source->name, 'Nome do arquivo', 500, true);
    bi_planning_timestamp($data->source->importedAt, 'Origem da base');
    if (!is_array($data->clients) || !bi_is_list($data->clients) || count($data->clients) < 1 || count($data->clients) > BI_MAX_CATALOG_CLIENTS) {
        bi_fail(422, 'invalid_catalog', 'A base deve conter entre 1 e 10.000 clientes.');
    }
    if (!is_int($data->source->rowCount) || $data->source->rowCount !== count($data->clients)) {
        bi_fail(422, 'invalid_catalog_count', 'A quantidade informada não corresponde à base de clientes.');
    }
    $seen = [];
    $result->clients = [];
    foreach ($data->clients as $index => $client) {
        $label = 'Cliente ' . ($index + 1);
        bi_fields($client, ['code', 'name', 'fantasy', 'city', 'uf', 'rep', 'repCode', 'status'], $label);
        $item = clone $client;
        $item->code = bi_code($client->code, $label . '.code');
        if (isset($seen[$item->code])) { bi_fail(422, 'duplicate_client', 'A base contém código de cliente repetido.'); }
        $seen[$item->code] = true;
        foreach (['name', 'fantasy', 'city', 'uf', 'rep', 'status'] as $field) {
            $item->$field = bi_text($client->$field, $label . '.' . $field, $field === 'uf' ? 2 : 500, in_array($field, ['name', 'city', 'uf'], true));
        }
        $item->uf = strtoupper($item->uf);
        if (!in_array($item->uf, ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'], true)) {
            bi_fail(422, 'invalid_uf', $label . ' contém UF inválida.');
        }
        if (!preg_match('~ / ' . preg_quote($item->uf, '~') . '$~D', $item->city)) {
            bi_fail(422, 'invalid_city', $label . ' deve informar a cidade no formato Cidade / UF.');
        }
        $item->repCode = $client->repCode === '' ? '' : bi_code($client->repCode, $label . '.repCode');
        $result->clients[] = $item;
    }
    return $result;
}

function bi_validate_planning($data): stdClass
{
    bi_fields($data, ['schemaVersion', 'revision', 'updatedAt', 'goals', 'clientCatalog'], 'Planejamento comercial');
    if ($data->schemaVersion !== 1) { bi_fail(422, 'unsupported_schema', 'A versão do planejamento não é compatível.'); }
    bi_revision($data->revision);
    bi_planning_timestamp($data->updatedAt, 'Planejamento comercial');
    if (!is_array($data->goals) || !bi_is_list($data->goals) || count($data->goals) > BI_MAX_GOALS) {
        bi_fail(422, 'invalid_goals', 'As metas devem ser uma lista de até 5.000 registros.');
    }
    $result = clone $data;
    $result->goals = [];
    $ids = $keys = [];
    foreach ($data->goals as $index => $goal) {
        $label = 'Meta ' . ($index + 1);
        bi_fields($goal, ['id', 'topRetailerId', 'month', 'metric', 'categories'], $label);
        $item = clone $goal;
        $item->id = bi_planning_id($goal->id, $label . '.id');
        $item->topRetailerId = bi_planning_id($goal->topRetailerId, $label . '.topRetailerId');
        if (!is_string($goal->month) || !preg_match('/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/D', $goal->month)) {
            bi_fail(422, 'invalid_month', $label . ' deve informar um mês válido.');
        }
        if (!in_array($goal->metric, ['sales', 'fardos'], true)) { bi_fail(422, 'invalid_metric', $label . ' contém unidade inválida.'); }
        $key = $item->topRetailerId . '|' . $goal->month . '|' . $goal->metric;
        if (isset($ids[$item->id]) || isset($keys[$key])) { bi_fail(422, 'duplicate_goal', 'Já existe uma meta para esse participante, mês e unidade.'); }
        $ids[$item->id] = $keys[$key] = true;
        bi_fields($goal->categories, ['Arroz', 'Flocão', 'Salgadinho'], $label . '.categories');
        $item->categories = clone $goal->categories;
        $scale = $goal->metric === 'sales' ? 100 : 1;
        $sum = 0;
        foreach (['Arroz', 'Flocão', 'Salgadinho'] as $category) {
            $value = $goal->categories->$category;
            if ((!is_int($value) && !is_float($value)) || !is_finite((float) $value) || $value < 0 || $value > 1000000000000 || abs($value * $scale - round($value * $scale)) > 0.0001) {
                bi_fail(422, 'invalid_goal_value', $label . ' contém valor inválido; use reais com até dois decimais ou fardos inteiros.');
            }
            $canonical = round($value * $scale) / $scale;
            $item->categories->$category = $canonical;
            $sum += $canonical;
        }
        if ($sum <= 0) { bi_fail(422, 'empty_goal', 'Informe ao menos uma categoria com meta maior que zero.'); }
        $result->goals[] = $item;
    }
    $result->clientCatalog = bi_validate_client_catalog($data->clientCatalog);
    return $result;
}

function bi_read_planning(string $path): stdClass
{
    clearstatcache(true, $path);
    if (!is_file($path) || !is_readable($path)) { bi_fail(503, 'planning_unavailable', 'O arquivo de metas e base de clientes não está disponível para leitura.'); }
    if (filesize($path) === false || filesize($path) > BI_MAX_JSON_BYTES) { bi_fail(500, 'planning_too_large', 'O planejamento ultrapassa o limite de 4 MB.'); }
    $content = @file_get_contents($path);
    if ($content === false || strlen($content) > BI_MAX_JSON_BYTES) { bi_fail(500, 'planning_read_failed', 'Não foi possível ler o planejamento comercial.'); }
    try { return bi_validate_planning(bi_decode($content, 'Planejamento comercial')); }
    catch (BiHttpError $error) { bi_fail(500, 'planning_invalid', 'O planejamento armazenado está inválido. A gravação foi bloqueada para preservar o arquivo.'); }
}

function bi_validate_goal_membership(stdClass $candidate, stdClass $current, array $topRetailerIds): void
{
    $known = array_fill_keys($topRetailerIds, true);
    $old = [];
    foreach ($current->goals as $goal) { $old[$goal->id] = $goal; }
    foreach ($candidate->goals as $goal) {
        // A participant may be removed after a goal was recorded. Preserve that
        // historical goal on unrelated saves, while blocking new or edited
        // goals for customers who are not currently in the Top program.
        if (!isset($known[$goal->topRetailerId]) && (!isset($old[$goal->id]) || $old[$goal->id] != $goal)) {
            bi_fail(422, 'unknown_top_retailer', 'A meta deve pertencer a um participante cadastrado no Top Varejista. Recarregue os cadastros antes de salvar.');
        }
    }
}

function bi_planning_transaction(string $path, ?stdClass $candidate = null, ?int $baseRevision = null, ?array $topRetailerIds = null): stdClass
{
    $write = $candidate !== null;
    if ($write) { $candidate = bi_validate_planning($candidate); bi_revision($baseRevision); }
    $lock = @fopen(dirname($path) . '/.planning.lock', 'c');
    if ($lock === false) { bi_fail(500, 'planning_lock_failed', 'O PHP não conseguiu abrir o controle de gravação do planejamento.'); }
    try {
        bi_acquire_lock($lock, $write);
        $current = bi_read_planning($path);
        if (!$write) { return $current; }
        if ($baseRevision !== $current->revision) { bi_fail(409, 'revision_conflict', 'Outra pessoa alterou as metas ou a base. Recarregue antes de salvar novamente.', ['currentRevision' => $current->revision]); }
        if ($topRetailerIds !== null) { bi_validate_goal_membership($candidate, $current, $topRetailerIds); }
        if ($current->revision >= BI_MAX_REVISION) { bi_fail(500, 'revision_limit', 'O contador de revisões atingiu o limite.'); }
        $candidate->revision = $current->revision + 1;
        $candidate->updatedAt = gmdate('Y-m-d\TH:i:s\Z');
        bi_write_atomic($path, $candidate);
        return $candidate;
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}
