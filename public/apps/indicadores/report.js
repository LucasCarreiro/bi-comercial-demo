(function(){
'use strict';
const core=window.BICore,model=window.BIReportModel,$=id=>document.getElementById(id),colors={Redes:'#526fc1',Representantes:'#b54167'};
let data=null;
const today=core.analytics.saoPauloToday(),monthStart=today.slice(0,8)+'01';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const state={view:'overview',metric:'fardos',filter:{start:monthStart,end:today,group:'all',rep:'all'},orders:null,load:null,clamped:false};
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2}),integer=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0});
const key=()=>state.metric==='sales'?'salesCents':'fardosUnits';
const fmt=(value,metric=state.metric)=>value==null?'—':metric==='sales'?money.format(Number(value)/100):integer.format(Number(BigInt(value)/1000000n));
const percentage=value=>value==null?'—':new Intl.NumberFormat('pt-BR',{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1}).format(value);
const short=value=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:state.metric==='sales'?1:0,...(state.metric==='sales'?{style:'currency',currency:'BRL'}:{})}).format(value);
const unitName=()=>state.metric==='sales'?'R$':'fardos';
const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const tooltip=$('chart-tooltip');
function bindTooltips(){
 document.querySelectorAll('[data-tooltip]').forEach(point=>{const show=()=>{tooltip.innerHTML='<span>'+esc(point.dataset.tooltipTitle)+'</span><strong>'+esc(point.dataset.tooltip)+'</strong>';tooltip.hidden=false;const rect=point.getBoundingClientRect(),width=tooltip.offsetWidth||180;tooltip.style.left=Math.max(width/2+12,Math.min(window.innerWidth-width/2-12,(rect.left+rect.right)/2))+'px';tooltip.style.top=Math.max(70,rect.top-10)+'px';};point.addEventListener('pointerenter',show);point.addEventListener('focus',show);point.addEventListener('pointerleave',()=>tooltip.hidden=true);point.addEventListener('blur',()=>tooltip.hidden=true);point.addEventListener('pointerdown',show);point.addEventListener('keydown',event=>{if(event.key==='Escape')tooltip.hidden=true;});});
}
function card(label,value,note,featured=false){return '<article class="stat'+(featured?' featured':'')+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></article>';}
function pointAttributes(title,value){return ' tabindex="0" role="img" data-tooltip="'+esc(value)+'" data-tooltip-title="'+esc(title)+'" aria-label="'+esc(title+': '+value)+'"';}
// Barras de Redes e Representantes por semana; value null = semana sem registro.
function barChart(weeks,{value,text,tick,label,counts=false}){
 const width=760,height=280,left=69,right=22,top=20,bottom=52,plotW=width-left-right,plotH=height-top-bottom;
 const values=weeks.flatMap(week=>model.GROUPS.map(group=>value(week,group))).filter(amount=>amount!=null),minimum=Math.min(0,...values),maximum=Math.max(1,...values),span=maximum-minimum;
 // Contagens usam topo múltiplo de 4 para as marcas do eixo serem inteiras e distintas.
 const low=minimum<0?minimum-span*.1:0,high=counts?Math.max(4,Math.ceil(maximum*1.14/4)*4):maximum+span*.14,y=amount=>top+(high-amount)/(high-low)*plotH;
 const grids=Array.from({length:5},(_,index)=>{const amount=low+(high-low)*index/4;return '<line class="gridline" x1="'+left+'" x2="'+(width-right)+'" y1="'+y(amount)+'" y2="'+y(amount)+'"/><text x="'+(left-12)+'" y="'+(y(amount)+3)+'" text-anchor="end">'+esc(tick(amount))+'</text>';}).join('');
 const band=plotW/Math.max(weeks.length,1),barW=Math.min(32,band*.23);
 const bars=weeks.map((week,index)=>{const center=left+band*(index+.5),axis='<text x="'+center+'" y="'+(height-20)+'" text-anchor="middle">'+esc(week.label)+'</text>';
  if(model.GROUPS.some(group=>value(week,group)==null))return '<text class="no-data" x="'+center+'" y="'+(y(0)-8)+'" text-anchor="middle">sem registro</text>'+axis;
  return model.GROUPS.map((group,groupIndex)=>{const amount=value(week,group),barX=center+(groupIndex===0?-barW-3:3),topY=Math.min(y(amount),y(0)),barH=Math.max(amount===0?0:1,Math.abs(y(amount)-y(0)));return '<g class="point"'+pointAttributes(week.label+' · '+group,text(week,group))+'><title>'+esc(week.label+' · '+group+': '+text(week,group))+'</title><rect class="chart-bar" x="'+barX+'" y="'+topY+'" width="'+barW+'" height="'+barH+'" rx="4" fill="'+colors[group]+'" style="--delay:'+(index*75+groupIndex*35)+'ms"/><rect x="'+barX+'" y="'+Math.min(topY,y(0)-14)+'" width="'+barW+'" height="'+Math.max(24,barH)+'" fill="transparent"/></g>';}).join('')+axis;}).join('');
 return '<svg class="plot" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+esc(label)+'">'+grids+bars+'</svg>';
}
function weeklyChart(summary){
 const metric=key(),scale=state.metric==='sales'?100:1000000;
 return barChart(summary.weeks,{value:(week,group)=>Number(week[group][metric])/scale,text:(week,group)=>fmt(week[group][metric]),tick:short,label:'Comparação semanal de redes e representantes'});
}
function ordersWeekly(summary){
 const status=state.orders,head='<div class="panel-head"><div><h2>Pedidos por semana</h2><p>Pedidos novos pelo código, de segunda a domingo, dentro do período filtrado.</p></div><span class="small-label">pedidos</span></div>';
 if(!status||status.loading)return '<section class="panel daily-panel">'+head+'<p class="empty">Consultando o histórico de pedidos…</p></section>';
 if(status.error)return '<section class="panel daily-panel">'+head+'<p class="empty">'+esc(status.error)+'</p></section>';
 const history=status.payload.history,weeks=model.ordersByWeek(history,summary.weeks,state.filter);
 const chart=barChart(weeks,{value:(week,group)=>week.recordedDays?week[group]:null,text:(week,group)=>integer.format(week[group])+(week[group]===1?' pedido':' pedidos')+' · '+week.recordedDays+' de '+week.days+' dias registrados',tick:amount=>integer.format(amount),label:'Pedidos novos por semana de redes e representantes',counts:true});
 return '<section class="panel daily-panel">'+head+'<div class="plot-wrap">'+chart+'</div>'+legend()+'<div class="ranking-foot">Histórico desde '+day(history.startedOn)+': semanas anteriores aparecem como sem registro, e os pedidos já em aberto no primeiro registro não contam como novos. O histórico é gravado quando alguém abre esta aba; um pedido lançado e faturado num dia sem registro fica de fora.</div></section>';
}
function dailyChart(summary){
 const metric=key(),scale=state.metric==='sales'?100:1000000,width=1100,height=280,left=75,right=25,top=22,bottom=45,plotW=width-left-right,plotH=height-top-bottom;
 const values=summary.daily.flatMap(day=>model.GROUPS.map(group=>Number(day[group][metric])/scale)),low=Math.min(0,...values),maximum=Math.max(1,...values),high=maximum+(maximum-low)*.15,y=value=>top+(high-value)/(high-low)*plotH,x=index=>left+index*plotW/Math.max(1,summary.daily.length-1);
 const grids=Array.from({length:5},(_,index)=>{const value=low+(high-low)*index/4;return '<line class="gridline" x1="'+left+'" x2="'+(width-right)+'" y1="'+y(value)+'" y2="'+y(value)+'"/><text x="'+(left-12)+'" y="'+(y(value)+3)+'" text-anchor="end">'+esc(short(value))+'</text>';}).join('');
 const lines=model.GROUPS.map(group=>'<path class="chart-line" stroke="'+colors[group]+'" d="'+summary.daily.map((day,index)=>(index?'L':'M')+x(index).toFixed(2)+','+y(Number(day[group][metric])/scale).toFixed(2)).join(' ')+'"/>').join('');
 const points=summary.daily.map((day,index)=>model.GROUPS.map(group=>'<g class="point"'+pointAttributes(model.dateLabel(day.date)+' · '+group,fmt(day[group][metric]))+'><title>'+esc(model.dateLabel(day.date)+' · '+group+': '+fmt(day[group][metric]))+'</title><circle cx="'+x(index)+'" cy="'+y(Number(day[group][metric])/scale)+'" r="3.5" fill="'+colors[group]+'" stroke="#fff" stroke-width="1.5"/><rect x="'+(x(index)-10)+'" y="'+(y(Number(day[group][metric])/scale)-10)+'" width="20" height="20" fill="transparent"/></g>').join('')+(index===0||index===summary.daily.length-1||index%3===0?'<text x="'+x(index)+'" y="'+(height-14)+'" text-anchor="middle">'+model.dateLabel(day.date)+'</text>':'')).join('');
 return '<svg class="plot" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Evolução diária de redes e representantes">'+grids+lines+points+'</svg>';
}
function legend(){return '<div class="legend">'+model.GROUPS.map(group=>'<span><i style="background:'+colors[group]+'"></i>'+group+'</span>').join('')+'</div>';}
function shareChart(summary){
 const metric=key(),total=summary[metric],valid=total>0n&&model.GROUPS.every(group=>summary.groups[group][metric]>=0n),radius=62,circ=2*Math.PI*radius;let offset=0;
 const arcs=model.GROUPS.map(group=>{const share=valid?Number(summary.groups[group][metric])/Number(total):0,length=share*circ,arc='<circle cx="90" cy="90" r="62" style="stroke:'+colors[group]+';stroke-dasharray:'+length+' '+(circ-length)+';stroke-dashoffset:'+(-offset)+'"/>';offset+=length;return arc;}).join('');
 return '<div class="share-body"><svg class="donut" viewBox="0 0 180 180" role="img" aria-label="Participação de redes e representantes"><circle cx="90" cy="90" r="62" stroke="#edf1f7"/>'+arcs+'</svg><div class="share-list">'+model.GROUPS.map(group=>'<div class="share-item"><span>'+group+'</span><strong>'+percentage(valid?Number(summary.groups[group][metric])/Number(total):null)+'</strong><small>'+fmt(summary.groups[group][metric])+'</small></div>').join('')+'</div></div>';
}
function overview(summary){
 const metric=key(),total=summary[metric],shares=group=>total>0n&&summary.groups[group][metric]>=0n?percentage(Number(summary.groups[group][metric])/Number(total)):'—';
 const stats='<div class="stats">'+card(state.metric==='sales'?'Faturamento total':'Volume total',fmt(total),summary.days+' dias carregados · '+summary.clients+' clientes com compra',true)+card('Redes',fmt(summary.groups.Redes[metric]),shares('Redes')+' do período')+card('Representantes',fmt(summary.groups.Representantes[metric]),shares('Representantes')+' do período')+card('Média diária',fmt(model.averageUnits(total,summary.days,state.metric)),unitName()+' por dia corrido do filtro')+'</div>';
 const charts='<div class="charts"><section class="panel"><div class="panel-head"><div><h2>Comparação por semana</h2><p>Segunda a domingo, dentro do período filtrado.</p></div><span class="small-label">'+unitName()+'</span></div><div class="plot-wrap">'+weeklyChart(summary)+'</div>'+legend()+'</section><section class="panel"><div class="panel-head"><h2>Participação no período</h2></div>'+shareChart(summary)+'</section></div>';
 const daily='<section class="panel daily-panel"><div class="panel-head"><h2>Evolução por dia</h2><span class="small-label">'+unitName()+'</span></div><div class="plot-wrap">'+dailyChart(summary)+'</div>'+legend()+'</section>';
 const rows=summary.daily.map(day=>{const sum=day.Redes[metric]+day.Representantes[metric];return '<tr><td>'+model.dateLabel(day.date)+'</td><td>'+fmt(day.Redes[metric])+'</td><td>'+fmt(day.Representantes[metric])+'</td><td>'+fmt(sum)+'</td><td>'+percentage(sum>0n?Number(day.Redes[metric])/Number(sum):null)+'</td><td>'+percentage(sum>0n?Number(day.Representantes[metric])/Number(sum):null)+'</td></tr>';}).join('');
 return stats+charts+ordersWeekly(summary)+daily+'<section class="panel daily-panel"><div class="panel-head"><h2>Detalhamento diário</h2><span class="small-label">'+summary.daily.length+' dias</span></div><div class="table-wrap"><table><thead><tr><th>Dia</th><th>Redes · '+unitName()+'</th><th>Representantes · '+unitName()+'</th><th>Total · '+unitName()+'</th><th>Redes %</th><th>Representantes %</th></tr></thead><tbody>'+rows+'</tbody></table></div></section>';
}
// Única consulta desta aba: o endpoint do próprio site, que lê a API e guarda o histórico diário.
const ORDERS_URL='../../api/orders.php';
const day=value=>value?value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4):'—';
async function loadOrders(){
 state.orders={loading:true};if(state.view==='orders')render();
 try{
  if(window.location?.protocol==='file:')throw new Error('Abra o painel pelo endereço do servidor para consultar os pedidos.');
  let response,body=null;
  try{response=await fetch(ORDERS_URL,{cache:'no-store',headers:{Accept:'application/json'}});}catch{throw new Error('Não foi possível acessar o servidor do painel.');}
  try{body=await response.json();}catch{body=null;}
  if(!response.ok||!body)throw new Error(body?.message||'Não foi possível consultar os pedidos.');
  model.summarizeOrders(body,state.filter);state.orders={payload:body};
 }catch(error){state.orders={error:error.message};}
 // A visão geral também mostra os pedidos por semana.
 if(state.view!=='ranking')render(false);
}
function ordersView(){
 const status=state.orders||{loading:true},busy=Boolean(status.loading);
 const head='<div class="subheader"><div><h2>Pedidos por vendedor</h2><p>Pedidos em aberto (ainda não faturados), consultados agora na API. Grupo e vendedor filtram esta visão; as datas não se aplicam.</p></div><button type="button" class="button secondary" data-orders-refresh'+(busy?' disabled':'')+'>'+(busy?'Consultando…':'Atualizar')+'</button></div>';
 if(busy)return head+'<section class="panel"><p class="empty">Consultando os pedidos em aberto na API…</p></section>';
 if(status.error)return head+'<p class="notice error" role="alert">'+esc(status.error)+'</p>';
 const summary=model.summarizeOrders(status.payload,state.filter),totals=summary.totals,openRows=summary.rows.filter(item=>item.open>0),max=Math.max(1,...openRows.map(item=>item.open)),plural=(value,one,many)=>integer.format(value)+' '+(value===1?one:many);
 const stats='<div class="stats">'+card('Pedidos em aberto',integer.format(totals.open),'API atualizada em '+day(summary.sourceUpdatedAt)+' às '+summary.sourceUpdatedAt.slice(11,16),true)+card('Clientes com pedido',integer.format(totals.clients),'Aguardando faturamento')+card('A faturar',money.format(totals.aFaturarCents/100),'Valor dos pedidos em aberto')+card('Vendedores',integer.format(openRows.length),'Com pedido em aberto agora')+'</div>';
 const bars=openRows.map((item,index)=>'<div class="order-bar point"'+pointAttributes(item.name,plural(item.open,'pedido','pedidos')+' · '+plural(item.clients,'cliente','clientes')+' · '+money.format(item.aFaturarCents/100))+'><span class="order-name">'+esc(item.name)+'<small>Cód. '+esc(item.code)+' · '+item.group+'</small></span><span class="order-track"><i style="width:'+(item.open/max*100).toFixed(1)+'%;background:'+colors[item.group]+';animation-delay:'+index*40+'ms"></i></span><strong>'+integer.format(item.open)+'</strong></div>').join('');
 const chart='<section class="panel"><div class="panel-head"><div><h2>Pedidos em aberto por vendedor</h2><p>Quantidade de pedidos ainda não faturados de cada vendedor.</p></div><span class="small-label">pedidos</span></div>'+(bars?'<div class="order-bars">'+bars+'</div>'+legend():'<p class="empty">O filtro selecionado não tem pedidos em aberto agora.</p>')+'</section>';
 const weekHead=summary.weeks.map(week=>'<th>'+model.dateLabel(week.start)+' a '+model.dateLabel(week.end)+'<small>'+week.recordedDays+' de 7 dias registrados</small></th>').join('');
 const rows=summary.rows.map(item=>'<tr><td class="client">'+esc(item.name)+'<small>Cód. '+esc(item.code)+' · '+item.group+'</small></td>'+summary.weeks.map(week=>'<td>'+integer.format(item.newByWeek[week.start]||0)+'</td>').join('')+'<td>'+integer.format(item.open)+'</td><td>'+money.format(item.aFaturarCents/100)+'</td></tr>').join('');
 const totalRow='<tr class="orders-total"><td class="client">Total</td>'+summary.weeks.map(week=>'<td>'+integer.format(totals.newByWeek[week.start])+'</td>').join('')+'<td>'+integer.format(totals.open)+'</td><td>'+money.format(totals.aFaturarCents/100)+'</td></tr>';
 const starting=summary.recordedDays<=1?' O histórico começou agora: os pedidos novos aparecem a partir da próxima atualização diária da API.':'';
 const table='<section class="panel daily-panel"><div class="panel-head"><div><h2>Pedidos novos por semana</h2><p>Pedidos que apareceram pela primeira vez na atualização diária da API, de segunda a domingo.</p></div><span class="small-label">'+plural(summary.recordedDays,'dia registrado','dias registrados')+'</span></div><div class="table-wrap"><table class="orders-table"><thead><tr><th>Vendedor</th>'+weekHead+'<th>Em aberto agora</th><th>A faturar</th></tr></thead><tbody>'+(rows?rows+totalRow:'<tr><td colspan="'+(summary.weeks.length+3)+'" class="empty">O filtro selecionado não tem pedidos.</td></tr>')+'</tbody></table></div><div class="ranking-foot">Histórico desde '+day(summary.startedOn)+'. Os '+integer.format(summary.baselineOpen)+' pedidos já em aberto no primeiro registro (todos os vendedores) não contam como novos. Dias sem registro podem deixar de fora pedidos lançados e faturados no intervalo.'+starting+'</div></section>';
 return head+stats+chart+table;
}
function ranking(summary){
 const total=summary.ranking.reduce((sum,item)=>sum+item.salesCents,0n),volume=summary.ranking.reduce((sum,item)=>sum+item.fardosUnits,0n);
 return '<div class="subheader"><div><h2>Ranking dos representantes</h2><p>Ordenação por volume em fardos.</p></div><span class="small-label">'+summary.ranking.length+' representantes</span></div><div class="stats">'+card('Faturamento',fmt(total,'sales'),'Representantes do filtro',true)+card('Volume',fmt(volume,'fardos'),'Fardos faturados')+card('Média diária',fmt(model.averageUnits(volume,summary.days,'fardos'),'fardos'),'Fardos por dia corrido do filtro')+card('Vendedores',String(summary.ranking.length),'VENDA DIRETA e VENDA DIRETA ATACADO ficam fora do ranking')+'</div><section class="panel"><div class="table-wrap"><table class="ranking-table"><thead><tr><th>Posição</th><th>Representante</th><th>Faturamento R$</th><th>Volume em fardos</th><th>Média fardos/dia</th></tr></thead><tbody>'+ (summary.ranking.map(item=>'<tr><td><span class="rank-number'+(item.position<=3?' top':'')+'">'+item.position+'</span></td><td class="client">'+esc(item.name)+'<small>Cód. '+esc(item.code)+'</small></td><td>'+fmt(item.salesCents,'sales')+'</td><td>'+fmt(item.fardosUnits,'fardos')+'</td><td>'+fmt(item.averageUnits,'fardos')+'</td></tr>').join('')||'<tr><td colspan="5" class="empty">O filtro selecionado não inclui representantes.</td></tr>')+'</tbody></table></div><div class="ranking-foot">Média diária = fardos ÷ '+summary.days+' dias corridos do período filtrado.</div></section>';
}
// A API devolve totais do período: os gráficos por dia pedem uma consulta por dia.
const MAX_DAYS=62,CACHE_KEY='bi-indicadores-dias-v1';
let loadSeq=0,loadAbort=null,memory=null;
const fullDate=value=>value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4);
const calendar=(start,end)=>{const days=[];for(const day=new Date(start+'T00:00:00Z');day.toISOString().slice(0,10)<=end;day.setUTCDate(day.getUTCDate()+1))days.push(day.toISOString().slice(0,10));return days;};
// Dias consultados só valem para a mesma atualização da API; na próxima, a consulta recomeça.
function cacheFor(updatedAt){
 if(memory?.updatedAt===updatedAt)return memory;
 try{const saved=JSON.parse(window.sessionStorage.getItem(CACHE_KEY)||'null');memory=saved?.updatedAt===updatedAt&&saved.days?saved:{updatedAt,days:{}};}catch{memory={updatedAt,days:{}};}
 return memory;
}
function saveCache(){try{window.sessionStorage.setItem(CACHE_KEY,JSON.stringify(memory));}catch{/* Sem armazenamento, a próxima consulta volta à API. */}}
function periodError(filter){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(filter.start)||!/^\d{4}-\d{2}-\d{2}$/.test(filter.end)||filter.start>filter.end)return 'Informe um início anterior ou igual ao fim.';
 if(filter.end>today)return 'O fim não pode ser depois de hoje.';
 if(model.dayCount(filter.start,filter.end)>MAX_DAYS)return 'Escolha um período de até '+MAX_DAYS+' dias: cada dia é uma consulta à API.';
 return null;
}
function showError(message){$('filter-error').textContent=message;$('filter-error').hidden=false;}
function setBusy(busy){$('apply-filters').disabled=busy;$('apply-filters').textContent=busy?'Consultando…':'Aplicar';}
function fillControls(){
 const reps=[...new Map(data.records.map(item=>[item.repCode,{code:item.repCode,name:item.rep}])).values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')),updated=data.source.updatedAt;
 if(!reps.some(rep=>rep.code===state.filter.rep))state.filter={...state.filter,rep:'all'};
 $('representative').innerHTML='<option value="all">Todos os vendedores</option>'+reps.map(rep=>'<option value="'+esc(rep.code)+'">'+esc(rep.name)+'</option>').join('');
 $('date-start').value=state.filter.start;$('date-end').value=state.filter.end;$('group').value=state.filter.group;$('representative').value=state.filter.rep;
 $('source-period').textContent='Dados fictícios · '+model.dateLabel(data.source.start)+' a '+model.dateLabel(data.source.end)+'/'+data.source.end.slice(0,4);
 $('source-updated').textContent=(updated?'API atualizada em '+fullDate(updated)+' às '+updated.slice(11,16)+'.':'A API não informou a data de atualização.')+(state.clamped?' O fim foi ajustado para '+fullDate(data.source.end)+', último dia com dados.':'')+(data.source.fardosMissing?' '+data.source.fardosMissing+' registro(s) vieram sem fardos da API.':'');
}
async function loadRange(filter){
 const id=++loadSeq,controller=new AbortController(),options={signal:controller.signal,allowStale:true};
 loadAbort?.abort();loadAbort=controller;state.load={done:0,total:model.dayCount(filter.start,filter.end)};setBusy(true);if(state.view!=='orders')render();
 try{
  // O último dia pedido mostra até quando a API está atualizada.
  const last=await core.api.loadPeriod({inicio:filter.end,fim:filter.end},options),updatedAt=last.updatedAt,sourceDay=updatedAt?.slice(0,10)||null;
  const end=sourceDay&&sourceDay<filter.end?sourceDay:filter.end;
  if(end<filter.start)throw new Error('A API foi atualizada em '+fullDate(sourceDay)+'. Escolha um período que termine até essa data.');
  const cache=cacheFor(updatedAt),dates=calendar(filter.start,end);
  if(end===filter.end)cache.days[end]=model.recordsFromDay(end,last);
  const pending=dates.filter(date=>!cache.days[date]);let next=0;
  const progress=()=>{if(id!==loadSeq)return;state.load={done:dates.filter(date=>cache.days[date]).length,total:dates.length};if(state.view!=='orders')render(false);};
  progress();
  const worker=async()=>{while(next<pending.length){const date=pending[next++];cache.days[date]=model.recordsFromDay(date,await core.api.loadPeriod({inicio:date,fim:date},options));progress();}};
  await Promise.all(Array.from({length:Math.min(3,pending.length)},worker));
  if(id!==loadSeq)return;
  saveCache();
  data=model.apiDataset({start:filter.start,end,updatedAt,days:dates.map(date=>({date,records:cache.days[date]}))});
  state.filter={...filter,end};state.clamped=end!==filter.end;state.load=null;$('filter-error').hidden=true;fillControls();
 }catch(error){
  if(id!==loadSeq||error?.name==='AbortError')return;
  const message=error?.message||'Não foi possível consultar a API.';
  // Com dados anteriores, mantém o relatório válido e mostra o erro acima dele.
  if(data){state.load=null;showError(message);$('date-start').value=state.filter.start;$('date-end').value=state.filter.end;}else state.load={error:message};
 }finally{if(id===loadSeq)setBusy(false);}
 if(id===loadSeq&&state.view!=='orders')render();
}
function loadingView(){
 if(state.load?.error)return '<p class="notice error" role="alert">'+esc(state.load.error)+'</p>';
 const load=state.load||{done:0,total:0},share=load.total?Math.round(load.done/load.total*100):0;
 return '<section class="panel"><div class="load-panel" role="status"><strong>Consultando a API: '+load.done+' de '+load.total+' dias</strong><span class="load-track"><i style="width:'+share+'%"></i></span><small>Cada dia é uma consulta. Os dias já consultados ficam guardados até a próxima atualização da API.</small></div></section>';
}
function render(animate=true){
 tooltip.hidden=true;const container=$('report-content');
 $('metric-toggle').hidden=state.view!=='overview';document.querySelectorAll('[data-report-view]').forEach(button=>{const active=button.dataset.reportView===state.view;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
 if(state.view==='orders')container.innerHTML=ordersView();
 else if(state.load||!data)container.innerHTML=loadingView();
 else{const summary=model.summarize(data,state.filter);container.innerHTML=state.view==='ranking'?ranking(summary):overview(summary);}
 if(animate){container.classList.remove('view-enter');void container.offsetWidth;container.classList.add('view-enter');}
 bindTooltips();
}
function applyFilters(){
 const next={start:$('date-start').value,end:$('date-end').value,group:$('group').value,rep:$('representative').value},error=periodError(next);
 if(error){showError(error);return;}
 if(!data||next.start<data.source.start||next.end>data.source.end){loadRange(next);return;}
 try{model.summarize(data,next);state.filter=next;$('filter-error').hidden=true;render();}catch(error){showError(error.message);}
}
for(const id of ['date-start','date-end'])$(id).max=today;
$('date-start').value=monthStart;$('date-end').value=today;
$('filters').addEventListener('submit',event=>{event.preventDefault();applyFilters();});
$('group').addEventListener('change',applyFilters);$('representative').addEventListener('change',applyFilters);
$('clear-filters').addEventListener('click',()=>{$('date-start').value=monthStart;$('date-end').value=today;$('group').value='all';$('representative').value='all';applyFilters();});
document.querySelectorAll('[data-report-view]').forEach(button=>button.addEventListener('click',()=>{if(!['overview','ranking','orders'].includes(button.dataset.reportView))return;state.view=button.dataset.reportView;if(state.view==='orders'&&(!state.orders||state.orders.error)){loadOrders();return;}render();}));
$('report-content').addEventListener('click',event=>{if(event.target.closest?.('[data-orders-refresh]')&&!state.orders?.loading)loadOrders();});
$('metric-toggle').addEventListener('click',()=>{state.metric=state.metric==='sales'?'fardos':'sales';$('metric-toggle').setAttribute('aria-pressed',String(state.metric==='fardos'));document.querySelectorAll('[data-metric]').forEach(node=>node.classList.toggle('chosen',node.dataset.metric===state.metric));render();});
window.addEventListener('scroll',()=>tooltip.hidden=true,true);window.addEventListener('resize',()=>tooltip.hidden=true);document.addEventListener('pointerdown',event=>{if(!event.target.closest?.('[data-tooltip]'))tooltip.hidden=true;});
loadRange(state.filter);
// Abrir a aba também grava o dia no histórico de pedidos (api/orders.php).
loadOrders();
})();
