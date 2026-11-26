import {CATEGORIES,ALL_CATEGORIES,normalizeCode,normalizeName,buildEntities,consolidateEntities,summarizeEntity,forecastEntity,saoPauloToday,comparisonPeriods,compareAnnual,monthlyComparisonPeriods,compareMonth} from './analytics.js';
import {loadAuxiliary,saveAuxiliary,loadYear,loadPeriod,loadClientContact} from './api.js';
import {MONTHS,COLORS,esc,fmt,pct,lineChart,mixChart,miniMix,bindChartTooltips,clearChartTooltips} from './charts.js';
import {Registry} from './registry.js';
import {animateAnalysis,clearAnalysisMotion} from './motion.js';
import {PlanningStore} from './planning-api.js';
import {INITIAL_CLIENT_CATALOG} from './client-catalog.js';
import {CustomerResults} from './customer-results.js';
import {NoOrders} from './no-orders.js';
import {printDualReport} from './print-report.js';
import {RepresentativeResults} from './representative-results.js';
import {loadCompanyPeriod,companyPeriodHTML} from './company-period.js';

const $=id=>document.getElementById(id),TODAY=saoPauloToday(),CURRENT_YEAR=Number(TODAY.slice(0,4));
const LOCAL_FILE=location.protocol==='file:';
const LOCAL_MESSAGE='Arquivo aberto no computador. O menu, o relatório e o simulador estão disponíveis. Para consultar vendas e salvar cadastros compartilhados, abra este BI pelo endereço HTTP/HTTPS da hospedagem com PHP.';
const TITLES={dashboard:'Dashboard principal',company:'Resultado da empresa',top:'Top Varejistas',networks:'Grandes redes',goals:'Metas Top Varejistas',presentation:'Apresentação ao cliente',representatives:'Resultados por representante','no-orders':'Clientes não visitados',registry:'Cadastros comerciais',indicadores:'Indicadores','simulador-top':'Simulador de Pedido'};
const isAnalytical=view=>['top','networks','company'].includes(view),isCustomerView=view=>['goals','presentation'].includes(view);
const state={companyPeriod:null,companyPeriodLoading:false,companyPeriodRequest:0,view:'dashboard',metric:'fardos',year:CURRENT_YEAR,aux:null,history:null,historyRequestedOn:null,previousHistory:null,previousPeriod:null,previousMonth:null,comparisonKey:null,comparisonPending:null,comparisonLoading:false,comparisonError:null,noOrdersStatus:'Aguardando consulta',representativesStatus:'Aguardando consulta',loading:false,requestId:0,controller:null,query:'',selected:{top:null,networks:null,company:null},flipping:false,dashboardStatus:'Carregando',historyStatus:'Aguardando histórico'};
const DASHBOARD_STATUSES=new Set(['Carregando','Atualizando','Atualizado','Atualização pendente','Indisponível','Arquivo local']);
function renderConnectionStatus(){const analytical=isAnalytical(state.view)||isCustomerView(state.view),standalone=state.view.startsWith('simulador-')||state.view==='indicadores';$('data-status').hidden=standalone;$('refresh').hidden=standalone;const label=LOCAL_FILE?'Arquivo local':state.view==='dashboard'?state.dashboardStatus:state.view==='no-orders'?state.noOrdersStatus:state.view==='representatives'?state.representativesStatus:analytical?state.historyStatus:state.aux?'Atualizado':'Carregando';$('connection-status').textContent=label;$('connection-status').setAttribute('data-state',label==='Arquivo local'?'local':label==='Atualizado'?'success':label==='Indisponível'?'error':label.includes('parcial')||label.includes('pendente')?'warning':'pending');}
function requestDashboardStatus(){const frame=$('app-frame');if(state.view!=='dashboard'||!frame?.contentWindow||frame.dataset.preparing==='true')return;frame.contentWindow.postMessage({type:'BI_DASHBOARD_STATUS_REQUEST'},LOCAL_FILE?'*':location.origin);}
// Mount only after the top-level document has finished loading. Creating a frame
// during parsing triggers an observer error in the browser's annotation layer.
// Keep the same frame, dimensions and styles once mounted, including its filters.
function syncEmbeddedView(){
 if(document.readyState!=='complete'||!['dashboard','indicadores','simulador-top'].includes(state.view))return;
 const desired=new URL('apps/'+state.view+'/index.html',location.href).href;
 let frame=$('app-frame');
 if(!frame){
  frame=document.createElement('iframe');frame.id='app-frame';frame.title=TITLES[state.view];frame.setAttribute('referrerpolicy','same-origin');
  // Connect a complete blank document first. The annotation observer can then
  // attach before a heavier child page starts navigating or loading scripts.
  frame.dataset.preparing='true';
  frame.addEventListener('load',()=>{if(frame.dataset.preparing==='true'){delete frame.dataset.preparing;syncEmbeddedView();return;}syncAuxiliary();requestDashboardStatus();});
  frame.src='about:blank';$('frame-view').appendChild(frame);
 }else{frame.title=TITLES[state.view];if(frame.dataset.preparing!=='true'&&frame.src!==desired)frame.src=desired;}
}
let toastTimer;
function showNotice(message,error=true){$('global-notice').textContent=message;$('global-notice').className='notice'+(error?'':' success');$('global-notice').hidden=!message;}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function registryNotice(message,error=false){$('registry-notice').textContent=message;$('registry-notice').className='notice'+(error?'':' success');$('registry-notice').hidden=!message;if(!error)toast(message);}
function syncAuxiliary(){const frame=$('app-frame');if(!LOCAL_FILE&&state.aux&&state.view==='dashboard'&&frame?.contentWindow&&frame.dataset.preparing!=='true')frame.contentWindow.postMessage({type:'BI_AUXILIARY',data:state.aux},location.origin);$('save-indicator').textContent=LOCAL_FILE?'Pré-visualização local':state.aux?'JSON compartilhado · revisão '+state.aux.revision:'Cadastros indisponíveis';if(state.view==='representatives')representativeResults.render();}
async function persistAuxiliary(next){if(!state.aux)throw new Error('Carregue os cadastros antes de salvar.');const saved=await saveAuxiliary(next,state.aux.revision);state.aux=saved;syncAuxiliary();return saved;}
const registry=new Registry({getAux:()=>state.aux,getHistory:()=>state.history,getCatalog:()=>planning.data?.clientCatalog||INITIAL_CLIENT_CATALOG,save:persistAuxiliary,today:saoPauloToday,notice:registryNotice,requestHistory:async()=>{if(registry.tab!=='representatives')return ensureHistory();const [history]=await Promise.all([ensureHistory(true),planning.load(true)]);return history;}});
const appRoot=new URL('../',document.currentScript?.src||new URL('js/app.bundle.js',location.href));
const planning=new PlanningStore(new URL('api/planning.php',appRoot));
const results=new CustomerResults({getAux:()=>state.aux,getHistory:()=>state.history,getPreviousHistory:()=>state.previousHistory,getPreviousPeriod:()=>state.previousPeriod,loadGoalHistory:async year=>year===state.year?ensureHistory():({...await loadYear(year),year}),ensureHistory:()=>ensureHistory().then(()=>ensureComparisons()).then(()=>state.history),notice:showNotice,store:planning,getMetric:()=>state.metric,getYear:()=>state.year,onNavigate:navigate});
const noOrders=new NoOrders({store:planning,loadPeriod,notice:showNotice,onNavigate:navigate,onStatus:status=>{state.noOrdersStatus=status;renderConnectionStatus();}});
const representativeResults=new RepresentativeResults({getAux:()=>state.aux,store:planning,loadPeriod,loadClientContact,loadHistory:async(year,{force=false}={})=>year===state.year?ensureHistory(force):({...await loadYear(year),year}),notice:showNotice,onStatus:status=>{state.representativesStatus=status;renderConnectionStatus();}});
function repaintData(){if(isAnalytical(state.view))renderAnalysis();if(isCustomerView(state.view))results.render();}
function refreshRegistryCatalog(){if(LOCAL_FILE||registry.tab!=='representatives')return;planning.load().then(()=>{if(state.view==='registry'&&registry.tab==='representatives')registry.refreshSources();}).catch(error=>registryNotice('Não foi possível atualizar a base de representantes. '+error.message,true));}

function navigate(view,push=true,tab){if(!TITLES[view])view='dashboard';state.view=view;$('page-title').textContent=TITLES[view].toLocaleUpperCase('pt-BR');document.title='BI Demo · '+TITLES[view];document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===view;button.classList.toggle('active',active);active?button.setAttribute('aria-current','page'):button.removeAttribute('aria-current');});$('sidebar').classList.remove('open');$('menu-toggle').setAttribute('aria-expanded','false');const analytical=isAnalytical(view),customer=isCustomerView(view),embedded=['dashboard','indicadores','simulador-top'].includes(view);$('frame-view').hidden=!embedded;$('analysis-view').hidden=!analytical;$('registry-view').hidden=view!=='registry';$('customer-results-view').hidden=!customer;$('no-orders-view').hidden=view!=='no-orders';$('representatives-view').hidden=view!=='representatives';$('year-control').hidden=!(analytical||customer||view==='registry');$('unit-toggle').hidden=!analytical;
 syncEmbeddedView();syncCompanyDateControls();
 if(push)history.pushState({view},'', '#'+view+(view==='registry'&&tab?'/'+tab:''));
 if(view==='registry'){registry.show(tab||registry.tab);refreshRegistryCatalog();if(!state.history&&!state.loading)ensureHistory().then(()=>{if(state.view==='registry')registry.refreshSources();}).catch(error=>registryNotice(error.message,true));}
 if(analytical){$('analysis-title').textContent=view==='top'?'Acompanhamento Top Varejista':view==='company'?'Acompanhamento da Empresa':'Acompanhamento Grandes Redes';$('manage-list').hidden=view==='company';$('manage-list').textContent=view==='top'?'Gerenciar participantes ↗':'Gerenciar grandes redes ↗';$('entity-search').value=state.query;renderAnalysis();ensureHistory().then(()=>ensureComparisons()).catch(error=>showNotice(error.message));}
 if(customer)results.show(view);else results.hide();if(view==='no-orders')noOrders.show();else noOrders.hide();if(view==='representatives')representativeResults.show();else representativeResults.hide();
 if(!analytical){clearChartTooltips($('analysis-content'));clearAnalysisMotion($('analysis-content'));}renderConnectionStatus();if(view==='dashboard')requestDashboardStatus();const section=analytical?$('analysis-view'):view==='registry'?$('registry-view'):customer?$('customer-results-view'):view==='no-orders'?$('no-orders-view'):view==='representatives'?$('representatives-view'):$('frame-view');section.classList.remove('content-enter');void section.offsetWidth;section.classList.add('content-enter');}
function route(){const [view,tab]=location.hash.slice(1).split('/');navigate(view||'dashboard',false,tab);}

async function ensureHistory(force=false){if(LOCAL_FILE)return null;const requestedDay=saoPauloToday();if(!force&&state.history?.year===state.year&&state.historyRequestedOn===requestedDay)return state.history;if(state.loading&&!force)return state.pending;
 state.controller?.abort();state.comparisonKey=null;state.previousHistory=null;state.previousPeriod=null;state.previousMonth=null;state.comparisonPending=null;const controller=new AbortController(),requestId=++state.requestId;state.controller=controller;state.loading=true;$('loading-panel').hidden=false;$('loading-label').textContent='Consultando '+state.year+'…';$('history-progress').value=0;state.historyStatus='Atualizando';renderConnectionStatus();$('refresh').disabled=true;
 const year=state.year;
 state.pending=(async()=>{try{const result=await loadYear(year,{signal:controller.signal,onProgress:progress=>{if(requestId!==state.requestId)return;$('history-progress').max=progress.total||1;$('history-progress').value=progress.completed;$('loading-label').textContent=progress.completed+' de '+progress.total+' meses consultados';}});if(requestId!==state.requestId)return null;state.history={...result,year};state.historyRequestedOn=requestedDay;state.historyStatus=result.coverage.ok===0?'Indisponível':result.coverage.errors?'Histórico parcial':result.coverage.stale?'Atualização pendente':'Atualizado';renderConnectionStatus();const requestedEnd=year<Number(requestedDay.slice(0,4))?year+'-12-31':requestedDay,coveredEnd=result.coverage.stale?result.asOf:requestedEnd;$('coverage-status').textContent=result.coverage.ok+' de '+result.coverage.requested+' meses disponíveis · consulta até '+requestedEnd.split('-').reverse().join('/')+(coveredEnd<requestedEnd?' · fonte até '+coveredEnd.split('-').reverse().join('/'):'');if(result.coverage.ok===0)showNotice('Nenhum mês pôde ser consultado. Confira a conexão da hospedagem com a API comercial.');else showNotice('');repaintData();return state.history;
 }catch(error){if(error.name!=='AbortError'&&requestId===state.requestId){state.historyStatus='Indisponível';renderConnectionStatus();showNotice(error.message);throw error;}return null;}finally{if(requestId===state.requestId){state.loading=false;$('loading-panel').hidden=true;$('refresh').disabled=false;repaintData();}}})();return state.pending;
}

// An open tab must not retain yesterday's query just because the year is equal.
// Only a change of calendar day triggers these background checks; no polling
// of the commercial API is performed every minute.
async function refreshForNewDay(){
 if(LOCAL_FILE||document.visibilityState==='hidden'||state.loading||!state.history||state.historyRequestedOn===saoPauloToday()||!(isAnalytical(state.view)||isCustomerView(state.view)||state.view==='registry'))return;
 try{await ensureHistory();if(isAnalytical(state.view)||isCustomerView(state.view))await ensureComparisons();if(state.view==='registry')registry.refreshSources();if(state.view==='company'&&state.companyPeriod)await applyCompanyPeriod(true);}catch(error){showNotice(error.message);}
}

async function ensureComparisons(){
 if(LOCAL_FILE||!state.history||state.history.year!==state.year)return null;
 const year=state.year,asOf=state.history.asOf,key=year+'|'+asOf,requestId=state.requestId;
 if(state.comparisonKey===key)return state.comparisonPending;
 state.comparisonKey=key;state.comparisonLoading=true;state.comparisonError=null;state.previousHistory=null;state.previousPeriod=null;state.previousMonth=null;
 const periods=comparisonPeriods(year,asOf),monthly=monthlyComparisonPeriods(year,asOf),signal=state.controller?.signal;repaintData();
 state.comparisonPending=(async()=>{
  const values=await Promise.allSettled([loadYear(year-1,{signal}),loadPeriod(periods.previous,{signal}),loadPeriod(monthly.previous,{signal})]);
  if(requestId!==state.requestId||key!==state.comparisonKey)return null;
  const [historyResult,periodResult,monthResult]=values;
  if(historyResult.status==='fulfilled')state.previousHistory={...historyResult.value,year:year-1};
  if(periodResult.status==='fulfilled')state.previousPeriod={month:periods.previous.fim.slice(0,7),...periodResult.value};
  if(monthResult.status==='fulfilled')state.previousMonth={month:monthly.previous.fim.slice(0,7),...monthResult.value};
  state.comparisonError=[...new Set(values.filter(value=>value.status==='rejected').map(value=>value.reason?.message||'Consulta indisponível.'))].join(' ');
  state.comparisonLoading=false;repaintData();return state.previousHistory;
 })();return state.comparisonPending;
}
function portfolioEntity(entities){return consolidateEntities(state.history?.months||[],entities,state.view==='company'?ALL_CATEGORIES:CATEGORIES);}
function previousFocus(months,view,selected,categories){if(!months)return null;const entities=buildEntities(months,state.aux,view);return selected?entities.find(entity=>entity.id===selected.id)||consolidateEntities(months,[],categories):consolidateEntities(months,entities,categories);}
function statCard(label,value,foot,featured=false,icon='↗'){return '<article class="stat-card'+(featured?' featured':'')+'"><span class="stat-label">'+esc(label)+'<i class="stat-icon" aria-hidden="true">'+icon+'</i></span><strong class="stat-value">'+esc(value)+'</strong><span class="stat-foot">'+esc(foot)+'</span></article>';}
function comparisonCard(label,actual,trend,foot,metric=state.metric){return '<article class="stat-card comparison-card" data-metric="'+metric+'"><span class="stat-label">'+esc(label)+'<i class="stat-icon" aria-hidden="true">◷</i></span><div class="comparison-values"><div class="comparison-value"><span>Realizado</span><strong>'+esc(fmt(actual,metric))+'</strong></div><div class="comparison-value trend-value"><span>Tendência</span><strong>'+esc(fmt(trend,metric))+'</strong></div></div><span class="stat-foot">'+esc(foot)+'</span></article>';}
function monthlyEvolutionCard(change,changeLabel,yearly){
 const value=yearly.percent==null?'—':(yearly.percent>0?'+':'')+pct(yearly.percent);
 const foot=state.comparisonLoading?'Consultando comparação':yearly.reason||'Até '+yearly.periods.current.fim.slice(5).split('-').reverse().join('/')+' nos dois anos';
 return '<article class="stat-card monthly-evolution-card"><span class="stat-label">Evolução mensal<i class="stat-icon" aria-hidden="true">↗</i></span><strong class="stat-value">'+esc(change)+'</strong><span class="stat-foot">'+esc(changeLabel)+'</span><div class="same-month-comparison"><span>Mesmo mês de '+(state.year-1)+'</span><strong>'+esc(value)+'</strong><small>'+esc(foot)+'</small></div></article>';
}
function syncCompanyDateControls(){
 const host=$('company-date-controls');if(!host)return;host.hidden=state.view!=='company';
 const today=saoPauloToday(),end=state.year===Number(today.slice(0,4))?today:state.year+'-12-31';
 for(const [id,value]of [['company-date-start',state.year+'-01-01'],['company-date-end',end]]){const field=$(id);field.min=state.year+'-01-01';field.max=end;if(!field.value||field.value.slice(0,4)!==String(state.year))field.value=value;field.disabled=LOCAL_FILE||state.companyPeriodLoading;}
 $('company-date-apply').disabled=LOCAL_FILE||state.companyPeriodLoading;$('company-date-clear').disabled=!state.companyPeriod&&!state.companyPeriodLoading;
}
async function applyCompanyPeriod(force=false){
 if(LOCAL_FILE||state.view!=='company'||state.companyPeriodLoading)return;
 const inicio=$('company-date-start').value,fim=$('company-date-end').value,year=state.year,request=++state.companyPeriodRequest;
 state.companyPeriodLoading=true;syncCompanyDateControls();renderAnalysis();
 try{
  const result=await loadCompanyPeriod({inicio,fim,today:saoPauloToday(),year,loadPeriod,history:state.history,previousHistory:state.previousHistory,force});
  if(request!==state.companyPeriodRequest||year!==state.year)return;
  state.companyPeriod=result;showNotice('');
 }catch(error){if(request===state.companyPeriodRequest)showNotice(error.message);}
 finally{if(request===state.companyPeriodRequest){state.companyPeriodLoading=false;syncCompanyDateControls();if(state.view==='company')renderAnalysis();}}
}
function clearCompanyPeriod(){state.companyPeriodRequest++;state.companyPeriod=null;state.companyPeriodLoading=false;const day=saoPauloToday();$('company-date-start').value=state.year+'-01-01';$('company-date-end').value=state.year===Number(day.slice(0,4))?day:state.year+'-12-31';syncCompanyDateControls();if(state.view==='company')renderAnalysis();}
function renderCompanyPeriod(container,metric,printing){
 if(state.companyPeriodLoading){container.innerHTML='<div class="loading-panel" role="status"><span class="spinner"></span><strong>Consultando o intervalo selecionado…</strong></div>';return printing?container.innerHTML:undefined;}
 const data=state.companyPeriod;container.innerHTML=companyPeriodHTML(data,state.aux,{metric,selectedId:state.selected.company,query:state.query});
 if(printing)return container.innerHTML;
 $('history-errors').hidden=true;$('coverage-status').textContent='Período: '+data.inicio.split('-').reverse().join('/')+' a '+data.fim.split('-').reverse().join('/');
 bindChartTooltips(container);animateAnalysis(container);
 container.querySelectorAll('[data-entity]').forEach(button=>button.addEventListener('click',()=>selectAnalysisEntity(button.dataset.entity)));
 container.querySelectorAll('[data-entity-row]').forEach(row=>{row.addEventListener('click',event=>{if(!event.target.closest?.('[data-entity]'))selectAnalysisEntity(row.dataset.entityRow);});row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectAnalysisEntity(row.dataset.entityRow);}});});
}
function updateClientFilterControl(){$('clear-client-filter').disabled=!state.selected[state.view]&&!state.query;}
function clearClientFilter(){if(!isAnalytical(state.view))return;state.selected[state.view]=null;state.query='';$('entity-search').value='';renderAnalysis();}
function selectAnalysisEntity(id){if(!isAnalytical(state.view))return;state.selected[state.view]=id;renderAnalysis();$('analysis-view').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}
function renderAnalysis(){clearChartTooltips($('analysis-content'));clearAnalysisMotion($('analysis-content'));try{renderAnalysisContent();}catch(error){showNotice('Não foi possível montar a análise: '+error.message);$('analysis-content').innerHTML='<div class="empty-state"><h3>Confira os cadastros e os dados</h3><p>'+esc(error.message)+'</p></div>';}finally{updateClientFilterControl();if($('analysis-print'))$('analysis-print').disabled=LOCAL_FILE||state.loading||state.comparisonLoading||state.companyPeriodLoading||!$('analysis-content').innerHTML.includes('class="stats-grid');}}
function renderAnalysisContent({metric=state.metric,printing=false}={}){
 if(!isAnalytical(state.view))return;
 const container=printing?document.createElement('div'):$('analysis-content'),view=state.view,company=view==='company';
 if(LOCAL_FILE){container.innerHTML='<div class="empty-state"><span class="empty-symbol">↗</span><h3>'+esc(TITLES[view])+' no servidor</h3><p>Esta análise consulta as vendas mensais e os cadastros compartilhados. Abra o endereço do BI na hospedagem com PHP para carregar os resultados reais.</p><p>Nenhum dado foi consultado ou alterado nesta abertura local.</p></div>';$('coverage-status').textContent='Consulta disponível pelo servidor';return;}
 if(!state.aux){container.innerHTML='<div class="empty-state"><h3>Cadastros indisponíveis</h3><p>Não foi possível carregar o JSON auxiliar. Atualize para tentar novamente.</p></div>';return;}
 if(!state.history||state.history.year!==state.year){container.innerHTML='<div class="empty-state"><span class="empty-symbol">↗</span><h3>Preparando a análise</h3><p>O histórico será consultado mês a mês na API da empresa.</p></div>';return;}
 if(company&&(state.companyPeriod||state.companyPeriodLoading))return renderCompanyPeriod(container,metric,printing);
 if(!printing){const day=saoPauloToday(),end=state.year<Number(day.slice(0,4))?state.year+'-12-31':day;$('coverage-status').textContent=state.history.coverage.ok+' de '+state.history.coverage.requested+' meses disponíveis · consulta até '+end.split('-').reverse().join('/')+(state.history.coverage.stale&&state.history.asOf<end?' · fonte até '+state.history.asOf.split('-').reverse().join('/'):'');}
 const coverage=state.history.coverage,quantityMissing=metric==='fardos'&&coverage.missingFardosMonths.length>0,errors=coverage.missingMonths;
 if(!printing){$('history-errors').hidden=!errors.length&&!quantityMissing&&!coverage.stale;$('history-errors').textContent=(errors.length?'Meses sem consulta válida: '+errors.join(', ')+'. Os valores faltantes não foram tratados como zero. ':'')+(quantityMissing?'Há meses em que a API não forneceu fardos completos. Veja os valores disponíveis ou alterne para R$. ':'')+(coverage.stale?(coverage.freshnessReason||'A fonte tem atualização anterior à data de hoje. A tendência usa a data disponível.'):'');}
 const candidates=buildEntities(state.history.months,state.aux,view),entities=candidates.filter(entity=>entity.eligible);
 if(!entities.length){container.innerHTML=company?'<div class="empty-state"><h3>Sem movimento disponível</h3><p>Não há clientes nos meses consultados. Confira o período e a conexão com a API.</p></div>':'<div class="empty-state"><span class="empty-symbol">◇</span><h3>'+(view==='top'?'Sua carteira Top Varejista começa aqui':'Sem redes com compras elegíveis neste ano')+'</h3><p>'+(view==='top'?'Cadastre os clientes que aceitaram o programa. Somente participantes com compras de arroz, flocão ou salgadinho aparecem na evolução.':'Confira a classificação das redes e as consultas mensais da API.')+(candidates.length?' '+candidates.length+' cadastro(s) não têm compras elegíveis nos dados disponíveis.':'')+'</p><button class="button button-primary" id="empty-register">'+(view==='top'?'Adicionar participantes':'Revisar grandes redes')+'</button></div>';$('empty-register')?.addEventListener('click',()=>navigate('registry',true,view==='top'?'top':'networks'));return;}
 const selected=entities.find(entity=>entity.id===state.selected[view]);if(!selected&&!printing)state.selected[view]=null;
 const focus=selected||portfolioEntity(entities),summary=summarizeEntity(focus,metric,state.year,state.history.asOf),forecast=forecastEntity(focus,metric,state.year,state.history.asOf),current=summary.series.find(point=>point.isCurrent),closedYear=state.year<CURRENT_YEAR,unit=metric==='sales'?'R$':'fardos';
 const priorFocus=previousFocus(state.previousHistory?.months,view,selected,focus.categories),priorSummary=priorFocus?summarizeEntity(priorFocus,metric,state.year-1,state.previousHistory.asOf):null;
 const priorPeriod=previousFocus(state.previousPeriod?[state.previousPeriod]:null,view,selected,focus.categories),annualChange=compareAnnual(focus,priorPeriod,metric,state.year,state.history.asOf);
 const priorMonth=previousFocus(state.previousMonth?[state.previousMonth]:null,view,selected,focus.categories),monthChange=compareMonth(focus,priorMonth,metric,state.year,state.history.asOf);
 const change=summary.change.percent==null?'—':(summary.change.percent>0?'+':'')+pct(summary.change.percent),changeLabel=summary.change.reason||(summary.change.isPartial?'Mês parcial em relação ao anterior':'Em relação ao mês anterior');
 const yearly=annualChange.percent==null?'—':(annualChange.percent>0?'+':'')+pct(annualChange.percent);
 const yearlyFoot=state.comparisonLoading?'Consultando o mesmo período do ano anterior':annualChange.reason||'Mesmo intervalo de '+(state.year-1)+' · até '+annualChange.periods.current.fim.slice(5).split('-').reverse().join('/');
 const currentValue=closedYear?summary.series.at(-1)?.total:forecast.currentMonth?.projected,annual=forecast.yearEnd?.projected;
 const banner=selected?'<div class="detail-banner"><div><span class="eyebrow">'+(view==='networks'?'Rede selecionada':'Cliente selecionado')+'</span><h3>'+esc(selected.name)+'</h3><p>'+esc(selected.city||'')+' · '+selected.clientCodes.length+' cadastro(s) · Cód. '+esc(selected.clientCodes.join(', '))+'</p></div></div>':'';
 const stats='<div class="stats-grid'+(closedYear?' year-closed':' has-comparison')+'">'+statCard(summary.complete?'Realizado no ano':'Realizado disponível',summary.monthCount?fmt(summary.knownTotal,metric):'—',(summary.complete?'Janeiro até '+(closedYear?'dezembro':MONTHS[Number(TODAY.slice(5,7))-1]):'Total parcial · há meses indisponíveis')+' · '+unit,true,'▦')+monthlyEvolutionCard(change,changeLabel,monthChange)+statCard('Evolução anual',yearly,yearlyFoot,false,'↗')+(closedYear?statCard('Último mês do ano',fmt(currentValue,metric),'Resultado realizado em dezembro',false,'◷'):comparisonCard('Tendência para '+MONTHS[Number(TODAY.slice(5,7))-1],current?.total,currentValue,forecast.currentMonth?.reason||'Mês em andamento',metric))+statCard(closedYear?'Resultado do ano':'Tendência até dezembro',fmt(annual,metric),forecast.yearEnd?.reason||(closedYear?'Ano encerrado':'Cenário com base no histórico mensal'),false,'◇')+'</div>';
 const scope=selected?selected.name:company?'Resultado consolidado da empresa':'Consolidado dos '+entities.length+' participantes';
 const charts='<div class="analysis-grid"><section class="panel"><div class="panel-heading"><div><h3>Evolução mensal</h3><p>'+esc(scope)+'</p></div><span class="small-label">'+state.year+' · '+unit+'</span></div><div class="chart-container">'+lineChart(summary.series,forecast,metric,{priorSeries:priorSummary?.series,priorYear:state.year-1})+'</div><div class="chart-legend"><span><i class="legend-dot"></i>'+state.year+' realizado</span><span><i class="legend-dot estimate"></i>Tendência</span>'+(priorSummary?'<span><i class="legend-dot previous"></i>'+String(state.year-1)+'</span>':'')+'</div>'+(state.comparisonError?'<p class="comparison-note">Comparação anterior parcialmente indisponível. '+esc(state.comparisonError)+'</p>':'')+'</section><section class="panel"><div class="panel-heading"><div><h3>Mix de categorias</h3><p>Composição do realizado '+(summary.complete?'no ano':'disponível')+'</p></div></div>'+mixChart(summary.mix,metric)+'</section></div>';
 container.innerHTML=banner+stats+charts+(forecast.currentMonth?.projected==null&&!closedYear?'<div class="forecast-callout"><strong>Tendência indisponível</strong><span>'+esc(forecast.currentMonth?.reason||forecast.reason||'São necessários mais meses válidos de histórico.')+'</span></div>':'')+entityTable(entities,selected,metric)+(selected?monthlyTable(summary,forecast,metric):'');
 if(printing)return container.innerHTML;
 bindChartTooltips(container);animateAnalysis(container);
 container.querySelectorAll('[data-entity]').forEach(button=>button.addEventListener('click',()=>selectAnalysisEntity(button.dataset.entity)));
 container.querySelectorAll('[data-entity-row]').forEach(row=>{const interactive=event=>event.target.dataset?.entity||event.target.closest?.('[data-entity]');row.addEventListener('click',event=>{if(!interactive(event))selectAnalysisEntity(row.dataset.entityRow);});row.addEventListener('keydown',event=>{if(!interactive(event)&&(event.key==='Enter'||event.key===' ')){event.preventDefault();selectAnalysisEntity(row.dataset.entityRow);}});});
}
function entityTable(entities,selected,metric=state.metric){
 const query=normalizeName(state.query);
 const all=entities.map(entity=>({entity,summary:summarizeEntity(entity,metric,state.year,state.history.asOf)})).filter(({entity})=>normalizeName([entity.name,entity.city,...entity.clientCodes].join(' ')).includes(query)).sort((a,b)=>b.summary.knownTotal-a.summary.knownTotal||a.entity.name.localeCompare(b.entity.name,'pt-BR'));
 const rows=all.slice(0,500).map(({entity,summary})=>{const change=summary.change.percent,latest=summary.series.find(point=>point.isCurrent)||summary.series.filter(point=>!point.isFuture).at(-1),active=selected?.id===entity.id;return '<tr class="entity-row'+(active?' is-selected':'')+'" data-entity-row="'+esc(entity.id)+'" tabindex="0" aria-selected="'+active+'" aria-label="Filtrar gráficos por '+esc(entity.name)+'"><td class="client-cell"><button class="client-button" data-entity="'+esc(entity.id)+'">'+esc(entity.name)+'</button><small>'+esc(entity.city||'Cidade não informada')+' · '+entity.clientCodes.length+' cadastro(s)</small></td><td class="number">'+(summary.monthCount?fmt(summary.knownTotal,metric):'—')+'</td><td class="number">'+fmt(latest?.total,metric)+'</td><td class="number"><span class="'+(change!=null&&change<0?'trend-down':'trend-up')+'">'+(change==null?'—':(change>0?'+':'')+pct(change))+'</span></td><td>'+miniMix(summary.mix)+'</td></tr>';}).join('');
 return '<section class="panel"><div class="panel-heading"><div><h3>'+(state.view==='top'?'Clientes participantes':state.view==='company'?'Clientes da empresa':'Redes acompanhadas')+'</h3></div><span class="registry-count">'+all.length+' '+(state.view==='networks'?'redes':'clientes')+'</span></div><div class="table-wrap"><table class="entity-table"><thead><tr><th>Cliente / grupo</th><th class="number">Realizado no ano</th><th class="number">'+(state.year===CURRENT_YEAR?'Mês atual · parcial':'Dezembro')+'</th><th class="number">Variação mensal</th><th>Mix</th></tr></thead><tbody>'+(rows||'<tr><td colspan="5" style="text-align:center;padding:30px">Nenhum cliente corresponde à busca.</td></tr>')+'</tbody></table></div><div class="table-footer"><span>'+(all.length>500?'Exibindo 500 de '+all.length+'. Refine a busca.':(state.view==='company'?'Todas as categorias':'Arroz, flocão e salgadinho')+' · '+(metric==='sales'?'Reais':'Fardos'))+'</span><span>Comparação com o mês anterior</span></div></section>';
}
function monthlyTable(summary,forecast,metric=state.metric){const categories=state.view==='company'?ALL_CATEGORIES:CATEGORIES;const estimates=new Map(forecast.months.map(point=>[point.month,point]));const rows=summary.series.map((point,index)=>{const estimate=estimates.get(point.month),future=point.isFuture,values=future?estimate?.categories:point.categories,label=future?(estimate?.projected!=null?'Tendência':'Sem tendência'):point.status!=='ok'?'Indisponível':point.isCurrent?'Mês parcial':'Fechado';return '<tr'+(future?' class="estimated-row"':'')+'><td class="client-cell">'+MONTHS[index]+' / '+state.year+'</td>'+categories.map(category=>'<td class="number">'+fmt(values?.[category],metric)+'</td>').join('')+'<td class="number">'+fmt(point.total,metric)+'</td><td class="number">'+(estimate?.status==='estimated'?fmt(estimate.projected,metric):'—')+'</td><td><span class="tag '+(future?'info':point.status!=='ok'?'warn':'')+'">'+label+'</span></td></tr>';}).join('');return '<section class="panel monthly-panel"><div class="panel-heading"><div><h3>Detalhamento mês a mês</h3><p>O mês atual mostra o realizado e a tendência de fechamento.</p></div></div><div class="table-wrap"><table class="monthly-table"><thead><tr><th>Mês</th>'+categories.map(category=>'<th class="number">'+esc(category)+'</th>').join('')+'<th class="number">Total realizado</th><th class="number">Tendência de fechamento</th><th>Referência</th></tr></thead><tbody>'+rows+'</tbody></table></div></section>';}

async function printAnalysis(){
 const button=$('analysis-print');button.disabled=true;
 try{
  if(!isAnalytical(state.view)||!state.history||!state.aux)throw new Error('Carregue os resultados antes de imprimir.');
  const title=TITLES[state.view]+' · '+state.year,reference='<p class="dual-print-reference">Referência da API: '+esc(state.history.asOf.split('-').reverse().join('/'))+(state.query?' · Busca: '+esc(state.query):'')+'</p>';
  const sections=[{title:'Fardos',html:reference+renderAnalysisContent({metric:'fardos',printing:true})},{title:'Valores em R$',html:reference+renderAnalysisContent({metric:'sales',printing:true})}];
  await printDualReport({title,sections});
 }catch(error){showNotice('Não foi possível preparar a impressão: '+error.message);}
 finally{button.disabled=false;}
}
async function toggleMetric(){if(state.flipping)return;const next=state.metric==='sales'?'fardos':'sales',view=$('analysis-content');state.flipping=true;$('unit-toggle').disabled=true;const apply=()=>{state.metric=next;$('unit-toggle').setAttribute('aria-pressed',String(next==='fardos'));document.querySelectorAll('[data-metric]').forEach(node=>node.classList.toggle('chosen',node.dataset.metric===next));renderAnalysis();};const animations=[];try{if(window.matchMedia('(prefers-reduced-motion: reduce)').matches||!view.animate)apply();else{const out=view.animate([{opacity:1,transform:'perspective(1800px) rotateY(0)'},{opacity:0,transform:'perspective(1800px) rotateY(-90deg)'}],{duration:150,easing:'ease-in',fill:'forwards'});animations.push(out);await out.finished;apply();out.cancel();const incoming=view.animate([{opacity:0,transform:'perspective(1800px) rotateY(90deg)'},{opacity:1,transform:'perspective(1800px) rotateY(0)'}],{duration:230,easing:'ease-out',fill:'forwards'});animations.push(incoming);await incoming.finished;}}catch{apply();}finally{animations.forEach(animation=>animation.cancel());state.flipping=false;$('unit-toggle').disabled=false;}}
async function refresh(){if(LOCAL_FILE){showNotice(LOCAL_MESSAGE,false);return;}try{$('refresh').disabled=true;const aux=await loadAuxiliary();state.aux=aux;syncAuxiliary();showNotice('');if(state.view==='registry'){registry.show();if(state.history)await ensureHistory(true);}else if(isAnalytical(state.view)){await ensureHistory(true);await ensureComparisons();if(state.view==='company'&&state.companyPeriod)await applyCompanyPeriod(true);}else if(isCustomerView(state.view)){await planning.load(true);await ensureHistory(true);await ensureComparisons();results.render();}else if(state.view==='no-orders'){await planning.load(true);await noOrders.consult();}else if(state.view==='representatives'){await planning.load(true);await representativeResults.refresh();}else if(state.view==='dashboard'){const frame=$('app-frame');if(frame?.contentWindow&&frame.dataset.preparing!=='true')frame.contentWindow.location.reload();else syncEmbeddedView();}else toast('Cadastros atualizados.');}catch(error){showNotice(error.message);}finally{$('refresh').disabled=false;}}
function downloadJSON(){if(!state.aux)return;const blob=new Blob([JSON.stringify(state.aux,null,2)+'\n'],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='BI_Cadastros_'+saoPauloToday()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.view)));
document.querySelectorAll('[data-registry-tab]').forEach(button=>button.addEventListener('click',()=>{registry.show(button.dataset.registryTab);refreshRegistryCatalog();}));
$('manage-list').addEventListener('click',()=>navigate('registry',true,state.view==='networks'?'networks':'top'));
$('entity-search').addEventListener('input',event=>{state.query=event.target.value;renderAnalysis();});
$('clear-client-filter').addEventListener('click',clearClientFilter);
$('analysis-print').addEventListener('click',printAnalysis);
$('company-date-apply').addEventListener('click',()=>applyCompanyPeriod());
$('company-date-clear').addEventListener('click',clearCompanyPeriod);
$('unit-toggle').addEventListener('click',toggleMetric);$('refresh').addEventListener('click',refresh);
$('menu-toggle').addEventListener('click',()=>{const opened=$('sidebar').classList.toggle('open');$('menu-toggle').setAttribute('aria-expanded',String(opened));});
$('year').innerHTML=Array.from({length:7},(_,i)=>'<option value="'+(CURRENT_YEAR-i)+'">'+(CURRENT_YEAR-i)+'</option>').join('');$('year').value=String(CURRENT_YEAR);
$('year').addEventListener('change',()=>{state.year=Number($('year').value);clearCompanyPeriod();syncCompanyDateControls();state.history=null;state.selected={top:null,networks:null,company:null};renderAnalysis();ensureHistory(true).then(()=>{if(state.view==='registry')registry.refreshSources();if(isAnalytical(state.view)||isCustomerView(state.view))return ensureComparisons();}).then(()=>{if(isCustomerView(state.view))results.show(state.view);}).catch(error=>showNotice(error.message));});
$('export-json').addEventListener('click',downloadJSON);$('import-json').addEventListener('click',()=>$('import-file').click());$('import-file').addEventListener('change',async event=>{try{await registry.importFile(event.target.files[0]);}catch(error){registryNotice('Não foi possível importar: '+error.message,true);}finally{event.target.value='';}});
window.addEventListener('load',syncEmbeddedView,{once:true});
window.addEventListener('focus',refreshForNewDay);
window.addEventListener('focus',()=>representativeResults.refreshForNewDay());
document.addEventListener?.('visibilitychange',()=>representativeResults.refreshForNewDay());
window.setInterval?.(()=>representativeResults.refreshForNewDay(),60000);
document.addEventListener?.('visibilitychange',refreshForNewDay);
window.setInterval?.(refreshForNewDay,60000);
window.addEventListener('message',event=>{const frame=$('app-frame');if(!frame||event.origin!==location.origin||event.source!==frame.contentWindow||!event.data)return;if(event.data.type==='BI_DASHBOARD_READY'){syncAuxiliary();requestDashboardStatus();}if(event.data.type==='BI_DASHBOARD_STATUS'&&DASHBOARD_STATUSES.has(event.data.status)){state.dashboardStatus=event.data.status;renderConnectionStatus();}if(event.data.type==='BI_NAVIGATE'&&event.data.view==='registry')navigate('registry',true,['top','networks','groups','representatives'].includes(event.data.tab)?event.data.tab:'top');});
window.addEventListener('popstate',route);window.addEventListener('hashchange',route);
window.addEventListener('keydown',event=>{if(event.key==='Escape'){$('sidebar').classList.remove('open');$('menu-toggle').setAttribute('aria-expanded','false');}});
async function bootstrap(){if(LOCAL_FILE){for(const id of ['year','unit-toggle','refresh','entity-search','import-json','export-json','import-file'])$(id).disabled=true;showNotice(LOCAL_MESSAGE,false);$('global-notice').className='notice local-preview';syncAuxiliary();route();return;}route();try{state.aux=await loadAuxiliary();syncAuxiliary();renderConnectionStatus();if(state.view==='registry')registry.show();if((isAnalytical(state.view)||state.view==='registry'))await ensureHistory();if(isAnalytical(state.view)){renderAnalysis();await ensureComparisons();}if(isCustomerView(state.view))results.render();}catch(error){showNotice('Cadastros indisponíveis: '+error.message);$('save-indicator').textContent='Falha ao consultar o JSON';}}
bootstrap();


