/**
 * Cálculos do BI Comercial, sem acesso à rede ou armazenamento.
 * Valores monetários são somados em centavos; fardos em milionésimos.
 * null significa informação indisponível; zero significa uma consulta válida sem compra.
 * Top/Redes usam três categorias. A visão da empresa inclui todas as vendas.
 */
export const CATEGORIES = Object.freeze(['Arroz', 'Flocão', 'Salgadinho']);
export const ALL_CATEGORIES = Object.freeze([...CATEGORIES, 'Outros']);
const SCALES = Object.freeze({sales: 100, fardos: 1000000});
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const blank = (categories = CATEGORIES) => Object.fromEntries(categories.map(category => [category, 0]));
const array = value => Array.isArray(value) ? value : [];
export const normalizeCode = value => String(value ?? '').trim().replace(/^0+(?=\d)/, '');
export const normalizeName = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('pt-BR').replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const codeFor = row => normalizeCode(row.cod_cliente ?? row.codCliente ?? row.code);

function scaleFor(metric) {
  if (!own(SCALES, metric)) throw new Error('Unidade de análise inválida.');
  return SCALES[metric];
}
function units(value, metric) {
  const scale = scaleFor(metric);
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const amount = Math.round(value * scale);
  return Number.isSafeInteger(amount) && Math.abs(value * scale - amount) <= 0.0001 ? BigInt(amount) : null;
}
function numberFromUnits(value, metric) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('O total excedeu o limite numérico seguro.');
  return Number(value) / scaleFor(metric);
}
function categoryUnits(row, metric, categories = CATEGORIES) {
  const source = row?.[metric];
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const result = {};
  for (const category of categories) {
    if (!own(source, category)) return null;
    const amount = units(source[category], metric);
    if (amount === null) return null;
    result[category] = amount;
  }
  return result;
}
function valuesFromUnits(values, metric, categories = CATEGORIES) {
  return Object.fromEntries(categories.map(category => [category, numberFromUnits(values[category], metric)]));
}
function totalValues(values, metric, categories = CATEGORIES) {
  return numberFromUnits(categories.reduce((sum, category) => sum + units(values[category], metric), 0n), metric);
}
function categoriesFor(entity) {
  const categories = entity?.categories ?? CATEGORIES;
  if (!Array.isArray(categories) || !categories.length || new Set(categories).size !== categories.length || categories.some(category => !ALL_CATEGORIES.includes(category))) throw new Error('Categorias da análise inválidas.');
  return categories;
}
const hasCompanyMovement = row => ALL_CATEGORIES.some(category => ['sales','fardos'].some(metric => typeof row?.[metric]?.[category] === 'number' && Number.isFinite(row[metric][category]) && row[metric][category] !== 0));
export function valueFor(row, metric, categories = CATEGORIES) {
  scaleFor(metric);
  const values = categoryUnits(row, metric, categories);
  return values === null ? null : numberFromUnits(categories.reduce((sum, category) => sum + values[category], 0n), metric);
}

function matchesRule(row, rules, exclusions = false) {
  const code = codeFor(row), name = normalizeName(row.name);
  const usable = array(rules).filter(rule => !exclusions || !array(rule.excludedClientCodes).some(item => normalizeCode(item) === code));
  const explicit = usable.filter(rule => array(rule.clientCodes).some(item => normalizeCode(item) === code));
  if (explicit.length > 1) throw new Error('O código ' + code + ' pertence a mais de um cadastro auxiliar.');
  if (explicit.length) return explicit[0];
  const matched = usable.filter(rule => array(rule.namePatterns).some(pattern => {
    // As regras confirmadas incluem nomes completos e prefixos legais terminados em (?: |$).
    if (typeof pattern !== 'string' || !pattern.startsWith('^') || pattern.length > 300) throw new Error('Há uma regra de nome inválida no cadastro auxiliar.');
    try { return new RegExp(pattern).test(name); } catch { throw new Error('Há uma expressão de nome inválida no cadastro auxiliar.'); }
  }));
  if (matched.length > 1) throw new Error('O cliente ' + (row.name || code) + ' corresponde a mais de uma regra auxiliar. Revise os agrupamentos.');
  return matched[0] ?? null;
}

/** Identidade estável: regras explícitas por código prevalecem sobre regras por nome. */
export function resolveIdentity(row, aux = {}) {
  const code = codeFor(row), normalizedName = normalizeName(row.name);
  const independent = array(aux.independentClientCodes).some(item => normalizeCode(item) === code) || array(aux.independentNames).some(name => normalizeName(name) === normalizedName);
  const group = matchesRule(row, aux.clientGroups);
  const network = independent ? null : matchesRule(row, aux.largeNetworks, true);
  // Uma exclusão explícita de rede também impede o fallback da API de reinseri-lo nela.
  const explicitlyExcluded = array(aux.largeNetworks).some(item => array(item.excludedClientCodes).some(value => normalizeCode(value) === code));
  const fallbackLarge = !independent && !explicitlyExcluded && !network && row.large === true;
  // A API pode classificar outra razão social na mesma rede já cadastrada.
  // Reutilize o id auxiliar somente por nome de rede exato e classificação large.
  const apiNetworkName = normalizeName(row.rede);
  const namedNetworks = fallbackLarge && apiNetworkName ? array(aux.largeNetworks).filter(item => normalizeName(item.name) === apiNetworkName) : [];
  if (namedNetworks.length > 1) throw new Error('A rede ' + row.rede + ' corresponde a mais de um cadastro auxiliar. Revise os nomes das redes.');
  const resolvedNetwork = network ?? namedNetworks[0] ?? null;
  const fallbackName = String(row.rede ?? '').trim() || String(row.name ?? '').trim();
  const fallbackKey = String(row.rede ?? '').trim() ? 'api-network:' + normalizeName(row.rede) : 'api-client:' + code;
  const networkId = resolvedNetwork ? String(resolvedNetwork.id) : fallbackLarge ? fallbackKey : null;
  const networkName = resolvedNetwork ? String(resolvedNetwork.name) : fallbackLarge ? fallbackName : null;
  return {
    groupId: group ? String(group.id) : networkId,
    groupName: group ? String(group.name) : networkName,
    networkId, networkName, large: Boolean(networkId)
  };
}

/** DISTRIBUIDORA PARCEIRA (cliente excluído) nunca participa; compra exclusivamente de Outros também não qualifica. */
export function eligibleClient(row) {
  const normalized = normalizeName(row?.name);
  if (codeFor(row ?? {}) === '990' || /^DISTRIBUIDORA PARCEIRA(?: LTDA)?$/.test(normalized)) return false;
  return CATEGORIES.some(category => {
    const monetary = row?.sales?.[category], quantity = row?.fardos?.[category];
    return (typeof monetary === 'number' && Number.isFinite(monetary) && monetary > 0) || (typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0);
  });
}

function emptyAggregate(month, categories = CATEGORIES) {
  return {month: month.month, status: month.status === 'ok' ? 'ok' : 'error', sales: month.status === 'ok' ? blank(categories) : null, fardos: month.status === 'ok' ? blank(categories) : null, matchedClients: 0, clientCodes: [], error: month.status === 'ok' ? null : String(month.error || 'Consulta indisponível.'), updatedAt: month.updatedAt ?? null, ...(month.inicio && month.fim ? {inicio:month.inicio,fim:month.fim} : {})};
}
function aggregateRows(month, rows, categories = CATEGORIES, qualifies = eligibleClient) {
  const result = emptyAggregate(month, categories);
  if (result.status !== 'ok') return result;
  const sales = Object.fromEntries(categories.map(category => [category, 0n]));
  const fardos = Object.fromEntries(categories.map(category => [category, 0n]));
  let hasSales = true, hasFardos = true;
  for (const row of rows) {
    const rowSales = categoryUnits(row, 'sales', categories), rowFardos = categoryUnits(row, 'fardos', categories);
    hasSales &&= rowSales !== null;
    hasFardos &&= rowFardos !== null;
    for (const category of categories) {
      if (rowSales) sales[category] += rowSales[category];
      if (rowFardos) fardos[category] += rowFardos[category];
    }
  }
  result.sales = hasSales ? valuesFromUnits(sales, 'sales', categories) : null;
  result.fardos = hasFardos ? valuesFromUnits(fardos, 'fardos', categories) : null;
  result.matchedClients = rows.filter(qualifies).length;
  result.clientCodes = [...new Set(rows.filter(qualifies).map(codeFor))].sort();
  return result;
}

/**
 * Entidades Top usam somente códigos explicitamente cadastrados, sem dedução por nome.
 * Redes usam o cadastro auxiliar + fallback API.large. O cliente excluído é removido antes de unir.
 * Linhas sem compra nas três categorias ainda preservam estornos e a disponibilidade
 * de fardos; suas compras de Outros nunca são agregadas.
 */
export function buildEntities(months, aux = {}, mode = 'top') {
  if (!['top', 'networks', 'company'].includes(mode)) throw new Error('Tipo de análise inválido.');
  const categories = mode === 'company' ? ALL_CATEGORIES : CATEGORIES;
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  const duplicateMonths = new Set();
  for (const month of sorted) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month.month) || duplicateMonths.has(month.month)) throw new Error('O histórico contém mês inválido ou repetido.');
    duplicateMonths.add(month.month);
  }
  const candidates = new Map();
  if (mode === 'top') {
    for (const record of array(aux.topRetailers)) {
      const id = String(record.id);
      if (candidates.has(id)) throw new Error('Há registros Top Varejista com identificador repetido.');
      candidates.set(id, {id, name: String(record.name), city: String(record.city ?? ''), rep: String(record.rep ?? ''), acceptedAt: record.acceptedAt ?? null, clientCodes: [...new Set(array(record.clientCodes).map(normalizeCode))], kind: 'top', rowsByMonth: new Map()});
    }
  } else if (mode === 'networks') {
    for (const record of array(aux.largeNetworks)) {
      const id = String(record.id);
      if (candidates.has(id)) throw new Error('Há redes com identificador repetido.');
      candidates.set(id, {id, name: String(record.name), city: '', rep: '', clientCodes: [], kind: 'network', rowsByMonth: new Map()});
    }
  }
  for (const month of sorted) {
    if (month.status !== 'ok') continue;
    const rowCodes = new Set();
    for (const row of array(month.clientes)) {
      const code = codeFor(row);
      if (rowCodes.has(code)) throw new Error('Código de cliente repetido no mês ' + month.month + ': ' + code + '.');
      rowCodes.add(code);
      if (mode !== 'company' && (code === '990' || /^DISTRIBUIDORA PARCEIRA(?: LTDA)?$/.test(normalizeName(row.name)))) continue;
      const identity = resolveIdentity(row, aux);
      let selected;
      if (mode === 'top') selected = [...candidates.values()].filter(entity => entity.clientCodes.includes(code));
      else if (mode === 'networks') {
        if (!identity.large) continue;
        if (!candidates.has(identity.networkId)) candidates.set(identity.networkId, {id: identity.networkId, name: identity.networkName, city: '', rep: '', clientCodes: [], kind: 'network', rowsByMonth: new Map()});
        selected = [candidates.get(identity.networkId)];
      } else {
        const id = identity.groupId ? 'company-group:' + identity.groupId : 'client:' + code;
        if (!candidates.has(id)) candidates.set(id, {id, name: identity.groupName || String(row.name), city: '', rep: String(row.rep || ''), clientCodes: [], kind: identity.groupId ? 'group' : 'client', rowsByMonth: new Map()});
        selected = [candidates.get(id)];
      }
      for (const entity of selected) {
        if (!entity.rowsByMonth.has(month.month)) entity.rowsByMonth.set(month.month, []);
        entity.rowsByMonth.get(month.month).push(row);
        if (!entity.clientCodes.includes(code)) entity.clientCodes.push(code);
      }
    }
  }
  return [...candidates.values()].map(({rowsByMonth, ...entity}) => {
    const rows = [...rowsByMonth.values()].flat(), cities = [...new Set(rows.map(row => String(row.city ?? '').trim()).filter(Boolean))];
    return {...entity, categories, city: entity.city || (cities.length === 1 ? cities[0] : cities.length ? cities.length + ' cidades' : ''), cities, clientCodes: entity.clientCodes.sort(), eligible: mode === 'company' ? rows.length > 0 : rows.some(eligibleClient), months: sorted.map(month => aggregateRows(month, rowsByMonth.get(month.month) || [], categories, mode === 'company' ? hasCompanyMovement : eligibleClient))};
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
}

/** Soma a mesma carteira em cada mês; lacunas nunca são tratadas como zero. */
export function consolidateEntities(months, entities, categories = entities[0]?.categories ?? CATEGORIES) {
  categoriesFor({categories});
  const aggregate = (points, metric) => {
    const values = points.map(point => categoryUnits(point, metric, categories));
    if (values.some(value => value === null)) return null;
    return valuesFromUnits(Object.fromEntries(categories.map(category => [category, values.reduce((sum, value) => sum + value[category], 0n)])), metric, categories);
  };
  return {id:'portfolio',name:'Visão da carteira',city:'',categories,clientCodes:[...new Set(entities.flatMap(entity => entity.clientCodes))],eligible:entities.some(entity => entity.eligible),months:months.map(month => {
    const points = entities.map(entity => entity.months.find(point => point.month === month.month));
    if(month.status !== 'ok' || points.some(point => !point || point.status !== 'ok')) return {...emptyAggregate({...month,status:'error'},categories),error:month.error || 'Dados incompletos no mês.'};
    return {month:month.month,status:'ok',sales:aggregate(points,'sales'),fardos:aggregate(points,'fardos'),clientCodes:[...new Set(points.flatMap(point => point.clientCodes || []))],matchedClients:points.reduce((sum,point) => sum + (point.matchedClients || 0),0),updatedAt:month.updatedAt ?? null,...(month.inicio && month.fim ? {inicio:month.inicio,fim:month.fim} : {})};
  })};
}

function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
export function saoPauloToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return value('year') + '-' + value('month') + '-' + value('day');
}
function temporal(year, asOf) {
  if (!Number.isInteger(Number(year)) || Number(year) < 1900 || Number(year) > 9999) throw new Error('Ano inválido.');
  if (!validDate(asOf)) throw new Error('Data de referência inválida.');
  return {year: Number(year), asOf, current: asOf.slice(0, 7), currentYear: Number(asOf.slice(0, 4)), day: Number(asOf.slice(8))};
}
function monthlySeries(entity, metric, year, asOf) {
  const time = temporal(year, asOf), existing = new Map(entity.months.map(month => [month.month, month])), categoryNames = categoriesFor(entity);
  return Array.from({length: 12}, (_, index) => {
    const month = String(time.year).padStart(4, '0') + '-' + String(index + 1).padStart(2, '0'), source = existing.get(month), isFuture = month > time.current;
    if (isFuture) return {month, status: 'future', total: null, categories: null, isCurrent: false, isFuture: true, matchedClients: 0, reason: 'Mês futuro.'};
    if (!source || source.status !== 'ok') return {month, status: 'error', total: null, categories: null, isCurrent: month === time.current, isFuture: false, matchedClients: null, reason: source?.error || 'Mês não consultado.'};
    const values = categoryUnits(source, metric, categoryNames);
    if (values === null) return {month, status: 'error', total: null, categories: null, isCurrent: month === time.current, isFuture: false, matchedClients: source.matchedClients, missingQuantity: metric === 'fardos', reason: metric === 'fardos' ? 'A API não informou fardos completos neste mês.' : 'Valores monetários incompletos neste mês.'};
    const categories = valuesFromUnits(values, metric, categoryNames);
    return {month, status: 'ok', total: totalValues(categories, metric, categoryNames), categories, isCurrent: month === time.current, isFuture: false, matchedClients: source.matchedClients, clientCodes: source.clientCodes || [], updatedAt: source.updatedAt, reason: null};
  });
}

/**
 * Retorna 12 pontos (ok/error/future). total/byCategory são null se faltar qualquer
 * mês já decorrido; knownTotal/knownByCategory somam apenas os pontos disponíveis.
 * change compara o mês consultado com o mês imediatamente anterior. O mês
 * corrente mantém isPartial=true. mix mostra o conhecido, com complete explícito.
 */
export function summarizeEntity(entity, metric = 'fardos', year = new Date().getFullYear(), asOf = saoPauloToday()) {
  scaleFor(metric);
  const categoryNames = categoriesFor(entity), series = monthlySeries(entity, metric, year, asOf), occurred = series.filter(point => !point.isFuture), known = occurred.filter(point => point.status === 'ok');
  const sums = Object.fromEntries(categoryNames.map(category => [category, 0n]));
  for (const point of known) for (const category of categoryNames) sums[category] += units(point.categories[category], metric);
  const knownByCategory = valuesFromUnits(sums, metric, categoryNames), knownTotal = totalValues(knownByCategory, metric, categoryNames), missingMonths = occurred.filter(point => point.status !== 'ok').map(point => point.month), complete = occurred.length > 0 && missingMonths.length === 0;
  const latest = occurred.at(-1), prior = occurred.at(-2);
  let change = {value: null, percent: null, fromMonth: prior?.month ?? null, toMonth: latest?.month ?? null, isPartial: Boolean(latest?.isCurrent), reason: !latest ? 'Não há mês realizado disponível no ano consultado.' : !prior ? 'Não há mês anterior disponível no ano consultado.' : latest.status !== 'ok' ? 'Os dados do mês consultado estão indisponíveis.' : 'Os dados do mês anterior estão indisponíveis.'};
  if (latest?.status === 'ok' && prior?.status === 'ok') {
    const delta = numberFromUnits(units(latest.total, metric) - units(prior.total, metric), metric);
    change = {...change, value: delta, percent: prior.total > 0 ? delta / prior.total : null, reason: prior.total > 0 ? null : 'O mês de comparação tem base zero ou negativa.'};
  }
  const canShare = knownTotal > 0 && categoryNames.every(category => knownByCategory[category] >= 0);
  return {id: entity.id, metric, year: Number(year), categories:categoryNames, series, total: complete ? knownTotal : null, knownTotal, byCategory: complete ? knownByCategory : null, knownByCategory, activeClients: new Set(known.flatMap(point => point.clientCodes || [])).size, monthCount: known.length, missingMonths, quantityMissingMonths: occurred.filter(point => point.missingQuantity).map(point => point.month), complete, latestMonth: known.at(-1) ?? null, change, mix: categoryNames.map(category => ({category, value: knownByCategory[category], share: canShare ? knownByCategory[category] / knownTotal : null})), mixReason: canShare ? null : 'Mix percentual indisponível para base zero ou valores líquidos negativos.', eligible: Boolean(entity.eligible)};
}

// Frações exatas mantêm o arredondamento de centavos/milionésimos na tendência.
const abs = value => value < 0n ? -value : value;
function gcd(a, b) { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a || 1n; }
function fraction(n, d = 1n) { if (d < 0n) {n = -n; d = -d;} const divisor = gcd(n, d); return {n: n / divisor, d: d / divisor}; }
const add = (a, b) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const subtract = (a, b) => fraction(a.n * b.d - b.n * a.d, a.d * b.d);
const multiply = (a, n) => fraction(a.n * BigInt(n), a.d);
function median(values) {
  const sorted = [...values].sort((a, b) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : fraction(add(sorted[middle - 1], sorted[middle]).n, add(sorted[middle - 1], sorted[middle]).d * 2n);
}
function roundedPositive(value) { if (value.n <= 0n) return 0n; return (value.n * 2n + value.d) / (2n * value.d); }
function theilSen(points, category, metric) {
  const slopes = [];
  for (let first = 0; first < points.length; first++) for (let second = first + 1; second < points.length; second++) slopes.push(fraction(units(points[second].categories[category], metric) - units(points[first].categories[category], metric), BigInt(points[second].x - points[first].x)));
  const slope = median(slopes), intercept = median(points.map(point => subtract(fraction(units(point.categories[category], metric)), multiply(slope, point.x))));
  return x => roundedPositive(add(intercept, multiply(slope, x)));
}
function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

/** Períodos equivalentes: um mês parcial nunca é comparado a um ano completo. */
export function comparisonPeriods(year, asOf = saoPauloToday()) {
  const time = temporal(year, asOf);
  if (time.year > time.currentYear || time.year <= 1900) throw new Error('Não há período anual comparável para o ano selecionado.');
  const currentEnd = time.year < time.currentYear ? time.year + '-12-31' : asOf;
  const month = Number(currentEnd.slice(5,7)), day = Math.min(Number(currentEnd.slice(8)), daysInMonth(time.year - 1, month));
  return {current:{inicio:time.year + '-01-01',fim:currentEnd},previous:{inicio:(time.year - 1) + '-01-01',fim:(time.year - 1) + '-' + String(month).padStart(2,'0') + '-' + String(day).padStart(2,'0')}};
}

/** O mês corrente usa o mesmo corte no ano anterior; ano encerrado usa dezembro. */
export function monthlyComparisonPeriods(year, asOf = saoPauloToday()) {
  const annual = comparisonPeriods(year, asOf);
  return {
    current:{inicio:annual.current.fim.slice(0,7) + '-01',fim:annual.current.fim},
    previous:{inicio:annual.previous.fim.slice(0,7) + '-01',fim:annual.previous.fim}
  };
}

/**
 * Compara o mês atual (ou dezembro do ano encerrado) ao mesmo mês do ano anterior.
 * A consulta anterior deve cobrir exatamente seu intervalo, sem prorrateio.
 * Falhas de outros meses não invalidam um par mensal que esteja completo.
 */
export function compareMonth(currentEntity, previousMonthEntity, metric = 'fardos', year = new Date().getFullYear(), asOf = saoPauloToday()) {
  const periods = monthlyComparisonPeriods(year, asOf), summary = summarizeEntity(currentEntity, metric, year, asOf), categories = categoriesFor(currentEntity);
  const point = summary.series.find(item => item.month === periods.current.fim.slice(0,7));
  const prior = previousMonthEntity?.months?.length === 1 ? previousMonthEntity.months[0] : null;
  const validPrior = prior?.status === 'ok' && prior.inicio === periods.previous.inicio && prior.fim === periods.previous.fim;
  const current = point?.status === 'ok' ? point.total : null, previous = validPrior ? valueFor(prior, metric, categories) : null;
  const complete = current !== null && previous !== null, value = complete ? numberFromUnits(units(current,metric) - units(previous,metric),metric) : null;
  const percent = complete && previous > 0 ? value / previous : null;
  const reason = current === null ? 'Os dados do mês comparado estão indisponíveis.' : !validPrior ? 'A consulta do mesmo mês no ano anterior está indisponível.' : previous === null ? 'Valores incompletos no mês anterior comparável.' : previous <= 0 ? 'O mesmo mês no ano anterior tem base zero ou negativa.' : null;
  return {current,previous,value,delta:value,percent,complete,periods,reason};
}

/**
 * previousPeriodEntity contém UMA agregação da consulta exata Jan..mesmo dia no
 * ano anterior, com inicio/fim preservados. Não aceita somar mensalidades completas
 * para aproximar o corte parcial. Carteira sem compra anterior vale zero somente
 * quando construída sobre uma consulta válida (consolidateEntities(base, [])).
 */
export function compareAnnual(currentEntity, previousPeriodEntity, metric = 'fardos', year = new Date().getFullYear(), asOf = saoPauloToday()) {
  const periods = comparisonPeriods(year, asOf), summary = summarizeEntity(currentEntity, metric, year, asOf), categories = categoriesFor(currentEntity);
  const prior = previousPeriodEntity?.months?.length === 1 ? previousPeriodEntity.months[0] : null;
  const validPrior = prior?.status === 'ok' && prior.inicio === periods.previous.inicio && prior.fim === periods.previous.fim;
  const previous = validPrior ? valueFor(prior, metric, categories) : null, current = summary.complete ? summary.total : null;
  const complete = current !== null && previous !== null, value = complete ? numberFromUnits(units(current,metric) - units(previous,metric),metric) : null;
  const percent = complete && previous > 0 ? value / previous : null;
  const reason = !summary.complete ? 'Há meses indisponíveis no ano consultado.' : !validPrior ? 'A consulta do mesmo período do ano anterior está indisponível.' : previous === null ? 'Valores incompletos no período anterior.' : previous <= 0 ? 'O período anterior tem base zero ou negativa.' : null;
  return {current,previous,value,delta:value,percent,complete,periods,reason};
}

/**
 * Tendência por categoria = Theil–Sen dos até seis meses fechados mais recentes,
 * incluindo meses válidos sem compra. Exige ao menos três meses fechados válidos.
 * Meses de erro/futuros nunca entram na regressão. Lacunas impedem total anual.
 * Mês parcial: até o dia 6 usa a tendência; a partir do dia 7 combina tendência
 * e ritmo observado (peso = fração decorrida), sempre >= realizado por categoria.
 * O resultado é cenário indicativo, sem probabilidade/intervalo de confiança.
 * byCategory representa o projetado; actualByCategory representa o realizado.
 */
export function forecastEntity(entity, metric = 'fardos', year = new Date().getFullYear(), asOf = saoPauloToday()) {
  const time = temporal(year, asOf), summary = summarizeEntity(entity, metric, Number(year), asOf), series = summary.series, categoryNames = categoriesFor(entity);
  const closedWindow = series.filter(point => !point.isFuture && !point.isCurrent).slice(-6), basis = closedWindow.filter(point => point.status === 'ok').map(point => ({...point, x: Number(point.month.slice(5))}));
  const basisMonths = basis.map(point => point.month), method = 'Theil–Sen por categoria nos até seis meses fechados recentes; mínimo de três meses válidos. Mês parcial ajustado pelo ritmo observado após o dia 6.';
  const initialReason = Number(year) > time.currentYear ? 'O ano selecionado ainda não começou.' : basis.length < 3 ? 'Histórico insuficiente: são necessários ao menos três meses fechados válidos.' : null;
  const models = initialReason ? null : Object.fromEntries(categoryNames.map(category => [category, theilSen(basis, category, metric)]));
  const months = series.map(point => {
    if (!point.isFuture && !point.isCurrent) return {month: point.month, actual: point.total, projected: point.total, categories: point.categories, actualCategories: point.categories, status: point.status === 'ok' ? 'actual' : 'unavailable', reason: point.reason};
    if (initialReason || !models) return {month: point.month, actual: point.total, projected: null, categories: null, actualCategories: point.categories, status: 'unavailable', reason: initialReason};
    if (point.isCurrent && point.status !== 'ok') return {month: point.month, actual: null, projected: null, categories: null, actualCategories: null, status: 'unavailable', reason: point.reason};
    const x = Number(point.month.slice(5)), projectedUnits = {};
    for (const category of categoryNames) {
      let estimated = models[category](x);
      if (point.isCurrent) {
        const actual = units(point.categories[category], metric);
        if (time.day >= 7) estimated = roundedPositive(add(fraction(estimated * BigInt(daysInMonth(Number(year), x) - time.day), BigInt(daysInMonth(Number(year), x))), fraction(actual)));
        if (estimated < actual) estimated = actual;
      }
      projectedUnits[category] = estimated;
    }
    const categories = valuesFromUnits(projectedUnits, metric, categoryNames);
    return {month: point.month, actual: point.total, projected: totalValues(categories, metric, categoryNames), categories, actualCategories: point.categories, status: 'estimated', reason: null};
  });
  const current = months.find(point => point.month === time.current), currentMonth = Number(year) === time.currentYear ? {month: time.current, actual: current?.actual ?? null, projected: current?.projected ?? null, remaining: current?.projected != null && current?.actual != null ? numberFromUnits(units(current.projected, metric) - units(current.actual, metric), metric) : null, byCategory: current?.categories ?? null, actualByCategory: current?.actualCategories ?? null, reason: current?.reason ?? null, method: time.day < 7 ? 'Tendência histórica; realizado preservado.' : 'Tendência histórica combinada ao ritmo parcial; realizado preservado.'} : null;
  let yearEnd;
  if (months.every(point => point.projected !== null)) {
    const totals = Object.fromEntries(categoryNames.map(category => [category, months.reduce((sum, point) => sum + units(point.categories[category], metric), 0n)])), byCategory = valuesFromUnits(totals, metric, categoryNames), projected = totalValues(byCategory, metric, categoryNames);
    yearEnd = {actual: summary.knownTotal, projected, remaining: numberFromUnits(units(projected, metric) - units(summary.knownTotal, metric), metric), byCategory, actualByCategory: summary.knownByCategory, reason: null, isEstimate: Number(year) >= time.currentYear};
  } else yearEnd = {actual: summary.knownTotal, projected: null, remaining: null, byCategory: null, actualByCategory: summary.knownByCategory, reason: summary.missingMonths.length ? 'Há meses sem informação completa. Não é possível estimar o total anual.' : initialReason || 'Projeção anual indisponível.', isEstimate: true};
  return {metric, year: Number(year), asOf, method, reason: initialReason, currentMonth, yearEnd, months, basisMonths, completeHistory: summary.complete, caution: 'Simulação de tendência, sujeita a mudanças no ritmo de compras. Não representa promessa de resultado.'};
}
