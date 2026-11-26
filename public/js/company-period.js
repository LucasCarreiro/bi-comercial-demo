import {ALL_CATEGORIES,buildEntities,consolidateEntities,valueFor,normalizeName} from './analytics.js';
import {esc,fmt,pct,MONTHS,lineChart,mixChart} from './charts.js';

const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const lastDay=month=>month+'-'+String(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()).padStart(2,'0');
const previousDate=value=>{const month=(Number(value.slice(0,4))-1)+value.slice(4,7);return month+'-'+String(Math.min(Number(value.slice(8)),Number(lastDay(month).slice(8)))).padStart(2,'0');};
const dateLabel=value=>value.split('-').reverse().join('/');
const change=(current,previous)=>current!==null&&previous!==null&&previous>0?(current-previous)/previous:null;
const signed=value=>value===null?'—':(value>0?'+':'')+pct(value);
const total=(points,metric)=>{const values=points.map(point=>point.status==='ok'?valueFor(point,metric,ALL_CATEGORIES):null);if(values.some(value=>value===null))return null;const scale=metric==='sales'?100:1000000;return Number(values.reduce((sum,value)=>sum+BigInt(Math.round(value*scale)),0n))/scale;};

export function companyPeriodSegments(inicio,fim){
 if(!validDate(inicio)||!validDate(fim)||inicio>fim||inicio.slice(0,4)!==fim.slice(0,4))throw new Error('Escolha datas válidas dentro do mesmo ano selecionado.');
 const year=inicio.slice(0,4),segments=[];
 for(let month=Number(inicio.slice(5,7));month<=Number(fim.slice(5,7));month++){
  const key=year+'-'+String(month).padStart(2,'0'),first=key+'-01',last=lastDay(key);
  segments.push({month:key,inicio:inicio>first?inicio:first,fim:fim<last?fim:last});
 }
 return segments;
}

/** Exact date segments: no full-month amount is sliced or prorated locally. */
export async function loadCompanyPeriod({inicio,fim,today,year,loadPeriod,history,previousHistory,force=false}){
 const segments=companyPeriodSegments(inicio,fim);
 if(!validDate(today)||fim>today||Number(inicio.slice(0,4))!==year)throw new Error('Use datas do ano selecionado, sem ultrapassar o dia de hoje.');
 const previous=segments.map(segment=>({month:(year-1)+segment.month.slice(4),inicio:previousDate(segment.inicio),fim:previousDate(segment.fim)}));
 const cache=new Map([...(history?.months||[]),...(previousHistory?.months||[])].map(point=>[point.month,point]));
 const jobs=[...segments,...previous],values=new Array(jobs.length);let next=0;
 const read=async()=>{
  while(next<jobs.length){const index=next++,segment=jobs[index],cached=cache.get(segment.month);
   try{
    const end=cached?.effectiveFim||cached?.coveredThrough||cached?.fim;
    const value=!force&&cached?.status==='ok'&&cached.inicio===segment.inicio&&end===segment.fim?cached:await loadPeriod({inicio:segment.inicio,fim:segment.fim},{allowStale:true});
    const covered=value.effectiveFim||value.coveredThrough||value.fim,sourceDay=String(value.updatedAt||value.atualizado_em||'').slice(0,10);
    if(value.status!=='ok'||!Array.isArray(value.clientes)||!validDate(covered)||!validDate(sourceDay)||value.freshnessKnown===false||covered<segment.fim||sourceDay<segment.fim)throw new Error('A API ainda não confirmou todos os dias deste intervalo.');
    values[index]={...value,...segment,status:'ok'};
   }catch(error){values[index]={...segment,status:'error',clientes:[],error:error.message};}
  }
 };
 await Promise.all([read(),read(),read()]);
 return {inicio,fim,previousInicio:previousDate(inicio),previousFim:previousDate(fim),year,current:values.slice(0,segments.length),previous:values.slice(segments.length),loadedOn:today};
}

export function companyPeriodSummary(entity,metric){
 const points=entity?.months||[],known=points.filter(point=>point.status==='ok'&&valueFor(point,metric,ALL_CATEGORIES)!==null);
 const categories=ALL_CATEGORIES.map(category=>{const values=known.map(point=>point[metric][category]),scale=metric==='sales'?100:1000000;return {category,value:Number(values.reduce((sum,value)=>sum+BigInt(Math.round(value*scale)),0n))/scale};});
 const net=categories.reduce((sum,item)=>sum+item.value,0);
 return {total:total(points,metric),knownTotal:net,complete:known.length===points.length,mix:categories.map(item=>({...item,share:net>0?item.value/net:null})),knownMonths:known.length};
}

export function companyPeriodHTML(data,aux,{metric='fardos',selectedId=null,query=''}={}){
 const entities=buildEntities(data.current,aux,'company').filter(entity=>entity.eligible),selected=entities.find(entity=>entity.id===selectedId),focus=selected||consolidateEntities(data.current,entities,ALL_CATEGORIES);
 if(selectedId&&!selected)return '<div class="empty-state"><h3>Cliente sem movimento no intervalo</h3><p>Limpe o filtro de cliente para consultar o resultado da empresa neste período.</p></div>';
 const priorEntities=buildEntities(data.previous,aux,'company'),priorFocus=selected?priorEntities.find(entity=>entity.id===selected.id)||consolidateEntities(data.previous,[],ALL_CATEGORIES):consolidateEntities(data.previous,priorEntities,ALL_CATEGORIES);
 const summary=companyPeriodSummary(focus,metric),prior=companyPeriodSummary(priorFocus,metric),evolution=change(summary.total,prior.total),unit=metric==='sales'?'R$':'fardos';
 const count=selected?1:entities.length,range=dateLabel(data.inicio)+' a '+dateLabel(data.fim),previousRange=dateLabel(data.previousInicio)+' a '+dateLabel(data.previousFim);
 const stat=(label,value,foot,featured=false)=>'<article class="stat-card'+(featured?' featured':'')+'"><span class="stat-label">'+esc(label)+'</span><strong class="stat-value">'+esc(value)+'</strong><span class="stat-foot">'+esc(foot)+'</span></article>';
 const seriesFor=(entity,year)=>Array.from({length:12},(_,index)=>{const month=year+'-'+String(index+1).padStart(2,'0'),point=entity.months.find(row=>row.month===month);return {month,total:point?.status==='ok'?valueFor(point,metric,ALL_CATEGORIES):null};});
 const currentSeries=seriesFor(focus,data.year),priorSeries=seriesFor(priorFocus,data.year-1),emptyForecast={months:[]};
 const rows=entities.map(entity=>({entity,summary:companyPeriodSummary(entity,metric)})).filter(({entity})=>normalizeName([entity.name,entity.city,...entity.clientCodes].join(' ')).includes(normalizeName(query))).sort((a,b)=>b.summary.knownTotal-a.summary.knownTotal||a.entity.name.localeCompare(b.entity.name,'pt-BR'));
 const errors=[...data.current,...data.previous].filter(row=>row.status!=='ok');
 const monthlyRows=focus.months.map(point=>{const other=priorFocus.months.find(row=>row.month.slice(5)===point.month.slice(5)),now=point.status==='ok'?valueFor(point,metric,ALL_CATEGORIES):null,before=other?.status==='ok'?valueFor(other,metric,ALL_CATEGORIES):null;return '<tr><td>'+esc(MONTHS[Number(point.month.slice(5))-1])+'</td><td>'+esc(fmt(now,metric))+'</td><td>'+esc(fmt(before,metric))+'</td><td class="'+(change(now,before)<0?'trend-down':'trend-up')+'">'+esc(signed(change(now,before)))+'</td></tr>';}).join('');
 return '<div class="detail-banner"><div><span class="eyebrow">Período selecionado</span><h3>'+esc(selected?.name||'Resultado da empresa')+'</h3><p>'+esc(range)+' · '+unit+' · Todas as categorias</p></div></div>'+
  (errors.length||!summary.complete||!prior.complete?'<div class="notice warning">Há dados indisponíveis no intervalo. Totais incompletos e comparações sem cobertura aparecem como “—”. O mix mostra somente os dados confirmados.</div>':'')+
  '<div class="stats-grid company-period-stats">'+stat('Realizado no período',fmt(summary.total,metric),range,true)+stat('Mesmo período de '+(data.year-1),fmt(prior.total,metric),previousRange)+stat('Evolução anual',signed(evolution),'Comparação do mesmo intervalo nos dois anos')+stat('Clientes com movimento',String(count),selected?'Cliente selecionado':'Todas as categorias')+'</div>'+
  '<div class="analysis-grid"><section class="panel"><div class="panel-heading"><div><h3>Evolução no período</h3><p>Somente as compras entre '+esc(range)+'</p></div></div><div class="chart-container">'+lineChart(currentSeries,emptyForecast,metric,{priorSeries,priorYear:data.year-1}).replace('Evolução mensal: linha azul mostra o realizado, tracejado vermelho mostra a tendência.','Evolução mensal no intervalo selecionado: linha azul mostra o realizado.')+'</div><div class="chart-legend"><span><i class="legend-dot"></i>'+data.year+'</span><span><i class="legend-dot previous"></i>'+(data.year-1)+'</span></div></section><section class="panel"><div class="panel-heading"><h3>Mix no período</h3></div>'+mixChart(summary.mix,metric)+'</section></div>'+
  '<section class="panel"><div class="panel-heading"><h3>Comparação mensal no intervalo</h3></div><div class="table-wrap"><table class="company-period-table"><thead><tr><th>Mês</th><th>'+data.year+'</th><th>'+(data.year-1)+'</th><th>Evolução anual</th></tr></thead><tbody>'+monthlyRows+'</tbody></table></div></section>'+
  '<section class="panel"><div class="panel-heading"><h3>Clientes da empresa</h3><span class="registry-count">'+rows.length+' clientes</span></div><div class="table-wrap"><table class="company-period-table"><thead><tr><th>Cliente / grupo</th><th>Realizado no período</th></tr></thead><tbody>'+rows.slice(0,500).map(({entity,summary:item})=>'<tr class="entity-row'+(selected?.id===entity.id?' is-selected':'')+'" data-entity-row="'+esc(entity.id)+'" tabindex="0"><td><button class="client-button" data-entity="'+esc(entity.id)+'">'+esc(entity.name)+'</button><small>'+esc(entity.city||'')+'</small></td><td>'+esc(fmt(item.total,metric))+'</td></tr>').join('')+'</tbody></table></div></section>';
}
