import {CATEGORIES} from './analytics.js';

const fields=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.prototype.hasOwnProperty.call(value,name));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,99}$/.test(value);
const timestamp=value=>value===null||typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
const safeText=(value,max=500)=>typeof value==='string'&&new TextEncoder().encode(value).length<=max&&!/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value);
const ufs=new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
export function validateGoal(goal){
 if(!fields(goal,['id','topRetailerId','month','metric','categories'])||!id(goal.id)||!id(goal.topRetailerId)||!/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(goal.month)||!['sales','fardos'].includes(goal.metric)||!fields(goal.categories,CATEGORIES))throw new Error('A meta contém campos inválidos.');
 const scale=goal.metric==='sales'?100:1;
 let total=0;
 for(const category of CATEGORIES){const value=goal.categories[category];if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e12||Math.abs(value*scale-Math.round(value*scale))>.0001)throw new Error('Use metas positivas em reais com até dois decimais ou fardos inteiros.');total+=value;}
 if(total<=0)throw new Error('Informe uma meta maior que zero em ao menos uma categoria.');
 return goal;
}
export function validatePlanning(data){
 if(!fields(data,['schemaVersion','revision','updatedAt','goals','clientCatalog'])||data.schemaVersion!==1||!Number.isSafeInteger(data.revision)||data.revision<0||data.revision>2147483646||!timestamp(data.updatedAt)||!Array.isArray(data.goals)||data.goals.length>5000)throw new Error('O planejamento retornou um formato inválido.');
 const ids=new Set(),keys=new Set();
 for(const goal of data.goals){validateGoal(goal);const key=goal.topRetailerId+'|'+goal.month+'|'+goal.metric;if(ids.has(goal.id)||keys.has(key))throw new Error('Há metas repetidas no planejamento.');ids.add(goal.id);keys.add(key);}
 const catalog=data.clientCatalog;
 if(catalog!==null){
  if(!fields(catalog,['source','clients'])||!fields(catalog.source,['name','importedAt','rowCount'])||!safeText(catalog.source.name)||!catalog.source.name.trim()||!timestamp(catalog.source.importedAt)||!Array.isArray(catalog.clients)||!catalog.clients.length||catalog.clients.length>10000||catalog.source.rowCount!==catalog.clients.length)throw new Error('A base de clientes retornou um formato inválido.');
  const codes=new Set();
  for(const client of catalog.clients){if(!fields(client,['code','name','fantasy','city','uf','rep','repCode','status'])||typeof client.code!=='string'||!/^\d{1,30}$/.test(client.code)||codes.has(client.code)||['name','fantasy','city','uf','rep','repCode','status'].some(key=>!safeText(client[key]))||!client.name.trim()||!ufs.has(client.uf)||!client.city.endsWith(' / '+client.uf)||client.repCode!==''&&!/^\d{1,30}$/.test(client.repCode))throw new Error('A base contém um cliente inválido ou repetido.');codes.add(client.code);}
 }
 return data;
}
export class PlanningStore{
 constructor(endpoint){this.endpoint=endpoint;this.data=null;this.error=null;this.pending=null;this.saving=false;}
 async request(options={}){
  if(globalThis.location?.protocol==='file:')throw new Error('Abra o BI no servidor para consultar e salvar metas.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
   const response=await fetch(this.endpoint,{...options,headers:{Accept:'application/json',...options.headers},credentials:'same-origin',cache:'no-store',signal:controller.signal});
   let value;try{value=await response.json();}catch{throw new Error('O servidor não retornou um planejamento válido. Verifique o PHP.');}
   if(!response.ok){const error=new Error(value?.message||value?.error?.message||'Não foi possível consultar o planejamento.');error.status=response.status;error.code=value?.error?.code;error.currentRevision=value?.currentRevision;throw error;}
   return structuredClone(validatePlanning(value));
  }catch(error){if(controller.signal.aborted)throw new Error('A consulta do planejamento demorou mais que o esperado. Tente novamente.');throw error;}
  finally{clearTimeout(timer);}
 }
 async load(force=false){
  if(this.pending)return this.pending;if(this.data&&!force)return this.data;
  this.pending=this.request().then(data=>{if(!this.data||data.revision>=this.data.revision)this.data=data;this.error=null;return this.data;}).catch(error=>{this.error=error;throw error;}).finally(()=>{this.pending=null;});return this.pending;
 }
 async save(next){
  if(!this.data||this.error)throw new Error('Recarregue o planejamento antes de salvar.');
  if(this.saving)throw new Error('Aguarde a gravação em andamento.');
  const baseRevision=this.data.revision,candidate=structuredClone(validatePlanning(next));
  if(candidate.revision!==baseRevision)throw new Error('O planejamento mudou desde a preparação desta alteração. Recarregue e confira os dados antes de salvar.');
  const body=JSON.stringify({baseRevision,data:candidate});
  if(new TextEncoder().encode(body).length>4*1024*1024)throw new Error('O planejamento ultrapassa o limite de 4 MB.');
  this.saving=true;
  try{const result=await this.request({method:'PUT',headers:{'Content-Type':'application/json'},body});if(result.revision!==baseRevision+1)throw new Error('A revisão retornada pelo servidor é inesperada. Recarregue antes de salvar novamente.');this.data=result;this.error=null;return result;}
  catch(error){if(error.status===409)error.message='Outra pessoa alterou as metas ou a base. Recarregue o planejamento antes de salvar; suas alterações não foram enviadas novamente.';throw error;}
  finally{this.saving=false;}
 }
}
