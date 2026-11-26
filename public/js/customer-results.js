import {CATEGORIES,ALL_CATEGORIES,normalizeCode,normalizeName,buildEntities,consolidateEntities,summarizeEntity,forecastEntity,compareAnnual,valueFor,saoPauloToday} from './analytics.js';
import {MONTHS,esc,fmt,pct,lineChart,mixChart,bindChartTooltips,clearChartTooltips} from './charts.js';
import {animateAnalysis,clearAnalysisMotion} from './motion.js';
import {INITIAL_CLIENT_CATALOG} from './client-catalog.js';
import {validateGoal} from './planning-api.js';
import {printDualReport} from './print-report.js';

const sum=(values,metric)=>{const scale=metric==='sales'?100:1000000;return Number(values.reduce((n,value)=>n+BigInt(Math.round(value*scale)),0n))/scale;};
const monthLabel=month=>MONTHS[Number(month.slice(5,7))-1]+' / '+month.slice(0,4);
const dateLabel=value=>String(value||'').slice(0,10).split('-').reverse().join('/');
const card=(label,value,foot='',featured=false)=>'<article class="stat-card'+(featured?' featured':'')+'"><span class="stat-label">'+esc(label)+'</span><strong class="stat-value">'+esc(value)+'</strong><span class="stat-foot">'+esc(foot)+'</span></article>';
const empty=(title,message)=>'<div class="empty-state"><h3>'+esc(title)+'</h3><p>'+esc(message)+'</p></div>';
export function customerEntity(history,codes,name='',categories=ALL_CATEGORIES){
 if(!history?.months)return null;
 const selected=new Set(codes.map(normalizeCode)),months=history.months.map(month=>({...month,clientes:(month.clientes||[]).filter(row=>selected.has(normalizeCode(row.cod_cliente??row.code)))}));
 const entities=buildEntities(months,{},'company'),entity=consolidateEntities(months,entities,ALL_CATEGORIES);
 return {...entity,name,categories,clientCodes:[...selected]};
}
export function goalAchievement(goal,point){
 validateGoal(goal);const metric=goal.metric,actual=point?.status==='ok'?valueFor(point,metric,CATEGORIES):null,total=sum(CATEGORIES.map(category=>goal.categories[category]),metric);
 return {goal:total,actual,share:actual===null?null:actual/total,remaining:actual===null?null:Math.max(0,total-actual),categories:CATEGORIES.map(category=>{const target=goal.categories[category],value=point?.status==='ok'&&typeof point?.[metric]?.[category]==='number'?point[metric][category]:null;return {category,goal:target,actual:value,share:value===null||target===0?null:value/target};})};
}
const validGoalMonth=value=>typeof value==='string'&&/^(?:19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value);
const goalMonthEnd=month=>month+'-'+String(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()).padStart(2,'0');
const nextGoalMonth=month=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,7);
const knownGoalDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
/** Saved monthly goals are immutable anchors. Inherited goals are derived, never
 * appended automatically; a manual goal for a later month starts a new chain.
 */
export function resolveRecurringGoal(record,goals,histories,targetMonth,metric='fardos',asOf=saoPauloToday()){
 if(!validGoalMonth(targetMonth)||!['fardos','sales'].includes(metric)||!knownGoalDate(asOf))throw new Error('Escolha um mês, uma unidade e uma referência válidos para a meta.');
 const anchor=(goals||[]).filter(goal=>goal.topRetailerId===record?.id&&goal.metric===metric&&goal.month<=targetMonth).sort((a,b)=>b.month.localeCompare(a.month))[0];
 if(!anchor)return {goal:null,inherited:false,sourceMonth:null,pendingMonth:null,reason:null,increases:[]};
 validateGoal(anchor);
 const goal={...anchor,month:targetMonth,categories:{...anchor.categories}},inherited=anchor.month!==targetMonth,increases=[];
 if(!inherited)return {goal,inherited:false,sourceMonth:anchor.month,pendingMonth:null,reason:null,increases};
 const known=new Map();for(const history of histories||[])for(const source of history?.months||[])if(!known.has(source.month))known.set(source.month,source);
 let current=anchor.month;
 while(current<targetMonth){
  const source=known.get(current),end=goalMonthEnd(current),reported=source?.updatedAt?.slice(0,10),coverage=[source?.effectiveFim,source?.coveredThrough,source?.fim,reported].filter(knownGoalDate).sort()[0];
  const closed=end<=asOf&&source?.status==='ok'&&(!coverage||knownGoalDate(coverage)&&coverage>=end)&&(!source?.inicio||source.inicio===current+'-01');
  if(!closed)return {goal:null,inherited:true,sourceMonth:anchor.month,pendingMonth:current,reason:'A meta de '+monthLabel(targetMonth)+' depende do fechamento confirmado de '+monthLabel(current)+'.',increases};
  let point;try{point=buildEntities([source],{topRetailers:[record]},'top')[0]?.months[0];}catch{return {goal:null,inherited:true,sourceMonth:anchor.month,pendingMonth:current,reason:'Revise o histórico de '+monthLabel(current)+' antes de apurar a meta recorrente.',increases};}
  const values=point?.status==='ok'?point[metric]:null;
  if(CATEGORIES.some(category=>goal.categories[category]>0&&(!Number.isFinite(values?.[category]))))return {goal:null,inherited:true,sourceMonth:anchor.month,pendingMonth:current,reason:'Faltam valores completos em '+monthLabel(current)+' na unidade da meta.',increases};
  for(const category of CATEGORIES){
   const target=goal.categories[category];if(target<=0||values[category]<target)continue;
   const scale=metric==='sales'?100:1,units=BigInt(Math.round(target*scale)),raised=(units*110n+99n)/100n;
   const value=Number(raised)/scale;if(!Number.isFinite(value)||value>1e12)return {goal:null,inherited:true,sourceMonth:anchor.month,pendingMonth:current,reason:'A meta recorrente ultrapassou o limite permitido; defina um novo valor mensal.',increases};
   goal.categories[category]=value;increases.push({month:current,category,from:target,to:value});
  }
  current=nextGoalMonth(current);
 }
 return {goal,inherited,sourceMonth:anchor.month,pendingMonth:null,reason:null,increases};
}
export function suggestGoalFromHistory(record,histories,targetMonth,metric='fardos',asOf=saoPauloToday()){
 if(!/^(?:19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(targetMonth)||!['fardos','sales'].includes(metric)||!/^\d{4}-\d{2}-\d{2}$/.test(asOf))throw new Error('Escolha um mês, uma unidade e uma data de referência válidos.');
 const anchor=targetMonth<asOf.slice(0,7)?targetMonth:asOf.slice(0,7),year=Number(anchor.slice(0,4)),month=Number(anchor.slice(5,7));
 const basisMonths=[3,2,1].map(back=>{const date=new Date(Date.UTC(year,month-1-back,1));return date.toISOString().slice(0,7);});
 const known=new Map();for(const history of histories||[])for(const point of history?.months||[])if(!known.has(point.month))known.set(point.month,point);
 const unavailable=basisMonths.filter(key=>!known.has(key)||known.get(key).status!=='ok');
 if(!record?.clientCodes?.length)return {available:false,basisMonths,categories:null,reason:'Selecione um cliente Top Varejista cadastrado.'};
 if(unavailable.length)return {available:false,basisMonths,categories:null,reason:'Histórico indisponível em '+unavailable.map(monthLabel).join(', ')+'. Consulte os três meses fechados antes de gerar a sugestão.'};
 const entity=buildEntities(basisMonths.map(key=>known.get(key)),{topRetailers:[record]},'top')[0];
 if(!entity||entity.months.some(point=>valueFor(point,metric,CATEGORIES)===null))return {available:false,basisMonths,categories:null,reason:'Os três meses precisam ter valores completos na unidade selecionada.'};
 const sourceScale=metric==='sales'?100:1000000,goalScale=metric==='sales'?100:1,denominator=3n*BigInt(sourceScale/goalScale);
 const categories=Object.fromEntries(CATEGORIES.map(category=>{const total=entity.months.reduce((n,point)=>n+BigInt(Math.round(point[metric][category]*sourceScale)),0n),rounded=total<=0n?0n:(total*2n+denominator)/(denominator*2n);return [category,Number(rounded)/goalScale];}));
 return {available:true,basisMonths,categories,reason:null,method:'Média aritmética por categoria dos três meses fechados, sem acréscimo de crescimento.'};
}
export class CustomerResults{
 constructor(options){Object.assign(this,options);this.printReport=options.printReport||printDualReport;this.view=null;this.goalMonth=null;this.goalMetric='fardos';this.goalClientId='';this.goalDrafts=new Map();this.renderedGoalKey=null;this.renderedGoalValues=null;this.goalHistories=new Map();this.goalHistoryPending=null;this.editing=null;this.presentationQuery='';this.selected=null;this.metric='fardos';this.visible=false;this.busy=false;this.loadingId=0;}
 catalog(){return this.store.data?.clientCatalog||INITIAL_CLIENT_CATALOG;}
 async show(view){
  this.view=view;this.visible=true;const token=++this.loadingId;this.render();
  try{await this.store.load();}catch(error){this.notice?.(error.message,true);}
  if(!this.visible||token!==this.loadingId)return;this.render();
  try{await this.ensureHistory();await this.ensureGoalHistories();}catch(error){this.notice?.(error.message,true);}
  if(this.visible&&token===this.loadingId)this.render();
 }
 hide(){this.visible=false;this.loadingId++;this.presentationScrollY=null;const container=document.getElementById('customer-results-content');if(container){clearChartTooltips(container);clearAnalysisMotion(container);}document.body.classList.remove('customer-presentation-mode');}
 render(){
  if(!this.visible)return;const container=document.getElementById('customer-results-content');if(!container)return;
  clearChartTooltips(container);clearAnalysisMotion(container);
  if(globalThis.location?.protocol==='file:'){container.innerHTML=empty('Abra o BI pelo servidor','As metas e a apresentação usam o histórico da API e os cadastros compartilhados.');return;}
  try{this.view==='goals'?this.renderGoals(container):this.renderPresentation(container);}catch(error){container.innerHTML=empty('Não foi possível montar esta tela',error.message);}
 }
 targetMonth(){const year=this.getYear(),today=saoPauloToday();if(!this.goalMonth||Number(this.goalMonth.slice(0,4))!==year)this.goalMonth=year+'-'+(year===Number(today.slice(0,4))?today.slice(5,7):'12');return this.goalMonth;}
 topEntities(){const history=this.getHistory(),aux=this.getAux();return history&&aux?buildEntities(history.months,aux,'top'):[];}
 allGoalHistories(){return [this.getHistory(),this.getPreviousHistory?.(),...this.goalHistories.values()].filter(Boolean);}
 goalFor(record,month,metric){const histories=this.allGoalHistories(),asOf=this.getHistory()?.asOf||saoPauloToday();return resolveRecurringGoal(record,this.store.data?.goals||[],histories,month,metric,asOf);}
 async ensureGoalHistories(){
  if(!this.loadGoalHistory)return;if(this.goalHistoryPending)return this.goalHistoryPending;
  const target=this.targetMonth(),records=new Set((this.getAux()?.topRetailers||[]).map(row=>row.id)),latest=new Map();
  for(const goal of this.store.data?.goals||[]){if(!records.has(goal.topRetailerId)||goal.month>target)continue;const key=goal.topRetailerId+'|'+goal.metric,other=latest.get(key);if(!other||goal.month>other.month)latest.set(key,goal);}
  const available=new Set(this.allGoalHistories().map(history=>Number(history.year||history.months?.[0]?.month?.slice(0,4)))),years=new Set();
  for(const goal of latest.values())if(goal.month<target)for(let year=Number(goal.month.slice(0,4));year<=Number(target.slice(0,4));year++)if(!available.has(year))years.add(year);
  if(!years.size)return;
  this.goalHistoryPending=(async()=>{for(const year of [...years].sort()){const history=await this.loadGoalHistory(year);this.goalHistories.set(year,history);}})().finally(()=>{this.goalHistoryPending=null;});
  return this.goalHistoryPending;
 }
 renderGoals(container){
  if(!this.store.data){container.innerHTML='<div class="page-intro"><h2>Metas Top Varejistas</h2><button id="goals-reload" class="button button-light">Recarregar metas</button></div>'+empty(this.store.error?'Planejamento indisponível':'Carregando metas',this.store.error?.message||'Aguarde a leitura das metas compartilhadas.');document.getElementById('goals-reload').addEventListener('click',async()=>{try{await this.store.load(true);this.render();}catch(error){this.notice?.(error.message,true);}});return;}
  if(this.renderedGoalKey&&document.getElementById('goal-form')){const values=CATEGORIES.map((_,index)=>document.getElementById('goal-value-'+index)?.value??'');if(!this.renderedGoalValues||values.some((value,index)=>value!==this.renderedGoalValues[index]))this.goalDrafts.set(this.renderedGoalKey,values);}
  const aux=this.getAux(),records=aux?.topRetailers||[],month=this.targetMonth(),metric=this.goalMetric,goals=this.store.data?.goals||[],history=this.getHistory();
  const exists=records.some(row=>row.id===this.goalClientId);if(!exists)this.goalClientId=records[0]?.id||'';
  const statuses=new Map(records.map(record=>[record.id,this.goalFor(record,month,metric)])),selectedStatus=statuses.get(this.goalClientId),selectedGoal=selectedStatus?.goal,entities=new Map(this.topEntities().map(entity=>[entity.id,entity]));
  const draftKey=this.goalClientId+'|'+month+'|'+metric,draft=this.goalDrafts.get(draftKey);this.renderedGoalKey=draftKey;this.renderedGoalValues=CATEGORIES.map((category,index)=>String(draft?.[index]??selectedGoal?.categories[category]??''));
  const scoped=[...statuses.values()].map(status=>status.goal).filter(Boolean),pending=[...statuses.values()].filter(status=>status.pendingMonth),achievements=scoped.map(goal=>goalAchievement(goal,entities.get(goal.topRetailerId)?.months.find(point=>point.month===month)));
  const totalGoal=pending.length?null:sum(achievements.map(item=>item.goal),metric),complete=!pending.length&&achievements.every(item=>item.actual!==null),actual=complete?sum(achievements.map(item=>item.actual),metric):null;
  const available=Boolean(this.store.data&&!this.store.error&&!this.busy&&records.length);
  const suggestionMessage=this.goalSuggestion?.key===draftKey?this.goalSuggestion.message:'Média dos últimos três meses fechados. A sugestão só é gravada ao clicar em Salvar meta.';
  const recurrenceMessage=selectedStatus?.pendingMonth?selectedStatus.reason:selectedStatus?.inherited?'Meta recorrente herdada de '+monthLabel(selectedStatus.sourceMonth)+'. As categorias atingidas recebem 10% no mês seguinte.':selectedGoal?'Esta meta continua nos próximos meses; cada categoria atingida sobe 10% após o fechamento.':'Defina a primeira meta. Ela continuará nos próximos meses, com aumento de 10% por categoria atingida após o fechamento.';
  const generator='<p class="goal-recurrence-note" role="status">'+esc(recurrenceMessage)+'</p><div class="goal-generator"><button id="goal-generate" class="button button-light" type="button"'+(!available||!history?' disabled':'')+'>Gerar sugestão · 3 meses</button><p id="goal-suggestion-status" role="status">'+esc(suggestionMessage)+'</p></div>';
  container.innerHTML='<div class="page-intro"><div><h2>Metas Top Varejistas</h2><p>Metas mensais por cliente e categoria.</p></div><button id="goals-reload" class="button button-light">Recarregar metas</button></div>'+(!records.length?empty('Adicione os participantes','Cadastre os clientes Top Varejistas para definir suas metas.'):'' )+
   '<div class="stats-grid goals-stats">'+card('Meta da carteira',fmt(totalGoal,metric),scoped.length+' cliente(s) com meta'+(pending.length?' · '+pending.length+' com histórico pendente':'')+' · '+monthLabel(month),true)+card('Realizado com meta',scoped.length?fmt(actual,metric):'—','Somente os clientes com meta neste mês')+card('Atingimento',scoped.length&&actual!==null?pct(actual/totalGoal):'—',metric==='sales'?'Metas e realizado em R$':'Metas e realizado em fardos')+'</div>'+
   '<p class="goal-recurrence-rule">Metas mantidas de um mês para outro. Aumento de 10% somente na categoria atingida no mês anterior fechado, arredondado para o próximo fardo ou centavo.</p><div class="goal-layout"><form class="panel goal-form" id="goal-form"><div class="panel-heading"><h3>'+(selectedGoal?(selectedStatus.inherited?'Ajustar meta recorrente':'Editar meta'):'Definir meta')+'</h3></div><div class="goal-form-body"><div class="field"><label for="goal-client">Cliente Top Varejista</label><select id="goal-client" required>'+records.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===this.goalClientId?' selected':'')+'>'+esc(row.name+' · '+row.city)+'</option>').join('')+'</select></div><div class="field-row"><div class="field"><label for="goal-month">Mês da meta</label><input id="goal-month" type="month" required min="'+this.getYear()+'-01" max="'+this.getYear()+'-12" value="'+month+'"></div><div class="field"><label for="goal-metric">Unidade</label><select id="goal-metric"><option value="fardos"'+(metric==='fardos'?' selected':'')+'>Fardos</option><option value="sales"'+(metric==='sales'?' selected':'')+'>R$</option></select></div></div>'+generator+CATEGORIES.map((category,index)=>'<div class="field"><label for="goal-value-'+index+'">'+esc(category)+'</label><input id="goal-value-'+index+'" type="number" min="0" max="1000000000000" step="'+(metric==='sales'?'.01':'1')+'" required value="'+esc(draft?.[index]??selectedGoal?.categories[category]??'')+'" placeholder="0"></div>').join('')+'<button class="button button-primary" id="goal-save" type="submit"'+(!available?' disabled':'')+'>'+(this.busy?'Salvando…':'Salvar meta')+'</button><p class="goal-save-status" role="status">'+(this.store.error?'Planejamento indisponível: recarregue antes de salvar.':this.store.data?'Gravação compartilhada · revisão '+this.store.data.revision:'Carregando planejamento…')+'</p></div></form><section class="panel"><div class="panel-heading"><h3>Realizado × meta</h3><span class="registry-count">'+monthLabel(month)+'</span></div><div class="table-wrap"><table class="goals-table"><thead><tr><th>Cliente</th><th>Meta</th><th>Realizado</th><th>Atingimento</th><th>Ações</th></tr></thead><tbody>'+records.map(row=>{const status=statuses.get(row.id),goal=status?.goal,progress=goal?goalAchievement(goal,entities.get(row.id)?.months.find(point=>point.month===month)):null;return '<tr><td class="client-cell">'+esc(row.name)+'<small>'+esc(row.city)+'</small>'+(status?.inherited?'<small class="goal-inherited">'+esc(status.pendingMonth?'Histórico pendente desde '+monthLabel(status.pendingMonth):'Meta recorrente · base '+monthLabel(status.sourceMonth))+'</small>':'')+(progress?'<div class="goal-category-summary">'+progress.categories.map(item=>'<span>'+esc(item.category)+': '+fmt(item.actual,metric)+' / '+fmt(item.goal,metric)+'</span>').join('')+'</div>':'')+'</td><td>'+fmt(progress?.goal,metric)+'</td><td>'+fmt(progress?.actual,metric)+'</td><td>'+(progress?pct(progress.share):'<span class="tag">'+(status?.pendingMonth?'Histórico pendente':'Sem meta')+'</span>')+'</td><td><div class="row-actions"><button type="button" data-goal-edit="'+esc(row.id)+'">'+(goal?(status?.inherited?'Ajustar':'Editar'):'Definir')+'</button>'+(goal&&!status?.inherited?'<button type="button" data-goal-remove="'+esc(goal.id)+'">Remover</button>':'')+'</div></td></tr>';}).join('')+'</tbody></table></div>'+(!history?'<p class="goal-history-note">O realizado será exibido quando o histórico terminar de carregar.</p>':'')+'</section></div>';
  document.getElementById('goals-reload').addEventListener('click',async()=>{try{await this.store.load(true);this.goalHistories.clear();await this.ensureGoalHistories();this.goalDrafts.clear();this.renderedGoalKey=null;this.renderedGoalValues=null;this.render();this.notice?.('Metas atualizadas.',false);}catch(error){this.notice?.(error.message,true);}});
  for(const [id,key]of [['goal-client','goalClientId'],['goal-month','goalMonth'],['goal-metric','goalMetric']])document.getElementById(id).addEventListener('change',event=>{this[key]=event.target.value;this.render();});
  document.getElementById('goal-form').addEventListener('submit',event=>this.saveGoal(event));
  document.getElementById('goal-generate')?.addEventListener('click',()=>this.generateSelectedGoal());
  container.querySelectorAll('[data-goal-edit]').forEach(button=>button.addEventListener('click',()=>{this.goalClientId=button.dataset.goalEdit;this.render();document.getElementById('goal-client').focus();}));
  container.querySelectorAll('[data-goal-remove]').forEach(button=>button.addEventListener('click',()=>this.removeGoal(button.dataset.goalRemove)));
  animateAnalysis(container);
 }
 generateSelectedGoal(){
  try{
   const topRetailerId=document.getElementById('goal-client').value,month=document.getElementById('goal-month').value,metric=document.getElementById('goal-metric').value,record=this.getAux()?.topRetailers.find(row=>row.id===topRetailerId),history=this.getHistory();
   const suggestion=suggestGoalFromHistory(record,[history,this.getPreviousHistory?.()],month,metric,history?.asOf||saoPauloToday());
   if(!suggestion.available)throw new Error(suggestion.reason);
   this.goalClientId=topRetailerId;this.goalMonth=month;this.goalMetric=metric;const key=topRetailerId+'|'+month+'|'+metric;
   CATEGORIES.forEach((category,index)=>{document.getElementById('goal-value-'+index).value=String(suggestion.categories[category]);});
   this.goalDrafts.set(key,CATEGORIES.map(category=>String(suggestion.categories[category])));
   const allZero=CATEGORIES.every(category=>suggestion.categories[category]===0);
   this.goalSuggestion={key,message:'Média de '+suggestion.basisMonths.map(monthLabel).join(', ')+' — '+(metric==='sales'?'arredondada em centavos':'arredondada em fardos inteiros')+'. '+(allZero?'O histórico resulta em zero; ajuste ao menos uma categoria antes de salvar.':'Revise os valores e clique em Salvar meta para gravar.')};
   this.render();this.notice?.('Sugestão preenchida. Nenhuma meta foi salva automaticamente.',false);
  }catch(error){this.notice?.(error.message,true);}
 }
 async saveGoal(event){
  event.preventDefault();if(this.busy)return;
  try{
   const aux=this.getAux(),topRetailerId=document.getElementById('goal-client').value,month=document.getElementById('goal-month').value,metric=document.getElementById('goal-metric').value;
   if(!aux?.topRetailers.some(row=>row.id===topRetailerId))throw new Error('Selecione um participante cadastrado.');
   if(Number(month.slice(0,4))!==this.getYear())throw new Error('Escolha um mês do ano selecionado.');
   const categories=Object.fromEntries(CATEGORIES.map((category,index)=>{const field=document.getElementById('goal-value-'+index);if(!field.value.trim())throw new Error('Preencha as três categorias; use zero quando não houver meta.');return [category,Number(field.value)];}));
   const next=structuredClone(this.store.data),existing=next.goals.find(row=>row.topRetailerId===topRetailerId&&row.month===month&&row.metric===metric),goal={id:existing?.id||'goal-'+crypto.randomUUID(),topRetailerId,month,metric,categories};validateGoal(goal);
   if(existing)next.goals[next.goals.indexOf(existing)]=goal;else next.goals.push(goal);
   this.busy=true;document.getElementById('goal-save').disabled=true;await this.store.save(next);this.goalDrafts.delete(topRetailerId+'|'+month+'|'+metric);this.renderedGoalKey=null;this.renderedGoalValues=null;this.notice?.('Meta salva para '+monthLabel(month)+' e usada como base dos próximos meses.',false);
  }catch(error){this.notice?.(error.message,true);}finally{this.busy=false;if(this.visible)this.render();}
 }
 async removeGoal(id){
  if(this.busy||!window.confirm('Remover esta meta mensal? Se houver uma meta anterior, a recorrência dela será retomada.'))return;
  try{this.busy=true;const next=structuredClone(this.store.data);next.goals=next.goals.filter(goal=>goal.id!==id);await this.store.save(next);this.notice?.('Meta removida.',false);}catch(error){this.notice?.(error.message,true);}finally{this.busy=false;if(this.visible)this.render();}
 }
 choices(){
  const tops=(this.getAux()?.topRetailers||[]).map(row=>({key:'top:'+row.id,name:row.name,city:row.city,codes:row.clientCodes,topRetailerId:row.id,kind:'Top Varejista'}));
  const clients=this.catalog().clients.map(row=>({key:'client:'+row.code,name:row.name,city:row.city,codes:[row.code],topRetailerId:null,kind:row.fantasy||'Cliente'}));
  return [...tops,...clients];
 }
 renderPresentation(container){
  const history=this.getHistory(),metric=this.metric,year=this.getYear();
  container.innerHTML='<div class="page-intro no-customer-print"><div><h2>Apresentação de resultados</h2><p>Selecione um cliente para preparar sua reunião.</p></div><button class="button button-light" id="presentation-exit" hidden>Sair da apresentação</button></div><section class="panel customer-picker no-customer-print"><div class="field"><label for="presentation-search">Cliente, cidade ou código</label><input id="presentation-search" type="search" autocomplete="off" value="'+esc(this.presentationQuery)+'" placeholder="Pesquisar cliente ou Top Varejista" aria-controls="presentation-suggestions"></div><div class="field"><label for="presentation-metric">Unidade</label><select id="presentation-metric"><option value="fardos"'+(metric==='fardos'?' selected':'')+'>Fardos</option><option value="sales"'+(metric==='sales'?' selected':'')+'>R$</option></select></div><button class="button button-light" id="presentation-clear"'+(!this.selected&&!this.presentationQuery?' disabled':'')+'>Limpar cliente</button><div class="customer-suggestions" id="presentation-suggestions"></div></section><div id="customer-report">'+(!this.selected?empty('Escolha o cliente da apresentação','Os resultados de outros clientes não aparecem no relatório individual.'):!history?empty('Carregando o histórico','A apresentação será montada com os dados da API.'):this.presentationMarkup(history,metric,year))+'</div>';
  document.getElementById('presentation-search').addEventListener('input',event=>{this.presentationQuery=event.target.value;this.renderSuggestions();});
  document.getElementById('presentation-metric').addEventListener('change',event=>{this.metric=event.target.value;this.render();});
  document.getElementById('presentation-clear').addEventListener('click',()=>{this.selected=null;this.presentationQuery='';document.body.classList.remove('customer-presentation-mode');this.render();});
  document.getElementById('presentation-exit').addEventListener('click',()=>this.setPresenting(false));
  document.getElementById('presentation-print')?.addEventListener('click',()=>this.printPresentation());
  document.getElementById('presentation-start')?.addEventListener('click',()=>this.setPresenting(true));
  this.renderSuggestions();bindChartTooltips(container);animateAnalysis(container);
 }
 renderSuggestions(){
  const container=document.getElementById('presentation-suggestions');if(!container)return;const query=normalizeName(this.presentationQuery);
  if(query.length<2){container.innerHTML='';return;}
  const rows=this.choices().filter(row=>normalizeName([row.name,row.city,row.kind,...row.codes].join(' ')).includes(query)).slice(0,25);
  container.innerHTML=rows.length?rows.map(row=>'<button type="button" data-presentation-client="'+esc(row.key)+'"><strong>'+esc(row.name)+'</strong><span>'+esc(row.city)+' · Cód. '+esc(row.codes.join(', '))+' · '+esc(row.kind)+'</span></button>').join(''):'<p>Nenhum cliente encontrado.</p>';
  container.querySelectorAll('[data-presentation-client]').forEach(button=>button.addEventListener('click',()=>{this.selected=this.choices().find(row=>row.key===button.dataset.presentationClient);this.presentationQuery='';this.render();}));
 }
 setPresenting(active){if(!this.selected)return;if(active&&this.presentationScrollY==null)this.presentationScrollY=window.scrollY||0;document.body.classList.toggle('customer-presentation-mode',active);const exit=document.getElementById('presentation-exit');if(exit)exit.hidden=!active;window.scrollTo?.({top:active?0:this.presentationScrollY||0,left:0,behavior:'auto'});if(!active)this.presentationScrollY=null;}
 async printPresentation(){
  try{const history=this.getHistory();if(!this.selected||!history)throw new Error('Selecione o cliente e aguarde o histórico antes de imprimir.');const year=this.getYear();await this.printReport({title:'Distribuidora Demo · '+this.selected.name+' · '+year,sections:[{title:'Fardos',html:this.presentationMarkup(history,'fardos',year)},{title:'R$',html:this.presentationMarkup(history,'sales',year)}]});}
  catch(error){this.notice?.(error.message,true);}
 }
 presentationMarkup(history,metric,year){
  const choice=this.selected,entity=customerEntity(history,choice.codes,choice.name),summary=summarizeEntity(entity,metric,year,history.asOf),forecast=forecastEntity(entity,metric,year,history.asOf),previousHistory=this.getPreviousHistory?.(),previousPeriod=this.getPreviousPeriod?.();
  const priorEntity=previousHistory?customerEntity(previousHistory,choice.codes,choice.name):null,priorSeries=priorEntity?summarizeEntity(priorEntity,metric,year-1,history.asOf).series:[];
  const exactPrior=previousPeriod?customerEntity({months:[previousPeriod]},choice.codes,choice.name):null,annual=compareAnnual(entity,exactPrior,metric,year,history.asOf),current=summary.series.find(point=>point.isCurrent),currentMonth=history.asOf.slice(0,7),isCurrentYear=Number(currentMonth.slice(0,4))===year;
  const top=this.getAux()?.topRetailers.find(row=>row.id===choice.topRetailerId||row.clientCodes.length===choice.codes.length&&row.clientCodes.every(code=>choice.codes.includes(code))),goalStatus=top?this.goalFor(top,isCurrentYear?currentMonth:year+'-12',metric):null,goal=goalStatus?.goal;
  const goalEntity=top?buildEntities(history.months,this.getAux(),'top').find(row=>row.id===top.id):null,progress=goal?goalAchievement(goal,goalEntity?.months.find(point=>point.month===goal.month)):null;
  const rows=summary.series.map((point,index)=>{const prior=priorSeries[index];return '<tr><td>'+MONTHS[index]+'</td><td>'+fmt(point.total,metric)+'</td><td>'+fmt(prior?.total,metric)+'</td>'+ALL_CATEGORIES.map(category=>'<td>'+fmt(point.categories?.[category],metric)+'</td>').join('')+'</tr>';}).join('');
  return '<article class="customer-report-sheet"><header class="customer-report-header"><img src="assets/logo.svg" alt="BI Comercial Demo" width="142" height="71"><div><span>RESULTADOS COMERCIAIS · '+year+'</span><h2>'+esc(choice.name)+'</h2><p>'+esc(choice.city)+' · Cód. '+esc(choice.codes.join(', '))+'</p></div></header><div class="customer-report-actions no-customer-print"><button id="presentation-start" class="button button-primary">Apresentar</button><button id="presentation-print" class="button button-light">Imprimir / PDF</button></div><div class="customer-report-period">Resultados até '+dateLabel(annual.periods.current.fim)+' · '+(metric==='sales'?'Reais':'Fardos')+'</div><div class="stats-grid customer-report-stats">'+card('Realizado no ano',fmt(summary.complete?summary.total:null,metric),summary.complete?'Compras registradas no período':'Há meses indisponíveis',true)+card('Evolução anual',pct(annual.percent),annual.reason||'Mesmo intervalo do ano anterior')+card(isCurrentYear?'Tendência do mês':'Realizado em dezembro',fmt(isCurrentYear?forecast.currentMonth?.projected:summary.series[11]?.total,metric),isCurrentYear?'Realizado: '+fmt(current?.total,metric):'Ano encerrado')+card(isCurrentYear?'Tendência até dezembro':'Resultado do ano',fmt(forecast.yearEnd?.projected,metric),forecast.yearEnd?.reason||'Com base no histórico')+'</div><div class="analysis-grid customer-report-charts"><section class="panel"><div class="panel-heading"><h3>Evolução das compras</h3><span class="small-label">'+year+' e '+(year-1)+'</span></div><div class="chart-container">'+lineChart(summary.series,forecast,metric,{priorSeries,priorYear:year-1})+'</div><div class="chart-legend"><span><i class="legend-dot"></i>'+year+'</span><span><i class="legend-dot previous"></i>'+(year-1)+'</span><span><i class="legend-dot estimate"></i>Tendência</span></div></section><section class="panel"><div class="panel-heading"><h3>Mix de produtos</h3></div>'+mixChart(summary.mix,metric)+'</section></div>'+(progress?'<section class="panel customer-goal-panel"><div class="panel-heading"><h3>Meta de '+monthLabel(goal.month)+(goalStatus?.inherited?' · recorrente':'')+'</h3><span class="registry-count">Atingimento: '+pct(progress.share)+'</span></div><div class="customer-goal-categories">'+progress.categories.map(item=>'<div><strong>'+esc(item.category)+'</strong><span>'+fmt(item.actual,metric)+' <small>/ '+fmt(item.goal,metric)+'</small></span><em>'+pct(item.share)+'</em></div>').join('')+'</div></section>':goalStatus?.pendingMonth?'<section class="panel customer-goal-panel"><div class="panel-heading"><h3>Meta recorrente · histórico pendente</h3></div><p class="goal-history-note">'+esc(goalStatus.reason)+'</p></section>':'')+'<section class="panel customer-monthly-panel"><div class="panel-heading"><h3>Compras mês a mês</h3></div><div class="table-wrap"><table><thead><tr><th>Mês</th><th>'+year+'</th><th>'+(year-1)+'</th>'+ALL_CATEGORIES.map(category=>'<th>'+esc(category)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div></section><footer class="customer-report-footer">Fonte: faturamento fictício gerado para a demonstração. Tendências são cenários indicativos, sujeitos a mudanças no ritmo de compras.</footer></article>';
 }
}
