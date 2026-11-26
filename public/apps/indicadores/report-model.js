(function(global){
'use strict';
const GROUPS=['Redes','Representantes'];
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const dayCount=(start,end)=>Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1;
const dateLabel=value=>value.slice(8,10)+'/'+value.slice(5,7);
function sum(records,key){return records.reduce((total,item)=>total+BigInt(item[key]),0n);}
function averageUnits(value,days,metric){
 if(!Number.isSafeInteger(days)||days<1)throw new Error('Informe uma quantidade positiva de dias.');
 if(!['sales','fardos'].includes(metric))throw new Error('Métrica inválida para a média diária.');
 const total=BigInt(value),divisor=BigInt(days),quotient=total/divisor,remainder=total%divisor;
 if(metric==='sales'&&(remainder<0n?-remainder:remainder)*2n>=divisor)return quotient+(total<0n?-1n:1n);
 return quotient;
}
function validate(data,filter){
 if(!data||data.schemaVersion!==1||!Array.isArray(data.records))throw new Error('Os dados do relatório não foram carregados.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(filter.start)||!/^\d{4}-\d{2}-\d{2}$/.test(filter.end)||filter.start>filter.end||filter.start<data.source.start||filter.end>data.source.end||!data.days.some(day=>day.date===filter.start)||!data.days.some(day=>day.date===filter.end))throw new Error('Selecione um período entre '+dateLabel(data.source.start)+' e '+dateLabel(data.source.end)+'/'+data.source.end.slice(0,4)+'.');
 if(!['all',...GROUPS].includes(filter.group))throw new Error('Selecione um grupo válido.');
 if(filter.rep!=='all'&&!data.records.some(item=>item.repCode===filter.rep))throw new Error('Selecione um vendedor com vendas no período carregado.');
}
function groups(records){return Object.fromEntries(GROUPS.map(group=>{const selected=records.filter(item=>item.group===group);return [group,{salesCents:sum(selected,'salesCents'),fardosUnits:sum(selected,'fardosUnits')}];}));}
function summarize(data,filter){
 validate(data,filter);
 const records=data.records.filter(item=>item.date>=filter.start&&item.date<=filter.end&&(filter.group==='all'||item.group===filter.group)&&(filter.rep==='all'||item.repCode===filter.rep));
 const result={filter:{...filter},records,groups:groups(records),salesCents:sum(records,'salesCents'),fardosUnits:sum(records,'fardosUnits'),days:dayCount(filter.start,filter.end),clients:new Set(records.map(item=>item.clientCode)).size};
 result.daily=data.days.filter(day=>day.date>=filter.start&&day.date<=filter.end).map(day=>({date:day.date,state:day.state,...groups(records.filter(item=>item.date===day.date))}));
 const weeks=new Map();
 for(const day of result.daily){const date=new Date(day.date+'T00:00:00Z'),weekday=(date.getUTCDay()+6)%7;date.setUTCDate(date.getUTCDate()-weekday);const key=date.toISOString().slice(0,10);if(!weeks.has(key))weeks.set(key,{start:day.date,end:day.date,Redes:{salesCents:0n,fardosUnits:0n},Representantes:{salesCents:0n,fardosUnits:0n},loadedDays:0});const week=weeks.get(key);week.end=day.date;if(day.state==='loaded')week.loadedDays++;for(const group of GROUPS)for(const metric of ['salesCents','fardosUnits'])week[group][metric]+=day[group][metric];}
 result.weeks=[...weeks.values()].map(week=>({...week,label:dateLabel(week.start)+' a '+dateLabel(week.end)}));
 const repOrder=new Map(data.representatives.map((item,index)=>[item.code,index]));
 result.ranking=filter.group==='Redes'?[]:data.representatives.filter(item=>filter.rep==='all'||item.code===filter.rep).map(rep=>{const selected=records.filter(item=>item.repCode===rep.code&&item.group==='Representantes');return {...rep,salesCents:sum(selected,'salesCents'),fardosUnits:sum(selected,'fardosUnits')};}).sort((a,b)=>a.fardosUnits===b.fardosUnits?repOrder.get(a.code)-repOrder.get(b.code):a.fardosUnits>b.fardosUnits?-1:1).map((item,index)=>({...item,position:index+1,averageUnits:averageUnits(item.fardosUnits,result.days,'fardos')}));
 return result;
}
function search(records,query){const terms=normalize(query).split(/\s+/).filter(Boolean);return terms.length?records.filter(item=>terms.every(term=>normalize([item.client,item.clientCode,item.rep,item.repCode,item.group,item.date].join(' ')).includes(term))):records;}
// Mesma divisão do relatório: VENDA DIRETA (7) e VENDA DIRETA ATACADO (12) são Redes.
const orderGroup=repCode=>['7','12'].includes(repCode)?'Redes':'Representantes';
const weekOf=date=>{const day=new Date(date+'T00:00:00Z');day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);return day.toISOString().slice(0,10);};
const plusDays=(date,days)=>{const day=new Date(date+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+days);return day.toISOString().slice(0,10);};
/**
 * Registros de um dia a partir da resposta já validada por BICore.api.loadPeriod.
 * Regra da planilha original: R$ de arroz, flocão e salgadinho (tudo menos Outros);
 * fardos de todos os produtos, inclusive Outros. Linhas só com pedidos a faturar ficam fora.
 */
function recordsFromDay(date,response){
 const records=[];
 for(const row of response.clientes){
  const sales=Object.entries(row.sales||{}),fardos=Object.values(row.fardos||{});
  if(!sales.some(([,value])=>value)&&!fardos.some(Boolean))continue;
  records.push({key:date+'|'+row.cod_cliente+'|'+row.cod_rep,date,clientCode:row.cod_cliente,client:row.name,repCode:row.cod_rep,rep:row.rep,group:orderGroup(row.cod_rep),salesCents:sales.reduce((sum,[category,value])=>category==='Outros'?sum:sum+Math.round(value*100),0),fardosUnits:fardos.reduce((sum,value)=>sum+Math.round(value*1000000),0),fardosMissing:!row.fardos});
 }
 return records;
}
/** Base no mesmo formato da planilha, para o período consultado dia a dia na API. */
function apiDataset({start,end,updatedAt,days}){
 const records=days.flatMap(day=>day.records),reps=new Map();
 for(const item of records)if(item.group==='Representantes'&&!reps.has(item.repCode))reps.set(item.repCode,item.rep);
 return {schemaVersion:1,source:{start,end,updatedAt,mode:'api',fardosMissing:records.filter(item=>item.fardosMissing).length},representatives:[...reps].map(([code,name])=>({code,name})).sort((a,b)=>a.code.localeCompare(b.code)),days:days.map(day=>({date:day.date,state:'loaded'})),records};
}
/** Pedidos em aberto agora (API) por vendedor e pedidos novos por semana (histórico gravado pelo servidor). */
function summarizeOrders(payload,filter,weekLimit=8){
 const current=payload?.current,history=payload?.history;
 if(!current||!Array.isArray(current.rows)||!history||!Array.isArray(history.snapshots)||!history.newByDay)throw new Error('A resposta de pedidos veio incompleta.');
 const keep=code=>(filter.group==='all'||orderGroup(code)===filter.group)&&(filter.rep==='all'||code===filter.rep),reps=new Map();
 const rep=(code,name)=>{if(!reps.has(code))reps.set(code,{code,name:name||history.reps?.[code]||'Vendedor '+code,group:orderGroup(code),open:0,clients:0,aFaturarCents:0,newByWeek:{}});return reps.get(code);};
 for(const row of current.rows)if(keep(row.repCode)){const item=rep(row.repCode,row.repName);item.open+=row.orders.length;item.clients++;item.aFaturarCents+=Math.round(row.aFaturar*100);}
 const recorded=[...new Set(history.snapshots.map(item=>item.date))].sort();
 const weeks=[...new Set(recorded.map(weekOf))].sort().slice(-weekLimit).map(start=>({start,end:plusDays(start,6),recordedDays:recorded.filter(date=>weekOf(date)===start).length}));
 for(const [date,byRep] of Object.entries(history.newByDay)){const week=weekOf(date);if(!weeks.some(item=>item.start===week))continue;for(const [code,count] of Object.entries(byRep))if(keep(code)){const item=rep(code);item.newByWeek[week]=(item.newByWeek[week]||0)+count;}}
 const rows=[...reps.values()].sort((a,b)=>b.open-a.open||b.aFaturarCents-a.aFaturarCents||a.name.localeCompare(b.name,'pt-BR')),total=key=>rows.reduce((sum,item)=>sum+item[key],0);
 return {sourceUpdatedAt:current.sourceUpdatedAt,startedOn:history.startedOn,baselineOpen:history.snapshots[0]?.open??0,recordedDays:recorded.length,weeks,rows,totals:{open:total('open'),clients:total('clients'),aFaturarCents:total('aFaturarCents'),newByWeek:Object.fromEntries(weeks.map(week=>[week.start,rows.reduce((sum,item)=>sum+(item.newByWeek[week.start]||0),0)]))}};
}
/** Pedidos novos (pelo código) de Redes e Representantes em cada semana do relatório; recordedDays 0 = semana sem registro. */
function ordersByWeek(history,weeks,filter){
 const recorded=new Set(history.snapshots.map(item=>item.date));
 return weeks.map(week=>{
  const row={start:week.start,end:week.end,label:week.label,days:dayCount(week.start,week.end),recordedDays:[...recorded].filter(date=>date>=week.start&&date<=week.end).length,Redes:0,Representantes:0};
  for(const [date,byRep] of Object.entries(history.newByDay))if(date>=week.start&&date<=week.end)for(const [code,count] of Object.entries(byRep))if((filter.group==='all'||orderGroup(code)===filter.group)&&(filter.rep==='all'||code===filter.rep))row[orderGroup(code)]+=count;
  return row;
 });
}
global.BIReportModel=Object.freeze({GROUPS,normalize,dayCount,dateLabel,averageUnits,summarize,search,orderGroup,summarizeOrders,recordsFromDay,apiDataset,ordersByWeek});
})(window);
