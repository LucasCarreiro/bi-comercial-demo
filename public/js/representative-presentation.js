import {esc,fmt} from './charts.js';
import {representativeSlides} from './representative-slides.js';

let motionLoad=null;
// Motion 14.9.1 hybrid is bundled locally, without externally hosted assets.
export function loadPresentationMotion(){
 if(globalThis.Motion?.animate)return Promise.resolve(globalThis.Motion);
 if(motionLoad)return motionLoad;
 motionLoad=new Promise(resolve=>{
  const script=document.createElement('script');let timer;
  const finish=value=>{clearTimeout(timer);script.onload=null;script.onerror=null;if(!value){script.remove();motionLoad=null;}resolve(value);};
  script.src=new URL('assets/vendor/motion.js',document.baseURI||location.href).href;
  script.dataset.biMotion='14.9.1';script.onload=()=>finish(globalThis.Motion?.animate?globalThis.Motion:null);script.onerror=()=>finish(null);
  timer=setTimeout(()=>finish(null),8000);document.head.appendChild(script);
 });
 return motionLoad;
}

/** One active scene and a short-lived outgoing scene; business models are read-only. */
export class RepresentativePresentation{
 constructor({renderSlides=representativeSlides,loadMotion=loadPresentationMotion}={}){
  this.renderSlides=renderSlides;this.loadMotion=loadMotion;this.root=null;this.index=0;this.controls=[];this.manualPause=false;this.hiddenPause=false;this.generation=0;
 }
 async open({groups,metric='fardos',macro=true}={}){
  this.close();
  if(!Array.isArray(groups)||!groups.length)throw new Error('Carregue os representantes antes de apresentar.');
  this.hiddenPause=document.visibilityState==='hidden';this.forceMotion=true;this.manualPause=false;
  this.groups=groups;this.metric=metric==='sales'?'sales':'fardos';this.macro=macro;this.slides=this.renderSlides({groups,metric:this.metric,macro});
  if(!this.slides.length)throw new Error('Não há resultados confirmados para apresentar.');
  const generation=++this.generation;this.returnFocus=document.activeElement;this.previousOverflow=document.body.style.overflow;
  this.root=document.createElement('div');this.root.className='rep-presentation';this.root.setAttribute('role','dialog');this.root.setAttribute('aria-modal','true');this.root.setAttribute('aria-label','Apresentação de resultados por representante');this.root.tabIndex=-1;
  this.root.innerHTML='<header class="rep-deck-toolbar"><div class="rep-deck-brand"><img src="assets/logo.svg" alt="BI Comercial Demo"><span>Resultados em movimento</span></div><label class="rep-deck-chapter-label"><span class="rep-deck-sr">Ir para representante</span><select id="rep-deck-chapter" aria-label="Ir para representante"></select></label><div class="rep-deck-tools"><button type="button" id="rep-deck-metric" aria-label="Alternar unidade da apresentação"></button><button type="button" id="rep-deck-theme" aria-label="Ativar versão clara" aria-pressed="false" title="Alternar visual claro e escuro (T)">☀ Clara</button><button type="button" id="rep-deck-motion" aria-pressed="false" title="Pausar efeitos (P)">Pausar efeitos</button><button type="button" id="rep-deck-fullscreen" title="Tela cheia (F)" aria-label="Tela cheia">⛶</button><button type="button" id="rep-deck-close" title="Fechar (Esc)" aria-label="Fechar apresentação">✕</button></div></header><div class="rep-deck-stage"></div><footer class="rep-deck-footer"><div class="rep-deck-status" role="status" aria-live="polite" aria-atomic="true"></div><div class="rep-deck-progress" aria-hidden="true"><span></span></div><nav class="rep-deck-nav" aria-label="Navegação dos slides"><button type="button" id="rep-deck-prev" aria-label="Slide anterior">←</button><button type="button" id="rep-deck-replay" aria-label="Repetir animação do slide" title="Repetir animação (R)">↻</button><button type="button" id="rep-deck-next" aria-label="Próximo slide">→</button></nav><span class="rep-deck-hint">← → avançar · Esc sair</span></footer>';
  this.background=[...document.body.children].map(node=>({node,inert:node.inert}));
  for(const {node}of this.background)node.inert=true;
  document.body.appendChild(this.root);document.body.style.overflow='hidden';
  this.media=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');this.reduced=Boolean(this.media?.matches);
  this.onPreference=()=>{this.reduced=Boolean(this.media?.matches);this.forceMotion=false;this.syncPause();this.go(this.index,{animate:false});};
  this.media?.addEventListener?.('change',this.onPreference);
  this.onKey=event=>this.keydown(event);document.addEventListener('keydown',this.onKey,true);
  this.onVisibility=()=>{this.hiddenPause=document.visibilityState==='hidden';this.syncPause();};document.addEventListener('visibilitychange',this.onVisibility);
  this.onFullscreen=()=>{if(this.root)this.find('#rep-deck-fullscreen').setAttribute('aria-label',document.fullscreenElement===this.root?'Sair da tela cheia':'Tela cheia');};document.addEventListener('fullscreenchange',this.onFullscreen);
  this.find('#rep-deck-close').addEventListener('click',()=>this.close());
  this.find('#rep-deck-prev').addEventListener('click',()=>this.go(this.index-1));this.find('#rep-deck-next').addEventListener('click',()=>this.go(this.index+1));
  this.find('#rep-deck-replay').addEventListener('click',()=>this.go(this.index));this.find('#rep-deck-metric').addEventListener('click',()=>this.setMetric(this.metric==='sales'?'fardos':'sales'));
  this.find('#rep-deck-theme').addEventListener('click',()=>this.setTheme(this.theme==='light'?'dark':'light'));
  this.find('#rep-deck-motion').addEventListener('click',()=>this.toggleMotion());this.find('#rep-deck-fullscreen').addEventListener('click',()=>this.fullscreen());
  this.find('#rep-deck-chapter').addEventListener('change',event=>this.go(Number(event.target.value)));
  const stage=this.find('.rep-deck-stage');let swipe=null;
  stage.addEventListener('pointerdown',event=>{swipe=event.pointerType==='touch'?{x:event.clientX,y:event.clientY}:null;});
  stage.addEventListener('pointerup',event=>{if(!swipe)return;const dx=event.clientX-swipe.x,dy=event.clientY-swipe.y;swipe=null;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.5)this.go(this.index+(dx<0?1:-1));});
  this.setTheme(this.theme||'light');this.rebuildChapters();this.syncPause();this.go(0,{animate:false});this.find('#rep-deck-close').focus({preventScroll:true});
  const motion=await this.loadMotion().catch(()=>null);
  if(!this.root||generation!==this.generation)return;
  this.motion=motion;this.go(this.index,{animate:true});
 }
 find(selector){return this.root?.querySelector(selector);}
 rebuildChapters(){
  const seen=new Set();this.find('#rep-deck-chapter').innerHTML=this.slides.map((slide,index)=>{if(seen.has(slide.chapter))return '';seen.add(slide.chapter);return '<option value="'+index+'">'+esc(slide.chapter)+'</option>';}).join('');
 }
 setTheme(theme){
  if(!this.root||!['light','dark'].includes(theme))return;
  this.theme=theme;this.root.dataset.theme=theme;
  const button=this.find('#rep-deck-theme');button.textContent=theme==='light'?'◐ Escura':'☀ Clara';button.setAttribute('aria-label',theme==='light'?'Ativar versão escura':'Ativar versão clara');button.setAttribute('aria-pressed',String(theme==='light'));
 }
 setMetric(metric){
  if(!this.root||!['fardos','sales'].includes(metric))return;
  const previous=this.slides[this.index]?.id;this.metric=metric;this.slides=this.renderSlides({groups:this.groups,metric,macro:this.macro});this.rebuildChapters();
  this.go(Math.max(0,this.slides.findIndex(slide=>slide.id===previous)));
 }
 finishAnimations(){
  for(const control of this.controls){try{control.complete?.();control.cancel?.();}catch{}}
  this.controls=[];
  this.departingScene?.remove();this.departingScene=null;
 }
 syncPause(){
  if(!this.root)return;
  const paused=this.effectsPaused();this.root.classList.toggle('motion-paused',paused);
  const button=this.find('#rep-deck-motion');button.textContent=paused?'Ativar efeitos':'Pausar efeitos';button.disabled=false;button.setAttribute('aria-pressed',String(paused));button.title=this.reduced&&!this.forceMotion?'Movimento reduzido do sistema respeitado. Clique para ativar os efeitos nesta apresentação.':'Pausar ou ativar efeitos (P)';
  if(paused){this.finishAnimations();this.finishScene();}
 }
 effectsPaused(){return this.manualPause||(this.reduced&&!this.forceMotion)||this.hiddenPause;}
 toggleMotion(){if(this.reduced&&!this.forceMotion){this.forceMotion=true;this.manualPause=false;}else this.manualPause=!this.manualPause;this.syncPause();if(!this.effectsPaused())this.go(this.index);}
 finishScene(){
  const scene=this.find('.rep-deck-slide');if(!scene)return;
  scene.style.opacity='1';scene.style.transform='none';scene.style.willChange='auto';
  for(const node of scene.querySelectorAll('[data-reveal]')){node.style.opacity='1';node.style.transform='none';node.style.willChange='auto';}
  for(const node of scene.querySelectorAll('[data-draw]')){node.style.strokeDasharray='';node.style.strokeDashoffset='';}
  for(const node of scene.querySelectorAll('[data-count]')){const number=Number(node.dataset.count);if(Number.isFinite(number))node.textContent=fmt(number,node.dataset.countMetric||this.metric);}
 }
 go(index,{animate=true}={}){
  if(!this.root||!Number.isInteger(index)||index<0||index>=this.slides.length)return;
  const direction=index<this.index?-1:1,changing=index!==this.index;this.sceneEpoch=(this.sceneEpoch||0)+1;this.finishAnimations();this.finishScene();
  const descriptor=this.slides[index],stage=this.find('.rep-deck-stage'),outgoing=changing&&animate&&!this.effectsPaused()&&this.motion?.animate?stage.querySelector('.rep-deck-slide'):null;
  if(outgoing)outgoing.remove();
  this.index=index;stage.innerHTML='<section class="rep-deck-slide is-entering" aria-label="'+esc(descriptor.title)+'">'+descriptor.html+'</section>';stage.scrollTop=0;
  if(outgoing){outgoing.classList.toggle('is-leaving',true);outgoing.setAttribute('aria-hidden','true');outgoing.inert=true;stage.appendChild(outgoing);this.departingScene=outgoing;}
  const chapterStart=this.slides.findIndex(slide=>slide.chapter===descriptor.chapter);this.find('#rep-deck-chapter').value=String(chapterStart);
  this.find('.rep-deck-status').textContent=String(index+1).padStart(2,'0')+' / '+String(this.slides.length).padStart(2,'0')+' · '+descriptor.title;
  this.find('.rep-deck-progress span').style.width=((index+1)/this.slides.length*100)+'%';
  this.find('#rep-deck-prev').disabled=index===0;this.find('#rep-deck-next').disabled=index===this.slides.length-1;
  this.find('#rep-deck-metric').textContent=this.metric==='sales'?'R$ ⇆ Fardos':'Fardos ⇆ R$';
  this.root.dataset.scene=descriptor.kind;
  if(animate&&!this.effectsPaused()&&this.motion?.animate)this.animateScene(direction,outgoing);else this.finishScene();
 }
 animateScene(direction,outgoing=null){
  const scene=this.find('.rep-deck-slide'),animate=this.motion.animate;
  const epoch=this.sceneEpoch;
  const run=(...args)=>{try{const control=animate(...args);this.controls.push(control);return control;}catch{return null;}};
  const entrance=(node,keyframes,options)=>{
   node.style.willChange='transform, opacity';let control,released=false;
   const release=()=>{
    if(released)return;released=true;
    if(epoch!==this.sceneEpoch||!node.isConnected||this.find('.rep-deck-slide')!==scene)return;
    // Remove only this finished effect. SVG drawings and counters keep their own timing.
    try{control?.cancel?.();}catch{}
    node.style.transform='none';node.style.opacity='1';node.style.willChange='auto';
    this.controls=this.controls.filter(item=>item!==control);
   };
   control=run(node,keyframes,{...options,onComplete:()=>Promise.resolve().then(release)});
   if(!control)release();
  };
  if(outgoing){outgoing.style.willChange='transform, opacity';const exit=run(outgoing,{opacity:[1,0],x:[0,-direction*70],scale:[1,.985]},{duration:.42,ease:[.4,0,.6,1],onComplete:()=>{outgoing.remove();if(this.departingScene===outgoing)this.departingScene=null;}});if(!exit){outgoing.remove();this.departingScene=null;}}
  entrance(scene,{opacity:[0,1],x:[direction*70,0],scale:[1.015,1]},{duration:.64,ease:[.22,1,.36,1]});
  [...scene.querySelectorAll('[data-reveal]')].forEach((node,index)=>entrance(node,{opacity:[0,1],y:[22,0]},{duration:.7,delay:.08+Math.min(index,12)*.045,ease:[.22,1,.36,1]}));
  [...scene.querySelectorAll('[data-draw]')].forEach((node,index)=>run(node,{pathLength:[0,1]},{duration:1.5,delay:.22+index*.09,ease:[.22,1,.36,1]}));
  for(const node of scene.querySelectorAll('[data-count]')){
   // Dense comparisons stay readable while rows enter; only headline amounts count up.
   if(node.closest?.('table'))continue;
   const value=Number(node.dataset.count);if(!Number.isFinite(value))continue;const final=fmt(value,node.dataset.countMetric||this.metric);node.setAttribute('aria-label',final);
   run(0,value,{duration:1.3,delay:.18,ease:'easeOut',onUpdate:amount=>{if(node.isConnected)node.textContent=fmt(amount,node.dataset.countMetric||this.metric);},onComplete:()=>{node.textContent=final;}});
  }
 }
 keydown(event){
  if(!this.root)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close();return;}
  if(event.key==='Tab'){
   const items=[...this.root.querySelectorAll('button:not([disabled]),select:not([disabled]),[tabindex="0"]')].filter(node=>!node.hidden),first=items[0],last=items.at(-1);
   if(!first){event.preventDefault();this.root.focus();return;}
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}return;
  }
  // A held arrow must not skip several slides during a transition.
  if(event.repeat){if(['ArrowRight','ArrowLeft','PageDown','PageUp','Home','End',' '].includes(event.key))event.preventDefault();return;}
  if(event.altKey||event.ctrlKey||event.metaKey||event.target?.isContentEditable||/^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName||''))return;
  const action={'ArrowRight':()=>this.go(this.index+1),'PageDown':()=>this.go(this.index+1),'ArrowLeft':()=>this.go(this.index-1),'PageUp':()=>this.go(this.index-1),'Home':()=>this.go(0),'End':()=>this.go(this.slides.length-1),'t':()=>this.setTheme(this.theme==='light'?'dark':'light'),'T':()=>this.setTheme(this.theme==='light'?'dark':'light'),'f':()=>this.fullscreen(),'F':()=>this.fullscreen(),'p':()=>this.toggleMotion(),'P':()=>this.toggleMotion(),'r':()=>this.go(this.index),'R':()=>this.go(this.index)}[event.key];
  // Space keeps its normal activation behavior on buttons.
  if(action){event.preventDefault();event.stopPropagation();action();}else if(event.key===' '&&event.target?.tagName!=='BUTTON'){event.preventDefault();this.go(this.index+1);}
 }
 async fullscreen(){
  if(!this.root)return;
  try{if(document.fullscreenElement===this.root)await document.exitFullscreen();else await this.root.requestFullscreen?.();}catch{this.find('#rep-deck-fullscreen')?.setAttribute('title','A apresentação já ocupa toda a janela. Tela cheia indisponível neste navegador.');}
 }
 close(){
  ++this.generation;if(!this.root)return;
  this.finishAnimations();const root=this.root;this.root=null;
  this.media?.removeEventListener?.('change',this.onPreference);document.removeEventListener('keydown',this.onKey,true);document.removeEventListener('visibilitychange',this.onVisibility);document.removeEventListener('fullscreenchange',this.onFullscreen);
  if(document.fullscreenElement===root)document.exitFullscreen?.().catch(()=>{});
  root.remove();for(const {node,inert}of this.background||[])node.inert=inert;document.body.style.overflow=this.previousOverflow||'';
  if(this.returnFocus?.isConnected&&!this.returnFocus.disabled)this.returnFocus.focus({preventScroll:true});
  this.background=[];this.groups=[];this.slides=[];this.motion=null;
 }
}
