import {normalizeCode,normalizeName,eligibleClient,resolveIdentity} from './analytics.js';
import {esc} from './charts.js';
import {representativeAlias,validateRepresentativeAliasEntries} from './representative-aliases.js';

const fields={top:'topRetailers',networks:'largeNetworks',groups:'clientGroups',representatives:'representativeAliases'};
const labels={top:'Top Varejistas',networks:'Grandes redes',groups:'Agrupamentos',representatives:'Representantes'};
const id=()=>globalThis.crypto?.randomUUID?.()||'cadastro-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
export const parseCodes=text=>[...new Set(String(text||'').split(/[,;\s]+/).filter(Boolean).map(normalizeCode))];
export function catalogFromHistory(history){const catalog=new Map();for(const month of history?.months||[])if(month.status==='ok')for(const row of month.clientes){const code=normalizeCode(row.cod_cliente),previous=catalog.get(code);catalog.set(code,{...row,hasEligibleHistory:Boolean(previous?.hasEligibleHistory||eligibleClient(row))});}return [...catalog.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||a.city.localeCompare(b.city,'pt-BR'));}
const sourceLabel=row=>row.name+' · '+row.city+' · Cód. '+normalizeCode(row.cod_cliente);
/** A nickname belongs to an exact representative code, never to a similar name. */
export function registryRepresentativeOptions(aux,history,catalog){
 const byCode=new Map(),add=(rawCode,rawName)=>{const value=String(rawCode??'').trim();if(!/^\d{1,30}$/.test(value))return;const code=normalizeCode(value),name=typeof rawName==='string'?rawName.trim():'';if(!byCode.has(code)||name)byCode.set(code,{code,name:name||byCode.get(code)?.name||'Representante código '+code});};
 for(const month of [...(history?.months||[])].sort((a,b)=>String(a.month).localeCompare(String(b.month))))if(month.status==='ok')for(const row of month.clientes||[])add(row.cod_rep,row.rep);
 for(const row of catalog?.clients||aux?.clientCatalog?.clients||[])add(row.repCode,row.rep);
 for(const row of aux?.representativeAliases||[])if(!byCode.has(normalizeCode(row.code)))add(row.code,'');
 return [...byCode.values()].map(row=>({...row,alias:representativeAlias(row.code,aux)})).sort((a,b)=>(a.alias||a.name).localeCompare(b.alias||b.name,'pt-BR')||a.code.localeCompare(b.code,'pt-BR',{numeric:true}));
}
/** View the identities already used by the dashboard without copying or changing rules. */
export function registryGroupings(aux,history){
 const catalog=catalogFromHistory(history),codes=values=>[...new Set(values.map(normalizeCode))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}));
 const explicit=(aux.clientGroups||[]).map(row=>({...row,source:'group',sourceId:row.id,clientCodes:[...row.clientCodes],observedCodes:[]}));
 const byCode=new Map(catalog.map(row=>[normalizeCode(row.cod_cliente),row])),independent=new Set((aux.independentClientCodes||[]).map(normalizeCode));
 const networks=(aux.largeNetworks||[]).map(row=>({...row,source:'network',sourceId:row.id,clientCodes:row.clientCodes.filter(code=>!independent.has(normalizeCode(code))&&!(row.excludedClientCodes||[]).map(normalizeCode).includes(normalizeCode(code))&&(!byCode.has(normalizeCode(code))||resolveIdentity(byCode.get(normalizeCode(code)),aux).networkId===row.id)),observedCodes:[]}));
 const groupsById=new Map(explicit.map(row=>[row.id,row])),networksById=new Map(networks.map(row=>[row.id,row])),derived=new Map(),sameNames=new Map();
 for(const row of catalog){
  const identity=resolveIdentity(row,aux),code=normalizeCode(row.cod_cliente);
  if(groupsById.has(identity.groupId))groupsById.get(identity.groupId).observedCodes.push(code);
  if(networksById.has(identity.networkId))networksById.get(identity.networkId).observedCodes.push(code);
  else if(identity.networkId){
   if(!derived.has(identity.networkId))derived.set(identity.networkId,{id:'network-source:'+identity.networkId,name:identity.networkName,source:'api',sourceId:identity.networkId,clientCodes:[],observedCodes:[],namePatterns:[]});
   derived.get(identity.networkId).observedCodes.push(code);
  }
  if(identity.groupId)continue;
  const key=JSON.stringify([normalizeName(row.name).replace(/\bS A$/,'SA'),normalizeName(row.city)]);
  if(!sameNames.has(key))sameNames.set(key,{id:'same-name:'+key,name:row.name,city:row.city,source:'same-name',sourceId:key,clientCodes:[],observedCodes:[],namePatterns:[]});
  sameNames.get(key).observedCodes.push(code);
 }
 return [...explicit,...networks,...derived.values(),...[...sameNames.values()].filter(row=>codes(row.observedCodes).length>1)].map(row=>({...row,clientCodes:codes([...row.clientCodes,...row.observedCodes]),observedCodes:codes(row.observedCodes)}));
}
export function validateRegistryDraft(data,tab,row,history){
 if(!row.name?.trim())throw new Error('Informe o nome.');
 if(row.name.length>160)throw new Error('Use até 160 caracteres no nome.');
 const codes=row.clientCodes||[];
 if(codes.some(code=>!/^\d{1,30}$/.test(code)))throw new Error('Use somente códigos numéricos de cliente, separados por vírgula.');
 if(!codes.length&&!row.namePatterns?.length)throw new Error('Informe ao menos um código de cliente.');
 for(const entry of data[fields[tab]])if(entry.id!==row.id&&entry.clientCodes.some(code=>codes.includes(normalizeCode(code))))throw new Error('Um desses códigos já pertence a outro cadastro desta lista. Edite o cadastro existente.');
 if(tab==='top'){
  if(codes.includes('990')||['DISTRIBUIDORA PARCEIRA LTDA','DISTRIBUIDORA PARCEIRA'].includes(normalizeName(row.name)))throw new Error('DISTRIBUIDORA PARCEIRA LTDA está excluída do programa e das análises.');
  if(!row.city?.trim())throw new Error('Informe a cidade / UF.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(row.acceptedAt)||Number.isNaN(Date.parse(row.acceptedAt+'T00:00:00Z'))||new Date(row.acceptedAt+'T00:00:00Z').toISOString().slice(0,10)!==row.acceptedAt)throw new Error('Informe uma data de aceite válida.');
  const catalog=catalogFromHistory(history),matched=catalog.filter(c=>codes.includes(normalizeCode(c.cod_cliente)));
  if(matched.length&&matched.every(c=>!c.hasEligibleHistory)&&history?.months?.every(m=>m.status==='ok'))throw new Error('Os cadastros informados têm somente Outros ou não têm compras das três categorias neste ano. Eles não participam da lista Top Varejista.');
 }
 return row;
}

export class Registry{
 constructor({getAux,getHistory,getCatalog=()=>null,save,today,notice,requestHistory}){Object.assign(this,{getAux,getHistory,getCatalog,save,today,notice,requestHistory});this.tab='top';this.editing=null;this.query='';this.repQuery='';this.repPickerQuery='';this.saving=false;}
 show(tab=this.tab){if(!fields[tab])tab='top';const changed=tab!==this.tab;this.tab=tab;if(changed)this.editing=null;document.querySelectorAll('[data-registry-tab]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.registryTab===tab)));this.render();}
 refreshSources(){if(this.tab==='representatives'){this.renderRepresentativePicker();this.renderRepresentativeRows();return;}const catalog=catalogFromHistory(this.getHistory()).filter(row=>this.tab!=='top'||row.hasEligibleHistory),options=document.getElementById('registry-sources');if(options)options.innerHTML=catalog.map(row=>'<option value="'+esc(sourceLabel(row))+'"></option>').join('');const help=document.getElementById('registry-source-help');if(help)help.textContent=catalog.length+' cadastros disponíveis. Selecione uma sugestão.';if(this.tab==='groups')this.renderRows();}
 render(){
  if(globalThis.location?.protocol==='file:'){document.getElementById('registry-content').innerHTML='<div class="empty-state"><h3>'+esc(labels[this.tab])+' no servidor</h3><p>Para consultar e editar esta lista, abra o endereço do BI na hospedagem com PHP. Assim as alterações são gravadas no mesmo JSON para toda a equipe.</p><p>O arquivo JSON não foi lido nem alterado nesta pré-visualização.</p></div>';return;}
  const aux=this.getAux(),container=document.getElementById('registry-content');if(!aux){container.innerHTML='<div class="empty-state"><h3>Cadastros indisponíveis</h3><p>Não foi possível ler o arquivo JSON. Verifique a hospedagem PHP e tente atualizar.</p></div>';return;}
  if(this.tab==='representatives'){this.renderRepresentatives();return;}
  const list=aux[fields[this.tab]],entry=list.find(row=>row.id===this.editing),top=this.tab==='top',network=this.tab==='networks';
  const catalog=catalogFromHistory(this.getHistory()).filter(row=>!top||row.hasEligibleHistory),options=catalog.map(row=>'<option value="'+esc(sourceLabel(row))+'"></option>').join('');
  const help=top?'Um participante pode reunir vários códigos. Só arroz, flocão e salgadinho entram no acompanhamento.':network?'Os códigos e as regras de nomes confirmadas identificam a rede. Os clientes independentes têm prioridade.':'Una os códigos que pertencem ao mesmo cliente. Um agrupamento comum não transforma o cliente em grande rede.';
  container.innerHTML='<div class="registry-layout"><form id="registry-form" class="panel registry-form"><span class="eyebrow">'+(entry?'Editar cadastro':'Novo cadastro')+'</span><h3>'+(entry?esc(entry.name):top?'Adicionar participante':network?'Cadastrar grande rede':'Agrupar clientes')+'</h3><div class="field"><label for="registry-source">Pesquisar na base consultada</label><input id="registry-source" type="search" list="registry-sources" placeholder="Nome, cidade ou código" autocomplete="off"><datalist id="registry-sources">'+options+'</datalist><small id="registry-source-help">'+(catalog.length?catalog.length+' cadastros disponíveis. Selecione uma sugestão.':'O histórico ainda não foi consultado.')+'</small><button type="button" id="registry-load-source" class="button button-light button-small" style="margin-top:9px">Consultar base de clientes</button></div><div class="field"><label for="registry-name">'+(top?'Cliente / rede':'Nome do '+(network?'grupo de grande rede':'agrupamento'))+' *</label><input id="registry-name" maxlength="160" required value="'+esc(entry?.name||'')+'"></div><div class="field"><label for="registry-codes">Códigos dos clientes '+(entry?.namePatterns?.length?'':'*')+'</label><textarea id="registry-codes" placeholder="Ex.: 123, 456, 789">'+esc(entry?.clientCodes?.join(', ')||'')+'</textarea><small>Separe os códigos por vírgula. Use os códigos da API, sem CNPJ.</small></div>'+(top?'<div class="field-row"><div class="field"><label for="registry-city">Cidade / UF *</label><input id="registry-city" maxlength="160" required value="'+esc(entry?.city||'')+'" placeholder="Teresina / PI"></div><div class="field"><label for="registry-date">Data do aceite *</label><input id="registry-date" type="date" required value="'+esc(entry?.acceptedAt||this.today())+'"></div></div><div class="field"><label for="registry-rep">Representante</label><input id="registry-rep" maxlength="180" value="'+esc(entry?.rep||'')+'"></div><div class="field"><label for="registry-notes">Observações</label><textarea id="registry-notes" maxlength="1200">'+esc(entry?.notes||'')+'</textarea></div>':'')+(network?'<div class="field"><label for="registry-excluded">Códigos que ficam fora desta rede</label><input id="registry-excluded" value="'+esc(entry?.excludedClientCodes?.join(', ')||'')+'" placeholder="Opcional"></div>':'')+(entry?.namePatterns?.length?'<p class="method-note">'+entry.namePatterns.length+' regra(s) de nomes confirmadas serão preservadas.</p>':'')+'<p class="method-note" style="margin:0 0 18px">'+help+'</p><div class="button-row"><button type="submit" class="button button-primary" id="registry-save">'+(entry?'Salvar alterações':'Adicionar à lista')+'</button>'+(entry?'<button type="button" class="button button-light" id="registry-cancel">Cancelar</button>':'')+'</div></form><section class="panel"><div class="panel-heading"><div><h3>'+labels[this.tab]+'</h3><p>Gravação compartilhada no servidor</p></div><span class="registry-count" id="registry-count">'+(this.tab==='groups'?registryGroupings(aux,this.getHistory()).length+' agrupamentos':list.length+' cadastros')+'</span></div><div class="registry-search"><input id="registry-search" type="search" value="'+esc(this.query)+'" placeholder="Pesquisar nesta lista" aria-label="Pesquisar cadastros"></div><div class="table-wrap"><table class="registry-table"><thead><tr><th>Cliente / grupo</th><th>'+(top?'Cidade / aceite':'Identificação')+'</th><th>Ações</th></tr></thead><tbody id="registry-rows"></tbody></table></div>'+(this.tab==='networks'?'<div class="registry-tools"><strong style="font-size:11px;color:var(--navy)">Exceções de classificação</strong><p>Códigos abaixo serão tratados como independentes, mesmo que a API os marque como grande rede.</p><label class="field"><input id="independent-codes" placeholder="Códigos independentes, separados por vírgula" value="'+esc(aux.independentClientCodes.join(', '))+'" aria-label="Códigos independentes"></label><button class="button button-light button-small" id="save-independent">Salvar exceções</button></div>':'')+'</section></div>';
  this.renderRows();
  document.getElementById('registry-form').addEventListener('submit',event=>this.submit(event));
  document.getElementById('registry-cancel')?.addEventListener('click',()=>{this.editing=null;this.render();});
  document.getElementById('registry-source').addEventListener('change',()=>this.chooseSource(catalogFromHistory(this.getHistory()).filter(row=>this.tab!=='top'||row.hasEligibleHistory)));
  document.getElementById('registry-load-source').addEventListener('click',async()=>{const button=document.getElementById('registry-load-source');button.disabled=true;try{await this.requestHistory();this.refreshSources();}catch(error){this.notice(error.message,true);}finally{button.disabled=false;}});
  document.getElementById('registry-search').addEventListener('input',event=>{this.query=event.target.value;this.renderRows();});
  document.getElementById('save-independent')?.addEventListener('click',()=>this.saveIndependent());
 }
 representativeOptions(){return registryRepresentativeOptions(this.getAux(),this.getHistory(),this.getCatalog());}
 renderRepresentatives(){
  const options=this.representativeOptions(),selected=options.find(row=>row.code===this.editing);
  this.repAliasCode=selected?.code||'';this.repPickerQuery='';
  document.getElementById('registry-content').innerHTML='<div class="registry-layout rep-alias-layout"><form id="rep-alias-form" class="panel registry-form"><span class="eyebrow">Identificação</span><h3>'+(selected?'Editar apelido':'Apelido do representante')+'</h3><div class="field"><label for="rep-alias-source">Pesquisar representante</label><input id="rep-alias-source" type="search" placeholder="Nome, código ou apelido" autocomplete="off"></div><div class="field"><label for="rep-alias-picker">Representante *</label><select id="rep-alias-picker" required></select><small id="rep-alias-source-help"></small><button type="button" id="rep-alias-load" class="button button-light button-small">Atualizar representantes</button></div><div class="field-row"><div class="field"><label for="rep-alias-code">Código</label><input id="rep-alias-code" readonly value="'+esc(selected?.code||'')+'"></div><div class="field"><label for="rep-alias-original">Nome original</label><input id="rep-alias-original" readonly value="'+esc(selected?.name||'')+'"></div></div><div class="field"><label for="rep-alias-name">Apelido *</label><input id="rep-alias-name" maxlength="80" required value="'+esc(selected?.alias||'')+'" placeholder="Como deseja identificar o representante"><small>O código e o nome original são preservados.</small></div><div class="button-row"><button class="button button-primary" id="registry-save" type="submit">Salvar apelido</button>'+(selected?'<button class="button button-light" id="rep-alias-cancel" type="button">Cancelar</button>':'')+'</div></form><section class="panel rep-alias-list"><div class="panel-heading"><div><h3>Representantes</h3><p>Nomes originais e apelidos</p></div><span class="registry-count" id="rep-alias-count"></span></div><div class="registry-search"><input id="rep-alias-search" type="search" value="'+esc(this.repQuery)+'" placeholder="Pesquisar nome, código ou apelido" aria-label="Pesquisar representantes"></div><div class="table-wrap"><table class="registry-table rep-alias-table"><thead><tr><th>Representante / código</th><th>Apelido</th><th>Ações</th></tr></thead><tbody id="rep-alias-rows"></tbody></table></div></section></div>';
  this.renderRepresentativePicker();this.renderRepresentativeRows();
  document.getElementById('rep-alias-source').addEventListener('input',event=>{this.repPickerQuery=event.target.value;this.renderRepresentativePicker();});
  document.getElementById('rep-alias-picker').addEventListener('change',event=>this.selectRepresentative(event.target.value));
  document.getElementById('rep-alias-search').addEventListener('input',event=>{this.repQuery=event.target.value;this.renderRepresentativeRows();});
  document.getElementById('rep-alias-form').addEventListener('submit',event=>this.submitRepresentativeAlias(event));
  document.getElementById('rep-alias-cancel')?.addEventListener('click',()=>{this.editing=null;this.render();});
  document.getElementById('rep-alias-load').addEventListener('click',async()=>{const button=document.getElementById('rep-alias-load');button.disabled=true;try{await this.requestHistory?.();this.refreshSources();}catch(error){this.notice(error.message,true);}finally{button.disabled=false;}});
 }
 renderRepresentativePicker(){
  const picker=document.getElementById('rep-alias-picker');if(!picker)return;
  const query=normalizeName(this.repPickerQuery),all=this.representativeOptions(),matches=all.filter(row=>normalizeName([row.code,row.name,row.alias].join(' ')).includes(query)),selected=all.find(row=>row.code===this.repAliasCode),list=selected&&!matches.some(row=>row.code===selected.code)?[selected,...matches]:matches;
  picker.innerHTML='<option value="">Selecione o representante</option>'+list.map(row=>'<option value="'+esc(row.code)+'">'+esc(row.name)+' · Cód. '+esc(row.code)+(row.alias?' · '+esc(row.alias):'')+'</option>').join('');picker.value=this.repAliasCode||'';
  document.getElementById('rep-alias-source-help').textContent=all.length?matches.length+' de '+all.length+' representantes na base.':'Nenhum representante com código disponível. Atualize a base.';
 }
 selectRepresentative(code){
  const row=this.representativeOptions().find(item=>item.code===code);this.repAliasCode=row?.code||'';
  document.getElementById('rep-alias-code').value=row?.code||'';document.getElementById('rep-alias-original').value=row?.name||'';document.getElementById('rep-alias-name').value=row?.alias||'';
 }
 renderRepresentativeRows(){
  const target=document.getElementById('rep-alias-rows');if(!target)return;
  const all=this.representativeOptions(),query=normalizeName(this.repQuery),list=all.filter(row=>normalizeName([row.code,row.name,row.alias].join(' ')).includes(query));
  document.getElementById('rep-alias-count').textContent=list.length+' de '+all.length;
  target.innerHTML=list.length?list.map(row=>'<tr><td class="client-cell">'+esc(row.name)+'<small>Cód. '+esc(row.code)+'</small></td><td>'+(row.alias?'<span class="rep-alias-label">'+esc(row.alias)+'</span>':'<span class="rep-alias-unset">Nome original</span>')+'</td><td><div class="row-actions"><button type="button" data-rep-alias-edit="'+esc(row.code)+'">'+(row.alias?'Editar':'Definir apelido')+'</button>'+(row.alias?'<button type="button" data-rep-alias-remove="'+esc(row.code)+'">Restaurar nome original</button>':'')+'</div></td></tr>').join(''):'<tr><td colspan="3" class="rep-alias-empty">'+(all.length?'Nenhum representante nesta busca.':'Atualize a base para consultar os representantes.')+'</td></tr>';
  document.querySelectorAll('[data-rep-alias-edit]').forEach(button=>button.addEventListener('click',()=>{this.editing=button.dataset.repAliasEdit;this.render();document.getElementById('rep-alias-name').focus();}));
  document.querySelectorAll('[data-rep-alias-remove]').forEach(button=>button.addEventListener('click',()=>this.removeRepresentativeAlias(button.dataset.repAliasRemove)));
 }
 async submitRepresentativeAlias(event){
  event.preventDefault();const code=this.repAliasCode,data=structuredClone(this.getAux());
  if(!this.representativeOptions().some(row=>row.code===code)){this.notice('Selecione um representante pelo nome e código.',true);return;}
  try{data.representativeAliases=validateRepresentativeAliasEntries([...(data.representativeAliases||[]).filter(row=>normalizeCode(row.code)!==code),{code,alias:document.getElementById('rep-alias-name').value}]);}catch(error){this.notice(error.message,true);return;}
  await this.commit(data,'Apelido salvo para toda a equipe.');
 }
 async removeRepresentativeAlias(code){
  const data=structuredClone(this.getAux()),entry=(data.representativeAliases||[]).find(row=>normalizeCode(row.code)===code);if(!entry||!window.confirm('Restaurar o nome original do representante '+code+'?'))return;
  data.representativeAliases=data.representativeAliases.filter(row=>normalizeCode(row.code)!==code);await this.commit(data,'Nome original restaurado.');
 }
 renderRows(){
  const data=this.getAux(),query=normalizeName(this.query),top=this.tab==='top',all=this.tab==='groups'?registryGroupings(data,this.getHistory()):data[fields[this.tab]],list=all.filter(row=>normalizeName([row.name,row.city,...row.clientCodes].join(' ')).includes(query));
  const count=document.getElementById('registry-count');if(count)count.textContent=all.length+(this.tab==='groups'?' agrupamentos':' cadastros');
  this.groupingRows=all;
  document.getElementById('registry-rows').innerHTML=list.length?list.map(row=>{
   const source=row.source,derived=source&&source!=='group',sourceTag=source==='network'?'Grande rede':source==='api'?'Rede informada pela API':source==='same-name'?'Mesmo nome e cidade':null;
   const detail=top?esc(row.city)+'<br><small>'+esc(row.acceptedAt.split('-').reverse().join('/'))+'</small>':sourceTag?'<span class="tag info">'+sourceTag+'</span>'+(row.city?'<small>'+esc(row.city)+'</small>':''):row.namePatterns?.length?'<span class="tag info">Regra confirmada</span>':'<span class="tag">Por código</span>';
   const actions=derived?'<button data-grouping-open="'+esc(row.id)+'">'+(source==='network'?'Editar rede':source==='api'?'Cadastrar rede':'Cadastrar grupo')+'</button>':'<button data-edit="'+esc(row.id)+'">Editar</button><button data-remove="'+esc(row.id)+'">Remover</button>';
   return '<tr><td class="client-cell">'+esc(row.name)+'<small>'+(row.clientCodes.length?'Cód. '+esc(row.clientCodes.join(', ')):(row.namePatterns?.length||0)+' regra(s) de nomes')+'</small></td><td>'+detail+'</td><td><div class="row-actions">'+actions+'</div></td></tr>';
  }).join(''):'<tr><td colspan="3" style="padding:32px;text-align:center">'+(all.length?'Nenhum resultado nesta busca.':'Nenhum cadastro nesta lista.')+'</td></tr>';
  document.querySelectorAll('[data-edit]').forEach(button=>button.addEventListener('click',()=>{this.editing=button.dataset.edit;this.render();document.getElementById('registry-name').focus();}));
  document.querySelectorAll('[data-remove]').forEach(button=>button.addEventListener('click',()=>this.remove(button.dataset.remove)));
  document.querySelectorAll('[data-grouping-open]').forEach(button=>button.addEventListener('click',()=>this.openGrouping(button.dataset.groupingOpen)));
 }
 openGrouping(id){
  const row=this.groupingRows?.find(item=>item.id===id);if(!row)return;
  if(row.source==='network'){this.editing=row.sourceId;this.show('networks');this.editing=row.sourceId;this.render();}
  else{this.editing=null;this.show(row.source==='api'?'networks':'groups');document.getElementById('registry-name').value=row.name;document.getElementById('registry-codes').value=row.clientCodes.join(', ');}
  document.getElementById('registry-name').focus();
 }

 chooseSource(catalog){const input=document.getElementById('registry-source'),value=input.value,normalized=normalizeName(value),matches=catalog.filter(row=>sourceLabel(row)===value||normalizeCode(row.cod_cliente)===normalizeCode(value)||normalizeName(row.name)===normalized);if(matches.length!==1){document.getElementById('registry-source-help').textContent='Selecione uma sugestão com nome, cidade e código para identificar o cadastro.';return;}const row=matches[0],identity=resolveIdentity(row,this.getAux());let related=[row];if(this.tab==='networks'&&identity.networkId)related=catalog.filter(item=>resolveIdentity(item,this.getAux()).networkId===identity.networkId);else if(identity.groupId)related=catalog.filter(item=>resolveIdentity(item,this.getAux()).groupId===identity.groupId);document.getElementById('registry-name').value=this.tab==='networks'?(identity.networkName||row.name):(identity.groupName||row.name);document.getElementById('registry-codes').value=related.map(item=>normalizeCode(item.cod_cliente)).join(', ');if(this.tab==='top'){const sourceCities=[...new Set(related.map(item=>item.city))];document.getElementById('registry-city').value=sourceCities.length>1?sourceCities.length+' cidades':sourceCities[0]||row.city;document.getElementById('registry-rep').value=[...new Set(related.map(item=>item.rep))].join(', ');}document.getElementById('registry-source-help').textContent=related.length+' cadastro(s) preenchido(s). Confira os códigos antes de salvar.';}
 async commit(next,message){if(this.saving)return false;this.saving=true;const button=document.getElementById('registry-save');if(button)button.disabled=true;try{await this.save(next);this.editing=null;this.render();this.notice(message);return true;}catch(error){this.notice(error.message,true);return false;}finally{this.saving=false;if(button)button.disabled=false;}}
 async submit(event){event.preventDefault();const data=structuredClone(this.getAux()),entry=data[fields[this.tab]].find(item=>item.id===this.editing),row={...(entry||{}),id:entry?.id||id(),name:document.getElementById('registry-name').value.trim(),clientCodes:parseCodes(document.getElementById('registry-codes').value)};if(this.tab==='top')Object.assign(row,{city:document.getElementById('registry-city').value.trim(),rep:document.getElementById('registry-rep').value.trim(),acceptedAt:document.getElementById('registry-date').value,notes:document.getElementById('registry-notes').value.trim()});else{row.namePatterns??=[];if(this.tab==='networks')row.excludedClientCodes=parseCodes(document.getElementById('registry-excluded').value);}try{validateRegistryDraft(data,this.tab,row,this.getHistory());}catch(error){this.notice(error.message,true);return;}const index=data[fields[this.tab]].findIndex(item=>item.id===row.id);if(index<0)data[fields[this.tab]].push(row);else data[fields[this.tab]][index]=row;await this.commit(data,'Cadastro salvo no JSON do servidor.');}
 async remove(entryId){const data=structuredClone(this.getAux()),entry=data[fields[this.tab]].find(row=>row.id===entryId);if(!entry||!window.confirm('Remover '+entry.name+' desta lista?'))return;data[fields[this.tab]]=data[fields[this.tab]].filter(row=>row.id!==entryId);await this.commit(data,this.tab==='networks'?'Regra removida. Classificações recebidas da API continuam valendo; use Exceções para marcar códigos como independentes.':'Cadastro removido do JSON.');}
 async saveIndependent(){const data=structuredClone(this.getAux());data.independentClientCodes=parseCodes(document.getElementById('independent-codes').value);if(data.independentClientCodes.some(code=>!/^\d{1,30}$/.test(code))){this.notice('Use somente códigos numéricos na lista de independentes.',true);return;}await this.commit(data,'Exceções salvas no JSON do servidor.');}
 async importFile(file){if(!file)return;if(file.size>4*1024*1024)throw new Error('O JSON deve ter até 4 MB.');const parsed=JSON.parse(await file.text());let next,skipped=0;if(parsed.version===1&&Array.isArray(parsed.clients)){
   next=structuredClone(this.getAux());const known=new Set(next.topRetailers.flatMap(item=>item.clientCodes.map(normalizeCode)));
   for(const item of parsed.clients){if(typeof item.name!=='string'||typeof item.code!=='string'||typeof item.city!=='string'||typeof item.date!=='string')throw new Error('A cópia anterior tem um registro inválido.');const code=normalizeCode(item.code);if(!code||known.has(code)){skipped++;continue;}const row={id:id(),name:item.name,clientCodes:[code],city:item.city,rep:item.rep||'',acceptedAt:item.date,notes:item.notes||''};try{validateRegistryDraft(next,'top',row,this.getHistory());}catch(error){if(code==='990'||/somente Outros|não têm compras/.test(error.message)){skipped++;continue;}throw error;}next.topRetailers.push(row);known.add(code);}
  }else{if(parsed.schemaVersion!==1||!Array.isArray(parsed.topRetailers)||!Array.isArray(parsed.largeNetworks)||!Array.isArray(parsed.clientGroups))throw new Error('Selecione um JSON auxiliar do BI ou uma cópia da lista de aceites anterior.');next={...parsed,revision:this.getAux().revision};next.representativeAliases=Object.hasOwn(parsed,'representativeAliases')?validateRepresentativeAliasEntries(parsed.representativeAliases):structuredClone(this.getAux().representativeAliases||[]);for(const row of next.topRetailers)validateRegistryDraft(next,'top',row,this.getHistory());if(!window.confirm('Substituir os cadastros compartilhados pelo conteúdo deste JSON?'))return;}
  await this.commit(next,'JSON importado e salvo.'+(skipped?' '+skipped+' registro(s) duplicado(s), sem código ou excluído(s) foram ignorados.':''));
 }
}


