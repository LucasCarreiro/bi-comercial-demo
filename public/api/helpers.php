<?php
declare(strict_types=1);

const BI_MAX_JSON_BYTES = 4194304;
const BI_MAX_RECORDS = 5000;
const BI_MAX_REVISION = 2147483646;

final class BiHttpError extends RuntimeException
{
    public int $status;
    public string $errorCode;
    public array $details;

    public function __construct(int $status, string $errorCode, string $message, array $details = [])
    {
        parent::__construct($message);
        $this->status = $status;
        $this->errorCode = $errorCode;
        $this->details = $details;
    }
}

function bi_fail(int $status, string $code, string $message, array $details = []): void
{
    throw new BiHttpError($status, $code, $message, $details);
}

function bi_headers(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
}

function bi_json($value, int $status = 200): void
{
    http_response_code($status);
    bi_headers();
    echo json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function bi_endpoint(callable $handler): void
{
    // Erros internos nunca devem ser incorporados ao JSON como HTML do PHP.
    ini_set('display_errors', '0');
    try {
        $handler();
    } catch (BiHttpError $error) {
        bi_json(array_merge([
            'error' => ['code' => $error->errorCode, 'message' => $error->getMessage()],
            'message' => $error->getMessage(),
        ], $error->details), $error->status);
    } catch (Throwable $error) {
        // Não registrar corpo da requisição nem dados comerciais.
        error_log('BI Comercial: falha interna em endpoint PHP (' . get_class($error) . ').');
        bi_json(['error' => ['code' => 'internal_error', 'message' => 'O servidor não conseguiu concluir a operação. Verifique a configuração e as permissões do PHP.'], 'message' => 'O servidor não conseguiu concluir a operação. Verifique a configuração e as permissões do PHP.'], 500);
    }
}

function bi_config(): array
{
    $config = require __DIR__ . '/config.php';
    if (!is_array($config)) {
        bi_fail(500, 'invalid_config', 'A configuração do PHP é inválida.');
    }
    return $config;
}

function bi_is_list(array $value): bool
{
    // Compatível com PHP 8.0, sem depender de array_is_list (PHP 8.1).
    $index = 0;
    foreach ($value as $key => $unused) {
        if ($key !== $index++) {
            return false;
        }
    }
    return true;
}

function bi_decode(string $json, string $context = 'JSON')
{
    try {
        return json_decode($json, false, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException $error) {
        bi_fail(422, 'invalid_json', $context . ' inválido.');
    }
}

function bi_fields($value, array $fields, string $label): void
{
    if (!$value instanceof stdClass) {
        bi_fail(422, 'invalid_schema', $label . ' deve ser um objeto.');
    }
    $actual = array_keys(get_object_vars($value));
    sort($actual);
    sort($fields);
    if ($actual !== $fields) {
        bi_fail(422, 'invalid_schema', $label . ' contém campos ausentes ou não reconhecidos.');
    }
}

function bi_text($value, string $label, int $maxBytes, bool $required = false): string
{
    if (!is_string($value) || strlen($value) > $maxBytes || preg_match('//u', $value) !== 1 || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $value)) {
        bi_fail(422, 'invalid_text', $label . ' contém texto inválido ou muito longo.');
    }
    $result = trim($value);
    if ($required && $result === '') {
        bi_fail(422, 'required_field', 'Preencha ' . $label . '.');
    }
    return $result;
}

function bi_code($value, string $label): string
{
    if (!is_string($value) || !preg_match('/^[0-9]{1,30}$/D', $value)) {
        bi_fail(422, 'invalid_code', $label . ' deve conter apenas números, em formato de texto.');
    }
    $result = ltrim($value, '0');
    return $result === '' ? '0' : $result;
}

function bi_codes($value, string $label): array
{
    if (!is_array($value) || !bi_is_list($value) || count($value) > BI_MAX_RECORDS) {
        bi_fail(422, 'invalid_codes', $label . ' deve ser uma lista de até 5.000 códigos.');
    }
    $result = [];
    $seen = [];
    foreach ($value as $item) {
        $code = bi_code($item, $label);
        if (isset($seen[$code])) {
            bi_fail(422, 'duplicate_code', $label . ' contém o código repetido ' . $code . '.');
        }
        $seen[$code] = true;
        $result[] = $code;
    }
    return $result;
}

function bi_name_key(string $value): string
{
    $value = strtr($value, [
        'á'=>'a','à'=>'a','â'=>'a','ã'=>'a','ä'=>'a','Á'=>'A','À'=>'A','Â'=>'A','Ã'=>'A','Ä'=>'A',
        'é'=>'e','è'=>'e','ê'=>'e','ë'=>'e','É'=>'E','È'=>'E','Ê'=>'E','Ë'=>'E',
        'í'=>'i','ì'=>'i','î'=>'i','ï'=>'i','Í'=>'I','Ì'=>'I','Î'=>'I','Ï'=>'I',
        'ó'=>'o','ò'=>'o','ô'=>'o','õ'=>'o','ö'=>'o','Ó'=>'O','Ò'=>'O','Ô'=>'O','Õ'=>'O','Ö'=>'O',
        'ú'=>'u','ù'=>'u','û'=>'u','ü'=>'u','Ú'=>'U','Ù'=>'U','Û'=>'U','Ü'=>'U','ç'=>'c','Ç'=>'C','ñ'=>'n','Ñ'=>'N',
    ]);
    return trim((string) preg_replace('/[^A-Z0-9]+/', ' ', strtoupper($value)));
}

function bi_patterns($value, string $label): array
{
    if (!is_array($value) || !bi_is_list($value) || count($value) > 100) {
        bi_fail(422, 'invalid_patterns', $label . ' deve ser uma lista de até 100 padrões.');
    }
    $result = [];
    foreach ($value as $pattern) {
        // Validar sem remover espaços literais que fazem parte da expressão.
        bi_text($pattern, $label, 300, true);
        if ($pattern[0] !== '^' || @preg_match(chr(31) . $pattern . chr(31) . 'u', '') === false) {
            bi_fail(422, 'invalid_pattern', $label . ' contém expressão inválida ou sem início ancorado (^).');
        }
        // Somente o subconjunto compartilhado pelas regras de nomes em PHP/JS.
        // Modificadores PCRE poderiam ser aceitos aqui e falhar no navegador.
        if (preg_match('/\(\?(?!:)/', $pattern) || strpos($pattern, '(*') !== false || preg_match('/\\\\(?:[1-9]|[kgpP])/', $pattern)) {
            bi_fail(422, 'invalid_pattern', $label . ' usa recursos incompatíveis com as regras JavaScript. Use nomes ou prefixos simples.');
        }
        if (in_array($pattern, $result, true)) {
            bi_fail(422, 'duplicate_pattern', $label . ' contém expressão repetida.');
        }
        $result[] = $pattern;
    }
    return $result;
}

function bi_date($value, string $label): string
{
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) {
        bi_fail(422, 'invalid_date', $label . ' deve estar no formato AAAA-MM-DD.');
    }
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, new DateTimeZone('UTC'));
    if (!$date || $date->format('Y-m-d') !== $value || (int) substr($value, 0, 4) < 1900 || (int) substr($value, 0, 4) > 2200) {
        bi_fail(422, 'invalid_date', $label . ' contém uma data inválida.');
    }
    return $value;
}

function bi_revision($value): int
{
    if (!is_int($value) || $value < 0 || $value > BI_MAX_REVISION) {
        bi_fail(422, 'invalid_revision', 'A revisão do arquivo é inválida.');
    }
    return $value;
}

function bi_representative_aliases($value): array
{
    if (!is_array($value) || !bi_is_list($value) || count($value) > BI_MAX_RECORDS) {
        bi_fail(422, 'invalid_representative_aliases', 'Os apelidos devem ser uma lista de até 5.000 representantes.');
    }
    $result = [];
    $seen = [];
    foreach ($value as $index => $record) {
        $label = 'representativeAliases[' . $index . ']';
        bi_fields($record, ['code', 'alias'], $label);
        if (!is_string($record->code)) {
            bi_fail(422, 'invalid_code', $label . '.code deve conter apenas números, em formato de texto.');
        }
        // Match JavaScript String.trim exactly; e.g. NEL (U+0085) is not whitespace here.
        $space = '[\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]';
        $trimmedCode = preg_replace('/^' . $space . '+|' . $space . '+$/u', '', $record->code);
        $code = bi_code($trimmedCode, $label . '.code');
        if (isset($seen[$code])) {
            bi_fail(422, 'duplicate_representative_alias', 'O código de representante ' . $code . ' possui mais de um apelido.');
        }
        if (!is_string($record->alias) || preg_match('//u', $record->alias) !== 1 || preg_match('/[\x{0000}-\x{001F}\x{007F}-\x{009F}]/u', $record->alias)) {
            bi_fail(422, 'invalid_representative_alias', $label . '.alias contém texto inválido ou caracteres de controle.');
        }
        $alias = preg_replace('/^' . $space . '+|' . $space . '+$/u', '', $record->alias);
        $length = preg_match_all('/./us', $alias);
        if ($length === false || $length < 1 || $length > 80) {
            bi_fail(422, 'invalid_representative_alias', $label . '.alias deve conter de 1 a 80 caracteres.');
        }
        $seen[$code] = true;
        $result[] = (object) ['code' => $code, 'alias' => $alias];
    }
    return $result;
}

function bi_validate_auxiliary($data): stdClass
{
    $fields = ['schemaVersion', 'revision', 'updatedAt', 'topRetailers', 'largeNetworks', 'clientGroups', 'independentClientCodes', 'independentNames'];
    if ($data instanceof stdClass && property_exists($data, 'representativeAliases')) {
        $fields[] = 'representativeAliases';
    }
    bi_fields($data, $fields, 'Arquivo auxiliar');
    if ($data->schemaVersion !== 1) {
        bi_fail(422, 'unsupported_schema', 'A versão do arquivo auxiliar não é compatível.');
    }
    bi_revision($data->revision);
    if ($data->updatedAt !== null && (!is_string($data->updatedAt) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/D', $data->updatedAt))) {
        bi_fail(422, 'invalid_updated_at', 'A data de atualização é inválida.');
    }
    $recordCount = 0;
    foreach (['topRetailers', 'largeNetworks', 'clientGroups'] as $collection) {
        if (!is_array($data->$collection) || !bi_is_list($data->$collection)) {
            bi_fail(422, 'invalid_collection', $collection . ' deve ser uma lista.');
        }
        $recordCount += count($data->$collection);
    }
    if ($recordCount > BI_MAX_RECORDS) {
        bi_fail(422, 'too_many_records', 'O arquivo comporta até 5.000 cadastros auxiliares.');
    }
    $result = clone $data;
    $result->representativeAliases = bi_representative_aliases(property_exists($data, 'representativeAliases') ? $data->representativeAliases : []);
    foreach (['topRetailers', 'largeNetworks', 'clientGroups'] as $collection) {
        $records = [];
        $seenIds = [];
        $assignedCodes = [];
        foreach ($data->$collection as $index => $record) {
            $label = $collection . '[' . $index . ']';
            $fields = $collection === 'topRetailers'
                ? ['id', 'name', 'clientCodes', 'city', 'rep', 'acceptedAt', 'notes']
                : ($collection === 'largeNetworks'
                    ? ['id', 'name', 'clientCodes', 'namePatterns', 'excludedClientCodes']
                    : ['id', 'name', 'clientCodes', 'namePatterns']);
            bi_fields($record, $fields, $label);
            $item = clone $record;
            $item->id = bi_text($record->id, $label . '.id', 100, true);
            if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,99}$/D', $item->id) || isset($seenIds[$item->id])) {
                bi_fail(422, 'invalid_id', $label . ' contém identificador inválido ou repetido.');
            }
            $seenIds[$item->id] = true;
            $item->name = bi_text($record->name, $label . '.name', 500, true);
            $item->clientCodes = bi_codes($record->clientCodes, $label . '.clientCodes');
            foreach ($item->clientCodes as $code) {
                if (isset($assignedCodes[$code])) {
                    bi_fail(422, 'duplicate_membership', 'O código ' . $code . ' já pertence a outro cadastro de ' . $collection . '.');
                }
                $assignedCodes[$code] = $item->id;
            }
            if ($collection === 'topRetailers') {
                if (!$item->clientCodes) {
                    bi_fail(422, 'required_membership', $label . ' deve informar ao menos um código de cliente.');
                }
                if (in_array('990', $item->clientCodes, true) || preg_match('/^DISTRIBUIDORA PARCEIRA(?: LTDA)?$/D', bi_name_key($item->name))) {
                    bi_fail(422, 'excluded_client', 'DISTRIBUIDORA PARCEIRA LTDA está excluída da lista Top Varejista e das análises.');
                }
                $item->city = bi_text($record->city, $label . '.city', 500);
                $item->rep = bi_text($record->rep, $label . '.rep', 500);
                $item->acceptedAt = bi_date($record->acceptedAt, $label . '.acceptedAt');
                $item->notes = bi_text($record->notes, $label . '.notes', 12000);
            } else {
                $item->namePatterns = bi_patterns($record->namePatterns, $label . '.namePatterns');
                if (!$item->clientCodes && !$item->namePatterns) {
                    bi_fail(422, 'required_membership', $label . ' precisa de um código ou de uma regra de nome.');
                }
                if ($collection === 'largeNetworks') {
                    $item->excludedClientCodes = bi_codes($record->excludedClientCodes, $label . '.excludedClientCodes');
                    if (array_intersect($item->clientCodes, $item->excludedClientCodes)) {
                        bi_fail(422, 'contradictory_membership', $label . ' inclui e exclui o mesmo código.');
                    }
                }
            }
            $records[] = $item;
        }
        $result->$collection = $records;
    }
    $result->independentClientCodes = bi_codes($data->independentClientCodes, 'independentClientCodes');
    if (!is_array($data->independentNames) || !bi_is_list($data->independentNames) || count($data->independentNames) > BI_MAX_RECORDS) {
        bi_fail(422, 'invalid_independents', 'independentNames deve ser uma lista de até 5.000 nomes.');
    }
    $result->independentNames = [];
    foreach ($data->independentNames as $name) {
        $name = bi_name_key(bi_text($name, 'independentNames', 500, true));
        if ($name === '' || in_array($name, $result->independentNames, true)) {
            bi_fail(422, 'duplicate_independent', 'A lista de independentes contém nome vazio ou repetido.');
        }
        $result->independentNames[] = $name;
    }
    return $result;
}

function bi_origin_key(string $value): ?string
{
    $parts = parse_url($value);
    if (!$parts || !isset($parts['scheme'], $parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment']) || (isset($parts['path']) && $parts['path'] !== '' && $parts['path'] !== '/')) {
        return null;
    }
    $scheme = strtolower($parts['scheme']);
    if ($scheme !== 'http' && $scheme !== 'https') {
        return null;
    }
    $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
    return $scheme . '://' . strtolower($parts['host']) . ':' . $port;
}

function bi_same_origin(array $config): void
{
    $siteOrigin = $config['site_origin'] ?? '';
    if ($siteOrigin === '') {
        $scheme = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') ? 'https' : 'http';
        $siteOrigin = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? '');
    }
    $expected = bi_origin_key((string) $siteOrigin);
    if ($expected === null) {
        bi_fail(500, 'invalid_origin_config', 'A origem do site não pôde ser determinada. A TI deve revisar site_origin em api/config.php.');
    }
    if (isset($_SERVER['HTTP_ORIGIN']) && bi_origin_key((string) $_SERVER['HTTP_ORIGIN']) !== $expected) {
        bi_fail(403, 'origin_not_allowed', 'A gravação deve ser feita a partir do próprio site.');
    }
    if (isset($_SERVER['HTTP_SEC_FETCH_SITE']) && !in_array(strtolower((string) $_SERVER['HTTP_SEC_FETCH_SITE']), ['same-origin', 'none'], true)) {
        bi_fail(403, 'origin_not_allowed', 'A gravação deve ser feita a partir do próprio site.');
    }
}

function bi_read_auxiliary(string $path): stdClass
{
    clearstatcache(true, $path);
    if (!is_file($path) || !is_readable($path)) {
        bi_fail(503, 'auxiliary_unavailable', 'O JSON auxiliar não está disponível para leitura. Verifique public/data/auxiliary.json e suas permissões.');
    }
    $size = filesize($path);
    if ($size === false || $size > BI_MAX_JSON_BYTES) {
        bi_fail(500, 'auxiliary_too_large', 'O JSON auxiliar ultrapassa o limite de 4 MB.');
    }
    $content = @file_get_contents($path);
    if ($content === false) {
        bi_fail(500, 'auxiliary_read_failed', 'Não foi possível ler o JSON auxiliar.');
    }
    if (strlen($content) > BI_MAX_JSON_BYTES) {
        bi_fail(500, 'auxiliary_too_large', 'O JSON auxiliar ultrapassa o limite de 4 MB.');
    }
    try {
        return bi_validate_auxiliary(bi_decode($content, 'Arquivo auxiliar'));
    } catch (BiHttpError $error) {
        bi_fail(500, 'auxiliary_invalid', 'O JSON auxiliar armazenado está inválido. A gravação foi bloqueada para preservar o arquivo.');
    }
}

function bi_acquire_lock($lock, bool $exclusive): void
{
    $started = microtime(true);
    do {
        if (flock($lock, ($exclusive ? LOCK_EX : LOCK_SH) | LOCK_NB)) {
            return;
        }
        usleep(25000);
    } while (microtime(true) - $started < 5);
    bi_fail(503, 'auxiliary_busy', 'O arquivo auxiliar está ocupado. Tente novamente.');
}

function bi_write_atomic(string $path, stdClass $data): void
{
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
    if (strlen($json) > BI_MAX_JSON_BYTES) {
        bi_fail(422, 'auxiliary_too_large', 'O JSON auxiliar ultrapassa o limite de 4 MB.');
    }
    $temporary = @tempnam(dirname($path), '.auxiliary-');
    if ($temporary === false) {
        bi_fail(500, 'auxiliary_write_failed', 'O PHP não conseguiu criar um arquivo temporário em public/data. Verifique a permissão de escrita da pasta.');
    }
    if (realpath(dirname($temporary)) !== realpath(dirname($path))) {
        @unlink($temporary);
        bi_fail(500, 'auxiliary_write_failed', 'O PHP não conseguiu criar o arquivo temporário na pasta public/data. Verifique a permissão de escrita.');
    }
    $stream = null;
    try {
        $stream = @fopen($temporary, 'wb');
        if ($stream === false) {
            bi_fail(500, 'auxiliary_write_failed', 'Não foi possível preparar a gravação do JSON auxiliar.');
        }
        $offset = 0;
        while ($offset < strlen($json)) {
            $written = fwrite($stream, substr($json, $offset));
            if ($written === false || $written === 0) {
                bi_fail(500, 'auxiliary_write_failed', 'Não foi possível concluir a gravação do JSON auxiliar.');
            }
            $offset += $written;
        }
        if (!fflush($stream) || (function_exists('fsync') && !fsync($stream))) {
            bi_fail(500, 'auxiliary_write_failed', 'O servidor não confirmou a gravação do JSON auxiliar.');
        }
        fclose($stream);
        $stream = null;
        @chmod($temporary, 0660);
        if (!@rename($temporary, $path)) {
            bi_fail(500, 'auxiliary_write_failed', 'O PHP não conseguiu substituir o JSON auxiliar. O arquivo anterior foi preservado; verifique as permissões de public/data.');
        }
    } finally {
        if (is_resource($stream)) {
            fclose($stream);
        }
        if (is_file($temporary)) {
            @unlink($temporary);
        }
    }
}

function bi_auxiliary_transaction(string $path, ?stdClass $candidate = null, ?int $baseRevision = null): stdClass
{
    $write = $candidate !== null;
    if ($write) {
        $candidate = bi_validate_auxiliary($candidate);
        bi_revision($baseRevision);
    }
    $lock = @fopen(dirname($path) . '/.auxiliary.lock', 'c');
    if ($lock === false) {
        bi_fail(500, 'auxiliary_lock_failed', 'O PHP não conseguiu abrir o controle de gravação em public/data. Verifique a permissão da pasta.');
    }
    try {
        bi_acquire_lock($lock, $write);
        $current = bi_read_auxiliary($path);
        if (!$write) {
            return $current;
        }
        if ($baseRevision !== $current->revision) {
            bi_fail(409, 'revision_conflict', 'Outra pessoa atualizou o arquivo. Recarregue os cadastros antes de salvar novamente.', ['currentRevision' => $current->revision]);
        }
        if ($current->revision >= BI_MAX_REVISION) {
            bi_fail(500, 'revision_limit', 'O contador de revisões atingiu o limite. Solicite uma revisão do arquivo pela TI.');
        }
        $candidate->revision = $current->revision + 1;
        $candidate->updatedAt = gmdate('Y-m-d\TH:i:s\Z');
        bi_write_atomic($path, $candidate);
        return $candidate;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
