'use strict';
let auxiliaryData=null,sharedIdentityResolver=null,sharedRankingEligibility=null,lastCommercialPayload=null,auxiliaryLoadError=false,territorySelectedClientCode=null;

'use strict';
// Consulta somente por GET; nenhuma credencial ou cópia da base comercial fica incorporada ao arquivo.
const API_URL=new URL('../../api/comercial.php',location.href).href;
const categories=['Arroz','Flocão','Salgadinho','Outros'];
const rankingCategories=['Arroz','Flocão','Salgadinho'];
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2});
const quantity=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0});
const quantityAverage=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0});
const FARDOS_SCALE=1000000;
let metricMode='fardos',preferredMetric='fardos',fardosAvailable=false,metricBusy=false;
const percent=new Intl.NumberFormat('pt-BR',{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1});
const timestamp=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'});
const $=id=>document.getElementById(id);
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toCents=value=>Math.round(value*100);
const toFardosUnits=value=>Math.round(value*FARDOS_SCALE);
const metricScale=()=>metricMode==='sales'?100:FARDOS_SCALE;
const toMetricUnits=value=>metricMode==='sales'?toCents(value):toFardosUnits(value);
const categoryValue=(client,category)=>client[metricMode][category];
const total=c=>categories.reduce((a,k)=>a+toMetricUnits(categoryValue(c,k)),0)/metricScale();
const sum=(list,fn=total)=>list.reduce((a,c)=>a+toMetricUnits(fn(c)),0)/metricScale();
const formatValue=value=>metricMode==='sales'?money.format(value):quantity.format(Math.trunc(value)||0);
const formatAverage=value=>metricMode==='sales'?money.format(value):quantityAverage.format(Math.trunc(value)||0);
const unitDescription=()=>metricMode==='sales'?'em reais':'em fardos';
const rank=(list,fn=total)=>[...list].sort((a,b)=>fn(b)-fn(a)||a.name.localeCompare(b.name,'pt-BR')||a.city.localeCompare(b.city,'pt-BR')||a.sourceIndex-b.sourceIndex);
const normalizeName=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleUpperCase('pt-BR').replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
// Regra comercial: Outros entra nos totais, mas não pontua nos rankings.
// A exclusão do cliente DISTRIBUIDORA PARCEIRA é aplicada aos cadastros antes de agrupar redes.
const rankingTotal=c=>rankingCategories.reduce((value,category)=>value+toMetricUnits(categoryValue(c,category)),0)/metricScale();
const hasRankingMovement=c=>rankingCategories.some(category=>categoryValue(c,category)!==0);
const excludedFromRanking=c=>c.codCliente.replace(/^0+(?=\d)/,'')==='990'||['DISTRIBUIDORA PARCEIRA LTDA','DISTRIBUIDORA PARCEIRA'].includes(normalizeName(c.name));
const rankingEligibleClients=list=>list.filter(c=>(sharedRankingEligibility?sharedRankingEligibility(c):!excludedFromRanking(c))&&hasRankingMovement(c));
const nameCityKey=c=>JSON.stringify([normalizeName(c.name).replace(/\bS A$/,'SA'),normalizeName(c.city)]);
// Identidades confirmadas pela supervisão e nomes corporativos presentes na base.
// Correspondências restritas ao nome legal evitam misturar um sobrenome com uma rede.
const networkRules=[
  {key:'rede_alfa',name:'Rede Alfa',pattern:/^ALFA SUPERMERCADOS (?:SA|S A)(?: |$)/},
  {key:'atacarejo_beta',name:'Atacarejo Beta',pattern:/^BETA ATACAREJO LTDA(?: |$)/},
  {key:'rede_gama',name:'Rede Gama',pattern:/^(?:GAMA ATACADISTA|FARMACIAS GAMAFARMA) LTDA(?: |$)/},
  {key:'delta',name:'Delta Distribuição',pattern:/^DELTA DISTRIBUICAO DE ALIMENTOS(?: (?:SA|S A))?$/},
  {key:'omega_atacado',name:'Ômega Atacado',pattern:/^OMEGA ATACADO (?:SA|S A)(?: |$)/},
  {key:'sigma_clube',name:'Sigma Clube',pattern:/^SIGMA CLUBE DE COMPRAS LTDA(?: |$)/}
];
const customerRules=[
  {key:'mercado_sol',name:'Mercado Sol',pattern:/^(?:MERCADO SOL LTDA|SOL E LUA MERCADINHO LTDA ME)$/},
  {key:'vale_verde',name:'Vale Verde',pattern:/^(?:MERCANTIL VALE VERDE|VALE VERDE ATACADO) LTDA$/}
];
const independentNames=new Set(['JOAO ALFA DOS SANTOS','MARIA ALFA NOGUEIRA']);
function resolveFallbackClientIdentity(row){
  const normalized=normalizeName(row.name),network=normalizeName(row.rede??''),rule=networkRules.find(rule=>rule.pattern.test(normalized)&&(!rule.requiresNetwork||rule.requiresNetwork.includes(network)));
  if(rule)return {key:'network:'+rule.key,name:rule.name,network:rule.name,large:true};
  const customer=customerRules.find(rule=>rule.pattern.test(normalized));
  return customer?{key:'customer:'+customer.key,name:customer.name,network:row.rede??null,large:row.large}:null;
}
const clientKey=c=>c.groupKey||nameCityKey(c);
let clients=[],includeNetworks=true,hasLoaded=false,loading=false,lastSuccess=null,loadedPeriod=null,loadedSelection=null,loadedQueryDay=null,activeView='ranking';
let missingOutrosCount=0,outrosRequestId=0,outrosController=null;
let outrosDetail={status:'idle',products:[],totalCents:0,message:''};
const regionalUFs=new Set(REGION_STATES.map(s=>s.uf));
const municipalityIndex=new Map(MUNICIPALITIES.map(city=>[JSON.stringify([normalizeName(city.name),city.uf]),city]));
const territoryIndex=new Map(TERRITORY_MAPS.map(state=>[state.uf,state]));
let mapState='PI',territoryView='overview',mapView=[...territoryIndex.get('PI').viewBox],mapDrag=null,mapDragMoved=false;
let municipalValues=new Map();
const currentTerritory=()=>territoryIndex.get(mapState);
const currentMunicipalities=()=>currentTerritory().municipalities;
const stateShareLabel=()=>mapState==='PI'?'Participação no Piauí':'Participação no estado';
function dashboardToday(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function selectionPeriod(start,end,today=dashboardToday()){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(start)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(end)||Number(start.slice(0,4))<1||Number(end.slice(0,4))<1)throw new Error('Informe o mês inicial e o mês final.');
  if(start>end)throw new Error('O mês inicial deve ser anterior ou igual ao mês final.');
  if(end>today.slice(0,7))throw new Error('Não é possível consultar meses futuros.');
  const last=new Date(0);last.setUTCHours(0,0,0,0);last.setUTCFullYear(Number(end.slice(0,4)),Number(end.slice(5)),0);
  return {inicio:start+'-01',fim:end===today.slice(0,7)?today:end+'-'+String(last.getUTCDate()).padStart(2,'0')};
}
function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
const dateLabel=value=>value.slice(8)+'/'+value.slice(5,7)+'/'+value.slice(0,4);
const periodLabel=period=>dateLabel(period.inicio)+' a '+dateLabel(period.fim);
function parseLocation(city){
  const text=city.trim(),match=text.match(/^(.*?)\s*\/\s*([a-z]{2})$/i),cityName=(match?match[1].trim():text)||'Cidade não informada',uf=match?match[2].toUpperCase():'';
  return {cityKey:JSON.stringify([normalizeName(cityName),uf]),cityName,uf,cityLabel:uf?cityName+' / '+uf:cityName};
}
function networkClients(){return clients.filter(c=>includeNetworks||!c.large);}
function representativeLabel(code,name,includeOriginal=false){
  const alias=window.BICore?.representatives?.representativeAlias(code,auxiliaryData)||'';
  return alias?alias+(includeOriginal?' · '+name:''):name;
}
function rankingClients(){const city=$('city').value;return networkClients().filter(c=>city==='all'||c.cityKey===city);}
function cityCatalog(list){return [...new Map(list.map(c=>[c.cityKey,{key:c.cityKey,label:c.cityLabel,name:c.cityName,uf:c.uf}])).values()].sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'));}
function updateCityFilter(){
  const selected=$('city').value,cities=cityCatalog(clients);
  $('city').innerHTML='<option value="all">Todas as cidades</option>'+cities.map(c=>'<option value="'+escapeHtml(c.key)+'">'+escapeHtml(c.label)+'</option>').join('');
  $('city').value=cities.some(c=>c.key===selected)?selected:'all';$('city').disabled=!cities.length;
}
function updateRegionalCityFilter(){
  const selected=$('regional-city').value,cities=[...currentMunicipalities()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  $('regional-city').innerHTML='<option value="all">Todos os municípios</option>'+cities.map(c=>'<option value="'+escapeHtml(c.key)+'">'+escapeHtml(c.name)+'</option>').join('');
  $('regional-city').value=cities.some(c=>c.key===selected)?selected:'all';$('regional-city').disabled=false;
}
function updateRegionalSellerFilter(){
  const selected=$('regional-seller').value,reps=[...new Map(networkClients().filter(c=>c.uf===mapState).map(c=>[c.codRep,c.rep])).entries()].sort((a,b)=>representativeLabel(a[0],a[1]).localeCompare(representativeLabel(b[0],b[1]),'pt-BR')||a[0].localeCompare(b[0]));
  $('regional-seller').innerHTML='<option value="all">Todos os vendedores</option>'+reps.map(([code,name])=>'<option value="'+escapeHtml(code)+'">'+escapeHtml(representativeLabel(code,name,true)+' · Cód. '+code)+'</option>').join('');
  $('regional-seller').value=reps.some(([code])=>code===selected)?selected:'all';$('regional-seller').disabled=!reps.length;
}
function regionalBase(){const seller=$('regional-seller').value;return networkClients().filter(c=>c.uf===mapState&&(seller==='all'||c.codRep===seller));}
function groupClients(list){
  const groups=new Map(),mode=$('aggregation').value;
  for(const client of list){
    const key=mode==='id'?client.codCliente:mode==='name_city'?nameCityKey(client):clientKey(client);let group=groups.get(key);
    if(!group){group={...client,name:mode==='client'&&client.groupName?client.groupName:client.name,sales:Object.fromEntries(categories.map(k=>[k,0])),salesCents:Object.fromEntries(categories.map(k=>[k,0])),fardosUnits:Object.fromEntries(categories.map(k=>[k,0])),completeFardos:true,representatives:new Set(),representativeLabels:new Map(),clientCodes:new Set(),cities:new Set()};groups.set(key,group);}
    for(const category of categories){group.salesCents[category]+=toCents(client.sales[category]);if(client.fardos)group.fardosUnits[category]+=toFardosUnits(client.fardos[category]);}
    group.completeFardos=group.completeFardos&&Boolean(client.fardos);
    group.representatives.add(client.rep);group.representativeLabels.set(client.codRep,representativeLabel(client.codRep,client.rep));group.clientCodes.add(client.codCliente);group.cities.add(normalizeName(client.city));group.large=group.large||client.large;
  }
  return [...groups.values()].map(group=>({...group,sales:Object.fromEntries(categories.map(k=>[k,group.salesCents[k]/100])),fardos:group.completeFardos?Object.fromEntries(categories.map(k=>[k,group.fardosUnits[k]/FARDOS_SCALE])):null,repDisplay:[...new Set(group.representativeLabels.values())].sort((a,b)=>a.localeCompare(b,'pt-BR')).join(', '),rep:[...group.representatives].sort((a,b)=>a.localeCompare(b,'pt-BR')).join(', ')}));
}
function readFardos(row,index){
  if(!Object.prototype.hasOwnProperty.call(row,'fardos'))return null;
  if(!row.fardos||typeof row.fardos!=='object'||Array.isArray(row.fardos))throw new Error('Quantidades em fardos inválidas no registro '+(index+1)+'.');
  for(const key of Object.keys(row.fardos))if(!categories.includes(key)&&row.fardos[key]!==0)throw new Error('Categoria de fardos não reconhecida: '+key+'. Solicite a revisão da integração.');
  const fardos={};let complete=true;
  for(const category of categories){
    if(!Object.prototype.hasOwnProperty.call(row.fardos,category)){complete=false;continue;}
    const value=row.fardos[category],units=toFardosUnits(value);
    if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(units)||Math.abs(value*FARDOS_SCALE-units)>0.0001)throw new Error('Quantidade de '+category+' em fardos inválida no registro '+(index+1)+'.');
    fardos[category]=units/FARDOS_SCALE;
  }
  return complete?fardos:null;
}
function validateResponse(payload,expectedPeriod){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Array.isArray(payload.clientes))throw new Error('A API deve retornar um objeto com a lista clientes e o período inicio/fim.');
  if(!validDate(payload.inicio)||!validDate(payload.fim)||payload.inicio>payload.fim)throw new Error('A API retornou um período inválido.');
  if(!expectedPeriod||payload.inicio!==expectedPeriod.inicio||payload.fim!==expectedPeriod.fim)throw new Error('A API não confirmou o período solicitado. Os valores desta resposta não foram utilizados.');
  if(payload.atualizado_em!=null&&typeof payload.atualizado_em!=='string')throw new Error('A data de atualização da API é inválida.');
  const clientCodes=new Set(),repNames=new Map();let missingOutros=0,missingFardos=0;
  const next=payload.clientes.map((row,index)=>{
    if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Registro '+(index+1)+' inválido.');
    for(const field of ['name','rep','city','cod_cliente','cod_rep'])if(typeof row[field]!=='string'||(field!=='city'&&!row[field].trim()))throw new Error('Campo '+field+' inválido no registro '+(index+1)+'.');
    if(typeof row.large!=='boolean')throw new Error('Classificação de rede inválida no registro '+(index+1)+'.');
    if(!row.sales||typeof row.sales!=='object'||Array.isArray(row.sales))throw new Error('Valores de vendas ausentes no registro '+(index+1)+'.');
    // Não descartar silenciosamente outra categoria se o contrato da API mudar.
    for(const key of Object.keys(row.sales))if(!categories.includes(key)&&row.sales[key]!==0)throw new Error('Categoria de vendas não reconhecida: '+key+'. Solicite a revisão da integração.');
    const sales={};
    for(const category of categories){
      // Respostas anteriores à atualização continuam utilizáveis, com aviso explícito.
      const absent=category==='Outros'&&!Object.prototype.hasOwnProperty.call(row.sales,category);
      if(absent)missingOutros++;
      const value=absent?0:row.sales[category],cents=toCents(value);
      if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(cents)||Math.abs(value*100-cents)>0.0001)throw new Error('Valor monetário de '+category+' inválido no registro '+(index+1)+'.');sales[category]=cents/100;
    }
    const fardos=readFardos(row,index);if(!fardos)missingFardos++;
    const codCliente=row.cod_cliente.trim(),codRep=row.cod_rep.trim(),rep=row.rep.trim();
    // O contrato atual retorna uma soma por cadastro; repetição de código exige revisão na origem.
    if(clientCodes.has(codCliente))throw new Error('A API repetiu o código de cliente '+codCliente+'. A resposta não foi somada para evitar duplicidade.');
    clientCodes.add(codCliente);
    if(repNames.has(codRep)&&repNames.get(codRep)!==rep)throw new Error('A API retornou nomes divergentes para o mesmo código de representante.');repNames.set(codRep,rep);
    if(row.rede!=null&&typeof row.rede!=='string')throw new Error('Nome de rede inválido no registro '+(index+1)+'.');
    if(row.ult_faturamento!=null&&!validDate(row.ult_faturamento))throw new Error('Último faturamento inválido no registro '+(index+1)+'.');
    if(row.a_faturar!=null&&(typeof row.a_faturar!=='number'||!Number.isFinite(row.a_faturar)))throw new Error('Valor a faturar inválido no registro '+(index+1)+'.');
    const identity=resolveClientIdentity(row),independent=!auxiliaryData&&independentNames.has(normalizeName(row.name));
    return {name:row.name.trim(),rep,city:row.city.trim(),...parseLocation(row.city),large:independent?false:identity?identity.large:row.large,apiLarge:row.large,sales,fardos,codCliente,codRep,rede:independent?null:identity?.network??row.rede??null,groupKey:identity?.key??null,groupName:identity?.name??null,lastInvoice:row.ult_faturamento??null,pending:row.a_faturar??null,sourceIndex:index};
  });
  return {clients:next,period:{inicio:payload.inicio,fim:payload.fim},updatedAt:payload.atualizado_em??null,missingOutros,missingFardos};
}
function validateOutrosResponse(payload,period,expectedCents){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Array.isArray(payload.produtos))throw new Error('O detalhamento de Outros não retornou uma lista de produtos válida.');
  if(payload.inicio!==period.inicio||payload.fim!==period.fim)throw new Error('O detalhamento de Outros não confirmou o período solicitado.');
  const codes=new Set();let totalCents=0;
  const products=payload.produtos.map((row,index)=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.cod!=='string'||!row.cod.trim()||typeof row.produto!=='string'||!row.produto.trim())throw new Error('Produto inválido no detalhamento de Outros, registro '+(index+1)+'.');
    const code=row.cod.trim(),value=row.faturado,cents=toCents(value);
    if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(cents)||Math.abs(value*100-cents)>0.0001)throw new Error('Valor faturado inválido no detalhamento de Outros.');
    if(codes.has(code))throw new Error('Código de produto repetido no detalhamento de Outros.');
    codes.add(code);totalCents+=cents;
    if(!Number.isSafeInteger(totalCents))throw new Error('Total inválido no detalhamento de Outros.');
    return {code,name:row.produto.trim(),cents};
  }).sort((a,b)=>b.cents-a.cents||a.name.localeCompare(b.name,'pt-BR'));
  if(expectedCents!==null&&totalCents!==expectedCents)throw new Error('O detalhamento de Outros soma '+money.format(totalCents/100)+', mas os clientes somam '+money.format(expectedCents/100)+'. Atualize para conferir. O faturamento utiliza os valores por cliente.');
  return {products,totalCents};
}
function renderOutrosDetails(){renderCompactOutrosDetails();}
async function loadOutros(period){
  const requestId=++outrosRequestId;
  if(outrosController)outrosController.abort();
  const controller=new AbortController();outrosController=controller;
  const expectedCents=missingOutrosCount?null:clients.reduce((n,c)=>n+toCents(c.sales.Outros),0);
  outrosDetail={status:'loading',products:[],totalCents:0,message:''};renderOutrosDetails();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const url=new URL(API_URL);url.searchParams.set('tipo','outros');
    url.searchParams.set('inicio',period.inicio);url.searchParams.set('fim',period.fim);
    const response=await fetch(url.toString(),{method:'GET',headers:{Accept:'application/json'},credentials:'same-origin',cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error('Não foi possível carregar a composição de Outros (HTTP '+response.status+').');
    let payload;try{payload=await response.json();}catch{throw new Error('A composição de Outros não retornou um JSON válido.');}
    const detail=validateOutrosResponse(payload,period,expectedCents);
    if(requestId!==outrosRequestId||loadedPeriod.inicio!==period.inicio||loadedPeriod.fim!==period.fim)return;
    outrosDetail={status:'ready',...detail,message:''};
  }catch(error){
    if(requestId!==outrosRequestId)return;
    outrosDetail={status:'error',products:[],totalCents:0,message:error.name==='AbortError'?'A composição de Outros demorou mais que o esperado. Tente atualizar novamente.':error instanceof TypeError?'Não foi possível consultar a composição de Outros. Tente atualizar novamente.':error.message};
  }finally{
    clearTimeout(timer);if(requestId===outrosRequestId){outrosController=null;renderOutrosDetails();}
  }
}
function rows(list,denominator,fn=total,showRep=false){
  if(!list.length)return '<tr><td colspan="4" class="empty">Nenhum registro neste filtro.</td></tr>';
  return list.map((c,i)=>{
    const value=fn(c),share=denominator>0?value/denominator:null,bar=Math.max(0,Math.min(100,(share??0)*100));
    const code=$('aggregation').value==='id'?' · Cód. '+c.codCliente:c.clientCodes.size>1?' · '+c.clientCodes.size+' cadastros somados':'';
    const city=c.cities.size>1?c.cities.size+' cidades':c.city;
    return '<tr><td><span class="rank '+(i<3?'podium':'')+'">'+String(i+1).padStart(2,'0')+'</span></td><td class="client">'+escapeHtml(c.name)+(c.large?'<span class="badge">Grande Rede</span>':'')+topRetailerBadge(c)+'<small title="'+escapeHtml(c.rep)+'">'+escapeHtml((showRep?(c.repDisplay||c.rep)+' · '+city:city)+code)+'</small></td><td class="money">'+formatValue(value)+'</td><td class="barcol"><div class="barline"><div class="track" aria-hidden="true"><div class="fill" style="width:'+bar.toFixed(3)+'%"></div></div><span class="pct">'+(share===null?'—':percent.format(share))+'</span></div></td></tr>';
  }).join('');
}
function topRetailerBadge(client){
  const code=value=>String(value??'').trim().replace(/^0+(?=\d)/,''),members=[...new Set([...(client.clientCodes||[client.codCliente])].map(code))].filter(Boolean);
  const participants=auxiliaryData?.topRetailers||[],registered=new Set(participants.flatMap(row=>(row.clientCodes||[]).map(code))),matched=members.filter(value=>registered.has(value));
  if(!matched.length)return '';
  const complete=matched.length===members.length,label=complete?'Top Varejista':'Top Varejista · '+matched.length+'/'+members.length+' cadastros';
  const names=participants.filter(row=>row.clientCodes?.some(value=>matched.includes(code(value)))).map(row=>row.name).join(', ');
  return '<span class="badge top-retailer-badge" title="'+escapeHtml('Participantes cadastrados: '+names)+'">'+escapeHtml(label)+'</span>';
}
function updateRepresentatives(){
  const selected=$('rep').value,representatives=[...new Map(rankingClients().map(c=>[c.codRep,c.rep])).entries()].sort((a,b)=>representativeLabel(a[0],a[1]).localeCompare(representativeLabel(b[0],b[1]),'pt-BR')||a[0].localeCompare(b[0]));
  $('rep').innerHTML=representatives.length?representatives.map(([code,name])=>'<option value="'+escapeHtml(code)+'">'+escapeHtml(representativeLabel(code,name,true)+' · Cód. '+code)+'</option>').join(''):'<option value="">Nenhum representante</option>';
  $('rep').value=representatives.some(([code])=>code===selected)?selected:representatives[0]?.[0]||'';
  $('rep').disabled=!representatives.length;
}
function updateMetricLabels(){
  const isFardos=metricMode==='fardos',button=$('metric-toggle');
  button.setAttribute('data-mode',metricMode);button.setAttribute('aria-pressed',String(isFardos));
  button.setAttribute('aria-label',isFardos?'Exibindo fardos. Alternar para reais.':'Exibindo reais. Alternar para fardos.');
  button.disabled=metricBusy||(hasLoaded&&!fardosAvailable);
  document.querySelectorAll('[data-sales-label]').forEach(node=>node.textContent=node.getAttribute(isFardos?'data-fardos-label':'data-sales-label'));
  $('municipal-legend').setAttribute('aria-label',isFardos?'Faixas de volume em fardos':'Faixas de faturamento em reais');
  $('metric-status').hidden=!hasLoaded||fardosAvailable;
  $('metric-status').textContent=hasLoaded&&!fardosAvailable?'A API não informou fardos completos para todos os clientes. Exibindo valores em R$; a troca será liberada após uma atualização com as quantidades.':'';
}
async function setMetricMode(mode,animate=true){
  if(!['sales','fardos'].includes(mode)||metricBusy||mode===metricMode||(mode==='fardos'&&hasLoaded&&!fardosAvailable))return;
  preferredMetric=mode;
  const view=$('view-'+activeView),animations=[];
  const apply=()=>{metricMode=mode==='fardos'&&hasLoaded&&!fardosAvailable?'sales':mode;hideMapTooltip();render();};
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if(!animate||reduced||typeof view.animate!=='function'){apply();return;}
  metricBusy=true;updateMetricLabels();view.setAttribute('aria-busy','true');
  try{
    const out=view.animate([{transform:'perspective(1800px) rotateY(0deg)',opacity:1},{transform:'perspective(1800px) rotateY(-90deg)',opacity:0}],{duration:180,easing:'ease-in',fill:'forwards'});animations.push(out);
    await out.finished;apply();out.cancel();
    const into=view.animate([{transform:'perspective(1800px) rotateY(90deg)',opacity:0},{transform:'perspective(1800px) rotateY(0deg)',opacity:1}],{duration:240,easing:'ease-out',fill:'forwards'});animations.push(into);await into.finished;
  }catch{apply();}
  finally{animations.forEach(animation=>animation.cancel());metricBusy=false;view.removeAttribute('aria-busy');updateMetricLabels();}
}
function render(){
  updateMetricLabels();
  $('category-coverage').hidden=!hasLoaded||missingOutrosCount===0||metricMode==='fardos';
  $('category-coverage').textContent=missingOutrosCount?'A resposta não informa a categoria Outros em '+missingOutrosCount+' cadastros. Os totais podem estar incompletos. Atualize a API para incluir essa categoria.':'';
  renderOutrosDetails();renderDashboardTrend();
  if(!hasLoaded){
    for(const id of ['revenue','count','average','concentration'])$(id).textContent='—';
    for(const id of ['overall','representative','category-ranking'])$(id).innerHTML='<tr><td colspan="4" class="empty">'+(loading?'Carregando…':'Atualize para carregar os dados.')+'</td></tr>';
    $('rep-summary').textContent='Aguardando dados';$('category-summary').textContent='Aguardando dados';$('rep').disabled=true;renderRegional();return;
  }
  const filtered=rankingClients(),grouped=groupClients(filtered),eligible=rankingEligibleClients(filtered),ranked=groupClients(eligible).filter(hasRankingMovement),revenue=sum(grouped),top=rank(ranked,rankingTotal).slice(0,20);
  
  $('revenue').textContent=formatValue(revenue);$('count').textContent=String(grouped.length);
  $('average').textContent=grouped.length?formatAverage(revenue/grouped.length):'—';
  $('concentration').textContent=revenue>0?percent.format(sum(top,rankingTotal)/revenue):'—';
  $('overall').innerHTML=rows(top,revenue,rankingTotal,true);
  const repClients=groupClients(filtered.filter(c=>c.codRep===$('rep').value)),repTotal=sum(repClients);
  const repRanked=groupClients(eligible.filter(c=>c.codRep===$('rep').value)).filter(hasRankingMovement);
  $('representative').innerHTML=rows(rank(repRanked,rankingTotal).slice(0,10),repTotal,rankingTotal);
  $('rep-summary').innerHTML='<span>'+repRanked.length+' clientes no ranking</span><span>Total no filtro: <b>'+formatValue(repTotal)+'</b></span>';
  if(!rankingCategories.includes($('category').value))$('category').value=rankingCategories[0];
  const category=$('category').value,fn=c=>categoryValue(c,category),categoryTotal=sum(grouped,fn),active=ranked.filter(c=>fn(c)!==0);
  $('category-ranking').innerHTML=rows(rank(active,fn).slice(0,20),categoryTotal,fn);
  $('category-summary').innerHTML='<span>'+escapeHtml(category)+' · '+active.length+' clientes no ranking</span><span>Total na categoria: <b>'+formatValue(categoryTotal)+'</b></span>';
  $('announcement').textContent='Painel '+unitDescription()+'. '+periodLabel(loadedPeriod)+'. '+(includeNetworks?'Com':'Sem')+' Grandes Redes. '+grouped.length+' clientes. Categoria '+category+'.';
  renderRegional();
}
function regionalData(){
  const state=$('state').value,city=$('regional-city').value,regionRows=regionalBase(),stateRows=regionRows.filter(c=>c.uf===state),localRows=stateRows.filter(c=>city==='all'||c.cityKey===city);
  return {state,city,regionRows,stateRows,localRows};
}
const hasMovement=client=>categories.some(category=>categoryValue(client,category)!==0);
function municipalityLevel(value){const bands=metricMode==='sales'?[10000,50000,100000,500000]:[100,500,1000,5000];return value<0?'negative':value===0?'0':value<=bands[0]?'1':value<=bands[1]?'2':value<=bands[2]?'3':value<=bands[3]?'4':'5';}
function mapCities(){
  const grouped=new Map();for(const row of regionalBase()){if(!grouped.has(row.cityKey))grouped.set(row.cityKey,[]);grouped.get(row.cityKey).push(row);}
  return currentMunicipalities().map(city=>{const records=grouped.get(city.key)||[];return {...city,label:city.name+' / '+city.uf,point:city,value:sum(records),count:groupClients(records).filter(hasMovement).length};});
}
function updateMap(){renderMapCities();renderMapInspector();}
function fitStateMap(){mapView=[...currentTerritory().viewBox];applyMapView();}
function applyMapView(){
  $('regional-map').setAttribute('viewBox',mapView.map(n=>n.toFixed(2)).join(' '));
  $('regional-map').setAttribute('data-zoomed','true');
  $('map-back').hidden=false;$('map-back').disabled=$('regional-city').value==='all';
  $('map-reset').disabled=false;$('map-zoom-in').disabled=mapView[3]<=currentTerritory().viewBox[3]/8;$('map-zoom-out').disabled=mapView[3]>=currentTerritory().viewBox[3];
  $('map-caption').textContent='Selecione um município para explorar seus resultados.';
}
function zoomMap(factor){
  const bounds=currentTerritory().viewBox,next=Math.max(bounds[3]/8,Math.min(bounds[3],mapView[3]*factor)),ratio=next/mapView[3],city=municipalityIndex.get($('regional-city').value),cx=city?.x??mapView[0]+mapView[2]/2,cy=city?.y??mapView[1]+mapView[3]/2;
  mapView=[cx-mapView[2]*ratio/2,cy-mapView[3]*ratio/2,mapView[2]*ratio,mapView[3]*ratio];if(next===bounds[3])mapView=[...bounds];applyMapView();hideMapTooltip();
}
function focusMunicipality(){
  const city=municipalityIndex.get($('regional-city').value);if(!city)return;
  const [x0,y0,x1,y1]=city.bounds,aspect=currentTerritory().viewBox[2]/currentTerritory().viewBox[3],height=Math.max(100,(y1-y0)*1.55,(x1-x0)*1.55/aspect),width=height*aspect;
  mapView=[(x0+x1-width)/2,(y0+y1-height)/2,width,height];applyMapView();hideMapTooltip();
}
function renderMapCities(){
  const cities=mapCities(),selected=$('regional-city').value;municipalValues=new Map(cities.map(c=>[c.key,c]));
  document.querySelectorAll('[data-map-city]').forEach(node=>{const city=municipalValues.get(node.dataset.mapCity);node.setAttribute('data-level',hasLoaded?municipalityLevel(city.value):'0');node.setAttribute('aria-pressed',String(city.key===selected));node.setAttribute('aria-label',city.name+(hasLoaded?' — '+formatValue(city.value):' — aguardando dados'));});
  const coverage=cities.filter(c=>c.value>0).length,unmatched=cityCatalog(regionalBase()).filter(c=>!municipalityIndex.has(c.key));
  $('map-city-status').hidden=false;$('map-city-status').textContent=hasLoaded?coverage+' municípios com movimento · '+currentMunicipalities().length+' no estado'+(unmatched.length?' · '+unmatched.length+' cidades sem correspondência no mapa':''):currentMunicipalities().length+' municípios · '+currentTerritory().name;
  $('map-negative-legend').hidden=!cities.some(c=>c.value<0);$('map-cities').setAttribute('aria-busy',String(!hasLoaded));
  $('map-focus-city').disabled=selected==='all';applyMapView();
}
function renderMapInspector(){
  const key=$('regional-city').value,selected=municipalValues.get(key),base=regionalBase(),stateTotal=sum(base),rows=key==='all'?base:base.filter(c=>c.cityKey===key),count=groupClients(rows).filter(hasMovement).length,value=sum(rows);
  $('map-inspector-label').textContent=selected?'Município selecionado':'Panorama do estado';$('map-inspector-name').textContent=selected?selected.name:currentTerritory().name;
  $('map-inspector-revenue').textContent=hasLoaded?formatValue(value):'—';$('map-inspector-count').textContent=hasLoaded?String(count):'—';
  $('map-selection-name').textContent=selected?selected.name:currentTerritory().name;$('map-selection-value').textContent=hasLoaded?formatValue(value):'—';$('map-view-details').disabled=!hasLoaded;
  $('map-inspector-share-label').textContent=selected?stateShareLabel():'Municípios com vendas';
  $('map-inspector-share').textContent=!hasLoaded?'—':selected?(stateTotal>0?percent.format(value/stateTotal):'—'):String([...municipalValues.values()].filter(c=>c.value>0).length);
}
function showMapTooltip(key,event){
  if(mapDragMoved&&mapDrag)return;const city=municipalValues.get(key);if(!city)return;
  $('map-tooltip-name').textContent=city.name;$('map-tooltip-value').textContent=hasLoaded?formatValue(city.value):'Aguardando dados';$('map-tooltip-detail').textContent=hasLoaded?(city.count?city.count+' clientes com movimento':'Sem movimento no filtro'):'';
  const rect=$('map-canvas').getBoundingClientRect(),x=Number.isFinite(event?.clientX)?event.clientX-rect.left+15:16,y=Number.isFinite(event?.clientY)?event.clientY-rect.top+15:16;
  $('map-tooltip').style.left=Math.max(10,Math.min(x,rect.width-220))+'px';$('map-tooltip').style.top=Math.max(10,Math.min(y,rect.height-95))+'px';$('map-tooltip').hidden=false;
}
function hideMapTooltip(){$('map-tooltip').hidden=true;}
function renderCityList(){
  const query=normalizeName($('municipality-search').value),selected=$('regional-city').value,cities=[...municipalValues.values()].filter(c=>normalizeName(c.name).includes(query)).sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name,'pt-BR'));
  $('city-search-count').textContent=cities.length+' municípios';
  $('regional-city-list').innerHTML=cities.length?cities.map(c=>'<button type="button" class="city-item" data-city="'+escapeHtml(c.key)+'" aria-pressed="'+String(c.key===selected)+'"><span>'+escapeHtml(c.name)+'</span><strong>'+(!hasLoaded?'—':c.value===0?'Sem movimento':formatValue(c.value))+'</strong></button>').join(''):'<p class="empty">Nenhum município encontrado.</p>';
  document.querySelectorAll('[data-city]').forEach(button=>button.addEventListener('click',()=>selectRegionalCity(button.dataset.city)));
}
function renderRegional(){
  renderStateOverview();
  updateMap();renderCityList();
  $('regional-details').hidden=!hasLoaded;$('regional-empty').hidden=hasLoaded;
  if(!hasLoaded){$('regional-empty').textContent=loading?'Carregando os indicadores de '+currentTerritory().name+'…':'Atualize para carregar os indicadores de '+currentTerritory().name+'.';return;}
  const {stateRows,localRows,city}=regionalData(),grouped=groupClients(localRows),active=grouped.filter(hasMovement),revenue=sum(grouped),stateTotal=sum(stateRows),selectedCity=municipalityIndex.get(city);
  $('region-title').textContent=selectedCity?selectedCity.name:currentTerritory().name;$('region-subtitle').textContent=(selectedCity?'Indicadores do município · ':'Indicadores de todos os municípios · ')+mapState;
  $('regional-revenue').textContent=formatValue(revenue);$('regional-count').textContent=String(active.length);$('regional-average').textContent=active.length?formatAverage(revenue/active.length):'—';
  $('regional-share').textContent=city==='all'?String([...municipalValues.values()].filter(c=>c.value>0).length):stateTotal>0?percent.format(revenue/stateTotal):'—';
  $('regional-share-label').textContent=city==='all'?'Municípios com vendas':stateShareLabel();
  const eligible=rankingEligibleClients(localRows),ranked=groupClients(eligible).filter(hasRankingMovement);
  $('regional-ranking').innerHTML=rows(rank(ranked,rankingTotal).slice(0,10),revenue,rankingTotal,true);
  $('regional-mix').innerHTML=categories.map(category=>{const value=sum(localRows,c=>categoryValue(c,category)),share=revenue>0?value/revenue:null;return '<div class="mix-item"><div class="mix-line"><strong>'+escapeHtml(category)+'</strong><span>'+formatValue(value)+'</span><b>'+(share===null?'—':percent.format(share))+'</b></div><div class="mix-track"><div style="width:'+Math.max(0,Math.min(100,(share??0)*100)).toFixed(3)+'%"></div></div></div>';}).join('');
  const repGroups=new Map();for(const client of eligible){if(!repGroups.has(client.codRep))repGroups.set(client.codRep,{code:client.codRep,name:client.rep,records:[]});repGroups.get(client.codRep).records.push(client);}
  const representatives=[...repGroups.values()].map(rep=>({...rep,value:sum(rep.records,rankingTotal),count:groupClients(rep.records).filter(hasRankingMovement).length})).filter(rep=>rep.count>0).sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name,'pt-BR'));
  $('regional-reps').innerHTML=representatives.length?representatives.slice(0,10).map(rep=>'<tr><td class="rep-name" title="'+escapeHtml(rep.name+' · Cód. '+rep.code)+'">'+escapeHtml(representativeLabel(rep.code,rep.name))+'</td><td>'+rep.count+'</td><td class="money">'+formatValue(rep.value)+'</td><td class="money">'+(revenue>0?percent.format(rep.value/revenue):'—')+'</td></tr>').join(''):'<tr><td colspan="4" class="empty">Sem movimento neste filtro.</td></tr>';
}
function stateOverviewData(){
  const base=networkClients();
  return REGION_STATES.map(state=>{const records=base.filter(row=>row.uf===state.uf),amounts=new Map();for(const row of records)amounts.set(row.cityKey,(amounts.get(row.cityKey)||0)+toMetricUnits(total(row)));return {...state,value:sum(records),count:[...amounts.values()].filter(value=>value>0).length};});
}
function renderStateOverview(){
  const states=stateOverviewData(),byUF=new Map(states.map(state=>[state.uf,state])),base=networkClients();
  $('state-overview').hidden=territoryView!=='overview';$('municipal-view').hidden=territoryView==='overview';
  $('overview-revenue').textContent=hasLoaded?formatValue(sum(base)):'—';
  $('overview-summary').textContent=hasLoaded?states.filter(state=>state.value>0).length+' estados com movimento · '+states.length+' estados disponíveis para explorar':'Os resultados serão exibidos após a atualização.';
  document.querySelectorAll('[data-overview-state]').forEach(node=>{const state=byUF.get(node.dataset.overviewState);if(!state)return;node.setAttribute('data-active',String(hasLoaded&&state.value>0));node.setAttribute('aria-label',state.name+(hasLoaded?' — '+formatValue(state.value):'')+' — explorar municípios');});
  const restoreUF=document.activeElement?.dataset?.territory;
  $('territory-state-list').innerHTML=[...states].sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name,'pt-BR')).map(state=>'<button type="button" class="territory-state-card" data-territory="'+state.uf+'" aria-label="Explorar '+escapeHtml(state.name)+'"><span class="state-initials">'+state.uf+'</span><span><span class="state-card-name">'+escapeHtml(state.name)+'</span><span class="state-card-value">'+(hasLoaded?formatValue(state.value):'—')+'</span><span class="state-card-detail">'+(hasLoaded?state.count+' municípios com movimento':territoryIndex.get(state.uf).municipalities.length+' municípios mapeados')+'</span></span><span aria-hidden="true">→</span></button>').join('');
  document.querySelectorAll('[data-territory]').forEach(button=>{button.addEventListener('click',()=>selectState(button.dataset.territory));if(territoryView==='overview'&&restoreUF===button.dataset.territory)button.focus();});
  const unmapped=base.filter(row=>!regionalUFs.has(row.uf)&&hasMovement(row));
  $('overview-unmapped').hidden=!hasLoaded||!unmapped.length;$('overview-unmapped').textContent=unmapped.length?'Há vendas fora dos estados mapeados: '+formatValue(sum(unmapped))+'. Consulte o ranking de clientes.':'';
}
function mountMunicipalMap(){
  const state=currentTerritory();
  $('regional-map').setAttribute('data-state',state.uf);
  $('map-insets').innerHTML=(state.insets||[]).map(inset=>'<rect x="'+inset.x+'" y="'+inset.y+'" width="'+inset.width+'" height="'+inset.height+'" rx="8"/>').join('');
  $('map-inset-labels').innerHTML=(state.insets||[]).map(inset=>'<text class="inset-title" x="'+inset.titleX+'" y="'+inset.titleY+'">'+escapeHtml(inset.title)+'</text><text class="inset-note" x="'+inset.noteX+'" y="'+inset.noteY+'">'+escapeHtml(inset.note)+'</text>').join('');
  $('map-cities').innerHTML=state.municipalities.map(city=>'<g class="municipality" data-map-city="'+escapeHtml(city.key)+'" data-code="'+city.code+'" data-level="0" role="button" tabindex="0" aria-pressed="false" aria-label="'+escapeHtml(city.name)+'"><path class="municipality-shape" d="'+city.path+'"/></g>').join('');
  $('regional-map').setAttribute('aria-label','Mapa dos '+state.municipalities.length+' municípios · '+state.name);$('map-cities').setAttribute('aria-label','Municípios · '+state.name);
  $('municipal-geography').setAttribute('aria-label','Mapa comercial dos municípios · '+state.name);
  $('territory-eyebrow').textContent='Inteligência territorial · '+state.name;$('territory-count').textContent=state.municipalities.length+' municípios';$('map-reset').textContent='Enquadrar '+state.name;$('municipal-map-source').setAttribute('href',state.source);
  bindMunicipalityEvents();
}
function showStateOverview(){territoryView='overview';mapDrag=null;hideMapTooltip();renderStateOverview();$('overview-title').focus();}
function selectState(uf){
  if(!territoryIndex.has(uf))return;clearTerritoryClientHighlight();
  const changed=mapState!==uf;mapState=uf;territoryView='municipal';mapDrag=null;mapDragMoved=false;$('state').value=uf;$('regional-city').value='all';$('regional-seller').value='all';$('municipality-search').value='';
  if(changed)mountMunicipalMap();updateRegionalCityFilter();updateRegionalSellerFilter();fitStateMap();hideMapTooltip();renderRegional();$('municipal-title').focus();
}
function selectRegionalCity(key){
  if(key!=='all'&&municipalityIndex.get(key)?.uf!==mapState)return;clearTerritoryClientHighlight();
  const restoreFocus=Boolean(document.activeElement?.dataset?.city);$('regional-city').value=key;
  const city=municipalityIndex.get(key);if(city&&(city.x<mapView[0]||city.x>mapView[0]+mapView[2]||city.y<mapView[1]||city.y>mapView[1]+mapView[3])){mapView[0]=city.x-mapView[2]/2;mapView[1]=city.y-mapView[3]/2;}
  renderRegional();hideMapTooltip();if(restoreFocus)[...document.querySelectorAll('[data-city]')].find(button=>button.dataset.city===key)?.focus();
}
function switchView(view){
  if(!['ranking','region'].includes(view))return;
  activeView=view;
  for(const name of ['ranking','region']){$('view-'+name).hidden=name!==view;$('tab-'+name).setAttribute('aria-selected',String(name===view));$('tab-'+name).setAttribute('tabindex',name===view?'0':'-1');}
  $('ranking-city-control').hidden=view==='region';
  if(view==='region')renderRegional();
}
function updateDraftNotice(){
  const pending=hasLoaded&&($('month-start').value!==loadedSelection.start||$('month-end').value!==loadedSelection.end);
  $('range-hint').hidden=!pending;
  $('range-hint').textContent=pending?'Período alterado. Clique em Aplicar. Os indicadores ainda mostram '+periodLabel(loadedPeriod)+'.':'';
  if(!loading)$('refresh').textContent=pending?'Aplicar':'Atualizar';
}
async function loadData(){
  if(location.protocol==='file:'){showLocalDashboard();return;}
  if(loading)return;
  const selected={start:$('month-start').value,end:$('month-end').value},queryDay=dashboardToday();let requested;
  try{requested=selectionPeriod(selected.start,selected.end,queryDay);}catch(error){$('api-status').hidden=false;$('api-status').textContent=error.message;return;}
  invalidateDashboardTrend();loading=true;$('month-start').disabled=true;$('month-end').disabled=true;$('refresh').disabled=true;$('refresh').textContent='Atualizando…';setDashboardConnectionStatus('Atualizando');
  $('api-status').hidden=true;$('api-status').textContent='';render();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    const url=new URL(API_URL);url.searchParams.set('inicio',requested.inicio);url.searchParams.set('fim',requested.fim);
    const response=await fetch(url.toString(),{method:'GET',headers:{Accept:'application/json'},credentials:'same-origin',cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error('A API respondeu com erro HTTP '+response.status+'.');
    let payload;try{payload=await response.json();}catch{throw new Error('A API não retornou um JSON válido.');}
    let next;try{next=validateResponse(payload,requested);}catch(error){error.isDataValidation=true;throw error;}
    lastCommercialPayload=payload;clients=next.clients;missingOutrosCount=next.missingOutros;fardosAvailable=next.missingFardos===0;metricMode=fardosAvailable?preferredMetric:'sales';loadedPeriod=next.period;loadedSelection=selected;loadedQueryDay=queryDay;hasLoaded=true;lastSuccess=new Date();updateCityFilter();updateRegionalSellerFilter();updateRegionalCityFilter();updateRepresentatives();
    loadOutros(next.period);render();
    renderTerritoryClientSearch();
    const sourceDay=typeof next.updatedAt==='string'?next.updatedAt.slice(0,10):'',sourceKnown=validDate(sourceDay);
    $('updated-at').textContent='Consulta até '+dateLabel(next.period.fim)+' · Fonte: '+(sourceKnown?dateLabel(sourceDay):'não informada');
    $('updated-at').setAttribute('title','Consulta realizada em '+timestamp.format(lastSuccess).replace(',',' às')+'. A data da fonte é informada pela API.');
    $('api-status').hidden=true;$('api-status').textContent='';
    setDashboardConnectionStatus(sourceKnown&&next.period.fim===queryDay&&sourceDay<queryDay?'Atualização pendente':'Atualizado');
  }catch(error){
    if(hasLoaded){$('month-start').value=loadedSelection.start;$('month-end').value=loadedSelection.end;}
    const detail=error.name==='AbortError'?'A atualização demorou mais que o esperado. Tente novamente.':error.isDataValidation?error.message:'Não foi possível atualizar os dados. Tente novamente.';
    $('api-status').className='notice error';$('api-status').hidden=false;$('api-status').textContent=detail+(hasLoaded?' Exibindo o período '+periodLabel(loadedPeriod)+'.':'');
    setDashboardConnectionStatus(hasLoaded?'Atualização pendente':'Indisponível');
  }finally{clearTimeout(timer);loading=false;$('month-start').disabled=false;$('month-end').disabled=false;$('refresh').disabled=false;updateDraftNotice();render();}
}
document.querySelectorAll('[data-network]').forEach(button=>button.addEventListener('click',()=>{includeNetworks=button.dataset.network==='all';document.querySelectorAll('[data-network]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));updateRepresentatives();updateRegionalSellerFilter();updateRegionalCityFilter();render();}));
$('rep').addEventListener('change',render);$('category').addEventListener('change',render);$('aggregation').addEventListener('change',render);$('refresh').addEventListener('click',loadData);
$('metric-toggle').addEventListener('click',()=>setMetricMode(metricMode==='fardos'?'sales':'fardos'));
$('month-start').addEventListener('input',updateDraftNotice);$('month-end').addEventListener('input',updateDraftNotice);
$('city').addEventListener('change',()=>{updateRepresentatives();render();});$('state').addEventListener('change',()=>selectState($('state').value));$('regional-city').addEventListener('change',()=>selectRegionalCity($('regional-city').value));
$('regional-seller').addEventListener('change',()=>{updateRegionalCityFilter();renderRegional();});
function bindMunicipalityEvents(){document.querySelectorAll('[data-map-city]').forEach(node=>{
  node.addEventListener('click',event=>{event.stopPropagation();if(!mapDragMoved)selectRegionalCity(node.dataset.mapCity);});
  node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectRegionalCity(node.dataset.mapCity);}if(event.key==='Escape')hideMapTooltip();});
  node.addEventListener('pointerenter',event=>showMapTooltip(node.dataset.mapCity,event));node.addEventListener('pointermove',event=>showMapTooltip(node.dataset.mapCity,event));node.addEventListener('pointerleave',hideMapTooltip);node.addEventListener('focus',()=>showMapTooltip(node.dataset.mapCity));node.addEventListener('blur',hideMapTooltip);
  node.addEventListener('dblclick',event=>{event.preventDefault();selectRegionalCity(node.dataset.mapCity);focusMunicipality();});
});}
document.querySelectorAll('[data-overview-state]').forEach(node=>{if(node.dataset.covered!=='true')return;node.addEventListener('click',()=>selectState(node.dataset.overviewState));node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectState(node.dataset.overviewState);}});});
$('back-to-states').addEventListener('click',showStateOverview);
$('map-back').addEventListener('click',()=>{selectRegionalCity('all');fitStateMap();});$('map-reset').addEventListener('click',()=>{fitStateMap();hideMapTooltip();});$('map-zoom-in').addEventListener('click',()=>zoomMap(.75));$('map-zoom-out').addEventListener('click',()=>zoomMap(1.333));
$('map-focus-city').addEventListener('click',focusMunicipality);$('municipality-search').addEventListener('input',renderCityList);
$('map-view-details').addEventListener('click',()=>$('regional-details').scrollIntoView({behavior:'smooth',block:'start'}));

$('regional-map').addEventListener('pointerdown',event=>{mapDragMoved=false;if(!mapState||event.button!==0)return;mapDrag={x:event.clientX,y:event.clientY,view:[...mapView],id:event.pointerId};});
$('regional-map').addEventListener('pointermove',event=>{if(!mapDrag||mapDrag.id!==event.pointerId)return;if(!(event.buttons&1)){mapDrag=null;return;}const dx=event.clientX-mapDrag.x,dy=event.clientY-mapDrag.y;if(!mapDragMoved&&Math.hypot(dx,dy)<5)return;mapDragMoved=true;hideMapTooltip();const rect=$('regional-map').getBoundingClientRect(),unit=Math.max(mapDrag.view[2]/rect.width,mapDrag.view[3]/rect.height);mapView=[mapDrag.view[0]-dx*unit,mapDrag.view[1]-dy*unit,mapDrag.view[2],mapDrag.view[3]];applyMapView();$('regional-map').setPointerCapture(event.pointerId);});
for(const type of ['pointerup','pointercancel','lostpointercapture'])$('regional-map').addEventListener(type,()=>{mapDrag=null;});
for(const view of ['ranking','region']){$('tab-'+view).addEventListener('click',()=>switchView(view));$('tab-'+view).addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();const next=view==='ranking'?'region':'ranking';switchView(next);$('tab-'+next).focus();}});}
$('state').value='PI';mountMunicipalMap();switchView('ranking');updateCityFilter();updateRegionalSellerFilter();updateRegionalCityFilter();applyMapView();render();initializeMigratedDashboard();

// Integration with the shared PHP-backed catalog. No duplicate local persistence.
let dashboardTrendHistory=null,dashboardTrendPending=null,dashboardTrendController=null,dashboardTrendGeneration=0,dashboardTrendFailure='';
function invalidateDashboardTrend(){
  dashboardTrendGeneration++;dashboardTrendController?.abort();dashboardTrendController=null;dashboardTrendHistory=null;dashboardTrendPending=null;dashboardTrendFailure='';
}
function dashboardCurrentMonth(){return dashboardToday().slice(0,7);}
function setDashboardTrend(value,note){$('revenue-trend').textContent=value==null?'—':formatValue(value);$('revenue-trend-note').textContent=note;}
function dashboardTrendEntity(history){
  const city=$('city').value,current=dashboardCurrentMonth(),sourceMonths=[...history.months];
  // Use the exact current response shown in the adjacent total. A history request
  // may finish before or after a source refresh, so it must not replace this base.
  const currentMonth={month:current,status:'ok',clientes:lastCommercialPayload.clientes,missingOutros:missingOutrosCount,updatedAt:lastCommercialPayload.atualizado_em};
  const index=sourceMonths.findIndex(month=>month.month===current);if(index<0)sourceMonths.push(currentMonth);else sourceMonths[index]=currentMonth;
  const months=sourceMonths.map(month=>{
    if(month.status!=='ok')return {month:month.month,status:'error',sales:null,fardos:null,error:month.error};
    if(metricMode==='sales'&&month.missingOutros>0)return {month:month.month,status:'error',sales:null,fardos:null,error:'A categoria Outros está incompleta neste mês.'};
    const filtered=month.clientes.filter(row=>{
      const identity=resolveClientIdentity(row),independent=!auxiliaryData&&independentNames.has(normalizeName(row.name)),large=independent?false:identity?identity.large:row.large;
      return (includeNetworks||!large)&&(city==='all'||parseLocation(row.city).cityKey===city);
    });
    const aggregate=metric=>{
      if(filtered.some(row=>!row[metric]||categories.some(category=>typeof row[metric][category]!=='number'||!Number.isFinite(row[metric][category]))))return null;
      const scale=metric==='sales'?100:FARDOS_SCALE;
      return Object.fromEntries(categories.map(category=>[category,Number(filtered.reduce((sum,row)=>sum+BigInt(Math.round(row[metric][category]*scale)),0n))/scale]));
    };
    return {month:month.month,status:'ok',sales:aggregate('sales'),fardos:aggregate('fardos'),clientCodes:filtered.map(row=>row.cod_cliente),matchedClients:filtered.length,updatedAt:month.updatedAt};
  });
  return {id:'dashboard-total',name:'Resultado do filtro',categories:[...categories],months,eligible:true};
}
function renderDashboardTrend(){
  if(location.protocol==='file:'){setDashboardTrend(null,'Consulta disponível pelo servidor');return;}
  const current=dashboardCurrentMonth();
  if(!hasLoaded||!loadedPeriod){setDashboardTrend(null,'Aguardando dados');return;}
  if(loadedPeriod.inicio!==current+'-01'||loadedPeriod.fim.slice(0,7)!==current){setDashboardTrend(null,'Selecione somente o mês atual');return;}
  if(loading){setDashboardTrend(null,'Atualizando dados');return;}
  if(dashboardTrendFailure){setDashboardTrend(null,dashboardTrendFailure);return;}
  if(!dashboardTrendHistory){
    setDashboardTrend(null,'Consultando histórico');
    if(!dashboardTrendPending){
      const api=window.BICore?.api,generation=dashboardTrendGeneration;
      if(typeof api?.loadYear!=='function'){setDashboardTrend(null,'Histórico indisponível');return;}
      dashboardTrendController=new AbortController();
      dashboardTrendPending=api.loadYear(Number(current.slice(0,4)),{signal:dashboardTrendController.signal}).then(history=>{
        if(generation!==dashboardTrendGeneration)return;
        dashboardTrendHistory=history;dashboardTrendPending=null;renderDashboardTrend();
      }).catch(error=>{
        if(generation!==dashboardTrendGeneration||error.name==='AbortError')return;
        dashboardTrendPending=null;dashboardTrendFailure='Não foi possível consultar a tendência';renderDashboardTrend();
      });
    }
    return;
  }
  try{
    const history=dashboardTrendHistory;
    const source=String(lastCommercialPayload?.atualizado_em??'').slice(0,10);
    if(source&&validDate(source)&&source.slice(0,7)<current){setDashboardTrend(null,'A fonte ainda não atualizou o mês atual');return;}
    const today=window.BICore.analytics.saoPauloToday(),asOf=source&&validDate(source)?(source<today?source:today):history.asOf;
    if(!source&&history.coverage?.forecastBlocked){setDashboardTrend(null,'A fonte ainda não atualizou o mês atual');return;}
    if(!validDate(asOf)||asOf.slice(0,7)!==current){setDashboardTrend(null,'Data de referência indisponível');return;}
    const entity=dashboardTrendEntity(history),forecast=window.BICore.analytics.forecastEntity(entity,metricMode,Number(current.slice(0,4)),asOf);
    setDashboardTrend(forecast.currentMonth?.projected??null,forecast.currentMonth?.projected==null?(forecast.currentMonth?.reason||forecast.reason||'Histórico insuficiente'):'Fechamento · referência '+dateLabel(asOf));
  }catch{setDashboardTrend(null,'Dados insuficientes para a tendência');}
}
function setDashboardConnectionStatus(status){
  const allowed=['Carregando','Atualizando','Atualizado','Atualização pendente','Indisponível','Arquivo local'];
  if(!allowed.includes(status))return;
  $('connection-badge').textContent=status;
  if(window.parent!==window)window.parent.postMessage({type:'BI_DASHBOARD_STATUS',status},location.protocol==='file:'?'*':location.origin);
}
function renderCompactOutrosDetails(){
  const panel=$('outros-panel'),table=$('outros-table');
  const visible=hasLoaded&&metricMode==='sales'&&includeNetworks&&$('city').value==='all'&&!loading&&outrosDetail.status==='ready'&&outrosDetail.products.length>0;
  panel.hidden=!visible;table.hidden=!visible;if(!visible)return;
  $('outros-detalhe').innerHTML=outrosDetail.products.map(product=>{
    const share=outrosDetail.totalCents>0?product.cents/outrosDetail.totalCents:null,bar=Math.max(0,Math.min(100,(share??0)*100));
    return '<tr><td class="client">'+escapeHtml(product.name)+'</td><td>'+escapeHtml(product.code)+'</td><td class="money">'+money.format(product.cents/100)+'</td><td class="barcol"><div class="barline"><div class="track" aria-hidden="true"><div class="fill" style="width:'+bar.toFixed(3)+'%"></div></div><span class="pct">'+(share===null?'—':percent.format(share))+'</span></div></td></tr>';
  }).join('');
}
function resolveClientIdentity(row){
  if(!auxiliaryData||!sharedIdentityResolver)return resolveFallbackClientIdentity(row);
  const identity=sharedIdentityResolver(row,auxiliaryData);
  return {key:identity.groupId?'group:'+identity.groupId:identity.networkId?'network:'+identity.networkId:null,name:identity.groupName||identity.networkName||row.name,network:identity.networkName||null,large:Boolean(identity.large)};
}
function validAuxiliaryEnvelope(data){
  try{window.BICore?.representatives?.validateRepresentativeAliasEntries(Object.hasOwn(data||{},'representativeAliases')?data.representativeAliases:[]);}catch{return false;}
  return Boolean(data&&data.schemaVersion===1&&Number.isInteger(data.revision)&&data.revision>=0&&['topRetailers','largeNetworks','clientGroups','independentClientCodes','independentNames'].every(key=>Array.isArray(data[key])));
}
function setAuxiliaryData(data){
  if(!validAuxiliaryEnvelope(data))throw new Error('O cadastro auxiliar retornou um formato inválido.');
  if(auxiliaryData&&data.revision<auxiliaryData.revision)return false;
  auxiliaryData=structuredClone(data);auxiliaryLoadError=false;
  $('auxiliary-status').hidden=true;$('auxiliary-status').textContent='';
  if(sharedIdentityResolver&&lastCommercialPayload&&loadedPeriod){
    const next=validateResponse(lastCommercialPayload,loadedPeriod);
    clients=next.clients;updateCityFilter();updateRepresentatives();updateRegionalSellerFilter();updateRegionalCityFilter();render();renderTerritoryClientSearch();
  }
  return true;
}
async function initializeMigratedDashboard(){
  setDashboardConnectionStatus('Carregando');
  const currentMonth=dashboardCurrentMonth();
  $('month-start').value=currentMonth;$('month-end').value=currentMonth;
  if(location.protocol==='file:'){showLocalDashboard();return;}
  try{
    const {analytics,api}=window.BICore||{};
    if(!analytics||!api)throw new Error('Os arquivos JavaScript do BI não foram carregados.');
    sharedIdentityResolver=analytics.resolveIdentity;
    sharedRankingEligibility=analytics.eligibleClient;
    if(typeof sharedIdentityResolver!=='function')throw new Error('Classificação de clientes indisponível.');
    // A newer parent revision may already be waiting when this request resolves.
    setAuxiliaryData(await api.loadAuxiliary());
  }catch{
    auxiliaryLoadError=true;$('auxiliary-status').hidden=false;
    $('auxiliary-status').textContent='Não foi possível carregar os cadastros compartilhados. O dashboard usa temporariamente as regras confirmadas da versão anterior. Recarregue a página para tentar novamente.';
  }
  if(window.parent!==window)window.parent.postMessage({type:'BI_DASHBOARD_READY'},location.origin);
  await loadData();
}
function refreshDashboardForNewDay(){
  if(location.protocol==='file:'||document.visibilityState==='hidden'||loading||!hasLoaded||!loadedSelection||!loadedQueryDay)return;
  const today=dashboardToday();
  if(today===loadedQueryDay||loadedSelection.end<loadedQueryDay.slice(0,7))return;
  // A date rollover refreshes the same applied range. Never apply or overwrite
  // an unfinished month selection, and never move a historical filter to today.
  if($('month-start').value!==loadedSelection.start||$('month-end').value!==loadedSelection.end)return;
  return loadData();
}
window.addEventListener('focus',refreshDashboardForNewDay);
window.setInterval?.(refreshDashboardForNewDay,60000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshDashboardForNewDay();});
function showLocalDashboard(){
  $('auxiliary-status').hidden=false;$('auxiliary-status').className='notice local-preview';
  $('auxiliary-status').textContent='Pré-visualização local. Para carregar as vendas e os cadastros, abra este BI pelo endereço HTTP/HTTPS da hospedagem com PHP. O arquivo aberto por duplo clique não executa PHP.';
  $('api-status').hidden=true;$('api-status').textContent='';setDashboardConnectionStatus('Arquivo local');
  $('updated-at').textContent='Consulta disponível pelo servidor';
  for(const id of ['month-start','month-end','refresh'])$(id).disabled=true;
}
function matchingTerritoryClients(query){
  const terms=normalizeName(query).split(' ').filter(Boolean);
  if(!terms.length||!hasLoaded)return [];
  const codeQuery=String(query).trim().replace(/^0+(?=\d)/,'');
  return clients.filter(client=>{
    const searchable=normalizeName(client.name+' '+client.city+' '+client.codCliente+' '+(client.groupName||''));
    return client.codCliente.replace(/^0+(?=\d)/,'')===codeQuery||terms.every(term=>searchable.includes(term));
  }).sort((a,b)=>Number(b.codCliente.replace(/^0+(?=\d)/,'')===codeQuery)-Number(a.codCliente.replace(/^0+(?=\d)/,'')===codeQuery)||a.name.localeCompare(b.name,'pt-BR')||a.city.localeCompare(b.city,'pt-BR')||a.codCliente.localeCompare(b.codCliente,'pt-BR'));
}
function renderTerritoryClientSearch(){
  const query=$('territory-client-query').value.trim(),results=matchingTerritoryClients(query);
  $('territory-client-status').textContent=!query?'':!hasLoaded?'Carregue os dados para pesquisar.':!results.length?'Nenhum cliente encontrado no período consultado.':results.length+' cadastros encontrados'+(results.length>30?' · exibindo os primeiros 30':'')+'.';
  $('territory-client-status').hidden=!query;
  $('territory-client-clear').disabled=!query&&$('territory-client-selection').hidden;
  $('territory-client-results').innerHTML=results.slice(0,30).map(client=>'<button type="button" class="territory-client-result" data-territory-client="'+escapeHtml(client.codCliente)+'"><span><strong>'+escapeHtml(client.name)+'</strong><small>'+escapeHtml(client.cityLabel)+' · Cód. '+escapeHtml(client.codCliente)+'</small></span><span aria-hidden="true">↗</span></button>').join('');
  document.querySelectorAll('[data-territory-client]').forEach(button=>button.addEventListener('click',()=>selectTerritoryClient(button.dataset.territoryClient)));
}
function selectTerritoryClient(code){
  const client=clients.find(row=>row.codCliente===String(code));if(!client)return false;
  const selection=$('territory-client-selection');selection.hidden=false;$('territory-client-clear').disabled=false;
  if(!territoryIndex.has(client.uf)||!municipalityIndex.has(client.cityKey)){
    selection.textContent=client.name+' · Cód. '+client.codCliente+' · '+client.cityLabel+'. Este município ainda não possui mapa disponível. Nenhum filtro foi alterado.';return false;
  }
  switchView('region');selectState(client.uf);selectRegionalCity(client.cityKey);focusMunicipality();selection.hidden=false;
  selection.textContent=client.name+' · Cód. '+client.codCliente+' · '+client.cityLabel+'. Município destacado. Os indicadores mostram a cidade '+(includeNetworks?'com':'sem')+' Grandes Redes; o vendedor foi definido como Todos.';
  territorySelectedClientCode=client.codCliente;$('territory-client-clear').disabled=false;
  document.querySelectorAll('[data-map-city]').forEach(node=>node.setAttribute('data-client-highlight',String(node.dataset.mapCity===client.cityKey)));
  $('municipal-title').focus();return true;
}
function clearTerritoryClientHighlight(){
  territorySelectedClientCode=null;
  $('territory-client-selection').hidden=true;$('territory-client-selection').textContent='';
  document.querySelectorAll('[data-map-city]').forEach(node=>node.removeAttribute('data-client-highlight'));
}
function clearTerritoryClientFilter(){
  const selected=Boolean(territorySelectedClientCode);
  $('territory-client-query').value='';clearTerritoryClientHighlight();
  if(selected){selectRegionalCity('all');fitStateMap();hideMapTooltip();}
  renderTerritoryClientSearch();$('territory-client-query').focus();
}
$('territory-client-query').addEventListener('input',renderTerritoryClientSearch);
$('territory-client-clear').addEventListener('click',clearTerritoryClientFilter);
window.addEventListener('message',event=>{
  if(event.source!==window.parent||event.origin!==location.origin)return;
  if(event.data?.type==='BI_DASHBOARD_STATUS_REQUEST'){setDashboardConnectionStatus($('connection-badge').textContent);return;}
  if(location.protocol==='file:'||event.data?.type!=='BI_AUXILIARY')return;
  try{setAuxiliaryData(event.data.data);}catch{
    $('auxiliary-status').hidden=false;$('auxiliary-status').textContent='Não foi possível aplicar os cadastros compartilhados recebidos. Recarregue a página para conferir a versão salva.';
  }
});
