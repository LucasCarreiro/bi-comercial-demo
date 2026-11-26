import {normalizeCode,normalizeName} from './analytics.js';
import {buildRepresentativeReport} from './representative-model.js';

const dateOK=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const lastDay=(year,month)=>new Date(Date.UTC(year,month,0)).getUTCDate();
function previousDate(value){const year=Number(value.slice(0,4))-1,month=Number(value.slice(5,7)),day=Math.min(Number(value.slice(8)),lastDay(year,month));return String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');}
const rowsOf=history=>(history?.months||[]).flatMap(month=>month.status==='ok'&&Array.isArray(month.clientes)?month.clientes:[]);
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
const pair=(current,previous,scale=1)=>{const known=numeric(current)&&numeric(previous),absolute=known?(scale?Math.round((current-previous)*scale)/scale:current-previous):null;return {current:numeric(current)?current:null,previous:numeric(previous)?previous:null,absolute,change:known&&previous>0?absolute/previous:null};};
const noBillingCities=report=>report.cities.filter(city=>city.totalClients>0&&city.status==='no-billing').length;
const cityLocation=row=>{const raw=String(row?.city||'').trim(),parts=raw.match(/^(.*?)\s*\/\s*([a-z]{2})$/i),cityName=(parts?parts[1]:raw).trim()||'Cidade não informada',uf=String(row?.uf||parts?.[2]||'').trim().toUpperCase(),city=cityName+(uf?' / '+uf:'');return {city,cityName,uf,cityKey:JSON.stringify([normalizeName(cityName),uf])};};
function monthlyCut(row){const end=row?.effectiveFim||row?.coveredThrough||row?.fim;return dateOK(row?.inicio)&&dateOK(end)?{inicio:row.inicio,fim:end}:null;}
function equivalentMonthCut(current,previous){
 const a=monthlyCut(current),b=monthlyCut(previous);if(!a||!b)return true;
 const year=Number(a.fim.slice(0,4)),month=Number(a.fim.slice(5,7)),closed=Number(a.fim.slice(8))===lastDay(year,month),expectedEnd=closed?String(year-1)+'-'+a.fim.slice(5,7)+'-'+String(lastDay(year-1,month)).padStart(2,'0'):previousDate(a.fim);
 return b.inicio===previousDate(a.inicio)&&b.fim===expectedEnd;
}

/** Comparisons use exact client/seller codes and the same current portfolio in both years.
 * Missing comparative sources remain unavailable; they never certify customer absence.
 */
export function buildRepresentativeComparison({catalog,period,history,previousPeriod,previousHistory,currentYearPeriod,previousYearPeriod,selectedIds,metric='fardos'}){
 const identityRows=[...rowsOf(history),...rowsOf(previousHistory),...[period,previousPeriod,currentYearPeriod,previousYearPeriod].flatMap(source=>source?.status==='ok'&&Array.isArray(source.clientes)?source.clientes:[])];
 const context=[...new Map(identityRows.map(row=>{const alias={cod_rep:row.cod_rep??row.repCode,rep:row.rep};return [JSON.stringify([normalizeCode(alias.cod_rep),alias.rep]),alias];})).values()];
 // All periods share a seller identity registry, including sellers found only in an
 // earlier year. The sentinel contributes aliases only, never a chart month.
 const reportFor=(source,months)=>{const report=buildRepresentativeReport({catalog,period:source,history:{months:[...(months?.months||[]),{month:'__identity__',status:'ok',clientes:context}]},selectedIds,metric});return {...report,series:report.series.filter(point=>/^\d{4}-\d{2}$/.test(point.month))};};
 const current=reportFor(period,history),scale=metric==='sales'?100:1000000;
 let previous=null,comparison;
 try{
  previous=reportFor(previousPeriod,previousHistory);
  if(previous.period.inicio!==previousDate(current.period.inicio)||previous.period.coveredThrough!==previousDate(current.period.coveredThrough))throw new Error('O ano anterior ainda não tem o mesmo intervalo e corte de datas da consulta atual.');
  comparison={status:'ok',error:null,scope:'current-portfolio',period:{current:current.period,previous:previous.period},metrics:{selected:pair(current.totals.selected,previous.totals.selected,scale),share:pair(current.totals.share,previous.totals.share,0),totalClients:pair(current.portfolio.totalClients,previous.portfolio.totalClients),billedClients:pair(current.portfolio.billedClients,previous.portfolio.billedClients),unbilledClients:pair(current.portfolio.unbilledClients,previous.portfolio.unbilledClients),noBillingCities:pair(noBillingCities(current),noBillingCities(previous))}};
 }catch(error){previous=null;comparison={status:'error',error:error.message,scope:'current-portfolio',period:{current:current.period,previous:null},metrics:{selected:pair(current.totals.selected,null),share:pair(current.totals.share,null),totalClients:pair(current.portfolio.totalClients,null),billedClients:pair(current.portfolio.billedClients,null),unbilledClients:pair(current.portfolio.unbilledClients,null),noBillingCities:pair(noBillingCities(current),null)}};}
 let previousSeries=[];
 try{previousSeries=previous?.series||reportFor(period,previousHistory).series;}catch{ /* Unknown history stays unknown. */ }
 const previousPoints=new Map(previousSeries.map(point=>[point.month,point])),currentRaw=new Map((history?.months||[]).map(point=>[point.month,point])),previousRaw=new Map((previousHistory?.months||[]).map(point=>[point.month,point]));
 const monthly=current.series.map(point=>{
  const previousMonth=String(Number(point.month.slice(0,4))-1).padStart(4,'0')+point.month.slice(4),other=previousPoints.get(previousMonth),aligned=equivalentMonthCut(currentRaw.get(point.month),previousRaw.get(previousMonth)),prior=aligned&&other?.status==='ok'?other.selected:null,values=pair(point.status==='ok'?point.selected:null,prior,scale),known=numeric(values.current)&&numeric(values.previous);
  return {month:point.month,previousMonth,...values,status:known?'ok':'error',error:!aligned?'O corte do ano anterior ainda não corresponde ao mesmo dia.':!known?'Não há dados completos para comparar este mês.':null,currentShare:point.share,previousShare:aligned?other?.share??null:null};
 });
 let recovery;
 const year=Number(current.period.coveredThrough.slice(0,4)),previousYear=year-1;
 try{
  // A read-only empty catalog exposes the selected sellers' invoiced API rows,
  // using the same billing evidence and seller resolution as the main model.
  const prior=buildRepresentativeReport({catalog:{clients:[]},period:previousYearPeriod,history:{months:[{month:'__identity__',status:'ok',clientes:context}]},selectedIds,metric});
  if(prior.period.inicio!==previousYear+'-01-01'||prior.period.coveredThrough!==previousYear+'-12-31')throw new Error('A lista exige a cobertura completa do ano anterior.');
  const buyers=prior.outsideCatalogClients;
  const candidateCatalog={clients:buyers.map(buyer=>({code:buyer.code,name:buyer.name,city:buyer.city,uf:buyer.uf,rep:buyer.rep,repCode:buyer.repCode,status:'Ativo'}))};
  // Portfolio lookup deliberately uses all-company invoices: a customer billed by
  // a different seller this year is not falsely presented as a lost customer.
  const present=buildRepresentativeReport({catalog:candidateCatalog,period:currentYearPeriod,history:{months:[{month:'__identity__',status:'ok',clientes:context}]},selectedIds,metric});
  if(present.period.inicio!==year+'-01-01'||present.period.coveredThrough.slice(0,4)!==String(year))throw new Error('A lista exige uma consulta desde janeiro do ano selecionado.');
  if(present.period.coveredThrough!==current.period.coveredThrough)throw new Error('A lista anual ainda não tem o mesmo corte de cobertura do relatório.');
  const notBilled=new Map(present.unbilledClients.map(client=>[client.code,client])),catalogByCode=new Map(catalog.clients.map(client=>[normalizeCode(client.code??client.cod_cliente),client]));
  const clients=buyers.filter(buyer=>notBilled.has(buyer.code)).map(buyer=>{const entry=catalogByCode.get(buyer.code),location=cityLocation(entry?.city?entry:buyer);return {code:buyer.code,name:String(entry?.name||buyer.name||'Cliente '+buyer.code),...location,rep:String(entry?.rep||buyer.rep||''),repCode:normalizeCode(entry?.repCode??entry?.cod_rep??buyer.repCode),previousRep:buyer.rep,previousRepCode:buyer.repCode,previousSales:buyer.sales,previousFardos:buyer.fardos,previousValue:buyer.value,lastInvoice:dateOK(buyer.ult_faturamento)?buyer.ult_faturamento:null,pending:Boolean(notBilled.get(buyer.code)?.pending),catalogStatus:entry?.status||null};}).sort((a,b)=>a.city.localeCompare(b.city,'pt-BR')||a.name.localeCompare(b.name,'pt-BR'));
  recovery={status:'ok',error:null,currentYear:year,previousYear,coveredThrough:present.period.coveredThrough,clients};
 }catch(error){recovery={status:'error',error:error.message,currentYear:year,previousYear,coveredThrough:null,clients:[]};}
 return {metric,current,previous,comparison,monthly,recovery};
}
