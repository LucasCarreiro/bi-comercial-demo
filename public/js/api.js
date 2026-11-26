import {ALL_CATEGORIES, CATEGORIES, normalizeCode, saoPauloToday} from './analytics.js';
import {validateRepresentativeAliasEntries} from './representative-aliases.js';

const AUXILIARY_URL = new URL('../api/auxiliary.php', import.meta.url);
const COMMERCIAL_URL = new URL('../api/comercial.php', import.meta.url);
const CLIENT_CONTACT_URL = new URL('../api/client-contact.php', import.meta.url);
const MAX_TIMEOUT = 30000;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function httpError(message, status, code, body) {
  const error = new Error(message); error.status = status; error.code = code; error.currentRevision = body?.currentRevision; return error;
}
async function requestJSON(url, options = {}) {
  if(globalThis.location?.protocol==='file:')throw httpError('Abra o BI pelo endereço HTTP/HTTPS da hospedagem com PHP para consultar ou salvar dados.',0,'LOCAL_FILE');
  const controller = new AbortController(), signal = options.signal;
  let timedOut = false;
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(() => {timedOut = true; controller.abort();}, MAX_TIMEOUT);
  try {
    const response = await fetch(url, {...options, headers: {Accept: 'application/json', ...options.headers}, credentials: 'same-origin', cache: 'no-store', signal: controller.signal});
    let data;
    try {data = await response.json();} catch {throw httpError('O servidor não retornou um JSON válido.', response.status, 'INVALID_JSON');}
    if (!response.ok) throw httpError(data?.message || data?.error?.message || (typeof data?.error === 'string' ? data.error : null) || 'Não foi possível concluir a consulta (HTTP ' + response.status + ').', response.status, data?.error?.code || data?.code || 'HTTP_ERROR', data);
    return data;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Consulta cancelada.', 'AbortError');
    if (timedOut) throw httpError('A consulta demorou mais que o esperado. Tente novamente.', 0, 'TIMEOUT');
    if (error instanceof TypeError) throw httpError('Não foi possível acessar o servidor. Confira a conexão e tente novamente.', 0, 'NETWORK_ERROR');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
function validateAuxiliary(data) {
  if (!data || typeof data !== 'object' || data.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 || !['topRetailers', 'largeNetworks', 'clientGroups', 'independentClientCodes', 'independentNames'].every(key => Array.isArray(data[key]))) throw new Error('O cadastro auxiliar retornou um formato inválido.');
  for (const record of [...data.largeNetworks,...data.clientGroups]) {
    if(!Array.isArray(record.namePatterns))throw new Error('Há um cadastro auxiliar sem regras de identificação válidas.');
    for(const pattern of record.namePatterns){
      if(typeof pattern!=='string'||pattern.length>300||!pattern.startsWith('^'))throw new Error('Há uma regra de nome inválida no cadastro auxiliar.');
      try{new RegExp(pattern);}catch{throw new Error('Uma regra de nome do cadastro não é compatível com JavaScript.');}
    }
  }
  return {...data, representativeAliases: validateRepresentativeAliasEntries(own(data, 'representativeAliases') ? data.representativeAliases : [])};
}
export async function loadAuxiliary() { return validateAuxiliary(await requestJSON(AUXILIARY_URL)); }
export async function loadClientContact(code) {
 const normalized=normalizeCode(code);
 if(!/^\d+$/.test(normalized))throw new Error('Código de cliente inválido.');
 const url=new URL(CLIENT_CONTACT_URL);url.searchParams.set('code',normalized);
 const value=await requestJSON(url);
 if(value?.code!==normalized||!Array.isArray(value.phones)||value.phones.some(phone=>typeof phone!=='string')||['address','number','neighborhood','postalCode','city','uf'].some(key=>typeof value[key]!=='string'))throw new Error('O cadastro não retornou um contato válido.');
 return value;
}
export async function saveAuxiliary(data, baseRevision) {
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new Error('A revisão do cadastro é inválida. Recarregue os dados antes de salvar.');
  const normalized = validateAuxiliary(data);
  try {
    return validateAuxiliary(await requestJSON(AUXILIARY_URL, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({baseRevision, data: normalized})}));
  } catch (error) {
    if (error.status === 409) error.message = 'Outra pessoa alterou o cadastro. Recarregue os dados antes de salvar para preservar as alterações da equipe.';
    throw error;
  }
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function sourceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[ T]|$)/.test(value)) return null;
  const date = value.slice(0, 10);
  return validDate(date) ? date : null;
}
function categoryValues(source, metric, index, optionalOutros = false) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Categorias de ' + metric + ' inválidas no registro ' + (index + 1) + '.');
  for (const key of Object.keys(source)) if (!ALL_CATEGORIES.includes(key) && source[key] !== 0) throw new Error('A API retornou a categoria não reconhecida ' + key + '. Solicite a revisão da integração.');
  const values = {}, scale = metric === 'sales' ? 100 : 1000000;
  let complete = true, missingOutros = false;
  for (const category of ALL_CATEGORIES) {
    if (!own(source, category)) {
      if (optionalOutros && category === 'Outros') {values[category] = 0; missingOutros = true; continue;}
      if (metric === 'fardos') {complete = false; continue;}
      throw new Error('A API não informou ' + category + ' no registro ' + (index + 1) + '.');
    }
    const value = source[category], amount = Math.round(value * scale);
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(amount) || Math.abs(value * scale - amount) > 0.0001) throw new Error('Valor de ' + category + ' inválido no registro ' + (index + 1) + '.');
    values[category] = amount / scale;
  }
  return {values: complete ? values : null, missingOutros};
}

/** Validação exportada para auditoria; rejeita períodos trocados e códigos duplicados. */
export function validateCommercialResponse(payload, period) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.clientes)) throw new Error('A API não retornou uma lista de clientes válida.');
  if (!validDate(payload.inicio) || !validDate(payload.fim) || payload.inicio !== period.inicio || payload.fim !== period.fim) throw new Error('A API não confirmou as datas solicitadas. Os valores deste mês não foram utilizados.');
  if (payload.atualizado_em != null && typeof payload.atualizado_em !== 'string') throw new Error('A data de atualização da API é inválida.');
  const codes = new Set(), reps = new Map(); let missingFardos = 0, missingOutros = 0;
  const clientes = payload.clientes.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Cliente inválido no registro ' + (index + 1) + '.');
    for (const key of ['cod_cliente', 'cod_rep', 'name', 'rep', 'city']) if (typeof row[key] !== 'string' || (key !== 'city' && !row[key].trim())) throw new Error('O campo ' + key + ' é inválido no registro ' + (index + 1) + '.');
    if (typeof row.large !== 'boolean' || (row.rede != null && typeof row.rede !== 'string')) throw new Error('Classificação de rede inválida no registro ' + (index + 1) + '.');
    const code = normalizeCode(row.cod_cliente), repCode = normalizeCode(row.cod_rep), rep = row.rep.trim();
    if (codes.has(code)) throw new Error('A API repetiu o código de cliente ' + code + '. O mês não foi somado para evitar duplicidade.');
    codes.add(code);
    if (reps.has(repCode) && reps.get(repCode) !== rep) throw new Error('A API retornou nomes diferentes para o mesmo representante.');
    reps.set(repCode, rep);
    if (row.ult_faturamento != null && !validDate(row.ult_faturamento)) throw new Error('Data de faturamento inválida no registro ' + (index + 1) + '.');
    if (row.a_faturar != null && (typeof row.a_faturar !== 'number' || !Number.isFinite(row.a_faturar))) throw new Error('Valor a faturar inválido no registro ' + (index + 1) + '.');
    const monetary = categoryValues(row.sales, 'sales', index, true), quantity = row.fardos == null ? {values: null} : categoryValues(row.fardos, 'fardos', index);
    if (!quantity.values) missingFardos++;
    if (monetary.missingOutros) missingOutros++;
    return {...row, cod_cliente: code, cod_rep: repCode, name: row.name.trim(), city: row.city.trim(), rep, sales: monetary.values, fardos: quantity.values};
  });
  return {clientes, updatedAt: payload.atualizado_em ?? null, missingFardos, missingOutros};
}

/** Consulta o intervalo exato, necessária para comparar o mesmo corte anual. */
export async function loadPeriod(period, {signal, allowStale = false} = {}) {
  if (!period || !validDate(period.inicio) || !validDate(period.fim) || period.inicio > period.fim || period.fim > saoPauloToday()) throw new Error('Informe um período válido, sem datas futuras.');
  if (signal?.aborted) throw new DOMException('Consulta cancelada.', 'AbortError');
  const url = new URL(COMMERCIAL_URL);url.searchParams.set('inicio',period.inicio);url.searchParams.set('fim',period.fim);
  const data = validateCommercialResponse(await requestJSON(url,{signal}),period), date = sourceDate(data.updatedAt);
  if (!allowStale && date && date < period.fim) throw httpError('A fonte ainda não cobre o fim do período solicitado.',0,'SOURCE_STALE');
  // The inactivity view may show only the interval actually covered by the
  // source. Unknown/older-than-start freshness must never certify no purchase.
  const coveredThrough = date && date >= period.inicio ? (date < period.fim ? date : period.fim) : null;
  return {...data,inicio:period.inicio,fim:period.fim,status:'ok',coveredThrough,stale:Boolean(date && date < period.fim),freshnessKnown:Boolean(date)};
}

/**
 * Jan..hoje (ano corrente) ou os 12 meses de ano encerrado. Concorrência = 3.
 * onProgress({completed,total,month,status}) não altera a validade dos dados.
 * coverage explicita falhas e fardos ausentes; mês de erro nunca é convertido em zero.
 */
export async function loadYear(year, {signal, onProgress} = {}) {
  const requestedAsOf = saoPauloToday(), selected = Number(year), currentYear = Number(requestedAsOf.slice(0, 4));
  if (!Number.isInteger(selected) || selected < 1900 || selected > 9999) throw new Error('Selecione um ano válido.');
  if (signal?.aborted) throw new DOMException('Consulta cancelada.', 'AbortError');
  const count = selected < currentYear ? 12 : selected === currentYear ? Number(requestedAsOf.slice(5, 7)) : 0;
  const months = Array.from({length: count}, (_, index) => ({month: String(selected).padStart(4, '0') + '-' + String(index + 1).padStart(2, '0')}));
  let next = 0, completed = 0;
  const worker = async () => {
    while (next < months.length) {
      if (signal?.aborted) throw new DOMException('Consulta cancelada.', 'AbortError');
      const index = next++, month = months[index].month, monthNumber = index + 1, lastDay = new Date(Date.UTC(selected, monthNumber, 0)).getUTCDate();
      const period = {inicio: month + '-01', fim: month === requestedAsOf.slice(0, 7) ? requestedAsOf : month + '-' + String(lastDay).padStart(2, '0')};
      try {
        const url = new URL(COMMERCIAL_URL); url.searchParams.set('inicio', period.inicio); url.searchParams.set('fim', period.fim);
        const data = validateCommercialResponse(await requestJSON(url, {signal}), period);
        months[index] = {month, status: 'ok', ...data, ...period};
      } catch (error) {
        if (signal?.aborted || error.name === 'AbortError') throw error;
        months[index] = {month, status: 'error', clientes: [], error: error.message, ...period};
      }
      completed++;
      try {onProgress?.({completed, total: months.length, month, status: months[index].status});} catch { /* Falha de pintura não muda a consulta. */ }
    }
  };
  await Promise.all(Array.from({length: Math.min(3, count)}, worker));
  const currentMonth = requestedAsOf.slice(0, 7), currentData = months.find(month => month.month === currentMonth && month.status === 'ok');
  const currentSourceDate = sourceDate(currentData?.updatedAt);
  let asOf = requestedAsOf, stale = false, forecastBlocked = false, freshnessReason = null;
  if (currentSourceDate && currentSourceDate < requestedAsOf) {
    stale = true;
    if (currentSourceDate.slice(0, 7) === currentMonth) {
      asOf = currentSourceDate;
      freshnessReason = 'A fonte foi atualizada em ' + currentSourceDate.split('-').reverse().join('/') + '. O ritmo e as estimativas usam essa data, sem contar dias posteriores como dias sem compra.';
      currentData.effectiveFim = currentSourceDate;
    } else {
      forecastBlocked = true;
      freshnessReason = 'A última atualização da fonte antecede o mês atual. A consulta atual e sua projeção foram marcadas como indisponíveis.';
    }
  }
  // Um mês que ainda não tinha terminado na data da fonte não equivale a um mês
  // fechado de compra zero. Preserve o erro explícito, inclusive em anos anteriores.
  for (const month of months) {
    if (month.status !== 'ok') continue;
    const date = sourceDate(month.updatedAt);
    if (date && date < month.fim && (month.month !== currentMonth || date.slice(0, 7) < currentMonth)) {
      month.status = 'error'; month.clientes = []; month.staleSource = true;
      month.error = 'A fonte foi atualizada em ' + date.split('-').reverse().join('/') + ', antes do fim deste período. Não foi assumido um resultado completo.';
    }
  }
  const missingMonths = months.filter(month => month.status !== 'ok').map(month => month.month), missingFardosMonths = months.filter(month => month.status === 'ok' && month.missingFardos > 0).map(month => month.month), missingOutrosMonths = months.filter(month => month.status === 'ok' && month.missingOutros > 0).map(month => month.month);
  return {months, asOf, coverage: {requested: months.length, completed, ok: months.length - missingMonths.length, errors: missingMonths.length, missingMonths, missingFardosMonths, missingOutrosMonths, complete: months.length > 0 && !missingMonths.length, fardosComplete: months.length > 0 && !missingMonths.length && !missingFardosMonths.length, quantityMissingGlobal: missingFardosMonths.length > 0, currentMonth, requestedAsOf, sourceUpdatedAt: currentData?.updatedAt ?? null, sourceDate: currentSourceDate, freshnessKnown: Boolean(currentSourceDate), stale, forecastBlocked, freshnessReason}};
}
