import {ALL_CATEGORIES,normalizeCode,normalizeName} from './analytics.js';

const metrics=['sales','fardos'];
const scales={sales:100,fardos:1000000};
const emptyCategories=()=>Object.fromEntries(ALL_CATEGORIES.map(category=>[category,0]));
const dateOK=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const active=client=>!client.status||normalizeName(client.status)==='ATIVO'||normalizeName(client.status)==='ATIVA';
const repCode=row=>normalizeCode(row?.cod_rep??row?.repCode);
const repName=row=>String(row?.rep??'').trim();
const clientCode=row=>normalizeCode(row?.cod_cliente??row?.code);
function historyRows(value){
 if(Array.isArray(value))return value.flatMap(row=>Array.isArray(row?.clientes)?row.clientes:[row]);
 if(Array.isArray(value?.months))return value.months.flatMap(month=>month.status==='ok'?(month.clientes||[]):[]);
 return Array.isArray(value?.clientes)?value.clientes:[];
}
function identityRegistry(catalog,extra){
 const source=[...(catalog?.clients||[]),...historyRows(extra)],coded=new Map(),aliases=new Map();
 for(const row of source){const code=repCode(row),name=repName(row);if(!code)continue;if(!/^\d+$/.test(code))throw new Error('Há um código de representante inválido na base.');const id='code:'+code;coded.set(id,{id,code,name:name||coded.get(id)?.name||'Representante '+code});if(name){const key=normalizeName(name);if(!aliases.has(key))aliases.set(key,new Set());aliases.get(key).add(id);}}
 const options=new Map(coded);
 for(const row of source){if(repCode(row))continue;const name=repName(row),key=normalizeName(name);if(!key)continue;const candidates=aliases.get(key);if(candidates?.size)continue;const id='name:'+key;if(!options.has(id))options.set(id,{id,code:'',name});}
 const resolve=row=>{const code=repCode(row);if(code)return options.has('code:'+code)?'code:'+code:null;const key=normalizeName(repName(row));if(!key)return null;const candidates=aliases.get(key);return candidates?.size===1?[...candidates][0]:candidates?.size>1?null:options.has('name:'+key)?'name:'+key:null;};
 return {options:[...options.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||a.code.localeCompare(b.code,'pt-BR',{numeric:true})),resolve};
}
/** Codes are authoritative. A name only joins a single exact normalized alias. */
export function representativeOptions(catalog,historyOrRows){return identityRegistry(catalog,historyOrRows).options;}
function amounts(rows,metric){
 const scale=scales[metric],values=Object.fromEntries(ALL_CATEGORIES.map(category=>[category,0n]));
 for(const row of rows){
  for(const category of ALL_CATEGORIES){const value=row?.[metric]?.[category],scaled=Math.round(value*scale);if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(scaled)||Math.abs(value*scale-scaled)>.0001)return {total:null,categories:null};values[category]+=BigInt(scaled);}
 }
 const safe=value=>{if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('O total excedeu o limite numérico seguro.');return Number(value)/scale;};
 return {total:safe(ALL_CATEGORIES.reduce((sum,category)=>sum+values[category],0n)),categories:Object.fromEntries(ALL_CATEGORIES.map(category=>[category,safe(values[category])]))};
}
const ratio=(part,total)=>part===null||total===null||total<=0?null:part/total;
function movement(row,start,end){
 if(!row)return false;
 if(dateOK(row.ult_faturamento)&&row.ult_faturamento>=start&&row.ult_faturamento<=end)return true;
 return metrics.some(metric=>ALL_CATEGORIES.some(category=>Number.isFinite(row?.[metric]?.[category])&&row[metric][category]!==0));
}
function cityLocation(row){
 const raw=String(row?.city??'').trim(),match=raw.match(/^(.*?)\s*\/\s*([a-z]{2})$/i),cityName=(match?match[1]:raw).trim()||'Cidade não informada',uf=String(row?.uf||match?.[2]||'').trim().toUpperCase(),city=cityName+(uf?' / '+uf:'');
 const key=JSON.stringify([normalizeName(cityName),uf]);return {key,cityKey:key,city,cityName,uf};
}
function validatedPeriod(period){
 if(period?.status!=='ok'||!Array.isArray(period.clientes)||!dateOK(period.inicio)||!dateOK(period.fim)||!dateOK(period.coveredThrough))throw new Error('Consulte um período com cobertura confirmada antes de apresentar os representantes.');
 const updatedAt=period.updatedAt??period.atualizado_em,sourceDay=typeof updatedAt==='string'?updatedAt.slice(0,10):null;
 if(period.inicio>period.fim||period.coveredThrough<period.inicio||period.coveredThrough>period.fim||!dateOK(sourceDay)||sourceDay<period.coveredThrough||period.freshnessKnown===false)throw new Error('A API ainda não confirmou cobertura para o período da apresentação.');
 const codes=new Set();for(const row of period.clientes){const code=clientCode(row);if(!/^\d+$/.test(code)||codes.has(code))throw new Error('A API tem um código de cliente inválido ou duplicado.');codes.add(code);}
 return {inicio:period.inicio,fim:period.fim,coveredThrough:period.coveredThrough,updatedAt,stale:period.coveredThrough<period.fim||Boolean(period.stale)};
}
/** Pure, read-only representative and active-portfolio report. Includes all sales categories. */
export function buildRepresentativeReport({catalog,period,history,selectedIds,metric='fardos'}){
 if(!metrics.includes(metric))throw new Error('Escolha uma unidade válida para a apresentação.');
 if(!catalog||!Array.isArray(catalog.clients))throw new Error('A base de clientes está indisponível.');
 const range=validatedPeriod(period),registry=identityRegistry(catalog,[...historyRows(history),...period.clientes]),options=registry.options,selection=[...new Set(Array.isArray(selectedIds)?selectedIds:[])];
 if(!selection.length)throw new Error('Selecione ao menos um representante.');
 if(selection.some(id=>!options.some(option=>option.id===id)))throw new Error('Um representante selecionado não está mais disponível na base.');
 const selectedSet=new Set(selection),representatives=options.filter(option=>selectedSet.has(option.id)),apiRows=period.clientes,selectedRows=apiRows.filter(row=>selectedSet.has(registry.resolve(row))),apiByCode=new Map(apiRows.map(row=>[clientCode(row),row]));
 const allCatalogCodes=new Set(),selectedClients=[];
 for(const client of catalog.clients){const code=clientCode(client);if(!/^\d+$/.test(code)||allCatalogCodes.has(code))throw new Error('O cadastro tem um código de cliente inválido ou repetido.');allCatalogCodes.add(code);if(!active(client)||!selectedSet.has(registry.resolve(client)))continue;const api=apiByCode.get(code),hasMovement=movement(api,range.inicio,range.coveredThrough),pending=!hasMovement&&Number.isFinite(api?.a_faturar)&&api.a_faturar>0,sales=api?amounts([api],'sales').total:0,fardos=api?amounts([api],'fardos').total:0;selectedClients.push({...client,...cityLocation(client),code,repId:registry.resolve(client),rep:client.rep||api?.rep||'',repCode:repCode(client),hasMovement,billed:hasMovement,pending,lastInvoice:dateOK(api?.ult_faturamento)&&api.ult_faturamento<=range.coveredThrough?api.ult_faturamento:null,sales,fardos,value:metric==='sales'?sales:fardos});}
 const portfolioCodes=new Set(selectedClients.map(client=>client.code));
 const presentApiRow=row=>{const code=clientCode(row),hasMovement=movement(row,range.inicio,range.coveredThrough),sales=amounts([row],'sales').total,fardos=amounts([row],'fardos').total;return {...row,...cityLocation(row),code,repCode:repCode(row),repId:registry.resolve(row),hasMovement,billed:hasMovement,pending:!hasMovement&&Number.isFinite(row.a_faturar)&&row.a_faturar>0,sales,fardos,value:metric==='sales'?sales:fardos};};
 const billedSelectedRows=selectedRows.filter(row=>movement(row,range.inicio,range.coveredThrough));
 const outsideCatalogClients=billedSelectedRows.filter(row=>!allCatalogCodes.has(clientCode(row))).map(presentApiRow),outsidePortfolioClients=billedSelectedRows.filter(row=>!portfolioCodes.has(clientCode(row))).map(presentApiRow);
 const companyAmounts=Object.fromEntries(metrics.map(kind=>[kind,amounts(apiRows,kind)])),selectedAmounts=Object.fromEntries(metrics.map(kind=>[kind,amounts(selectedRows,kind)]));
 const totals={selected:selectedAmounts[metric].total,company:companyAmounts[metric].total,share:ratio(selectedAmounts[metric].total,companyAmounts[metric].total),categories:selectedAmounts[metric].categories,companyCategories:companyAmounts[metric].categories,sales:selectedAmounts.sales.total,fardos:selectedAmounts.fardos.total,companySales:companyAmounts.sales.total,companyFardos:companyAmounts.fardos.total,categoriesSales:selectedAmounts.sales.categories,categoriesFardos:selectedAmounts.fardos.categories};
 const portfolio={totalClients:selectedClients.length,billedClients:selectedClients.filter(client=>client.hasMovement).length,unbilledClients:selectedClients.filter(client=>!client.hasMovement).length,pendingClients:selectedClients.filter(client=>client.pending).length,outsideCatalogClients:outsideCatalogClients.length,outsidePortfolioClients:outsidePortfolioClients.length,selectedBilledClients:selectedRows.filter(row=>movement(row,range.inicio,range.coveredThrough)).length};
 const cityIndex=new Map();const ensureCity=row=>{const location=cityLocation(row);if(!cityIndex.has(location.key))cityIndex.set(location.key,{...location,totalClients:0,billedClients:0,unbilledClients:0,pendingClients:0,outsideCatalogClients:0,outsidePortfolioClients:0,invoiceClients:0,_portfolio:[],_selected:[]});return cityIndex.get(location.key);};
 for(const client of selectedClients){const city=ensureCity(client);city.totalClients++;client.hasMovement?city.billedClients++:city.unbilledClients++;if(client.pending)city.pendingClients++;const api=apiByCode.get(client.code);if(api)city._portfolio.push(api);}
 for(const row of selectedRows){const billed=movement(row,range.inicio,range.coveredThrough);if(!billed&&!portfolioCodes.has(clientCode(row)))continue;const city=ensureCity(row);city._selected.push(row);if(billed)city.invoiceClients++;if(billed&&!allCatalogCodes.has(clientCode(row)))city.outsideCatalogClients++;if(billed&&!portfolioCodes.has(clientCode(row)))city.outsidePortfolioClients++;}
 const cities=[...cityIndex.values()].map(city=>{const selected=Object.fromEntries(metrics.map(kind=>[kind,amounts(city._selected,kind)])),portfolio=Object.fromEntries(metrics.map(kind=>[kind,amounts(city._portfolio,kind)])),hasBilling=city.billedClients>0||city.invoiceClients>0,status=city.unbilledClients>0?(hasBilling?'mixed':'no-billing'):city.totalClients?'all-billed':hasBilling?'api-only':'no-billing';const {_selected,_portfolio,...fields}=city;return {...fields,status,selectedValue:selected[metric].total,portfolioValue:portfolio[metric].total,sales:selected.sales.total,fardos:selected.fardos.total,portfolioSales:portfolio.sales.total,portfolioFardos:portfolio.fardos.total,categories:selected[metric].categories};}).sort((a,b)=>b.unbilledClients-a.unbilledClients||a.city.localeCompare(b.city,'pt-BR'));
 const series=(Array.isArray(history?.months)?history.months:[]).map(month=>{if(month.status!=='ok'||!Array.isArray(month.clientes))return {month:month.month,status:'error',selected:null,company:null,share:null,categories:null,companyCategories:null};const chosen=month.clientes.filter(row=>selectedSet.has(registry.resolve(row))),selected=amounts(chosen,metric),company=amounts(month.clientes,metric);return {month:month.month,status:'ok',selected:selected.total,company:company.total,share:ratio(selected.total,company.total),categories:selected.categories,companyCategories:company.categories};});
 const byRepresentative=representatives.map(representative=>{const rows=apiRows.filter(row=>registry.resolve(row)===representative.id),clients=selectedClients.filter(client=>client.repId===representative.id),values=Object.fromEntries(metrics.map(kind=>[kind,amounts(rows,kind)]));return {...representative,selected:values[metric].total,company:totals.company,share:ratio(values[metric].total,totals.company),sales:values.sales.total,fardos:values.fardos.total,categories:values[metric].categories,totalClients:clients.length,billedClients:clients.filter(client=>client.hasMovement).length,unbilledClients:clients.filter(client=>!client.hasMovement).length,pendingClients:clients.filter(client=>client.pending).length};});
 const unbilledClients=selectedClients.filter(client=>!client.hasMovement).sort((a,b)=>a.city.localeCompare(b.city,'pt-BR')||a.name.localeCompare(b.name,'pt-BR'));
 return {metric,selectedIds:selection,representatives,period:range,totals,portfolio,cities,clients:selectedClients,unbilledClients,outsideCatalogClients,outsidePortfolioClients,series,byRepresentative,categories:ALL_CATEGORIES};
}
