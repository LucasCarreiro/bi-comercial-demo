// Visual transitions only: values, selections and chart geometry are unchanged.
const activeMotion=new WeakMap();
function fitMetricValues(container){
 if(typeof globalThis.window?.getComputedStyle!=='function')return;
 for(const value of container.querySelectorAll('.stat-value, .comparison-value>strong')){
  if(!value.style||!value.parentElement)continue;
  value.style.fontSize='';
  const width=Math.min(value.clientWidth||Infinity,value.parentElement.clientWidth||Infinity),content=value.scrollWidth||0;
  if(!Number.isFinite(width)||width<=0||content<=width)continue;
  const size=parseFloat(window.getComputedStyle(value).fontSize);
  if(Number.isFinite(size)&&size>17)value.style.fontSize=Math.max(17,Math.floor(size*width/content*.98))+'px';
 }
}
export function clearAnalysisMotion(container){
 const previous=activeMotion.get(container);if(!previous)return;
 for(const animation of previous.animations){try{animation.cancel();}catch{}}
 previous.preference?.removeEventListener?.('change',previous.onPreferenceChange);
 activeMotion.delete(container);
}
export function animateAnalysis(container){
 if(!container?.querySelectorAll)return 0;
 clearAnalysisMotion(container);
 fitMetricValues(container);
 const preference=globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)');
 if(preference?.matches)return 0;
 const animations=[];
 const animate=(element,keyframes,options)=>{
  if(typeof element?.animate!=='function')return;
  try{const animation=element.animate(keyframes,{fill:'backwards',...options});animations.push(animation);animation.finished?.catch?.(()=>{});}catch{}
 };
 const enter=(element,delay=0,distance=10)=>animate(element,[{opacity:0,transform:'translateY('+distance+'px)'},{opacity:1,transform:'translateY(0)'}],{duration:420,delay,easing:'cubic-bezier(.2,.7,.2,1)'});
 [...container.querySelectorAll('.stat-card')].forEach((card,index)=>enter(card,Math.min(index*65,260),12));
 [...container.querySelectorAll('.panel')].forEach((panel,index)=>enter(panel,120+Math.min(index*65,260),14));
 [...container.querySelectorAll('.actual-line')].forEach(path=>{
  let length=0;try{length=path.getTotalLength?.()||0;}catch{}
  if(Number.isFinite(length)&&length>0)animate(path,[{strokeDasharray:length+' '+length,strokeDashoffset:length},{strokeDasharray:length+' '+length,strokeDashoffset:0}],{duration:850,delay:180,easing:'cubic-bezier(.25,.1,.25,1)'});
 });
 [...container.querySelectorAll('.estimate-line')].forEach(path=>animate(path,[{opacity:0,clipPath:'inset(0 100% 0 0)'},{opacity:1,clipPath:'inset(0 0 0 0)'}],{duration:700,delay:340,easing:'ease-out'}));
 [...container.querySelectorAll('[data-chart-point]')].forEach((point,index)=>animate(point,[{opacity:0},{opacity:1}],{duration:240,delay:250+Math.min(index*24,420),easing:'ease-out'}));
 [...container.querySelectorAll('.mix-donut-wrap')].forEach(wrap=>animate(wrap,[{opacity:.2,transform:'scale(.94)'},{opacity:1,transform:'scale(1)'}],{duration:650,delay:180,easing:'cubic-bezier(.2,.7,.2,1)'}));
 [...container.querySelectorAll('.donut-arc')].forEach((arc,index)=>{
  const length=Number(arc.dataset?.arcLength),circ=Number(arc.dataset?.arcCirc);
  if(!Number.isFinite(length)||!Number.isFinite(circ)||length<=0||circ<=0||length>circ)return;
  animate(arc,[{strokeDasharray:'0 '+circ},{strokeDasharray:length+' '+(circ-length)}],{duration:750,delay:200+index*55,easing:'cubic-bezier(.2,.7,.2,1)'});
 });
 [...container.querySelectorAll('.mix-item')].forEach((item,index)=>enter(item,390+index*55,7));
 const onPreferenceChange=event=>{if(event.matches)clearAnalysisMotion(container);};
 preference?.addEventListener?.('change',onPreferenceChange);
 activeMotion.set(container,{animations,preference,onPreferenceChange});
 return animations.length;
}
