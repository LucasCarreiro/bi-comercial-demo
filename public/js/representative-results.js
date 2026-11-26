import {ALL_CATEGORIES,normalizeName,saoPauloToday} from './analytics.js';
import {esc,fmt,pct,MONTHS,bindChartTooltips,clearChartTooltips} from './charts.js';
import {INITIAL_CLIENT_CATALOG} from './client-catalog.js';
import {representativeOptions,buildRepresentativeReport} from './representative-model.js';
import {representativeDisplayName} from './representative-aliases.js';
import {RepresentativeMap} from './representative-map.js';
import {exportRepresentativePowerPoint,representativeMacroSummary} from './representative-pptx.js';
import {buildRepresentativeComparison} from './representative-comparison.js';
import {loadRepresentativeComparisonData} from './representative-data.js';
import {representativeReportHTML,representativeMacroHTML,bindRepresentativeGrowth} from './representative-view.js';
import {printDualReport} from './print-report.js';
import {animateAnalysis,clearAnalysisMotion} from './motion.js';
import {RepresentativePresentation} from './representative-presentation.js';
import {loadClosedRepresentativePresentationData} from './representative-presentation-data.js';

const humanDate=value=>value?value.slice(0,10).split('-').reverse().join('/'):'—';
const empty=(title,text)=>'<div class="empty-state"><h3>'+esc(title)+'</h3><p>'+esc(text)+'</p></div>';
const count=value=>Number.isFinite(value)?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(value):'—';
const BATCH_REPRESENTATIVE_CODES=['1','8','17','24','27','29','32','34','47','61','71','81','95','96','110'];
const statusName=status=>({'all-billed':'Carteira faturada',mixed:'Faturamento parcial','no-billing':'Sem faturamento','api-only':'Faturamento sem carteira local'}[status]||'Não classificado');
const card=(title,value,foot='',featured=false)=>'<article class="stat-card'+(featured?' featured':'')+'"><span class="stat-label">'+esc(title)+'</span><strong class="stat-value">'+esc(value)+'</strong><span class="stat-foot">'+esc(foot)+'</span></article>';

// Decorate only calculated report copies: names from the API remain the identity source.
const displayRepresentative=(row,aux)=>({...row,originalName:row.name,displayName:representativeDisplayName(row,aux)});
const selectionLabel=rows=>{
 if(rows.length===2&&rows.some(row=>row.code==='7')&&rows.some(row=>row.code==='12')){
  const names=rows.map(row=>typeof row.displayName==='string'?row.displayName.trim():'');
  return names[0]&&names.every(name=>name===names[0])?names[0]:'VENDA DIRETA + ATACADO';
 }
 return rows.map(row=>row.displayName||row.name).join(' + ');
};
const displayReport=(report,aux)=>{
 const decorate=row=>{const display=displayRepresentative(row,aux);return {...display,name:display.displayName};};
 const representatives=report.representatives.map(decorate);
 return {...report,representatives,byRepresentative:report.byRepresentative.map(decorate),displayLabel:selectionLabel(representatives)};
};

export function representativeShareChart(series,metric){
 const points=series||[],values=points.map(point=>point.share).filter(Number.isFinite);
 if(!values.length)return empty('Participação indisponível','Não há uma base completa e positiva da empresa para calcular o percentual.');
 const width=760,height=250,left=55,right=15,top=20,bottom=42,w=width-left-right,h=height-top-bottom;
 const low=Math.min(0,...values),high=Math.max(.05,...values)*1.15,span=high-low||1,y=value=>top+(high-value)/span*h,zero=y(0),step=w/Math.max(1,points.length),bar=Math.min(36,step*.58);
 const grid=Array.from({length:5},(_,index)=>{const value=low+span*index/4;return '<line class="gridline" x1="'+left+'" x2="'+(width-right)+'" y1="'+y(value)+'" y2="'+y(value)+'"/><text x="'+(left-9)+'" y="'+(y(value)+4)+'" text-anchor="end">'+esc(pct(value))+'</text>';}).join('');
 const bars=points.map((point,index)=>{const x=left+step*(index+.5),value=point.share,month=MONTHS[Number(point.month.slice(5,7))-1],label=month+' / '+point.month.slice(0,4),details=Number.isFinite(value)?pct(value)+' · Representantes: '+fmt(point.selected,metric)+' · Empresa: '+fmt(point.company,metric):'Dados indisponíveis';return '<text x="'+x+'" y="'+(height-14)+'" text-anchor="middle">'+esc(month)+'</text>'+(Number.isFinite(value)?'<g data-chart-point tabindex="0" role="img" aria-label="'+esc(label+': '+details)+'" data-tooltip-title="'+esc(label)+'" data-tooltip-value="'+esc(details)+'"><title>'+esc(label+': '+details)+'</title><rect class="rep-share-bar" x="'+(x-bar/2)+'" y="'+Math.min(zero,y(value))+'" width="'+bar+'" height="'+Math.max(1,Math.abs(zero-y(value)))+'" rx="4"/><rect class="chart-hit" x="'+(x-step/2)+'" y="'+top+'" width="'+step+'" height="'+h+'" fill="transparent"/></g>':'');}).join('');
 return '<svg class="line-chart rep-share-chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Participação mensal dos representantes selecionados no resultado da empresa. Passe o mouse ou selecione uma coluna para ver os valores exatos.">'+grid+bars+'</svg>';
}

export class RepresentativeResults{
 constructor(options){
  Object.assign(this,options);this.active=false;this.busy=false;this.selectedIds=new Set();this.query='';this.clientQuery='';this.city=null;this.uf=null;this.page=0;this.metric='fardos';this.period=null;this.history=null;this.requestId=0;this.error='';this.map=null;this.mapReady=false;this.mapError='';this.printReport=options.printReport||printDualReport;this.exporting=false;this.exportPowerPoint=options.exportPowerPoint||exportRepresentativePowerPoint;this.comparisonData=null;this.contactCache=new Map();this.contactRequestId=0;this.macroCache=null;this.presenting=false;this.presentationRequestId=0;this.presentationDataCache=null;
  const today=saoPauloToday();this.start=today.slice(0,7)+'-01';this.end=today;this.calendarDay=today;this.queriedOn=null;
 }
 catalog(){return this.store.data?.clientCatalog||INITIAL_CLIENT_CATALOG;}
 auxiliary(){return this.getAux?.()||{};}
 displayOptions(catalog,rows){const aux=this.auxiliary();return representativeOptions(catalog,rows).map(row=>displayRepresentative(row,aux));}
 options(){return this.displayOptions(this.catalog(),[...(this.history?.months||[]),...(this.period?.clientes||[])]);}
 async show(){
  this.active=true;this.syncCalendar();this.render();
  if(location.protocol==='file:')return;
  try{await this.store.load();}catch(error){this.notice?.('Usando o cadastro já disponível. '+error.message,true);}
  if(!this.active)return;
  if(this.period&&this.period.inicio===this.start&&this.period.fim===this.end&&this.queriedOn===saoPauloToday()){this.render();return;}
  await this.refresh(false);
 }
 hide(){this.presentationRequestId++;this.presenting=false;this.presentation?.close();this.active=false;this.clearGrowth?.();clearChartTooltips(document.getElementById('representatives-report'));clearAnalysisMotion(document.getElementById('representatives-report'));}
 syncCalendar(){
  const today=saoPauloToday();if(today===this.calendarDay)return;
  if(this.end===this.calendarDay){this.end=today;if(this.start===this.calendarDay.slice(0,7)+'-01')this.start=today.slice(0,7)+'-01';}
  this.calendarDay=today;
 }
 async refreshForNewDay(){if(!this.active||this.busy||!this.period||!this.queriedOn||document.visibilityState==='hidden'||this.queriedOn===saoPauloToday())return;this.syncCalendar();await this.refresh();}
 async refresh(forceHistory=true){
  if(this.busy||location.protocol==='file:')return;
  const start=this.start,end=this.end,queryDay=saoPauloToday(),id=++this.requestId;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end||end>queryDay){this.notice?.('Escolha um período válido, sem datas futuras.',true);return;}
  this.presentationRequestId++;this.presenting=false;this.presentationDataCache=null;this.presentation?.close();this.busy=true;this.error='';this.period=null;this.history=null;this.comparisonData=null;this.contactCache.clear();this.city=null;this.page=0;this.onStatus?.('Atualizando');this.render();
  try{
   const [period,history]=await Promise.all([this.loadPeriod({inicio:start,fim:end},{allowStale:true}),this.loadHistory(Number(end.slice(0,4)),{force:forceHistory})]);
   if(id!==this.requestId)return;
   this.period=period;this.history=history;this.comparisonData=await loadRepresentativeComparisonData({period,history,loadPeriod:this.loadPeriod,loadHistory:this.loadHistory,force:forceHistory});if(id!==this.requestId)return;this.queriedOn=queryDay;this.onStatus?.(period.stale?'Atualização pendente':'Atualizado');
  }catch(error){if(id===this.requestId){this.error=error.message;this.period=null;this.onStatus?.('Indisponível');}}
  finally{if(id===this.requestId){this.busy=false;if(this.active)this.render();}}
 }
 batchDefinitions(){
  const available=new Map(this.options().map(row=>[row.code,row])),required=[...BATCH_REPRESENTATIVE_CODES,'7','12'],missing=required.filter(code=>!available.has(code));
  const definitions=BATCH_REPRESENTATIVE_CODES.filter(code=>available.has(code)).map(code=>({codes:[code],label:available.get(code).displayName}));
  if(available.has('7')&&available.has('12'))definitions.push({codes:['7','12'],label:selectionLabel([available.get('7'),available.get('12')])});
  return {available,definitions,missing};
 }
 batchGroups({strict=false}={}){
  const catalog=this.catalog(),period=this.period,history=this.history,comparisonData=this.comparisonData,aux=this.auxiliary(),aliasKey=JSON.stringify(aux.representativeAliases||[]),{available,definitions,missing}=this.batchDefinitions();
  if(strict&&missing.length)throw new Error('Não foi possível localizar os representantes de código '+missing.join(', ')+'. O PowerPoint não foi gerado.');
  if(this.macroCache?.catalog===catalog&&this.macroCache.period===period&&this.macroCache.history===history&&this.macroCache.comparisonData===comparisonData&&this.macroCache.aliasKey===aliasKey)return this.macroCache.groups;
  const groups=definitions.map(definition=>({label:definition.label,reports:['fardos','sales'].map(metric=>{
   const context={catalog,period,history,selectedIds:definition.codes.map(code=>available.get(code).id),metric};
   return {report:displayReport(buildRepresentativeReport(context),aux),comparison:buildRepresentativeComparison({...context,...comparisonData}),history,groupLabel:definition.label};
  })}));
  this.macroCache={catalog,period,history,comparisonData,aliasKey,groups};return groups;
 }
 renderMacro(){
  const container=document.getElementById('rep-macro');if(!container)return;
  if(!this.period||this.error||this.busy){container.innerHTML='';return;}
  try{
   const groups=this.batchGroups(),macro=representativeMacroSummary(groups,this.metric);container.innerHTML=representativeMacroHTML(macro,{missing:this.batchDefinitions().missing});
   container.querySelectorAll('[data-rep-macro-index]').forEach(node=>{
    const select=()=>{const row=macro.rows[Number(node.dataset.repMacroIndex)];if(!row)return;this.selectedIds=new Set(row.ids);this.city=null;this.page=0;this.renderOptions();this.renderReport();document.getElementById('representatives-report')?.scrollIntoView?.({behavior:'smooth',block:'start'});};
    node.addEventListener('click',select);node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});
   });
  }catch(error){container.innerHTML=empty('Visão macro indisponível',error.message);}
 }
 model(metric=this.metric){if(!this.period||!this.selectedIds.size)return null;return displayReport(buildRepresentativeReport({catalog:this.catalog(),period:this.period,history:this.history,selectedIds:[...this.selectedIds],metric}),this.auxiliary());}
 render(){
  if(!this.active)return;
  this.clearGrowth?.();
  const container=document.getElementById('representatives-content'),local=location.protocol==='file:';
  clearChartTooltips(document.getElementById('representatives-report'));clearAnalysisMotion(document.getElementById('representatives-report'));
  container.innerHTML='<div class="page-intro"><div><h2>Resultados por representante</h2></div><div class="button-row rep-report-actions"><button type="button" class="button rep-present-button" id="rep-present" title="Apresentação animada de janeiro até o último mês fechado: seleção atual ou visão macro e todos os representantes" disabled><span aria-hidden="true">▷</span> Apresentar</button><button type="button" class="button button-light" id="rep-pptx" disabled>PowerPoint</button><button type="button" class="button button-light" id="rep-pptx-all" title="Gerar um PowerPoint com os 15 representantes e Venda Direta + Atacado, separados, em fardos e R$" disabled>PowerPoint · todos</button><button class="button button-primary" id="rep-print" disabled>Imprimir · Fardos + R$</button></div></div><form class="panel rep-results-filters" id="rep-results-form"><label>Início<input type="date" id="rep-start" required value="'+esc(this.start)+'" max="'+saoPauloToday()+'"'+(this.busy?' disabled':'')+'></label><label>Fim<input type="date" id="rep-end" required value="'+esc(this.end)+'" max="'+saoPauloToday()+'"'+(this.busy?' disabled':'')+'></label><label>Unidade<select id="rep-metric"><option value="fardos"'+(this.metric==='fardos'?' selected':'')+'>Fardos</option><option value="sales"'+(this.metric==='sales'?' selected':'')+'>R$</option></select></label><button class="button button-primary" id="rep-load"'+(this.busy||local?' disabled':'')+'>'+(this.busy?'Consultando…':'Atualizar resultados')+'</button></form><div id="rep-macro"></div><section class="panel rep-picker"><div class="panel-heading"><h3>Representantes</h3><span class="registry-count" id="rep-selection-count">'+this.selectedIds.size+' selecionado(s)</span></div><div class="rep-picker-tools"><input type="search" id="rep-search" value="'+esc(this.query)+'" placeholder="Pesquisar nome ou código" aria-label="Pesquisar representantes"><button type="button" class="button button-light" id="rep-clear">Limpar seleção</button></div><div id="rep-options" class="rep-options" role="group" aria-label="Selecionar representantes"></div></section><div id="representatives-report">'+(local?empty('Abra o endereço do painel','Esta apresentação consulta o faturamento e o cadastro pelo servidor da empresa.'):this.busy?'<div class="loading-panel"><span class="spinner"></span><strong>Preparando os resultados do período…</strong></div>':'')+'</div>';
  document.getElementById('rep-results-form').addEventListener('submit',event=>{event.preventDefault();this.start=document.getElementById('rep-start').value;this.end=document.getElementById('rep-end').value;this.refresh();});
  for(const key of ['start','end'])document.getElementById('rep-'+key).addEventListener('change',event=>{this[key]=event.target.value;});
  document.getElementById('rep-search').addEventListener('input',event=>{this.query=event.target.value;this.renderOptions();});
  document.getElementById('rep-metric').addEventListener('change',event=>{this.metric=event.target.value;this.renderReport();});
  document.getElementById('rep-clear').addEventListener('click',()=>{this.selectedIds.clear();this.city=null;this.page=0;this.renderOptions();this.renderReport();});
  document.getElementById('rep-print').addEventListener('click',()=>this.print());
  document.getElementById('rep-pptx').addEventListener('click',()=>this.powerPoint());
  document.getElementById('rep-pptx-all').addEventListener('click',()=>this.powerPointAll());
  document.getElementById('rep-present').addEventListener('click',()=>this.present());
  this.renderOptions();if(!this.busy&&!local)this.renderReport();
 }
 renderOptions(){
  const target=document.getElementById('rep-options');if(!target)return;
  const query=normalizeName(this.query),options=this.options().filter(row=>!query||normalizeName(row.displayName+' '+row.name+' '+(row.code||'')).includes(query));
  target.innerHTML=options.length?options.map(row=>'<label class="rep-option'+(this.selectedIds.has(row.id)?' selected':'')+'"><input type="checkbox" data-representative="'+esc(row.id)+'"'+(this.selectedIds.has(row.id)?' checked':'')+'><span><strong>'+esc(row.displayName)+'</strong><small>'+(row.displayName!==row.name?esc(row.name)+' · ':'')+(row.code?'Cód. '+esc(row.code):'Sem código no cadastro')+'</small></span></label>').join(''):'<p class="rep-picker-empty">Nenhum representante encontrado.</p>';
  target.querySelectorAll('[data-representative]').forEach(node=>node.addEventListener('change',()=>{node.checked?this.selectedIds.add(node.dataset.representative):this.selectedIds.delete(node.dataset.representative);this.city=null;this.page=0;this.renderOptions();this.renderReport();}));
  document.getElementById('rep-selection-count').textContent=this.selectedIds.size+' selecionado(s)';
 }
 comparison(metric=this.metric){
  if(!this.period||!this.selectedIds.size)return null;
  return buildRepresentativeComparison({catalog:this.catalog(),period:this.period,history:this.history,...this.comparisonData,selectedIds:[...this.selectedIds],metric});
 }
 reportMarkup(report,{printing=false,mapHTML=''}={}){
  return representativeReportHTML(report,{comparison:this.comparison(report.metric),history:this.history,printing,mapHTML,city:this.city,clientQuery:this.clientQuery,page:this.page,shareChart:representativeShareChart(report.series,report.metric)});
 }
 async showContact(code){
  const client=this.comparison()?.recovery?.clients.find(row=>row.code===code),target=document.getElementById('rep-customer-detail');if(!client||!target)return;
  const request=++this.contactRequestId;target.hidden=false;target.innerHTML='<strong>'+esc(client.name)+'</strong><p>Consultando o contato do cadastro…</p>';
  try{
   if(!this.loadClientContact)throw new Error('A consulta de contato não está disponível.');
   const value=this.contactCache.get(code)||await this.loadClientContact(code);this.contactCache.set(code,value);
   if(!this.active||request!==this.contactRequestId||document.getElementById('rep-customer-detail')!==target)return;
   const address=[value.address,value.number].filter(Boolean).join(', '),city=[value.city,value.uf].filter(Boolean).join(' / ');
   target.innerHTML='<div class="rep-contact-heading"><div><strong>'+esc(client.name)+'</strong><small>Cód. '+esc(code)+'</small></div><button type="button" class="button button-light button-small" id="rep-contact-close">Fechar contato</button></div><dl><div><dt>Endereço</dt><dd>'+esc(address||'Não informado no cadastro')+'</dd></div><div><dt>Bairro / CEP</dt><dd>'+esc([value.neighborhood,value.postalCode].filter(Boolean).join(' · ')||'Não informado no cadastro')+'</dd></div><div><dt>Cidade</dt><dd>'+esc(city||client.city)+'</dd></div><div><dt>Telefone</dt><dd>'+(value.phones.length?value.phones.map(phone=>'<a href="tel:'+esc(phone.replace(/[^+0-9]/g,''))+'">'+esc(phone)+'</a>').join(' · '):'Não informado no cadastro')+'</dd></div></dl><small>Fonte: '+esc(value.source?.name||'Cadastro de clientes')+'</small>';
  }catch(error){if(request===this.contactRequestId&&document.getElementById('rep-customer-detail')===target)target.innerHTML='<div class="rep-contact-heading"><strong>'+esc(client.name)+'</strong><button type="button" class="button button-light button-small" id="rep-contact-close">Fechar contato</button></div><p>'+esc(error.message)+'</p><p>'+esc(client.city)+'</p>';}
  document.getElementById('rep-contact-close')?.addEventListener('click',()=>{target.hidden=true;target.innerHTML='';this.contactRequestId++;});
 }

 renderReport(){
  if(!this.active||this.busy)return;
  const target=document.getElementById('representatives-report');if(!target)return;
  this.renderMacro();
  document.getElementById('rep-present').disabled=this.busy||this.presenting||!this.period||Boolean(this.error);
  document.getElementById('rep-pptx-all').disabled=this.busy||!this.period||Boolean(this.error)||Boolean(this.batchExporting);
  this.clearGrowth?.();
  clearChartTooltips(target);clearAnalysisMotion(target);document.getElementById('rep-print').disabled=true;document.getElementById('rep-pptx').disabled=true;
  if(this.error){target.innerHTML=empty('Não foi possível consultar o resultado',this.error);return;}
  if(!this.selectedIds.size){target.innerHTML=empty('Selecione os representantes','Escolha um ou mais nomes para preparar a apresentação.');return;}
  if(!this.period){target.innerHTML=empty('Carregue o período','Consulte a API para preparar os resultados.');return;}
  let report;try{report=this.model();}catch(error){target.innerHTML=empty('Cobertura ainda não confirmada',error.message);return;}
  target.innerHTML=this.reportMarkup(report);
  document.getElementById('rep-print').disabled=false;
  this.bindCityActions(target);
  this.clearGrowth=bindRepresentativeGrowth(target);
  target.querySelectorAll('[data-recovery-code]').forEach(node=>{node.addEventListener('click',()=>this.showContact(node.dataset.recoveryCode));node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();this.showContact(node.dataset.recoveryCode);}});});
  document.getElementById('rep-clear-city')?.addEventListener('click',()=>{this.city=null;this.page=0;this.renderReport();});
  document.getElementById('rep-client-query')?.addEventListener('input',event=>{this.clientQuery=event.target.value;this.page=0;const cursor=event.target.selectionStart;this.renderReport();const input=document.getElementById('rep-client-query');input.focus();input.setSelectionRange?.(cursor,cursor);});
  document.getElementById('rep-prev')?.addEventListener('click',()=>{this.page=Math.max(0,this.page-1);this.renderReport();});
  document.getElementById('rep-next')?.addEventListener('click',()=>{this.page++;this.renderReport();});
  const map=new RepresentativeMap({container:document.getElementById('rep-map-host'),onCity:key=>this.selectCity(key)});this.map=map;this.mapReady=false;
  map.load().then(()=>{if(!this.active||this.map!==map)return;const choices=map.stateChoices(report.cities);if(!choices.some(choice=>choice.uf===this.uf))this.uf=choices.find(choice=>choice.uf==='PI')?.uf||choices.find(choice=>choice.available)?.uf||choices[0]?.uf||'PI';const select=document.getElementById('rep-map-state');select.innerHTML=choices.map(choice=>'<option value="'+esc(choice.uf)+'"'+(choice.uf===this.uf?' selected':'')+'>'+esc(choice.name+' · '+choice.cityCount+' cidade(s)'+(!choice.available?' · sem mapa':''))+'</option>').join('');select.addEventListener('change',()=>{this.uf=select.value;map.render(report.cities,{state:this.uf,selectedCity:this.city,metric:this.metric});});map.render(report.cities,{state:this.uf,selectedCity:this.city,metric:this.metric});this.mapReady=true;this.mapError='';document.getElementById('rep-print').disabled=false;document.getElementById('rep-pptx').disabled=this.exporting;}).catch(error=>{if(this.active&&this.map===map){this.mapError=error.message;document.getElementById('rep-map-host').innerHTML=empty('Mapa indisponível',error.message);}});
  bindChartTooltips(target);animateAnalysis(target);
 }
 bindCityActions(target){target.querySelectorAll('[data-rep-city]').forEach(node=>{node.addEventListener('click',()=>this.selectCity(node.dataset.repCity));node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();this.selectCity(node.dataset.repCity);}});});}
 selectCity(key){this.city=this.city===key?null:key;const city=this.model()?.cities.find(row=>row.key===this.city);if(city)this.uf=city.uf;this.page=0;this.renderReport();}
 async powerPoint(){
  if(this.exporting||this.batchExporting)return;
  const button=document.getElementById('rep-pptx'),label=button?.textContent;this.exporting=true;if(button){button.disabled=true;button.textContent='Preparando PowerPoint…';}
  try{
   if(this.busy||!this.period||!this.selectedIds.size)throw new Error('Selecione os representantes e carregue os resultados antes de exportar.');
   if(!this.mapReady)throw new Error(this.mapError||'Aguarde o mapa terminar de carregar antes de exportar.');
   const reports=['fardos','sales'].map(metric=>{const report=this.model(metric);return {report,comparison:this.comparison(metric),history:this.history,groupLabel:report.displayLabel,mapHTML:this.map.snapshot({metric})};});
   await this.exportPowerPoint({reports});
   this.notice?.('PowerPoint preparado com as versões em fardos e R$.',false);
  }catch(error){this.notice?.(error.message,true);}finally{this.exporting=false;if(button){button.textContent=label||'PowerPoint';button.disabled=this.busy||!this.period||!this.selectedIds.size||!this.mapReady;}}
 }
 async print(){
  const button=document.getElementById('rep-print');button.disabled=true;
  try{
   if(this.busy||!this.period||!this.selectedIds.size)throw new Error('Selecione os representantes e carregue os resultados antes de imprimir.');
   const sections=['fardos','sales'].map(metric=>({title:metric==='sales'?'Valores em R$':'Fardos',html:this.reportMarkup(this.model(metric),{printing:true})}));
   await this.printReport({title:'Resultados por representante',sections});
  }catch(error){this.notice?.(error.message,true);}finally{if(button)button.disabled=false;}
 }
 async present(){
  if(this.presenting)return;
  const button=document.getElementById('rep-present'),request=++this.presentationRequestId;
  this.presenting=true;if(button){button.disabled=true;button.textContent='Preparando apresentação…';}
  try{
   if(this.busy||!this.period||this.error)throw new Error('Carregue os resultados antes de apresentar.');
   const today=saoPauloToday(),catalog=this.catalog(),selectedIds=[...this.selectedIds],metric=this.metric,visiblePeriod=this.period,visibleHistory=this.history;
   let data=this.presentationDataCache?.day===today&&this.presentationDataCache.period===visiblePeriod&&this.presentationDataCache.history===visibleHistory?this.presentationDataCache.data:null;
   if(!data){
    data=await loadClosedRepresentativePresentationData({today,loadPeriod:this.loadPeriod,loadHistory:this.loadHistory,period:visiblePeriod,history:visibleHistory});
    if(!this.active||request!==this.presentationRequestId)return;
    this.presentationDataCache={day:today,period:visiblePeriod,history:visibleHistory,data};
   }
   if(!this.active||request!==this.presentationRequestId)return;
   const aux=this.auxiliary(),options=this.displayOptions(catalog,[...data.history.months,...data.period.clientes]),available=new Map(options.map(row=>[row.code,row]));
   const selected=selectedIds.length>0,definitions=selected?[{selectedIds,label:selectionLabel(options.filter(row=>selectedIds.includes(row.id)))}]:BATCH_REPRESENTATIVE_CODES.filter(code=>available.has(code)).map(code=>({selectedIds:[available.get(code).id],label:available.get(code).displayName}));
   if(!selected&&available.has('7')&&available.has('12'))definitions.push({selectedIds:[available.get('7').id,available.get('12').id],label:selectionLabel([available.get('7'),available.get('12')])});
   const groups=definitions.map(definition=>({label:definition.label,reports:['fardos','sales'].map(unit=>{
    const context={catalog,period:data.period,history:data.history,selectedIds:definition.selectedIds,metric:unit};
    return {report:displayReport(buildRepresentativeReport(context),aux),comparison:buildRepresentativeComparison({...context,...data.comparisonData}),history:data.history,groupLabel:definition.label};
   })}));
   this.presentation=this.presentation||new RepresentativePresentation();
   await this.presentation.open({groups,metric,macro:!selected});
  }catch(error){if(this.active&&request===this.presentationRequestId)this.notice?.(error.message,true);}
  finally{if(request===this.presentationRequestId){this.presenting=false;const current=document.getElementById('rep-present');if(current){current.innerHTML='<span aria-hidden="true">▷</span> Apresentar';current.disabled=this.busy||!this.period||Boolean(this.error);}}}
 }
 async powerPointAll(){
  if(this.batchExporting||this.exporting)return;
  const button=document.getElementById('rep-pptx-all');this.batchExporting=true;if(button){button.disabled=true;button.textContent='Preparando PowerPoint…';}
  try{
   if(this.busy||!this.period||this.error)throw new Error('Carregue os resultados do período antes de gerar as apresentações.');
   const period=this.period,groups=this.batchGroups({strict:true}).map(group=>({...group,reports:group.reports.map(entry=>({...entry}))}));
   const map=new RepresentativeMap();await map.load();
   for(const group of groups){
    const choices=map.stateChoices(group.reports[0].report.cities),state=choices.find(choice=>choice.uf==='PI'&&choice.available)?.uf||choices.find(choice=>choice.available)?.uf||choices[0]?.uf||'PI';
    for(const entry of group.reports){map.render(entry.report.cities,{state,metric:entry.report.metric});entry.mapHTML=map.snapshot({metric:entry.report.metric});}
   }
   await this.exportPowerPoint({groups,fileName:'BI_Apresentacoes_Representantes_'+period.coveredThrough+'.pptx'});
   this.notice?.('PowerPoint preparado com visão macro, 15 representantes individuais e Venda Direta + Atacado agrupados, em fardos e R$.',false);
  }catch(error){this.notice?.(error.message,true);}finally{this.batchExporting=false;const currentButton=document.getElementById('rep-pptx-all');if(currentButton){currentButton.textContent='PowerPoint · todos';currentButton.disabled=this.busy||!this.period||Boolean(this.error);}}
 }
}
