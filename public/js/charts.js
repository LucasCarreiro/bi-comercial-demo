export const COLORS=['#4e71c6','#b94d70','#d4af59','#659f98'];
export const MONTHS=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const formatter=metric=>new Intl.NumberFormat('pt-BR',metric==='sales'?{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2}:{maximumFractionDigits:0,roundingMode:'trunc'});
export const fmt=(value,metric='fardos')=>value==null||!Number.isFinite(value)?'—':formatter(metric).format(metric==='sales'?value:Math.trunc(value)||0);
export const pct=value=>value==null||!Number.isFinite(value)?'—':new Intl.NumberFormat('pt-BR',{style:'percent',maximumFractionDigits:1,minimumFractionDigits:1}).format(value);
const compact=(value,metric)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:metric==='sales'?1:0,...(metric==='sales'?{style:'currency',currency:'BRL'}:{roundingMode:'trunc'})}).format(value);

export function lineChart(series,projection,metric,{priorSeries=[],priorYear}={}){
 const width=760,height=265,left=66,right=22,top=24,bottom=39,plotW=width-left-right,plotH=height-top-bottom;
 const predicted=new Map((projection?.months||[]).map(item=>[item.month,item]));
 const priorByMonth=new Map(priorSeries.map(item=>[Number(item.month?.slice(5,7)),item]));
 const prior=series.map((_,index)=>priorByMonth.get(index+1)?.total??null);
 const values=[...series.flatMap(item=>[item.total,predicted.get(item.month)?.projected]),...prior].filter(value=>Number.isFinite(value));
 if(!values.length)return '<div class="empty-state"><p>Não há dados disponíveis para desenhar a evolução.</p></div>';
 const min=Math.min(0,...values),max=Math.max(1,...values),span=max-min,pad=span*.12,lo=min<0?min-pad:0,hi=max+pad;
 const x=index=>left+index*plotW/11,y=value=>top+(hi-value)/(hi-lo)*plotH;
 const pathFor=items=>{let previous=false;return items.map((value,index)=>{if(value==null||!Number.isFinite(value)){previous=false;return '';}const point=(previous?'L':'M')+x(index).toFixed(2)+','+y(value).toFixed(2);previous=true;return point;}).join(' ');};
 const actual=series.map(item=>item.total),estimated=series.map(item=>{const p=predicted.get(item.month);return p?.status==='estimated'?p.projected:null;});
 const firstEstimate=estimated.findIndex(v=>v!=null);if(firstEstimate>0&&actual[firstEstimate-1]!=null)estimated[firstEstimate-1]=actual[firstEstimate-1];
 const grids=Array.from({length:5},(_,i)=>{const value=lo+(hi-lo)*i/4;return '<line class="gridline" x1="'+left+'" x2="'+(width-right)+'" y1="'+y(value)+'" y2="'+y(value)+'"/><text x="'+(left-12)+'" y="'+(y(value)+3)+'" text-anchor="end">'+esc(compact(value,metric))+'</text>';}).join('');
 const ticks=series.map((item,index)=>'<text x="'+x(index)+'" y="'+(height-12)+'" text-anchor="middle">'+MONTHS[index]+'</text>').join('');
 const dot=(value,index,kind,year=series[index].month.slice(0,4))=>{const label=MONTHS[index]+' / '+year+' · '+kind,formatted=fmt(value,metric)+(metric==='sales'?'':' fardos');return '<g class="chart-point" data-chart-point data-tooltip-title="'+esc(label)+'" data-tooltip-value="'+esc(formatted)+'" tabindex="0" role="img" aria-label="'+esc(label+': '+formatted)+'"><title>'+esc(label+': '+formatted)+'</title><circle'+(kind==='Tendência'?' class="estimated"':kind==='Ano anterior'?' class="previous" style="fill:white;stroke:#7d8fa7;stroke-width:2"':'')+' cx="'+x(index)+'" cy="'+y(value)+'" r="'+(kind==='Tendência'?'3.5':'3.7')+'"/><rect class="chart-hit" x="'+(x(index)-12)+'" y="'+(y(value)-12)+'" width="24" height="24" style="fill:transparent;stroke:none"/></g>';};
 const dots=series.map((item,index)=>{const p=predicted.get(item.month),previous=priorByMonth.get(index+1);return (Number.isFinite(prior[index])?dot(prior[index],index,'Ano anterior',priorYear??previous.month.slice(0,4)):'')+(Number.isFinite(item.total)?dot(item.total,index,'Realizado'):'')+(p?.status==='estimated'&&Number.isFinite(p.projected)?dot(p.projected,index,'Tendência'):'');}).join('');
 return '<svg class="line-chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Evolução mensal: linha azul mostra o realizado, tracejado vermelho mostra a tendência.'+(prior.some(value=>Number.isFinite(value))?' Linha cinza mostra o ano anterior.':'')+' Passe o mouse ou selecione um ponto para consultar o valor do mês.">'+grids+(prior.some(value=>Number.isFinite(value))?'<path class="previous-line" style="stroke:#7d8fa7;stroke-width:2.2;fill:none;stroke-linecap:round;stroke-linejoin:round" d="'+pathFor(prior)+'"/>':'')+'<path class="actual-line" d="'+pathFor(actual)+'"/><path class="estimate-line" d="'+pathFor(estimated)+'"/>'+dots+ticks+'</svg>';
}

const tooltipBindings=new WeakMap();
export function clearChartTooltips(container){tooltipBindings.get(container)?.();tooltipBindings.delete(container);}
export function bindChartTooltips(container){
 if(!container?.querySelectorAll)return;
 clearChartTooltips(container);
 const points=[...container.querySelectorAll('[data-chart-point]')];
 if(!points.length)return;
 const tooltip=document.createElement('div');tooltip.className='chart-tooltip';tooltip.hidden=true;tooltip.setAttribute('role','status');tooltip.setAttribute('aria-live','polite');(document.body?.appendChild?document.body:container).appendChild(tooltip);
 let pinned=null,active=null;
 const removeHandlers=[];
 const hide=()=>{tooltip.hidden=true;active=null;};
 const show=point=>{
  active=point;tooltip.innerHTML='<span class="chart-tooltip-title">'+esc(point.dataset.tooltipTitle)+'</span><strong class="chart-tooltip-value">'+esc(point.dataset.tooltipValue)+'</strong>';tooltip.hidden=false;
  const rect=point.getBoundingClientRect(),width=tooltip.offsetWidth||190,viewport=window.innerWidth||1024;
  tooltip.style.left=Math.max(width/2+12,Math.min(viewport-width/2-12,(rect.left+rect.right)/2))+'px';
  const height=tooltip.offsetHeight||58,above=rect.top-height-10>=8;
  tooltip.style.top=(above?rect.top-10:rect.bottom+10)+'px';tooltip.style.transform=above?'translate(-50%,-100%)':'translate(-50%,0)';
 };
 const outside=event=>{if(!points.some(point=>point===event.target||point.contains?.(event.target))){pinned=null;hide();}};
 const onScroll=()=>{if(active)show(active);};
 for(const point of points){
  const handlers={pointerenter:()=>show(point),pointerleave:()=>{if(pinned!==point)hide();},focus:()=>show(point),blur:()=>{if(pinned!==point)hide();},pointerdown:event=>{if(event.pointerType==='touch'){pinned=point;show(point);}},keydown:event=>{if(event.key==='Escape'){pinned=null;hide();}else if(event.key==='Enter'||event.key===' '){event.preventDefault();pinned=point;show(point);}}};
  for(const [event,handler]of Object.entries(handlers)){point.addEventListener(event,handler);removeHandlers.push(()=>point.removeEventListener?.(event,handler));}
 }
 const outsideTarget=document.addEventListener?document:container;
 outsideTarget.addEventListener('pointerdown',outside);window.addEventListener('scroll',onScroll,true);window.addEventListener('resize',onScroll);
 tooltipBindings.set(container,()=>{removeHandlers.forEach(remove=>remove());outsideTarget.removeEventListener?.('pointerdown',outside);window.removeEventListener?.('scroll',onScroll,true);window.removeEventListener?.('resize',onScroll);tooltip.remove?.();});
}

export function mixChart(mix,metric){
 const positive=mix.reduce((n,item)=>n+Math.max(0,item.value||0),0),radius=46,circ=2*Math.PI*radius;let offset=0;
 const arcs=mix.map((item,index)=>{const length=positive?Math.max(0,item.value||0)/positive*circ:0,html='<circle class="donut-arc" data-arc-length="'+length+'" data-arc-circ="'+circ+'" cx="66" cy="66" r="46" style="stroke:'+COLORS[index]+';stroke-dasharray:'+length+' '+(circ-length)+';stroke-dashoffset:'+(-offset)+'"/>';offset+=length;return html;}).join('');
 return '<div class="mix-body mix-body-stacked"><div class="mix-donut-wrap"><svg class="donut" viewBox="0 0 132 132" role="img" aria-label="Mix de '+mix.length+' categorias, com percentuais e valores discriminados abaixo"><circle class="donut-base" cx="66" cy="66" r="46"/>'+arcs+'</svg><div class="mix-donut-center" aria-hidden="true"><strong>Mix</strong><span>'+mix.length+' categorias</span></div></div><div class="mix-items" style="--mix-count:'+mix.length+'">'+mix.map((item,index)=>'<div class="mix-item"><div><span><i class="category-dot" style="background:'+COLORS[index]+'"></i>'+esc(item.category)+'</span><strong>'+pct(item.share)+'</strong></div><p>'+fmt(item.value,metric)+'</p></div>').join('')+'</div></div>'+(mix.some(item=>item.value<0)?'<p class="method-note" style="padding:0 22px 15px">Devoluções reduzem os valores líquidos. O anel representa apenas parcelas positivas.</p>':'');
}
export function miniMix(mix){return '<span class="mix-percentages" style="--mix-count:'+mix.length+'" aria-label="'+esc(mix.map(item=>item.category+': '+pct(item.share)).join(', '))+'">'+mix.map((item,index)=>'<span class="mix-percentage"><span class="mix-category"><i class="category-dot" style="background:'+COLORS[index]+'"></i>'+esc(item.category)+'</span><span class="mix-share">'+pct(item.share)+'</span></span>').join('')+'</span>';}
