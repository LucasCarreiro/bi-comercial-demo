<?php
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

/** One exact customer code per request; no bulk contact response or name search. */
function bi_read_client_contact(string $path, string $code): stdClass
{
    clearstatcache(true, $path);
    if (!is_file($path) || !is_readable($path)) {
        bi_fail(503, 'contacts_unavailable', 'A base de contatos ainda não está disponível.');
    }
    $size = filesize($path);
    if ($size === false || $size > BI_MAX_JSON_BYTES) {
        bi_fail(503, 'contacts_invalid', 'A base de contatos não pôde ser consultada.');
    }
    $content = @file_get_contents($path);
    if ($content === false || strlen($content) > BI_MAX_JSON_BYTES) {
        bi_fail(503, 'contacts_unavailable', 'Não foi possível ler a base de contatos.');
    }
    try {
        $data = bi_decode($content, 'Base de contatos');
        bi_fields($data, ['schemaVersion', 'source', 'contacts'], 'Base de contatos');
        if ($data->schemaVersion !== 1 || !$data->contacts instanceof stdClass || count(get_object_vars($data->contacts)) > 10000) {
            bi_fail(503, 'contacts_invalid', 'A base de contatos não pôde ser consultada.');
        }
        bi_fields($data->source, ['name', 'modifiedAt', 'importedAt'], 'Origem dos contatos');
        foreach (['name', 'modifiedAt', 'importedAt'] as $field) {
            bi_text($data->source->$field, 'Origem dos contatos', 500, true);
        }
        if (!property_exists($data->contacts, $code)) {
            bi_fail(404, 'contact_not_found', 'Endereço e telefone não encontrados no cadastro para este código.');
        }
        $contact = $data->contacts->$code;
        bi_fields($contact, ['code', 'address', 'number', 'neighborhood', 'postalCode', 'city', 'uf', 'phones'], 'Contato');
        if (bi_code($contact->code, 'Código do contato') !== $code) {
            bi_fail(503, 'contacts_invalid', 'O código do contato não corresponde à consulta.');
        }
        foreach (['address', 'number', 'neighborhood', 'postalCode', 'city', 'uf'] as $field) {
            bi_text($contact->$field, 'Contato', 1000, in_array($field, ['city', 'uf'], true));
        }
        if (!preg_match('/^[A-Z]{2}$/D', $contact->uf) || !is_array($contact->phones) || !bi_is_list($contact->phones) || count($contact->phones) > 4) {
            bi_fail(503, 'contacts_invalid', 'O contato não pôde ser consultado.');
        }
        foreach ($contact->phones as $phone) { bi_text($phone, 'Telefone', 100, true); }
        $result = clone $contact;
        $result->source = clone $data->source;
        return $result;
    } catch (BiHttpError $error) {
        if (in_array($error->status, [404, 503], true)) { throw $error; }
        bi_fail(503, 'contacts_invalid', 'A base de contatos está inválida e não foi exibida.');
    }
}

function bi_client_contact_request(string $path): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        header('Allow: GET');
        bi_fail(405, 'method_not_allowed', 'A consulta de contato aceita apenas GET.');
    }
    // Reject explicit cross-site requests; direct same-host reads remain valid.
    $scheme = !empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off' ? 'https' : 'http';
    $expected = bi_origin_key($scheme . '://' . ($_SERVER['HTTP_HOST'] ?? ''));
    if (isset($_SERVER['HTTP_ORIGIN']) && ($expected === null || bi_origin_key((string) $_SERVER['HTTP_ORIGIN']) !== $expected)) {
        bi_fail(403, 'origin_not_allowed', 'Consulte os contatos pelo próprio painel.');
    }
    if (isset($_SERVER['HTTP_SEC_FETCH_SITE']) && !in_array(strtolower((string) $_SERVER['HTTP_SEC_FETCH_SITE']), ['same-origin', 'none'], true)) {
        bi_fail(403, 'origin_not_allowed', 'Consulte os contatos pelo próprio painel.');
    }
    if (array_keys($_GET) !== ['code']) {
        bi_fail(400, 'invalid_query', 'Informe somente um código de cliente.');
    }
    $code = bi_code($_GET['code'], 'Código do cliente');
    bi_json(bi_read_client_contact($path, $code));
}

bi_endpoint(static function (): void {
    bi_client_contact_request(__DIR__ . '/../data/client-contacts.json');
});
