import {normalizeName} from './analytics.js';
import {esc,fmt} from './charts.js';

let territoryLoad=null;
const STATE_NAMES={PI:'Piauí',MA:'Maranhão',PE:'Pernambuco',PA:'Pará',TO:'Tocantins',BA:'Bahia',AC:'Acre',AL:'Alagoas',AP:'Amapá',AM:'Amazonas',CE:'Ceará',DF:'Distrito Federal',ES:'Espírito Santo',GO:'Goiás',MG:'Minas Gerais',MS:'Mato Grosso do Sul',MT:'Mato Grosso',PB:'Paraíba',PR:'Paraná',RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RO:'Rondônia',RR:'Roraima',RS:'Rio Grande do Sul',SC:'Santa Catarina',SE:'Sergipe',SP:'São Paulo'};
const count=value=>Number.isFinite(value)&&value>=0?Math.trunc(value):0;
const cityName=city=>String(city.cityName||city.city||'').replace(/\s*\/\s*[A-Z]{2}\s*$/i,'').trim();
const municipalityKey=(name,uf)=>JSON.stringify([normalizeName(name),String(uf||'').toUpperCase()]);
const statusFor=city=>['all-billed','mixed','no-billing','api-only'].includes(city.status)?city.status:count(city.totalClients)>0?(count(city.billedClients)===0?'no-billing':count(city.unbilledClients)>0?'mixed':'all-billed'):'api-only';
const stateData=()=>[...(globalThis.BI_TERRITORY_DATA?.states||[]),...(globalThis.BI_REP_EXTRA_TERRITORIES?.states||[])];

export function matchRepresentativeCities(cities,territories=stateData()){
 const municipalities=new Map(territories.flatMap(state=>state.municipalities.map(city=>[municipalityKey(city.name,state.uf),city]))),matched=[],unmatched=[];
 for(const city of cities||[]){const uf=String(city.uf||'').toUpperCase(),key=municipalityKey(cityName(city),uf),municipality=municipalities.get(key);(municipality?matched:unmatched).push({...city,uf,municipality:municipality||null});}
 return {matched,unmatched};
}
export function representativeStateChoices(cities,territories=stateData()){
 const available=new Set(territories.map(state=>state.uf)),grouped=new Map();
 for(const city of cities||[]){const uf=String(city.uf||'').toUpperCase()||'ND';if(!grouped.has(uf))grouped.set(uf,new Set());grouped.get(uf).add(city.key||municipalityKey(cityName(city),uf));}
 return [...grouped].map(([uf,keys])=>({uf,name:STATE_NAMES[uf]||'Estado não informado',available:available.has(uf),cityCount:keys.size})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
}
function detail(city,metric){
 const lines=[cityName(city)+' / '+city.uf,'Carteira: '+count(city.totalClients)+' clientes','Com faturamento: '+count(city.billedClients),'Sem faturamento: '+count(city.unbilledClients)];
 if(count(city.pendingClients))lines.push('Sem faturamento, com pedidos a faturar: '+count(city.pendingClients));
 if(count(city.outsideCatalogClients))lines.push('Faturados sem cadastro correspondente: '+count(city.outsideCatalogClients));
 else if(count(city.outsidePortfolioClients))lines.push('Faturados fora da carteira atual: '+count(city.outsidePortfolioClients));
 const value=Object.prototype.hasOwnProperty.call(city,metric)?city[metric]:city.selectedValue??null;
 lines.push((metric==='sales'?'Faturamento do representante: ':'Fardos do representante: ')+fmt(value,metric));return lines;
}
function legend(){return '<div class="rep-map-legend"><span><i class="rep-map-key all-billed"></i>Todos faturados</span><span><i class="rep-map-key mixed"></i>Parte faturada</span><span><i class="rep-map-key no-billing"></i>Sem faturamento</span><span><i class="rep-map-key api-only"></i>Faturamento sem carteira local</span><span><i class="rep-map-key outside"></i>Fora da carteira</span></div>';}

export class RepresentativeMap{
 constructor({container,onCity,assetURL}={}){this.container=container;this.onCity=onCity;this.assetURL=assetURL;this.cities=[];this.state=null;this.selectedCity=null;this.metric='fardos';this.viewBox=null;this.data=stateData();}
 async load(){
  if(globalThis.BI_TERRITORY_DATA?.states?.length&&globalThis.BI_REP_EXTRA_TERRITORIES?.states?.length){this.data=stateData();return this.data;}
  if(!territoryLoad){
   const loadAsset=(path,available)=>available()?Promise.resolve():new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=new URL(path,document.baseURI||location.href).href;script.dataset.biTerritory='representative';
    script.onload=()=>available()?resolve():reject(new Error('A malha municipal não foi disponibilizada.'));
    script.onerror=()=>{script.remove();reject(new Error('Não foi possível carregar o mapa municipal. Os indicadores continuam disponíveis.'));};document.head.appendChild(script);
   });
   territoryLoad=Promise.all([loadAsset(this.assetURL||'apps/dashboard/territory-data.js',()=>Boolean(globalThis.BI_TERRITORY_DATA?.states?.length)),loadAsset('assets/representatives-territory-extra.js',()=>Boolean(globalThis.BI_REP_EXTRA_TERRITORIES?.states?.length))]).then(()=>stateData()).catch(error=>{territoryLoad=null;throw error;});
  }
  this.data=await territoryLoad;return this.data;
 }
 stateChoices(cities=this.cities){return representativeStateChoices(cities,this.data);}
 render(cities,{state,selectedCity=null,metric='fardos'}={}){
  this.cities=cities||[];this.metric=metric;this.selectedCity=selectedCity;const choices=this.stateChoices(),next=state||this.state||(choices.some(item=>item.uf==='PI')?'PI':choices[0]?.uf)||'PI';
  if(next!==this.state){this.state=next;this.viewBox=null;}else this.state=next;
  const territory=this.data.find(item=>item.uf===this.state);if(!this.viewBox&&territory)this.viewBox=[...territory.viewBox];
  if(this.container){this.container.innerHTML=this.markup(false);this.bind();}
  const matches=matchRepresentativeCities(this.cities.filter(city=>city.uf===this.state),this.data);return {state:this.state,...matches};
 }
 markup(printing=false,{metric=this.metric}={}){
  const territory=this.data.find(item=>item.uf===this.state),cities=this.cities.filter(city=>String(city.uf).toUpperCase()===this.state),matches=matchRepresentativeCities(cities,this.data),name=territory?.name||STATE_NAMES[this.state]||this.state;
  if(!territory)return '<div class="rep-map-empty"><strong>'+esc(name)+'</strong><p>A malha municipal deste estado não está disponível neste mapa. As cidades e seus indicadores permanecem nas listas do relatório.</p></div>'+legend();
  const dataByCode=new Map(matches.matched.map(city=>[city.municipality.code,city])),viewBox=printing?territory.viewBox:(this.viewBox||territory.viewBox);
  const shapes=territory.municipalities.map(city=>{const row=dataByCode.get(city.code),selected=row&&row.key===this.selectedCity,summary=row?detail(row,metric):[city.name+' / '+territory.uf,'Fora da carteira selecionada'];return '<g class="rep-map-city'+(selected?' is-selected':'')+'" data-status="'+(row?statusFor(row):'outside')+'"'+(row?' data-rep-map-city="'+esc(row.key)+'" role="button" tabindex="0" aria-pressed="'+Boolean(selected)+'"':'')+' aria-label="'+esc(summary.join(' · '))+'"><title>'+esc(summary.join('\n'))+'</title><path d="'+esc(city.path)+'"/></g>';}).join('');
  const tools=printing?'':'<div class="rep-map-tools" data-print-exclude="true"><button type="button" data-rep-map-zoom="in" aria-label="Ampliar mapa">+</button><button type="button" data-rep-map-zoom="out" aria-label="Reduzir mapa">−</button><button type="button" data-rep-map-zoom="fit">Enquadrar</button></div>';
  const unmatched=matches.unmatched.length?'<p class="rep-map-unmatched">Sem correspondência na malha: '+matches.unmatched.map(city=>esc(cityName(city)+' / '+city.uf)).join(', ')+'. Os resultados dessas cidades estão incluídos no relatório.</p>':'';
  return '<div class="rep-map-widget"><div class="rep-map-heading"><div><strong>'+esc(name)+'</strong><span>'+matches.matched.length+' cidades destacadas · '+territory.municipalities.length+' municípios</span></div>'+tools+'</div><div class="rep-map-frame"><svg class="rep-map-svg" viewBox="'+viewBox.join(' ')+'" role="group" aria-label="Carteira por município · '+esc(name)+'" xmlns="http://www.w3.org/2000/svg">'+shapes+'</svg>'+(printing?'':'<div class="rep-map-tooltip" role="status" hidden></div>')+'</div>'+legend()+unmatched+'<p class="rep-map-source">Limites municipais: IBGE</p></div>';
 }
 snapshot({metric=this.metric}={}){return this.markup(true,{metric});}
 bind(){
  const container=this.container,tooltip=container.querySelector('.rep-map-tooltip'),frame=container.querySelector('.rep-map-frame');
  for(const node of container.querySelectorAll('[data-rep-map-city]')){
   const city=this.cities.find(item=>item.key===node.dataset.repMapCity);if(!city)continue;
   const select=()=>this.onCity?.(city.key,city);
   const show=event=>{if(!tooltip||!frame)return;tooltip.innerHTML=detail(city,this.metric).map((line,index)=>index?'<span>'+esc(line)+'</span>':'<strong>'+esc(line)+'</strong>').join('');tooltip.hidden=false;const bounds=frame.getBoundingClientRect();const x=event?.clientX?event.clientX-bounds.left:bounds.width/2,y=event?.clientY?event.clientY-bounds.top:28;tooltip.style.left=Math.max(8,Math.min(bounds.width-248,x+14))+'px';tooltip.style.top=Math.max(8,Math.min(bounds.height-150,y+14))+'px';};
   node.addEventListener('click',select);node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}if(event.key==='Escape'&&tooltip)tooltip.hidden=true;});
   node.addEventListener('pointerenter',show);node.addEventListener('pointermove',show);node.addEventListener('pointerleave',()=>{if(tooltip)tooltip.hidden=true;});node.addEventListener('focus',show);node.addEventListener('blur',()=>{if(tooltip)tooltip.hidden=true;});
  }
  for(const button of container.querySelectorAll('[data-rep-map-zoom]'))button.addEventListener('click',()=>this.zoom(button.dataset.repMapZoom));
 }
 zoom(direction){
  const territory=this.data.find(item=>item.uf===this.state),svg=this.container?.querySelector('.rep-map-svg');if(!territory||!svg)return;
  if(direction==='fit')this.viewBox=[...territory.viewBox];else{
   const current=this.viewBox||territory.viewBox,factor=direction==='in'?.72:1/.72,height=Math.max(territory.viewBox[3]/5,Math.min(territory.viewBox[3],current[3]*factor)),ratio=height/current[3],selected=this.cities.find(city=>city.key===this.selectedCity),point=selected?matchRepresentativeCities([selected],this.data).matched[0]?.municipality:null,cx=point?.x??(current[0]+current[2]/2),cy=point?.y??(current[1]+current[3]/2),width=current[2]*ratio;
   this.viewBox=[Math.max(0,Math.min(territory.viewBox[2]-width,cx-width/2)),Math.max(0,Math.min(territory.viewBox[3]-height,cy-height/2)),width,height];
  }
  svg.setAttribute('viewBox',this.viewBox.join(' '));
 }
}
