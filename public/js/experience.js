// Progressive visual enhancement only. Figures, filters and source data are untouched.
const experienceSessions=new WeakMap();
const EXPERIENCE_PANELS='.panel,.kpi,.connection-tools,.report-toolbar,.registry-form,.page-intro';
const EXPERIENCE_BARS='.fill,.mix-track>div,.rep-city-bar i,.goal-progress>i';
const EXPERIENCE_CANDIDATES=EXPERIENCE_PANELS+','+EXPERIENCE_BARS;
const EXPERIENCE_OWN_MOTION='#analysis-content,#representatives-report,#customer-results-content';
const EXPERIENCE_PRESS='button,a.button,[role="tab"]';

/** One independent session per connected document/element; safe in embedded apps. */
export function initExperience({root=globalThis.document}={}){
 const noop=()=>{};
 if(!root||![1,9].includes(root.nodeType))return noop;
 const doc=root.nodeType===9?root:root.ownerDocument,scope=root.nodeType===9?root.documentElement:root,view=doc?.defaultView;
 if(!scope?.isConnected||!scope.querySelectorAll||!view)return noop;
 if(experienceSessions.has(scope))return experienceSessions.get(scope);
 const ownClass=!scope.classList.contains('bi-experience');scope.classList.add('bi-experience');
 const media=view.matchMedia?.('(prefers-reduced-motion: reduce)'),animations=new Set(),seen=new WeakSet(),waiting=new Set(),added=new Set(),inks=new Set();
 let disposed=false,printing=false,frame=null,scanWhole=false,intersection=null,mutation=null;
 const reduced=()=>Boolean(media?.matches),visible=()=>doc.visibilityState!=='hidden';
 const within=node=>node?.isConnected&&(scope===node||scope.contains(node));
 const cancelAll=()=>{for(const animation of [...animations]){try{animation.cancel();}catch{}}animations.clear();for(const ink of inks)ink.remove();inks.clear();};
 const animate=(node,keyframes,options,done)=>{
  if(disposed||printing||reduced()||!visible()||!within(node)||typeof node.animate!=='function'){done?.();return;}
  let animation;try{animation=node.animate(keyframes,{duration:380,easing:'cubic-bezier(.2,.75,.2,1)',fill:'backwards',...options});}catch{done?.();return;}
  animations.add(animation);const finish=()=>{animations.delete(animation);done?.();};
  if(animation.finished?.then)animation.finished.then(finish,finish);else finish();
 };
 const reveal=node=>{
  if(!within(node))return;
  if(node.matches(EXPERIENCE_BARS)){
   animate(node,[{transformOrigin:'left center',transform:'scaleX(.08)',opacity:.65},{transformOrigin:'left center',transform:'scaleX(1)',opacity:1}],{duration:620});return;
  }
  if(node.closest(EXPERIENCE_OWN_MOTION))return;
  // No persistent opacity or transform is written: failed/missing animation is visible.
  animate(node,[{opacity:.35,transform:'translateY(9px)'},{opacity:1,transform:'translateY(0)'}],{duration:430});
 };
 const Intersection=view.IntersectionObserver;
 if(typeof Intersection==='function')intersection=new Intersection(entries=>{
  if(disposed||printing||reduced()||!visible())return;
  for(const entry of entries){if(!entry.isIntersecting)continue;intersection.unobserve(entry.target);waiting.delete(entry.target);reveal(entry.target);}
 },{root:null,rootMargin:'0px 0px -28px 0px',threshold:.06});
 const consider=node=>{
  if(!within(node)||seen.has(node)||(!node.matches(EXPERIENCE_BARS)&&node.closest(EXPERIENCE_OWN_MOTION)))return;
  seen.add(node);if(printing||reduced()||!visible())return;
  if(intersection){waiting.add(node);intersection.observe(node);}else reveal(node);
 };
 const scan=node=>{
  if(!within(node)||node.classList?.contains('experience-ink'))return;
  if(node.matches?.(EXPERIENCE_CANDIDATES))consider(node);
  let processed=0;for(const candidate of node.querySelectorAll(EXPERIENCE_CANDIDATES)){consider(candidate);if(++processed>=180)break;}
 };
 const raf=view.requestAnimationFrame?.bind(view),cancelFrame=view.cancelAnimationFrame?.bind(view);
 const schedule=node=>{
  if(disposed||!within(node)||node.classList?.contains('experience-ink'))return;
  if(added.size>=100){scanWhole=true;added.clear();}else if(!scanWhole)added.add(node);
  if(frame!==null)return;
  const run=()=>{frame=null;if(disposed)return;const nodes=scanWhole?[scope]:[...added];scanWhole=false;added.clear();nodes.forEach(scan);};
  if(raf)frame=raf(run);else{frame=-1;Promise.resolve().then(run);}
 };
 const Mutation=view.MutationObserver;
 if(typeof Mutation==='function'){
  mutation=new Mutation(records=>{for(const record of records)for(const node of record.addedNodes||[])if(node.nodeType===1&&!node.classList?.contains('experience-ink'))schedule(node);});
  // The observer never receives Window, null, a frame document or a detached node.
  mutation.observe(scope,{childList:true,subtree:true});
 }
 const press=(event,keyboard=false)=>{
  if(disposed||printing||reduced()||!visible()||(!keyboard&&event.button!=null&&event.button!==0))return;
  const target=event.target?.closest?.(EXPERIENCE_PRESS);
  if(!within(target)||target.disabled||target.getAttribute?.('aria-disabled')==='true')return;
  const bounds=target.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
  const ink=doc.createElement('span'),diameter=Math.max(bounds.width,bounds.height)*1.75;
  ink.className='experience-ink';ink.setAttribute('aria-hidden','true');
  const x=keyboard||!Number.isFinite(event.clientX)?bounds.width/2:event.clientX-bounds.left,y=keyboard||!Number.isFinite(event.clientY)?bounds.height/2:event.clientY-bounds.top;
  ink.style.width=ink.style.height=diameter+'px';ink.style.left=(x-diameter/2)+'px';ink.style.top=(y-diameter/2)+'px';
  target.classList.add('experience-pressable');target.appendChild(ink);inks.add(ink);
  const remove=()=>{inks.delete(ink);ink.remove();};
  animate(ink,[{transform:'scale(.1)',opacity:.22},{transform:'scale(1)',opacity:0}],{duration:430,easing:'cubic-bezier(.15,.6,.25,1)',fill:'none'},remove);
 };
 const pointer=event=>press(event),key=event=>{if(!event.repeat&&(event.key==='Enter'||event.key===' '))press(event,true);};
 const change=event=>{
  const target=event.target;if(!within(target)||!target.matches?.('input:not([type="checkbox"]):not([type="radio"]),select,textarea')||target.disabled||target.readOnly)return;
  animate(target,[{boxShadow:'0 0 0 0 rgba(78,113,198,0)'},{boxShadow:'0 0 0 4px rgba(78,113,198,.10)'},{boxShadow:'0 0 0 0 rgba(78,113,198,0)'}],{duration:420});
 };
 const preference=()=>{if(reduced()){cancelAll();intersection?.disconnect();waiting.clear();}else schedule(scope);};
 const visibility=()=>{if(!visible())cancelAll();else schedule(scope);};
 const beforePrint=()=>{printing=true;cancelAll();intersection?.disconnect();};
 const afterPrint=()=>{printing=false;if(!reduced()){for(const node of [...waiting]){if(within(node))intersection?.observe(node);else waiting.delete(node);}schedule(scope);}};
 scope.addEventListener('pointerdown',pointer);scope.addEventListener('keydown',key);scope.addEventListener('change',change);
 doc.addEventListener('visibilitychange',visibility);view.addEventListener('beforeprint',beforePrint);view.addEventListener('afterprint',afterPrint);media?.addEventListener?.('change',preference);
 const cleanup=()=>{
  if(disposed)return;disposed=true;if(frame!==null&&frame!==-1)cancelFrame?.(frame);frame=null;added.clear();waiting.clear();
  mutation?.disconnect();intersection?.disconnect();cancelAll();
  scope.removeEventListener('pointerdown',pointer);scope.removeEventListener('keydown',key);scope.removeEventListener('change',change);
  doc.removeEventListener('visibilitychange',visibility);view.removeEventListener('beforeprint',beforePrint);view.removeEventListener('afterprint',afterPrint);media?.removeEventListener?.('change',preference);
  if(ownClass)scope.classList.remove('bi-experience');experienceSessions.delete(scope);
 };
 experienceSessions.set(scope,cleanup);schedule(scope);return cleanup;
}
