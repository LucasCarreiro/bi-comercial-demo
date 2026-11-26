import {fmt,pct,MONTHS} from './charts.js';

const INK='171B43',BLUE='456BAE',RED='AD1738',MUTED='748198',PALE='EDF1F7';
const number=value=>typeof value==='number'&&Number.isFinite(value);
const day=value=>value?String(value).slice(0,10).split('-').reverse().join('/'):'—';
const signed=value=>number(value)?(value>0?'+':'')+pct(value):'—';
const integer=value=>number(value)?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(value):'—';
let libraryPromise=null;

export async function loadRepresentativePowerPointLibrary(){
 if(typeof globalThis.PptxGenJS==='function')return globalThis.PptxGenJS;
 if(!libraryPromise){libraryPromise=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=new URL('assets/vendor/pptxgenjs.bundle.js',document.baseURI||location.href).href;script.dataset.biPowerpoint='true';
  script.onload=()=>{if(typeof globalThis.PptxGenJS==='function')resolve(globalThis.PptxGenJS);else{script.remove();reject(new Error('A biblioteca de PowerPoint não foi disponibilizada.'));}};
  script.onerror=()=>{script.remove();reject(new Error('Não foi possível carregar o PowerPoint. Atualize a página e tente novamente.'));};document.head.appendChild(script);
 }).catch(error=>{libraryPromise=null;throw error;});}
 return libraryPromise;
}

/** Uses the actual municipal paths from the local map, with standalone styling. */
export function representativeMapSVG(mapHTML){
 const match=String(mapHTML||'').match(/<svg\b[\s\S]*?<\/svg>/i);if(!match)return null;
 let svg=match[0].replace(/<script\b[\s\S]*?<\/script>/gi,'').replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi,'').replace(/\s(?:href|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*')/gi,'');
 const view=svg.match(/\bviewBox="([^"]+)"/i)?.[1].trim().split(/[ ,]+/).map(Number);if(!view||view.length!==4||view.some(value=>!number(value))||view[2]<=0||view[3]<=0)return null;
 svg=svg.replace(/<svg\b([^>]*)>/i,(_,attrs)=>'<svg'+attrs.replace(/\s(?:width|height)="[^"]*"/gi,'')+' width="'+view[2]*2+'" height="'+view[3]*2+'"><style>.rep-map-city path{fill:#e0e7f1;stroke:#fff;stroke-width:1.1}.rep-map-city[data-status="all-billed"] path{fill:#258c84}.rep-map-city[data-status="mixed"] path{fill:#5279bd}.rep-map-city[data-status="no-billing"] path{fill:#d6a64d}.rep-map-city[data-status="api-only"] path{fill:#8a70b0}.rep-map-city.is-selected path{stroke:#17213f;stroke-width:3}</style>');
 return {svg,width:view[2],height:view[3]};
}

async function rasterizeMap(mapHTML){
 const payload=representativeMapSVG(mapHTML);if(!payload)return null;
 const url=URL.createObjectURL(new Blob([payload.svg],{type:'image/svg+xml;charset=utf-8'}));
 try{
  const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Não foi possível preparar o mapa para o PowerPoint.'));image.src=url;});
  const scale=Math.min(3,1800/Math.max(payload.width,payload.height)),canvas=document.createElement('canvas');canvas.width=Math.round(payload.width*scale);canvas.height=Math.round(payload.height*scale);const context=canvas.getContext('2d');if(!context)throw new Error('O navegador não conseguiu preparar a imagem do mapa.');context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  return {data:canvas.toDataURL('image/png'),width:payload.width,height:payload.height};
 }finally{URL.revokeObjectURL(url);}
}

function text(slide,value,x,y,w,h,size=17,options={}){slide.addText(String(value??'—'),{x,y,w,h,fontFace:'Aptos',fontSize:size,color:INK,margin:0,breakLine:false,valign:'mid',...options});}
function frame(pptx,title,entry,index){
 const report=entry.report,slide=pptx.addSlide();slide.background={color:'FFFFFF'};
 slide.addShape(pptx.ShapeType.rect,{x:0,y:0,w:13.333333,h:.13,line:{color:RED,transparency:100},fill:{color:RED}});
 text(slide,title,.58,.37,11.5,.46,29,{bold:true});text(slide,report.metric==='sales'?'R$':'Fardos',11.65,.38,1.08,.4,17,{color:RED,bold:true,align:'right'});
 slide.addShape(pptx.ShapeType.line,{x:.58,y:1.02,w:12.15,h:0,line:{color:'D9E0EA',width:.8}});
 const names=report.representatives.map(row=>row.name),full=names.join(' · '),label=entry.groupLabel|| (names.length<=2?full:names.slice(0,2).join(' · ')+' · +'+(names.length-2)+' representante(s)');
 text(slide,label,.6,1.16,12.05,.45,label.length>100?13:17,{color:MUTED});
 const stamp=day(report.period.inicio)+' a '+day(report.period.coveredThrough)+(report.period.coveredThrough<report.period.fim?' · solicitado até '+day(report.period.fim):'');
 text(slide,'Distribuidora Demo · '+stamp,.6,7,11.5,.3,13,{color:MUTED,bold:true});text(slide,String(index),12.1,7.02,.6,.25,11,{color:MUTED,align:'right'});
 slide.addNotes('Representantes selecionados: '+full+'\nFonte: API comercial da empresa. Dados até '+day(report.period.coveredThrough)+'. Categorias: arroz, flocão, salgadinho e outros. A carteira usa o cadastro atual.');
 return slide;
}
function metricBlock(slide,label,value,x,y,w,{size=39,color=INK,foot=''}={}){text(slide,label,x,y,w,.26,15,{color:MUTED});text(slide,value,x,y+.42,w,.62,size,{bold:true,color});if(foot)text(slide,foot,x,y+1.15,w,.42,13,{color:MUTED});}
function addSummary(pptx,entry,index){
 const report=entry.report,comparison=entry.comparison,metrics=comparison?.comparison?.metrics||{},previousYear=Number(report.period.fim.slice(0,4))-1,slide=frame(pptx,'Resultados por representante',entry,index);
 const current=fmt(report.totals.selected,report.metric),previous=metrics.selected?.previous;
 metricBlock(slide,'Realizado no período',current,.65,1.94,4.25,{size:current.length>16?29:39,color:RED,foot:number(previous)?previousYear+': '+fmt(previous,report.metric):'Comparação anterior indisponível'});
 metricBlock(slide,'Crescimento sobre '+previousYear,signed(metrics.selected?.change),5.02,1.94,3.55,{size:42,color:BLUE,foot:'Mesmo intervalo do ano anterior'});
 metricBlock(slide,'Participação na empresa',pct(report.totals.share),.65,4.23,3.6,{size:33,foot:'Empresa: '+fmt(report.totals.company,report.metric)});
 text(slide,'Carteira atual',4.72,4.23,3.9,.3,15,{color:MUTED});text(slide,integer(report.portfolio.totalClients)+' clientes',4.72,4.68,3.9,.48,28,{bold:true});
 text(slide,'Com faturamento: '+integer(report.portfolio.billedClients)+'\nSem faturamento: '+integer(report.portfolio.unbilledClients),4.72,5.35,3.9,.7,18,{color:INK,breakLine:false});
 const image=entry.mapImage,svgPayload=!image?representativeMapSVG(entry.mapHTML):null;
 if(image||svgPayload){
  const width=image?.width||svgPayload.width,height=image?.height||svgPayload.height,w=Math.min(3.05,4.25*width/height),h=w*height/width;
  const data=image?.data||'data:image/svg+xml;base64,'+encodeBase64(svgPayload.svg);slide.addImage({data,x:9.2+(3.05-w)/2,y:1.85,w,h,altText:'Mapa dos municípios da carteira selecionada'});
  const state=entry.mapHTML?.match(/<strong>([^<]+)<\/strong>/)?.[1]||'Território da carteira';text(slide,state,9.03,1.53,3.5,.28,16,{align:'center',bold:true});
  const colors=['258C84','5279BD','D6A64D','8A70B0'],labels=['Todos faturados','Parte faturada','Sem faturamento','Faturamento sem carteira local'];
  labels.forEach((label,i)=>{slide.addShape(pptx.ShapeType.rect,{x:9.15,y:6.02+i*.2,w:.09,h:.09,line:{color:colors[i],transparency:100},fill:{color:colors[i]}});text(slide,label,9.34,5.98+i*.2,3.1,.18,10,{color:MUTED});});
 }else text(slide,'Mapa não disponível para esta seleção',9.1,3.4,3.55,1,17,{align:'center',color:MUTED});
}
function encodeBase64(value){if(typeof btoa==='function')return btoa(unescape(encodeURIComponent(value)));throw new Error('Prepare a imagem do mapa antes de criar o PowerPoint neste ambiente.');}
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const endOfMonth=month=>month+'-'+String(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()).padStart(2,'0');

/** Closed-month means exclude missing values, but retain confirmed zero purchases.
 * MoM always uses the immediately preceding calendar month from the current year.
 */
export function representativeMonthlyStats(entry){
 const year=String(entry?.report?.period?.fim||'').slice(0,4),history=entry?.history,sourceCut=history?.asOf,reportCut=entry?.report?.period?.coveredThrough;
 const cutoff=validDate(sourceCut)&&sourceCut.slice(0,4)===year?sourceCut:validDate(reportCut)&&reportCut.slice(0,4)===year?reportCut:null;
 const raw=new Map((history?.months||[]).map(row=>[row.month,row])),points=new Map((entry?.comparison?.monthly||[]).filter(row=>typeof row.month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month)&&row.month.slice(0,4)===year&&cutoff&&row.month<=cutoff.slice(0,7)).map(row=>[row.month,row]));
 const months=[...points.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(row=>{
  const source=raw.get(row.month),sourceEnd=source?.effectiveFim||source?.coveredThrough||source?.fim,last=endOfMonth(row.month),end=validDate(sourceEnd)&&sourceEnd.slice(0,7)===row.month?(sourceEnd<cutoff?sourceEnd:cutoff):(last<cutoff?last:cutoff);
  const month=Number(row.month.slice(5,7)),prior=month>1?points.get(year+'-'+String(month-1).padStart(2,'0')):null;
  return {...row,partial:end<last||(validDate(source?.inicio)&&source.inicio>row.month+'-01'),monthChange:number(row.current)&&number(prior?.current)&&prior.current>0?(row.current-prior.current)/prior.current:null};
 });
 const closed=months.filter(row=>!row.partial),current=closed.filter(row=>number(row.current)),previous=closed.filter(row=>number(row.previous)),annualGrowth=closed.filter(row=>number(row.change)),monthGrowth=closed.filter(row=>number(row.monthChange));
 return {months,cutoff,average:{current:current.length?current.reduce((sum,row)=>sum+row.current,0)/current.length:null,previous:previous.length?previous.reduce((sum,row)=>sum+row.previous,0)/previous.length:null,currentCount:current.length,previousCount:previous.length},growthAverage:{annual:annualGrowth.length?annualGrowth.reduce((sum,row)=>sum+row.change,0)/annualGrowth.length:null,month:monthGrowth.length?monthGrowth.reduce((sum,row)=>sum+row.monthChange,0)/monthGrowth.length:null,annualCount:annualGrowth.length,monthCount:monthGrowth.length}};
}
/** Comparative scope is the explicit, non-overlapping representative chapters. */
export function representativeMacroSummary(groups,metric='fardos'){
 if(!['fardos','sales'].includes(metric))throw new Error('Unidade da visão macro inválida.');
 const ids=new Set(),rows=[];let period=null,company;
 for(const group of groups||[]){
  const entry=group.reports?.find(item=>item.report?.metric===metric);if(!entry)throw new Error('Faltam dados de uma unidade na visão macro.');
  const report=entry.report,key=JSON.stringify([report.period.inicio,report.period.fim,report.period.coveredThrough]);
  if(period&&key!==JSON.stringify([period.inicio,period.fim,period.coveredThrough]))throw new Error('Os representantes precisam usar o mesmo período.');period=report.period;
  const representativeIds=report.representatives.map(row=>row.id||'code:'+row.code);for(const id of representativeIds){if(ids.has(id))throw new Error('Um representante aparece em mais de um grupo da visão macro.');ids.add(id);}
  const total=report.totals,comparative=entry.comparison?.comparison?.metrics?.selected;
  if(company===undefined)company=total.company;else if(company!==total.company)throw new Error('A base da empresa difere entre os representantes.');
  rows.push({label:group.label||entry.groupLabel||report.representatives.map(row=>row.name).join(' + '),ids:representativeIds,codes:report.representatives.map(row=>row.code),current:number(total.selected)?total.selected:null,previous:number(comparative?.previous)?comparative.previous:null,change:number(comparative?.change)?comparative.change:null,share:number(total.share)?total.share:null,clients:report.portfolio.totalClients,billed:report.portfolio.billedClients});
 }
 const sum=(field)=>{if(!rows.length||rows.some(row=>!number(row[field])))return null;const scale=metric==='sales'?100:1000000;return Number(rows.reduce((total,row)=>total+BigInt(Math.round(row[field]*scale)),0n))/scale;};
 const current=sum('current'),previous=sum('previous');
 return {metric,period,rows,totals:{current,previous,change:number(current)&&number(previous)&&previous>0?(current-previous)/previous:null,share:number(current)&&number(company)&&company>0?current/company:null,company:number(company)?company:null,clients:sum('clients'),billed:sum('billed')}};
}

/** Compare the same groups' two consecutive, confirmed closed calendar months.
 * This is a ratio of aggregate monthly amounts, never an average of growth rates.
 */
export function representativeMacroMonthlyGrowth(groups,metric='fardos'){
 const summary=representativeMacroSummary(groups,metric),cutoff=summary.period?.coveredThrough;
 const missing=reason=>({month:null,previousMonth:null,current:null,previous:null,change:null,reason});
 if(!summary.rows.length||!validDate(cutoff)||!validDate(summary.period?.inicio)||!validDate(summary.period?.fim)||summary.period.inicio>cutoff||cutoff>summary.period.fim)return missing('O período da visão macro ainda não está confirmado.');
 const month=cutoff.slice(0,7),year=Number(month.slice(0,4)),index=Number(month.slice(5,7)),previousMonth=new Date(Date.UTC(year,index-2,1)).toISOString().slice(0,7);
 const result={month,previousMonth,current:null,previous:null,change:null,reason:null};
 if(cutoff!==endOfMonth(month)||summary.period.inicio>month+'-01')return {...result,reason:'A comparação mensal exige meses fechados.'};
 const entries=groups.map(group=>group.reports.find(entry=>entry.report.metric===metric)),scale=metric==='sales'?100:1000000;
 const monthAmount=(entry,key)=>{
  const points=Array.isArray(entry.report.series)?entry.report.series.filter(row=>row.month===key):[],fallback=Array.isArray(entry.comparison?.monthly)?entry.comparison.monthly.filter(row=>row.month===key):[];
  if(points.length>1||fallback.length>1)return null;
  const point=points[0]||fallback[0],value=points.length?point?.selected:point?.current;
  if(!point||points.length&&point.status!=='ok'||point.partial===true||!number(value))return null;
  const raw=Array.isArray(entry.history?.months)?entry.history.months.filter(row=>row.month===key):null;
  // A missing prior-year December is not silently substituted by January or November.
  if(key.slice(0,4)!==String(year)&&!raw?.length)return null;
  if(raw){
   if(raw.length!==1||raw[0].status!=='ok'||raw[0].freshnessKnown===false)return null;
   const source=raw[0],end=source.effectiveFim||source.coveredThrough||source.fim,last=endOfMonth(key),sourceDate=String(source.updatedAt||source.atualizado_em||'').slice(0,10),hasSourceDate=source.updatedAt!=null||source.atualizado_em!=null;
   if(source.inicio!=null&&source.inicio!==key+'-01'||end!=null&&end!==last||hasSourceDate&&(!validDate(sourceDate)||sourceDate<last))return null;
  }else if(!points.length&&point.status!=='ok')return null;
  const units=Math.round(value*scale);
  return Number.isSafeInteger(units)&&Math.abs(value*scale-units)<=.0001?BigInt(units):null;
 };
 const aggregate=key=>{
  let total=0n;
  for(const entry of entries){const value=monthAmount(entry,key);if(value===null)return null;total+=value;}
  return total<=BigInt(Number.MAX_SAFE_INTEGER)&&total>=BigInt(Number.MIN_SAFE_INTEGER)?Number(total)/scale:null;
 };
 result.current=aggregate(month);result.previous=aggregate(previousMonth);
 if(result.current===null||result.previous===null)return {...result,reason:'Os dois meses ainda não estão confirmados para todos os grupos.'};
 if(result.previous<=0)return {...result,reason:'O mês anterior não tem uma base positiva para comparação.'};
 return {...result,change:(result.current-result.previous)/result.previous};
}
function addMacro(pptx,groups,index){
 const volume=representativeMacroSummary(groups,'fardos'),money=representativeMacroSummary(groups,'sales'),slide=pptx.addSlide(),previousYear=Number(volume.period.fim.slice(0,4))-1;slide.background={color:'FFFFFF'};
 slide.addShape(pptx.ShapeType.rect,{x:0,y:0,w:13.333333,h:.13,line:{color:RED,transparency:100},fill:{color:RED}});
 text(slide,'Visão macro dos representantes',.58,.37,11,.46,29,{bold:true});text(slide,'Fardos e R$',11.2,.4,1.5,.3,13,{color:RED,bold:true,align:'right'});
 slide.addShape(pptx.ShapeType.line,{x:.58,y:1.02,w:12.15,h:0,line:{color:'D9E0EA',width:.8}});
 text(slide,groups.length+' grupos acompanhados · Venda Direta + Atacado juntos',.6,1.12,12.05,.3,14,{color:MUTED});
 text(slide,'Volume dos grupos: '+fmt(volume.totals.current,'fardos')+' fardos',.65,1.55,6,.34,18,{bold:true});
 text(slide,'Receita dos grupos: '+fmt(money.totals.current,'sales'),6.75,1.55,5.9,.34,18,{bold:true,align:'right'});
 const rows=[[{text:'REPRESENTANTE',options:{bold:true}},{text:'FARDOS',options:{bold:true}},{text:'VAR. ANUAL',options:{bold:true}},{text:'R$',options:{bold:true}},{text:'VAR. ANUAL',options:{bold:true}},{text:'PART. FARDOS',options:{bold:true}}],...volume.rows.map((row,i)=>{
  const finance=money.rows[i],fill=i%2?'F3F5F9':'FFFFFF',style={fill};
  return [{text:row.label,options:{...style,align:'left',fontSize:row.label.length>38?9:10.5,bold:true}},{text:fmt(row.current,'fardos'),options:style},{text:signed(row.change),options:{...style,bold:true,color:number(row.change)&&row.change<0?RED:BLUE}},{text:fmt(finance.current,'sales'),options:style},{text:signed(finance.change),options:{...style,bold:true,color:number(finance.change)&&finance.change<0?RED:BLUE}},{text:pct(row.share),options:style}];
 })];
 slide.addTable(rows,{x:.65,y:2.08,w:12.05,h:4.5,colW:[3.85,1.65,1.1,2.55,1.1,1.8],rowH:4.5/Math.max(rows.length,1),fontFace:'Aptos',fontSize:10.5,color:INK,margin:[.025,.06,.025,.06],align:'center',valign:'middle',border:{type:'solid',color:'E0E5ED',pt:.35},autoPage:false,fill:'FFFFFF'});
 text(slide,'Variação anual: mesmo período de '+previousYear+'. Participação: sobre o volume total da empresa. Totais abrangem somente os grupos acima.',.65,6.63,12.05,.22,10,{color:MUTED,align:'center'});
 text(slide,'Distribuidora Demo · '+day(volume.period.inicio)+' a '+day(volume.period.coveredThrough),.6,7,11.5,.3,13,{color:MUTED,bold:true});text(slide,String(index),12.1,7.02,.6,.25,11,{color:MUTED,align:'right'});
 slide.addNotes('Visão macro dos grupos acompanhados. Cada capítulo individual mantém sua própria seleção. '+volume.rows.map(row=>row.label+' ('+row.codes.join(', ')+')').join('; '));
}
function addAnnual(pptx,entry,index){
 const report=entry.report,comparison=entry.comparison,year=Number(report.period.fim.slice(0,4)),slide=frame(pptx,'Crescimento mês a mês · '+(report.metric==='sales'?'R$':'Fardos'),entry,index),months=comparison?.monthly||[];
 if(!months.some(row=>number(row.current)||number(row.previous))){text(slide,'Não há dados confirmados para desenhar a comparação anual.',.8,3.2,11.7,1,23,{align:'center',color:MUTED});return;}
 const data=months.map(row=>({label:MONTHS[Number(row.month.slice(5,7))-1],current:number(row.current)?(report.metric==='fardos'?Math.trunc(row.current):row.current):null,previous:number(row.previous)?(report.metric==='fardos'?Math.trunc(row.previous):row.previous):null}));
 const labels=data.map(row=>row.label),format=report.metric==='sales'?'"R$ "#,##0.00':'#,##0';
 slide.addChart([
  {type:pptx.ChartType.line,data:[{name:String(year),labels,values:data.map(row=>row.current)}],options:{lineDataSymbol:'circle',lineDataSymbolSize:7,lineSize:2.5,lineDash:'solid',chartColors:['1C3152'],dataLabelPosition:'t'}},
  {type:pptx.ChartType.line,data:[{name:String(year-1),labels,values:data.map(row=>row.previous)}],options:{lineDataSymbol:'square',lineDataSymbolSize:6,lineSize:1.9,lineDash:'dash',chartColors:['858B95'],dataLabelPosition:'b'}}
 ],{x:.7,y:1.96,w:11.95,h:4.55,showTitle:false,showLegend:true,legendPos:'b',legendFontFace:'Aptos',legendFontSize:15,showValue:true,showMarker:true,showCatName:false,showSerName:false,dataLabelFontFace:'Aptos',dataLabelFontSize:11,dataLabelColor:INK,dataLabelFormatCode:format,catAxisLabelFontFace:'Aptos',catAxisLabelFontSize:13,valAxisLabelFontSize:11,valAxisLabelFormatCode:format,catAxisLineColor:'C5CCD8',valAxisLineShow:false,showBorder:false,chartArea:{fill:{color:'FFFFFF'},border:{color:'FFFFFF'}},plotArea:{fill:{color:'FFFFFF'},border:{color:'FFFFFF'}},displayBlanksAs:'gap',valGridLine:{color:'E4E8EF',width:.5}});
 text(slide,year+': linha contínua, círculo  ·  '+(year-1)+': linha tracejada, quadrado',.75,6.56,11.8,.24,12,{color:MUTED,align:'center'});
}
function addMonthly(pptx,entry,index){
 const report=entry.report,year=Number(report.period.fim.slice(0,4)),stats=representativeMonthlyStats(entry),{months,average,growthAverage}=stats,metric=report.metric;
 const monthlyEntry=stats.cutoff?{...entry,report:{...report,period:{inicio:year+'-01-01',fim:stats.cutoff,coveredThrough:stats.cutoff}}}:entry;
 const slide=frame(pptx,'Comparação mensal · '+(metric==='sales'?'R$':'Fardos'),monthlyEntry,index),growth=value=>({bold:true,color:number(value)&&value<0?RED:BLUE});
 const rows=[[{text:'MÊS',options:{bold:true}},{text:String(year),options:{bold:true}},{text:String(year-1),options:{bold:true}},{text:'CRESCIMENTO ANUAL',options:{bold:true,fontSize:12}},{text:'MÊS ANTERIOR',options:{bold:true,fontSize:12}}],...months.map((row,index)=>[
  {text:MONTHS[Number(row.month.slice(5,7))-1]+(row.partial?' *':''),options:{bold:true,fill:index%2?'F3F5F9':'FFFFFF'}},
  {text:fmt(row.current,metric),options:{fill:index%2?'F3F5F9':'FFFFFF'}},
  {text:fmt(row.previous,metric),options:{fill:index%2?'F3F5F9':'FFFFFF'}},
  {text:signed(row.change),options:{...growth(row.change),fill:index%2?'E9EEF7':'F1F5FC'}},
  {text:signed(row.monthChange),options:{...growth(row.monthChange),fill:index%2?'E9EEF7':'F1F5FC'}}
 ]),[
  {text:'MÉDIA MENSAL',options:{bold:true,fontSize:12,fill:PALE}},
  {text:fmt(average.current,metric),options:{bold:true,fill:PALE}},
  {text:fmt(average.previous,metric),options:{bold:true,fill:PALE}},
  {text:signed(growthAverage.annual),options:{...growth(growthAverage.annual),fill:PALE}},
  {text:signed(growthAverage.month),options:{...growth(growthAverage.month),fill:PALE}}
 ]];
 slide.addTable(rows,{x:.65,y:1.92,w:12.05,h:4.58,colW:[1.65,2.75,2.75,2.5,2.4],rowH:Math.min(.42,4.58/Math.max(rows.length,1)),fontFace:'Aptos',fontSize:14,color:INK,margin:[.035,.09,.035,.09],align:'center',valign:'middle',border:{type:'solid',color:'E0E5ED',pt:.4},autoPage:false,bold:false,fill:'FFFFFF'});
 const base='Média: meses fechados confirmados ('+year+': '+average.currentCount+'; '+(year-1)+': '+average.previousCount+'). Percentuais: média aritmética das variações válidas.';
 const partial=months.some(row=>row.partial)?'* Mês parcial. Ano anterior: mesmo corte de dias. Mês anterior: variação dos acumulados de cada mês, sem projeção.':'Mês anterior: variação sobre o mês imediatamente anterior de '+year+'.';
 text(slide,base+'\n'+partial,.65,6.52,12.05,.4,10,{color:MUTED,align:'center'});
}

/** Native, editable KPI text, tables and charts. Only the municipal map is an image. */
function powerPointGroups(input){
 if(!input||(input.reports!==undefined&&input.groups!==undefined))throw new Error('Prepare uma seleção individual ou os grupos de representantes antes de exportar.');
 const groups=input.groups===undefined?[{reports:input.reports}]:input.groups;
 if(!Array.isArray(groups)||!groups.length)throw new Error('Prepare ao menos uma apresentação por representante antes de exportar.');
 for(const group of groups){
  if(!Array.isArray(group?.reports)||group.reports.length!==2||group.reports[0]?.report?.metric!=='fardos'||group.reports[1]?.report?.metric!=='sales')throw new Error('Prepare as duas unidades, fardos e R$, antes de exportar.');
  for(const entry of group.reports){if(!entry.report?.representatives?.length||!entry.report.period?.coveredThrough||!entry.report.totals||!entry.report.portfolio)throw new Error('Selecione os representantes e carregue os resultados antes de exportar.');}
 }
 return groups;
}
export function buildRepresentativePowerPoint(input,{PptxGenJS}={}){
 if(typeof PptxGenJS!=='function')throw new Error('A biblioteca de PowerPoint ainda não está disponível.');
 const groups=powerPointGroups(input);
 const pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';pptx.author='Distribuidora Demo';pptx.subject='Resultados por representante';pptx.title='Distribuidora Demo · Resultados por representante';pptx.company='Distribuidora Demo';pptx.lang='pt-BR';pptx.theme={headFontFace:'Aptos',bodyFontFace:'Aptos',lang:'pt-BR'};
 let slideNumber=1;if(input.groups!==undefined)addMacro(pptx,groups,slideNumber++);for(const group of groups)for(const entry of group.reports){addSummary(pptx,entry,slideNumber++);addAnnual(pptx,entry,slideNumber++);addMonthly(pptx,entry,slideNumber++);}
 return pptx;
}

export async function exportRepresentativePowerPoint(input){
 const groups=powerPointGroups(input),PptxGenJS=await loadRepresentativePowerPointLibrary(),mapImages=new Map(),prepared=[];
 // Serial preparation bounds canvas memory; identical municipality maps are reused.
 for(const group of groups){const reports=[];for(const entry of group.reports){let mapImage=entry.mapImage;if(!mapImage){const key=String(entry.mapHTML||'');if(!mapImages.has(key))mapImages.set(key,await rasterizeMap(key));mapImage=mapImages.get(key);}reports.push({...entry,mapImage});}prepared.push({...group,reports});}
 const preparedInput=input.groups===undefined?{...input,reports:prepared[0].reports}:{...input,groups:prepared},pptx=buildRepresentativePowerPoint(preparedInput,{PptxGenJS});
 const date=groups[0].reports[0].report.period.coveredThrough,fileName=String(input.fileName||'BI_Resultados_Representantes_'+date+'.pptx').replace(/[\\/:*?"<>|]/g,'_');
 await pptx.writeFile({fileName,compression:true});return {fileName,slides:groups.length*6+(input.groups===undefined?0:1)};
}
