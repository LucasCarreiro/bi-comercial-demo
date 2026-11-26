import {normalizeCode} from './analytics.js';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const MAX_ALIASES = 5000;

/** Auxiliary display labels only. The representative code remains the identity. */
export function validateRepresentativeAliasEntries(value) {
  if (!Array.isArray(value) || value.length > MAX_ALIASES) throw new Error('Os apelidos devem ser uma lista de até 5.000 representantes.');
  const codes = new Set();
  return Array.from(value, (record, index) => {
    const label = 'Apelido do representante ' + (index + 1);
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).sort().join(',') !== 'alias,code') throw new Error(label + ' contém campos ausentes ou não reconhecidos.');
    if (typeof record.code !== 'string' || !/^[0-9]{1,30}$/.test(record.code.trim())) throw new Error(label + ': informe um código de até 30 números, em formato de texto.');
    const code = normalizeCode(record.code);
    if (codes.has(code)) throw new Error('O código de representante ' + code + ' possui mais de um apelido.');
    if (typeof record.alias !== 'string' || CONTROL_CHARACTERS.test(record.alias)) throw new Error(label + ': o nome não pode conter caracteres de controle.');
    const alias = record.alias.trim();
    if (!alias || [...alias].length > 80) throw new Error(label + ': use de 1 a 80 caracteres.');
    codes.add(code);
    return {code, alias};
  });
}

/** Lookup is exclusively by code; names and nicknames never merge representatives. */
export function representativeAlias(code, auxiliary) {
  const key = normalizeCode(code);
  if (!/^[0-9]{1,30}$/.test(key) || !Array.isArray(auxiliary?.representativeAliases)) return '';
  const record = auxiliary.representativeAliases.find(entry => normalizeCode(entry?.code) === key);
  return typeof record?.alias === 'string' ? record.alias.trim() : '';
}

export function representativeDisplayName(representative, auxiliary) {
  return representativeAlias(representative?.code, auxiliary) || String(representative?.name ?? '');
}
