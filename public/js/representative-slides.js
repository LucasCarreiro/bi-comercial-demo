import {esc,fmt,pct,MONTHS} from './charts.js';
import {representativeMacroSummary,representativeMonthlyStats,representativeMacroMonthlyGrowth} from './representative-pptx.js';
import {representativeIntro} from './representative-intro.js';

const number=value=>typeof value==='number'&&Number.isFinite(value);
const day=value=>typeof value==='string'?value.slice(0,10).split('-').reverse().join('/'):'—';
const integer=value=>number(value)?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(value):'—';
const unit=metric=>metric==='sales'?'R$':'Fardos';
const signed=value=>number(value)?(value>0?'+':'')+pct(value):'—';
const tone=value=>number(value)?value<0?'is-negative':value>0?'is-positive':'is-neutral':'is-unknown';
const amount=(value,metric='fardos',extra='')=>'<span'+(number(value)?' data-count="'+value+'" data-count-metric="'+metric+'"':'')+(extra?' class="'+extra+'"':'')+'>'+esc(fmt(value,metric))+'</span>';
const periodText=period=>day(period?.inicio)+' — '+day(period?.coveredThrough);

function orbit(){
 return '<svg class="rep-orbit" viewBox="0 0 640 640" aria-hidden="true"><defs><linearGradient id="rep-orbit-gradient" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#86ebe2"/><stop offset=".52" stop-color="#627bff"/><stop offset="1" stop-color="#f04c73"/></linearGradient></defs><g class="rep-orbit-breath"><circle class="rep-orbit-core" cx="320" cy="320" r="183"/><circle class="rep-orbit-line" cx="320" cy="320" r="249"/><circle class="rep-orbit-line rep-orbit-line--inner" cx="320" cy="320" r="216"/><g class="rep-orbit-spin"><ellipse cx="320" cy="320" rx="295" ry="125" transform="rotate(-28 320 320)"/><circle cx="57" cy="441" r="6"/></g><g class="rep-orbit-spin rep-orbit-spin--reverse"><ellipse cx="320" cy="320" rx="282" ry="157" transform="rotate(49 320 320)"/><circle cx="503" cy="531" r="4"/></g></g></svg>';
}

function backdrop(){
 return '<div class="rep-scene-aurora" aria-hidden="true"></div><svg class="rep-scene-contour" viewBox="0 0 1440 810" preserveAspectRatio="none" aria-hidden="true"><g><path d="M-130 740 C120 80 620 1120 1540 230"/><path d="M-100 770 C180 95 640 1080 1560 270"/><path d="M-70 800 C240 110 660 1040 1580 310"/><path d="M-40 830 C300 125 680 1000 1600 350"/></g></svg>';
}

function topLine(kicker,right,period){return '<div class="rep-scene-top" data-reveal><span><i></i>'+esc(kicker)+'</span><div class="rep-scene-context"><span>'+esc(right)+'</span><time class="rep-scene-date">'+esc(periodText(period))+'</time></div></div>';}
function foot(period){
 const stale=period?.stale||period?.coveredThrough<period?.fim;
 return stale?'<div class="rep-scene-foot rep-scene-warning" data-reveal><span class="rep-foot-warning">'+esc('Fonte cobre até '+day(period.coveredThrough)+' · solicitado até '+day(period.fim))+'</span></div>':'';
}
function title(kicker,heading,sub=''){
 return '<header class="rep-scene-heading" data-reveal><span class="rep-scene-eyebrow">'+esc(kicker)+'</span><h2>'+esc(heading)+'</h2>'+(sub?'<p>'+esc(sub)+'</p>':'')+'</header>';
}

function cover(entry,label){
 const report=entry.report,metric=report.metric,comparative=entry.comparison?.comparison?.metrics?.selected,year=Number(report.period.coveredThrough.slice(0,4)),name=label||report.representatives.map(row=>row.name).join(' + ');
 const previous=number(comparative?.previous)?comparative.previous:null,change=number(comparative?.change)?comparative.change:null;
 return '<div class="rep-scene rep-scene--cover">'+backdrop()+topLine('Distribuidora Demo · Resultados comerciais',unit(metric),report.period)+'<div class="rep-hero-main"><div class="rep-hero-copy"><span class="rep-scene-eyebrow" data-reveal>O resultado começa no campo</span><h1 class="'+(name.length>48?'rep-long-name':'')+'" data-reveal>'+esc(name)+'</h1><div class="rep-hero-change '+tone(change)+'" data-reveal><span class="rep-growth-arrow" aria-hidden="true">'+(number(change)?change<0?'↘':'↗':'—')+'</span><strong>'+esc(signed(change))+'</strong><span>sobre o mesmo período<br>de '+(year-1)+'</span></div></div><div class="rep-hero-result">'+orbit()+'<div class="rep-hero-number" data-reveal><span class="rep-scene-eyebrow">Realizado no período</span><strong>'+amount(report.totals.selected,metric)+'</strong><span class="rep-hero-unit">'+esc(metric==='sales'?'Receita faturada':'Fardos faturados')+'</span></div></div></div><div class="rep-hero-facts"><div data-reveal><span>Mesmo período · '+(year-1)+'</span><strong>'+amount(previous,metric)+'</strong></div><div data-reveal><span>Participação na empresa</span><strong>'+esc(pct(report.totals.share))+'</strong></div><div data-reveal><span>Clientes faturados da carteira</span><strong>'+integer(report.portfolio.billedClients)+'<small> / '+integer(report.portfolio.totalClients)+'</small></strong></div></div>'+foot(report.period)+'</div>';
}

function annualChart(entry){
 const year=Number(entry.report.period.coveredThrough.slice(0,4)),monthly=entry.comparison?.monthly||[],byMonth=new Map(monthly.map(row=>[Number(row.month?.slice(5,7)),row])),series=Array.from({length:12},(_,i)=>({month:i+1,...byMonth.get(i+1)}));
 const values=series.flatMap(point=>[point.current,point.previous]).filter(number);
 if(!values.length)return '<div class="rep-scene-empty" data-reveal>O histórico mensal ainda não está disponível.</div>';
 const width=1080,height=440,left=78,right=32,top=44,bottom=54,plotW=width-left-right,plotH=height-top-bottom,min=Math.min(0,...values),max=Math.max(1,...values),pad=(max-min)*.17,low=min<0?min-pad:0,high=max+pad;
 const x=index=>left+index*plotW/11,y=value=>top+(high-value)/(high-low)*plotH;
 const path=key=>{let connected=false;return series.map((point,index)=>{if(!number(point[key])){connected=false;return '';}const result=(connected?'L':'M')+x(index).toFixed(2)+' '+y(point[key]).toFixed(2);connected=true;return result;}).join(' ');};
 const compact=value=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
 const grid=Array.from({length:5},(_,i)=>{const value=low+(high-low)*i/4;return '<line class="rep-chart-grid" x1="'+left+'" x2="'+(width-right)+'" y1="'+y(value)+'" y2="'+y(value)+'"/><text class="rep-chart-axis" x="'+(left-14)+'" y="'+(y(value)+5)+'" text-anchor="end">'+esc(compact(value))+'</text>';}).join('');
 const points=series.map((point,index)=>{
  const month=MONTHS[index],label=month+' / '+year,previousLabel=month+' / '+(year-1),close=number(point.current)&&number(point.previous)&&Math.abs(y(point.current)-y(point.previous))<36;
  return '<text class="rep-chart-axis" x="'+x(index)+'" y="'+(height-14)+'" text-anchor="middle">'+month+'</text>'+(number(point.previous)?'<g class="rep-chart-point rep-chart-point--previous" tabindex="0" role="img" aria-label="'+esc(previousLabel+': '+fmt(point.previous,entry.report.metric))+'"><title>'+esc(previousLabel+': '+fmt(point.previous,entry.report.metric))+'</title><rect x="'+(x(index)-5)+'" y="'+(y(point.previous)-5)+'" width="10" height="10"/><rect class="rep-chart-hit" x="'+(x(index)-19)+'" y="'+(y(point.previous)-19)+'" width="38" height="38"/></g>':'')+(number(point.current)?'<g class="rep-chart-point rep-chart-point--current" tabindex="0" role="img" aria-label="'+esc(label+': '+fmt(point.current,entry.report.metric))+'"><title>'+esc(label+': '+fmt(point.current,entry.report.metric))+'</title><circle cx="'+x(index)+'" cy="'+y(point.current)+'" r="6"/><text class="rep-chart-value" x="'+x(index)+'" y="'+(y(point.current)+(close?-18:-17))+'" text-anchor="middle">'+esc(compact(point.current))+'</text><circle class="rep-chart-hit" cx="'+x(index)+'" cy="'+y(point.current)+'" r="21"/></g>':'');
 }).join('');
 return '<svg class="rep-deck-chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Comparação mensal de '+year+' e '+(year-1)+'. Passe sobre os pontos para o valor exato; meses sem dados ficam com lacunas.">'+grid+'<path class="rep-chart-line rep-chart-line--previous" d="'+path('previous')+'"/><path class="rep-chart-line rep-chart-line--current" data-draw pathLength="1" stroke-dasharray="1" d="'+path('current')+'"/>'+points+'</svg>';
}

function evolution(entry,label){
 const report=entry.report,year=Number(report.period.coveredThrough.slice(0,4)),stats=representativeMonthlyStats(entry),cutoff=stats.cutoff||report.period.coveredThrough,monthKey=cutoff.slice(0,7),last=stats.months.find(row=>row.month===monthKey),month=MONTHS[Number(monthKey.slice(5,7))-1]||'último mês';
 return '<div class="rep-scene rep-scene--evolution">'+backdrop()+topLine('Evolução das vendas',unit(report.metric),{inicio:year+'-01-01',coveredThrough:cutoff})+title(label,year+' em perspectiva','O ritmo mês a mês, comparado ao ano anterior.')+'<div class="rep-evolution-body"><div class="rep-chart-panel" data-reveal>'+annualChart(entry)+'<div class="rep-chart-legend"><span><i class="current"></i>'+year+' · realizado</span><span><i class="previous"></i>'+(year-1)+' · ano anterior</span></div></div><aside class="rep-chart-insights"><div class="rep-insight '+tone(last?.monthChange)+'" data-reveal><span>Crescimento mensal · '+esc(month)+'</span><strong>'+esc(signed(last?.monthChange))+'</strong><small>Em relação ao mês anterior</small></div><div class="rep-insight '+tone(last?.change)+'" data-reveal><span>Crescimento anual · '+esc(month)+'</span><strong>'+esc(signed(last?.change))+'</strong><small>Mesmo mês de '+(year-1)+'</small></div></aside></div>'+foot({...report.period,inicio:year+'-01-01',coveredThrough:cutoff})+'</div>';
}

function monthly(entry,label){
 const report=entry.report,year=Number(report.period.coveredThrough.slice(0,4)),stats=representativeMonthlyStats(entry),cutoff=stats.cutoff||report.period.coveredThrough,byMonth=new Map(stats.months.map(row=>[row.month,row])),count=cutoff.slice(0,4)===String(year)?Math.min(12,Math.max(0,Number(cutoff.slice(5,7))||0)):0;
 const rows=Array.from({length:count},(_,index)=>{const month=year+'-'+String(index+1).padStart(2,'0');return byMonth.get(month)||{month,current:null,previous:null,change:null,monthChange:null,partial:false};});
 const start=rows.length?MONTHS[0]:'Histórico',end=rows.length?MONTHS[rows.length-1]:'mensal';
 const table='<table class="rep-scene-table"><thead><tr><th>Mês</th><th>'+year+'</th><th>'+(year-1)+'</th><th>Crescimento anual</th><th>Mês anterior</th></tr></thead><tbody>'+rows.map(row=>'<tr data-reveal><th scope="row">'+esc(MONTHS[Number(row.month.slice(5,7))-1])+(row.partial?'<sup>*</sup>':'')+'</th><td>'+amount(row.current,report.metric)+'</td><td>'+amount(row.previous,report.metric)+'</td><td class="'+tone(row.change)+'">'+esc(signed(row.change))+'</td><td class="'+tone(row.monthChange)+'">'+esc(signed(row.monthChange))+'</td></tr>').join('')+'</tbody><tfoot><tr class="rep-month-average" data-reveal><th scope="row">Média mensal</th><td>'+amount(stats.average.current,report.metric)+'</td><td>'+amount(stats.average.previous,report.metric)+'</td><td class="'+tone(stats.growthAverage.annual)+'">'+esc(signed(stats.growthAverage.annual))+'</td><td class="'+tone(stats.growthAverage.month)+'">'+esc(signed(stats.growthAverage.month))+'</td></tr></tfoot></table>';
 return {title:'Comparação mensal · '+start+' a '+end,kind:'monthly',html:'<div class="rep-scene rep-scene--monthly rep-monthly-full" data-month-count="'+rows.length+'">'+backdrop()+topLine('Comparação mensal · '+start+' a '+end,unit(report.metric),{inicio:year+'-01-01',coveredThrough:cutoff})+title(label,'Os números, lado a lado.','Crescimento anual e evolução sobre o mês imediatamente anterior.')+'<div class="rep-monthly-table" data-reveal>'+table+'</div>'+foot({...report.period,inicio:year+'-01-01',coveredThrough:cutoff})+'</div>'};
}

function macroScenes(groups,metric){
 const summary=representativeMacroSummary(groups,metric),monthly=representativeMacroMonthlyGrowth(groups,metric),t=summary.totals,scenes=[],chunkSize=8;
 const rankedRows=[...summary.rows].sort((a,b)=>{
  if(number(a.current)!==number(b.current))return number(a.current)?-1:1;
  return (number(a.current)?b.current-a.current:0)||a.label.localeCompare(b.label,'pt-BR')||a.codes.join(',').localeCompare(b.codes.join(','),'pt-BR',{numeric:true});
 });
 for(let offset=0;offset<rankedRows.length;offset+=chunkSize){
  const rows=rankedRows.slice(offset,offset+chunkSize),page=offset/chunkSize,total=Math.ceil(summary.rows.length/chunkSize),change=t.change;
  const monthName=key=>/^\d{4}-\d{2}$/.test(key||'')?MONTHS[Number(key.slice(5,7))-1]+' / '+key.slice(0,4):'';
  const monthlyLabel=monthly.month&&monthly.previousMonth?monthName(monthly.month)+' × '+monthName(monthly.previousMonth):'';
  const stats='<div class="rep-macro-deck-stats"><div data-reveal><span>Realizado dos grupos</span><strong>'+amount(t.current,metric)+'</strong></div><div class="'+tone(change)+'" data-reveal><span>Crescimento anual</span><strong>'+esc(signed(change))+'</strong></div><div class="'+tone(monthly.change)+'" data-reveal><span>Crescimento mensal</span><strong>'+esc(signed(monthly.change))+'</strong><small>'+esc(monthly.reason||monthlyLabel)+'</small></div></div>';
  const table='<table class="rep-scene-table rep-macro-deck-table"><thead><tr><th>Representante / grupo</th><th>Realizado</th><th>Ano anterior</th><th>Crescimento</th><th>Participação</th></tr></thead><tbody>'+rows.map((row,index)=>'<tr data-reveal><th scope="row"><small>'+String(offset+index+1).padStart(2,'0')+'</small>'+esc(row.label)+'</th><td>'+amount(row.current,metric)+'</td><td>'+amount(row.previous,metric)+'</td><td class="'+tone(row.change)+'">'+esc(signed(row.change))+'</td><td>'+esc(pct(row.share))+'</td></tr>').join('')+'</tbody></table>';
  scenes.push({title:'Visão macro'+(total>1?' · '+(page+1)+'/'+total:''),chapter:'Visão macro',kind:'macro',html:'<div class="rep-scene rep-scene--macro">'+backdrop()+topLine('Distribuidora Demo · Visão macro',unit(metric),summary.period)+title(summary.rows.length+' grupos acompanhados','O campo em uma só visão.',total>1?'Representantes '+(offset+1)+'–'+Math.min(summary.rows.length,offset+chunkSize)+' de '+summary.rows.length:'Resultado dos grupos acompanhados no período.')+stats+'<div class="rep-macro-table-wrap" data-reveal>'+table+'</div>'+foot(summary.period)+'</div>'});
 }
 return scenes;
}

/** Read-only deck descriptors, generated from the already-confirmed representative models. */
export function representativeSlides({groups,metric='fardos',macro=true}={}){
 if(!['fardos','sales'].includes(metric))throw new Error('Escolha fardos ou R$ para a apresentação.');
 if(!Array.isArray(groups)||!groups.length)throw new Error('Carregue ao menos um representante para apresentar.');
 const chosen=groups.map(group=>{
  const entry=group?.reports?.find(value=>value?.report?.metric===metric);
  if(!entry?.report?.period?.coveredThrough||!Array.isArray(entry.report.representatives)||!entry.report.representatives.length)throw new Error('Um representante ainda não tem dados confirmados para apresentar.');
  return {entry,label:String(group.label||entry.groupLabel||entry.report.representatives.map(row=>row.name).join(' + '))};
 });
 const result=[representativeIntro({period:chosen[0].entry.report.period,metric,label:chosen.length===1?chosen[0].label:'',groupCount:chosen.length}),...(macro?macroScenes(groups,metric).map((scene,index)=>({...scene,id:'macro-'+index})):[])];
 chosen.forEach(({entry,label},index)=>{
  const chapter=label,prefix='representative-'+index+'-';
  result.push({id:prefix+'cover',title:'Resultado no período',chapter,kind:'cover',html:cover(entry,label)});
  result.push({id:prefix+'evolution',title:'Evolução anual',chapter,kind:'evolution',html:evolution(entry,label)});
  result.push({...monthly(entry,label),chapter,id:prefix+'monthly-0'});
 });
 return result;
}
