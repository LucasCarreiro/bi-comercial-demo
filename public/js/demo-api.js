/*
 * BI Comercial · modo demonstração
 * ---------------------------------
 * Substitui a API comercial e os endpoints PHP por um gerador de dados
 * FICTÍCIOS que roda no próprio navegador. Empresa, clientes, representantes,
 * redes, produtos, preços, telefones e endereços são todos inventados.
 * As cidades são municípios reais apenas para que o mapa (malhas do IBGE)
 * funcione.
 *
 * O gerador é determinístico (semente fixa): a mesma consulta sempre devolve
 * os mesmos números. Gravações (cadastros e metas) ficam só no navegador.
 */
(function (global) {
  'use strict';

  // ---------- utilidades determinísticas ----------
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return h >>> 0;
  }
  const rnd = (...parts) => hash(parts.join('|')) / 4294967296;
  const pick = (list, ...parts) => list[Math.floor(rnd(...parts) * list.length)];
  const round2 = value => Math.round(value * 100) / 100;

  function saoPauloNow() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'}).formatToParts(new Date()).map(p => [p.type, p.value]));
    return {date: parts.year + '-' + parts.month + '-' + parts.day, time: parts.hour + ':' + parts.minute + ':' + parts.second};
  }
  const addDays = (date, days) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const weekday = date => new Date(date + 'T12:00:00Z').getUTCDay();

  // ---------- cadastro fictício ----------
  const COMPANY = 'Distribuidora Demo';
  const DATA_START = '2024-01-01';

  const REPS = [
    {code: '1', name: 'ANA PAULA MOREIRA', cities: [['TERESINA', 'PI', 3], ['ALTOS', 'PI'], ['JOSÉ DE FREITAS', 'PI'], ['UNIÃO', 'PI']], clients: 34, growth: 0.09},
    {code: '8', name: 'BRUNO CESAR LOPES', cities: [['PARNAÍBA', 'PI', 3], ['LUÍS CORREIA', 'PI'], ['PIRACURUCA', 'PI'], ['ESPERANTINA', 'PI']], clients: 28, growth: 0.05},
    {code: '17', name: 'CARLA ROCHA VIEIRA', cities: [['URUÇUÍ', 'PI', 2], ['BOM JESUS', 'PI', 2], ['CORRENTE', 'PI'], ['BALSAS', 'MA', 2]], clients: 24, growth: 0.14},
    {code: '24', name: 'DIEGO FARIAS NETO', cities: [['PICOS', 'PI', 3], ['VALENÇA DO PIAUÍ', 'PI'], ['OEIRAS', 'PI', 2]], clients: 26, growth: -0.04},
    {code: '27', name: 'EDUARDO SALES REPRESENTACOES LTDA', cities: [['FLORIANO', 'PI', 3], ['SÃO RAIMUNDO NONATO', 'PI', 2], ['PETROLINA', 'PE']], clients: 27, growth: 0.07},
    {code: '29', name: 'FERNANDA LIMA COSTA', cities: [['PIRIPIRI', 'PI', 2], ['PEDRO II', 'PI'], ['CAMPO MAIOR', 'PI', 2], ['BARRAS', 'PI']], clients: 25, growth: 0.02},
    {code: '32', name: 'GUSTAVO TEIXEIRA', cities: [['TIMON', 'MA', 3], ['CAXIAS', 'MA', 2], ['CODÓ', 'MA']], clients: 27, growth: 0.11},
    {code: '34', name: 'HELENA BARROS', cities: [['SÃO LUÍS', 'MA', 3], ['BACABAL', 'MA'], ['PEDREIRAS', 'MA']], clients: 25, growth: -0.07},
    {code: '47', name: 'IGOR MENDES', cities: [['IMPERATRIZ', 'MA', 3], ['PRESIDENTE DUTRA', 'MA'], ['ARAGUAÍNA', 'TO']], clients: 23, growth: 0.04},
    {code: '61', name: 'JULIANA PRADO', cities: [['TERESINA', 'PI', 1]], clients: 30, growth: 0.06},
    {code: '71', name: 'KLEBER ARAUJO', cities: [['CHAPADINHA', 'MA', 2], ['BARRAS', 'PI'], ['ESPERANTINA', 'PI']], clients: 20, growth: -0.02},
    {code: '81', name: 'LARISSA FONTES', cities: [['PALMAS', 'TO', 3], ['ARAGUAÍNA', 'TO', 2]], clients: 21, growth: 0.18},
    {code: '95', name: 'MAURICIO QUEIROZ', cities: [['SÃO LUÍS', 'MA', 2], ['TIMON', 'MA']], clients: 22, growth: 0.03},
    {code: '96', name: 'NATALIA REIS REPRESENTACOES LTDA', cities: [['PETROLINA', 'PE', 2], ['ARARIPINA', 'PE'], ['SALGUEIRO', 'PE'], ['JUAZEIRO', 'BA', 2]], clients: 26, growth: 0.08},
    {code: '110', name: 'OTAVIO CAMPOS', cities: [['BARREIRAS', 'BA', 2], ['MARABÁ', 'PA', 2], ['PARAUAPEBAS', 'PA']], clients: 19, growth: 0.21},
    {code: '108', name: 'RENATA DIAS', cities: [['TERESINA', 'PI'], ['CAMPO MAIOR', 'PI']], clients: 12, growth: 0.01},
    {code: '16', name: 'PEDRO ALVES', cities: [['FLORIANO', 'PI'], ['PICOS', 'PI']], clients: 10, growth: 0, retiredOn: '2025-06-30'},
    {code: '7', name: 'VENDA DIRETA', cities: [['TERESINA', 'PI']], clients: 14, growth: 0.06, direct: true},
    {code: '12', name: 'VENDA DIRETA ATACADO', cities: [['TERESINA', 'PI']], clients: 8, growth: 0.05, direct: true}
  ];
  const REP_BY_CODE = new Map(REPS.map(r => [r.code, r]));

  // Redes fictícias (nomes legais inventados) e as lojas de cada uma.
  const NETWORKS = [
    {id: 'net-alfa', name: 'Rede Alfa', rede: 'REDE ALFA', legal: 'ALFA SUPERMERCADOS SA', pattern: '^ALFA SUPERMERCADOS (?:SA|S A)(?: |$)', rep: '7', size: 90,
      stores: [['TERESINA', 'PI'], ['TERESINA', 'PI'], ['TERESINA', 'PI'], ['PARNAÍBA', 'PI'], ['PICOS', 'PI'], ['TIMON', 'MA'], ['SÃO LUÍS', 'MA'], ['IMPERATRIZ', 'MA']]},
    {id: 'net-beta', name: 'Atacarejo Beta', rede: 'ATACAREJO BETA', legal: 'BETA ATACAREJO LTDA', pattern: '^BETA ATACAREJO LTDA(?: |$)', rep: '12', size: 110,
      stores: [['TERESINA', 'PI'], ['TERESINA', 'PI'], ['FLORIANO', 'PI'], ['CAXIAS', 'MA'], ['PETROLINA', 'PE']]},
    {id: 'net-gama', name: 'Rede Gama', rede: 'REDE GAMA', legal: 'GAMA ATACADISTA LTDA', legalAlt: 'FARMACIAS GAMAFARMA LTDA', pattern: '^(?:GAMA ATACADISTA|FARMACIAS GAMAFARMA) LTDA(?: |$)', rep: '7', size: 55,
      stores: [['TERESINA', 'PI'], ['CAMPO MAIOR', 'PI'], ['PIRIPIRI', 'PI'], ['TERESINA', 'PI', 'alt'], ['ALTOS', 'PI', 'alt']]},
    {id: 'net-delta', name: 'Delta Distribuição', rede: 'DELTA', legal: 'DELTA DISTRIBUICAO DE ALIMENTOS SA', pattern: '^DELTA DISTRIBUICAO DE ALIMENTOS(?: (?:SA|S A))?$', rep: '12', size: 140,
      stores: [['TERESINA', 'PI'], ['SÃO LUÍS', 'MA']]},
    {id: 'net-omega', name: 'Ômega Atacado', rede: 'OMEGA ATACADO', legal: 'OMEGA ATACADO SA', pattern: '^OMEGA ATACADO (?:SA|S A)(?: |$)', rep: '7', size: 100,
      stores: [['TERESINA', 'PI'], ['IMPERATRIZ', 'MA'], ['PALMAS', 'TO'], ['JUAZEIRO', 'BA']]},
    {id: 'net-sigma', name: 'Sigma Clube', rede: 'SIGMA CLUBE', legal: 'SIGMA CLUBE DE COMPRAS LTDA', pattern: '^SIGMA CLUBE DE COMPRAS LTDA(?: |$)', rep: '12', size: 120,
      stores: [['TERESINA', 'PI'], ['SÃO LUÍS', 'MA'], ['BARREIRAS', 'BA']]}
  ];

  const PREFIXES = ['MERCADINHO', 'SUPERMERCADO', 'COMERCIAL', 'MERCEARIA', 'MERCADO', 'ATACAREJO', 'DEPOSITO', 'EMPORIO', 'PANIFICADORA', 'CASA'];
  const CORES = ['AURORA', 'BOA SAFRA', 'CAJUEIRO', 'CARNAUBA', 'ESTRELA DO NORTE', 'FAROL', 'GIRASSOL', 'HORIZONTE', 'IPE AMARELO', 'JATOBA', 'LUAR', 'MANDACARU', 'NOVA ERA', 'OASIS', 'PALMEIRAS', 'PRIMAVERA', 'RIO CLARO', 'SERRA AZUL', 'SOL NASCENTE', 'TRES IRMAOS', 'UNIAO DO BAIRRO', 'VALE VERDE', 'VITORIA', 'BURITI', 'CANAA', 'DOIS CORACOES', 'ECONOMIA', 'FAMILIA', 'GRAO DE OURO', 'LAGOA', 'MIRANTE', 'NORDESTAO', 'PONTO CERTO', 'RECANTO', 'SAO FRANCISCO', 'TIO JOCA', 'VIZINHANCA', 'BEM ESTAR', 'CENTRAL', 'PRACA'];
  const SUFFIXES = [' LTDA', ' LTDA', ' ME', ' EIRELI', '', ' LTDA ME'];
  const FIRST = ['ANTONIO', 'BEATRIZ', 'CAIO', 'DANIELA', 'ELIAS', 'FABIANA', 'GERALDO', 'IARA', 'JOAQUINA', 'LEANDRO', 'MIRIAM', 'NELSON', 'OLGA', 'PAULO', 'RAQUEL', 'SAMUEL', 'TEREZA', 'VALTER'];
  const LAST = ['ARAGAO', 'BRANDAO', 'CARDOSO', 'DUTRA', 'ESTEVES', 'FREIRE', 'GOMES', 'HOLANDA', 'LEAL', 'MACHADO', 'NUNES', 'PEIXOTO', 'QUARESMA', 'RANGEL', 'SOBRAL', 'TAVARES', 'VASCONCELOS'];

  function buildClients() {
    const used = new Set(), clients = [];
    const newCode = (...seed) => { let code; let i = 0; do { code = String(100 + Math.floor(rnd('code', ...seed, i++) * 2300)); } while (used.has(code)); used.add(code); return code; };
    const usedNames = new Set();
    const newName = (...seed) => {
      for (let i = 0; i < 50; i++) {
        let name;
        if (rnd('pf', ...seed, i) < 0.18) name = pick(FIRST, 'f', ...seed, i) + ' ' + pick(LAST, 'l', ...seed, i) + ' ' + pick(LAST, 'l2', ...seed, i);
        else name = pick(PREFIXES, 'p', ...seed, i) + ' ' + pick(CORES, 'c', ...seed, i) + pick(SUFFIXES, 's', ...seed, i);
        if (!usedNames.has(name)) { usedNames.add(name); return name; }
      }
      return 'MERCADO DEMO ' + seed.join('');
    };
    const mix = (...seed) => {
      const a = 0.45 + rnd('mA', ...seed) * 0.3, f = rnd('mF', ...seed) < 0.15 ? 0 : 0.1 + rnd('mF2', ...seed) * 0.2, s = rnd('mS', ...seed) < 0.2 ? 0 : 0.08 + rnd('mS2', ...seed) * 0.2, o = rnd('mO', ...seed) < 0.35 ? 0 : 0.03 + rnd('mO2', ...seed) * 0.12;
      const t = a + f + s + o; return {Arroz: a / t, 'Flocão': f / t, Salgadinho: s / t, Outros: o / t};
    };
    const base = (extra) => Object.assign({large: false, rede: null, fantasy: '', start: DATA_START, end: null, discount: 0.96 + 0.08 * rnd('disc', extra.code)}, extra);

    for (const rep of REPS) {
      if (rep.direct) continue;
      const weighted = rep.cities.flatMap(c => Array(c[2] || 1).fill(c));
      for (let i = 0; i < rep.clients; i++) {
        const [city, uf] = pick(weighted, 'city', rep.code, i), code = newCode(rep.code, i), r = rnd('size', code);
        const size = r < 0.55 ? 4 + rnd('s1', code) * 14 : r < 0.88 ? 18 + rnd('s2', code) * 50 : 70 + rnd('s3', code) * 160;
        const c = base({code, name: newName(rep.code, i), city, uf, repCode: rep.code, size, freq: 0.05 + rnd('freq', code) * 0.2, mix: mix(code)});
        const life = rnd('life', code);
        if (life < 0.07) c.end = addDays('2025-03-01', Math.floor(rnd('end', code) * 280)); // clientes a recuperar
        else if (life < 0.15) c.start = addDays('2025-01-15', Math.floor(rnd('start', code) * 600)); // clientes novos
        else if (life < 0.23) c.never = true; // na carteira, sem compra
        if (rep.retiredOn) c.end = rep.retiredOn;
        clients.push(c);
      }
    }
    for (const net of NETWORKS) {
      net.clientCodes = [];
      net.stores.forEach(([city, uf, alt], i) => {
        const code = newCode(net.id, i);
        net.clientCodes.push(code);
        clients.push(base({code, name: alt ? net.legalAlt : net.legal, fantasy: net.name.toUpperCase() + ' ' + (i + 1), city, uf, repCode: net.rep, size: net.size * (0.6 + rnd('ns', code) * 0.8), freq: 0.3 + rnd('nf', code) * 0.2, mix: mix(code), large: true, rede: net.rede, network: net.id}));
      });
    }
    // Clientes especiais que demonstram as regras do painel
    const special = [
      {key: 'sol1', name: 'MERCADO SOL LTDA', city: 'TERESINA', uf: 'PI', repCode: '61', size: 60, group: 'grp-sol'},
      {key: 'sol2', name: 'SOL E LUA MERCADINHO LTDA ME', city: 'ALTOS', uf: 'PI', repCode: '1', size: 35, group: 'grp-sol'},
      {key: 'ind1', name: 'JOAO ALFA DOS SANTOS', city: 'PICOS', uf: 'PI', repCode: '24', size: 12, independent: true},
      {key: 'ind2', name: 'MARIA ALFA NOGUEIRA', city: 'CAXIAS', uf: 'MA', repCode: '32', size: 9, independent: true},
      {key: 'par', name: 'DISTRIBUIDORA PARCEIRA LTDA', city: 'TERESINA', uf: 'PI', repCode: '12', size: 160, excluded: true, code: '990'},
      {key: 'out1', name: 'COMERCIAL BEM ESTAR UTILIDADES LTDA', city: 'TERESINA', uf: 'PI', repCode: '61', size: 20, onlyOutros: true},
      {key: 'grp1', name: 'MERCANTIL VALE VERDE LTDA', city: 'TERESINA', uf: 'PI', repCode: '7', size: 70, group: 'grp-vale'},
      {key: 'grp2', name: 'VALE VERDE ATACADO LTDA', city: 'TIMON', uf: 'MA', repCode: '7', size: 60, group: 'grp-vale'},
      ...Array.from({length: 9}, (_, i) => ({key: 'dir' + i, name: newName('direct', i), city: pick([['TERESINA', 'PI'], ['TERESINA', 'PI'], ['PARNAÍBA', 'PI'], ['TIMON', 'MA']], 'dc', i)[0], uf: 'PI', repCode: i < 6 ? '7' : '12', size: 35 + rnd('ds', i) * 80}))
    ];
    for (const s of special) {
      if (s.key.startsWith('dir') && s.city === 'TIMON') s.uf = 'MA';
      const code = s.code || newCode('special', s.key);
      used.add(code);
      clients.push(base({code, name: s.name, city: s.city, uf: s.uf, repCode: s.repCode, size: s.size, freq: 0.2 + rnd('sf', code) * 0.25, mix: s.onlyOutros ? {Arroz: 0, 'Flocão': 0, Salgadinho: 0, Outros: 1} : mix(code), group: s.group || null, independent: Boolean(s.independent), excluded: Boolean(s.excluded)}));
    }
    return clients.sort((a, b) => Number(a.code) - Number(b.code));
  }

  const CLIENTS = buildClients();
  const CLIENT_BY_CODE = new Map(CLIENTS.map(c => [c.code, c]));

  // ---------- vendas diárias ----------
  const SEASON = [0.92, 0.88, 0.97, 0.95, 1.0, 0.98, 1.02, 1.03, 1.0, 1.04, 1.06, 1.16];
  const PRICE = {Arroz: 118, 'Flocão': 29.5, Salgadinho: 33.8, Outros: 46};
  const CATS = ['Arroz', 'Flocão', 'Salgadinho', 'Outros'];

  function dayPurchase(c, date, wd = weekday(date)) {
    if (c.never || date < c.start || (c.end && date > c.end) || date < DATA_START) return null;
    if (wd === 0) return null;
    const month = Number(date.slice(5, 7)), year = Number(date.slice(0, 4));
    const rep = REP_BY_CODE.get(c.repCode), years = (year - 2025) + (month - 1) / 12;
    const growth = Math.pow(1 + (rep?.growth ?? 0.05) + (rnd('cg', c.code) - 0.5) * 0.12, years);
    let p = c.freq * SEASON[month - 1] * (wd === 6 ? 0.55 : 1) * Math.min(1.25, growth);
    if (Number(date.slice(8, 10)) <= 10) p *= 1.15;
    if (rnd('buy', c.code, date) >= p) return null;
    const out = {fardos: {}, sales: {}};
    let any = false;
    const months = (year - 2024) * 12 + month - 1, inflation = Math.pow(1.0035, months);
    for (const k of CATS) {
      const w = c.mix[k];
      if (!w || rnd('cat', c.code, date, k) > 0.55 + w) { out.fardos[k] = 0; out.sales[k] = 0; continue; }
      const qty = Math.max(1, Math.round(c.size * w * (0.55 + 0.9 * rnd('q', c.code, date, k)) * Math.max(0.6, growth)));
      const price = PRICE[k] * inflation * c.discount * (0.97 + 0.06 * rnd('pr', c.code, date, k));
      out.fardos[k] = qty; out.sales[k] = round2(qty * price); any = true;
    }
    return any ? out : null;
  }

  function today() { return saoPauloNow().date; }
  function updatedAt() { const n = saoPauloNow(); return n.date + ' ' + (n.time < '07:40:00' ? n.time : '07:40:00'); }

  function openOrders(c, date) {
    if (c.never || date < c.start || (c.end && date > c.end) || rnd('ord', c.code, date) > (c.large ? 0.22 : 0.07)) return null;
    const count = 1 + Math.floor(rnd('oc', c.code, date) * (c.large ? 3 : 2)), orders = [];
    for (let i = 0; i < count; i++) orders.push(50000 + (hash(c.code + date + i) % 9000) * 3 + i);
    const value = round2(c.size * (0.6 + rnd('ov', c.code, date)) * 80 * count);
    return {orders, value};
  }

  const periodCache = new Map();
  function commercial(inicio, fim) {
    const key = inicio + '|' + fim, now = today();
    if (periodCache.has(key)) return periodCache.get(key);
    const end = fim > now ? now : fim, rows = [], days = [];
    for (let d = inicio; d <= end; d = addDays(d, 1)) days.push([d, weekday(d)]);
    for (const c of CLIENTS) {
      const fardos = {Arroz: 0, 'Flocão': 0, Salgadinho: 0, Outros: 0}, sales = {Arroz: 0, 'Flocão': 0, Salgadinho: 0, Outros: 0};
      let last = null;
      for (const [d, wd] of days) {
        if (wd === 0) continue;
        const p = dayPurchase(c, d, wd);
        if (!p) continue;
        last = d;
        for (const k of CATS) { fardos[k] += p.fardos[k]; sales[k] = round2(sales[k] + p.sales[k]); }
      }
      const pending = fim >= now && inicio <= now ? openOrders(c, now) : null;
      if (!last && !pending) continue;
      const rep = REP_BY_CODE.get(c.repCode);
      rows.push({cod_cliente: c.code, cod_rep: c.repCode, name: c.name, city: c.city + ' / ' + c.uf, rep: rep.name, large: c.large, rede: c.rede, sales, fardos, ult_faturamento: last, a_faturar: pending ? pending.value : 0, pedidos: pending ? pending.orders : []});
    }
    const payload = {inicio, fim, atualizado_em: updatedAt(), clientes: rows};
    periodCache.set(key, payload);
    if (periodCache.size > 400) periodCache.delete(periodCache.keys().next().value);
    return payload;
  }

  const OUTROS_PRODUCTS = [['OT-101', 'Feijão carioca Demo 1 kg'], ['OT-102', 'Açúcar cristal Demo 2 kg'], ['OT-103', 'Macarrão espaguete Demo 500 g'], ['OT-104', 'Farinha de mandioca Demo 1 kg'], ['OT-105', 'Fubá Demo 500 g'], ['OT-106', 'Tapioca Demo 500 g'], ['OT-107', 'Milho de pipoca Demo 500 g'], ['OT-108', 'Biscoito cream cracker Demo 400 g']];
  function outros(inicio, fim) {
    const totalCents = commercial(inicio, fim).clientes.reduce((n, r) => n + Math.round(r.sales.Outros * 100), 0);
    const weights = OUTROS_PRODUCTS.map(([code]) => 0.3 + rnd('ow', code, inicio.slice(0, 7))), sum = weights.reduce((a, b) => a + b, 0);
    let rest = totalCents;
    const produtos = OUTROS_PRODUCTS.map(([cod, produto], i) => {
      const cents = i === OUTROS_PRODUCTS.length - 1 ? rest : Math.floor(totalCents * weights[i] / sum);
      rest -= cents; return {cod, produto, faturado: cents / 100};
    }).filter(p => p.faturado !== 0);
    return {inicio, fim, atualizado_em: updatedAt(), produtos};
  }

  // ---------- cadastros (sementes) ----------
  function auxiliarySeed() {
    const medium = CLIENTS.filter(c => !c.large && !c.never && !c.end && !c.excluded && !c.independent && !c.group && c.size > 25 && c.start <= '2025-01-01');
    const chosen = [];
    for (const c of medium) { if (chosen.length >= 8) break; if (!chosen.some(x => x.repCode === c.repCode)) chosen.push(c); }
    const topRetailers = chosen.map((c, i) => ({id: 'top-' + (i + 1), name: c.name, clientCodes: [c.code], city: c.city + ' / ' + c.uf, rep: REP_BY_CODE.get(c.repCode).name, acceptedAt: addDays('2026-02-02', i * 11), notes: i === 0 ? 'Participante de exemplo (dados fictícios).' : ''}));
    return {
      schemaVersion: 1, revision: 1, updatedAt: '2026-01-05T12:00:00Z', topRetailers,
      largeNetworks: NETWORKS.map(n => ({id: n.id, name: n.name, clientCodes: n.clientCodes.slice(), namePatterns: [n.pattern], excludedClientCodes: []})),
      clientGroups: [
        {id: 'grp-sol', name: 'Mercado Sol', clientCodes: CLIENTS.filter(c => c.group === 'grp-sol').map(c => c.code), namePatterns: ['^(?:MERCADO SOL LTDA|SOL E LUA MERCADINHO LTDA ME)$']},
        {id: 'grp-vale', name: 'Vale Verde', clientCodes: CLIENTS.filter(c => c.group === 'grp-vale').map(c => c.code), namePatterns: ['^(?:MERCANTIL VALE VERDE|VALE VERDE ATACADO) LTDA$']}
      ],
      representativeAliases: [{code: '1', alias: 'Ana Paula'}, {code: '27', alias: 'Eduardo'}, {code: '96', alias: 'Natália'}, {code: '29', alias: 'Fernanda'}, {code: '110', alias: 'Otávio'}],
      independentClientCodes: [],
      independentNames: ['JOAO ALFA DOS SANTOS', 'MARIA ALFA NOGUEIRA']
    };
  }

  function monthsBack(n) { const [y, m] = today().split('-').map(Number), out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(d.toISOString().slice(0, 7)); } return out; }
  function planningSeed(aux) {
    const goals = [];
    aux.topRetailers.forEach((top, i) => {
      const c = CLIENT_BY_CODE.get(top.clientCodes[0]);
      monthsBack(3).forEach((month, j) => {
        const f = (k, mult) => Math.max(1, Math.ceil(c.size * c.freq * 26 * c.mix[k] * mult * (1 + j * 0.1)));
        goals.push({id: 'goal-' + top.id + '-' + month, topRetailerId: top.id, month, metric: 'fardos', categories: {Arroz: f('Arroz', 1.05), 'Flocão': c.mix['Flocão'] ? f('Flocão', 1.1) : 0, Salgadinho: c.mix.Salgadinho ? f('Salgadinho', 1.1) : 0}});
      });
      if (i % 3 === 0) goals.forEach(g => { if (g.topRetailerId === top.id) { const sum = g.categories.Arroz + g.categories['Flocão'] + g.categories.Salgadinho; if (!sum) g.categories.Arroz = 10; } });
    });
    return {schemaVersion: 1, revision: 1, updatedAt: '2026-01-05T12:00:00Z', goals, clientCatalog: null};
  }

  function clientCatalog() {
    return {
      source: {name: 'Base de clientes fictícia (demo)', importedAt: null, rowCount: CLIENTS.length},
      clients: CLIENTS.map(c => ({code: c.code, name: c.name, fantasy: c.fantasy || '', city: c.city + ' / ' + c.uf, uf: c.uf, rep: REP_BY_CODE.get(c.repCode).name, repCode: c.repCode, status: c.end && c.end < '2025-12-31' ? 'Inativo' : 'Ativo'}))
    };
  }

  function contact(code) {
    const c = CLIENT_BY_CODE.get(code);
    if (!c) return null;
    const streets = ['Rua das Acácias', 'Avenida Central', 'Rua do Comércio', 'Rua Projetada A', 'Avenida dos Ipês', 'Travessa da Feira'];
    const hoods = ['Centro', 'Bairro Novo', 'Jardim Demo', 'Vila Exemplo', 'Setor Comercial'];
    const n = hash('tel' + code);
    return {code, phones: ['(00) 9' + String(1000 + n % 9000) + '-' + String(1000 + (n >>> 8) % 9000)], address: pick(streets, 'st', code), number: String(10 + n % 990), neighborhood: pick(hoods, 'hd', code), postalCode: '00000-' + String(100 + n % 900), city: c.city, uf: c.uf};
  }

  function ordersPayload() {
    const now = today(), rows = [];
    for (const c of CLIENTS) {
      const o = openOrders(c, now);
      if (o) rows.push({clientCode: c.code, clientName: c.name, city: c.city + ' / ' + c.uf, repCode: c.repCode, repName: REP_BY_CODE.get(c.repCode).name, aFaturar: o.value, orders: o.orders});
    }
    const startedOn = addDays(now, -34), snapshots = [], newByDay = {}, reps = {};
    for (const r of REPS) if (!r.retiredOn) reps[r.code] = r.name;
    for (let d = startedOn; d <= now; d = addDays(d, 1)) {
      if (weekday(d) === 0) continue;
      let open = 0; const byRep = {};
      for (const c of CLIENTS) { const o = openOrders(c, d); if (!o) continue; open += o.orders.length; if (d !== startedOn) byRep[c.repCode] = (byRep[c.repCode] || 0) + Math.max(1, Math.round(o.orders.length * 0.6)); }
      snapshots.push({sourceUpdatedAt: d + ' 07:40:00', date: d, open});
      if (d !== startedOn) newByDay[d] = byRep;
    }
    return {current: {sourceUpdatedAt: updatedAt(), date: now, rows}, history: {schemaVersion: 1, startedOn, snapshots, reps, newByDay}};
  }

  const API = {COMPANY, CLIENTS, REPS, NETWORKS, commercial, outros, auxiliarySeed, planningSeed, clientCatalog, contact, ordersPayload, today};
  global.BI_DEMO = API;

  // ---------- interceptação do fetch (somente no navegador) ----------
  if (typeof global.fetch !== 'function' || typeof global.location === 'undefined') return;
  const realFetch = global.fetch.bind(global);
  const memory = {};
  const store = {
    get(key, seed) { try { const v = global.localStorage.getItem(key); if (v) return JSON.parse(v); } catch {} return memory[key] || (memory[key] = seed()); },
    set(key, value) { memory[key] = value; try { global.localStorage.setItem(key, JSON.stringify(value)); } catch {} }
  };
  const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json; charset=utf-8'}});
  const fail = (status, code, message) => json({error: {code, message}, message}, status);
  const wait = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Consulta cancelada.', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Consulta cancelada.', 'AbortError')); }, {once: true});
  });
  const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

  async function handle(url, init) {
    const method = (init.method || 'GET').toUpperCase(), name = url.pathname.split('/').pop();
    await wait(40 + Math.floor(Math.random() * 90), init.signal);
    if (name === 'comercial.php') {
      const inicio = url.searchParams.get('inicio'), fim = url.searchParams.get('fim'), tipo = url.searchParams.get('tipo');
      if (!validDate(inicio) || !validDate(fim) || inicio > fim) return fail(400, 'invalid_period', 'Informe inicio e fim válidos.');
      return json(tipo === 'outros' ? outros(inicio, fim) : commercial(inicio, fim));
    }
    if (name === 'auxiliary.php') {
      const current = store.get('bi-demo-auxiliary', auxiliarySeed);
      if (method === 'GET') return json(current);
      const body = JSON.parse(init.body || '{}');
      if (body.baseRevision !== current.revision) return json({error: {code: 'revision_conflict', message: 'Outra pessoa alterou o cadastro.'}, currentRevision: current.revision}, 409);
      const saved = {...body.data, revision: current.revision + 1, updatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z')};
      store.set('bi-demo-auxiliary', saved); return json(saved);
    }
    if (name === 'planning.php') {
      const current = store.get('bi-demo-planning', () => planningSeed(store.get('bi-demo-auxiliary', auxiliarySeed)));
      if (method === 'GET') return json(current);
      const body = JSON.parse(init.body || '{}');
      if (body.baseRevision !== current.revision) return json({error: {code: 'revision_conflict', message: 'O planejamento mudou.'}, currentRevision: current.revision}, 409);
      const saved = {...body.data, revision: current.revision + 1, updatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z')};
      store.set('bi-demo-planning', saved); return json(saved);
    }
    if (name === 'orders.php') return json(ordersPayload());
    if (name === 'client-contact.php') {
      const value = contact(String(url.searchParams.get('code') || '').replace(/^0+(?=\d)/, ''));
      return value ? json(value) : fail(404, 'not_found', 'Cliente não encontrado na base de contatos (demo).');
    }
    return fail(404, 'not_found', 'Endpoint não disponível na demonstração.');
  }

  global.fetch = function (input, init = {}) {
    let url;
    try { url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, global.location.href); } catch { return realFetch(input, init); }
    if (url.origin === global.location.origin && /\/api\/[a-z-]+\.php$/.test(url.pathname)) {
      const merged = input instanceof Request ? {method: input.method, signal: input.signal, ...init} : init;
      return handle(url, merged);
    }
    return realFetch(input, init);
  };
})(typeof window !== 'undefined' ? window : globalThis);
