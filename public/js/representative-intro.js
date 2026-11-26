import {esc} from './charts.js';

const dateOK=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const day=value=>value.slice(0,10).split('-').reverse().join('/');

function titleBackdrop(){
 const particles=[[12,19,0],[83,17,1.5],[94,55,3],[66,78,.6],[38,90,2.4],[76,41,4.2],[56,12,3.2],[21,72,5.1]];
 return '<div class="rep-intro-wash" aria-hidden="true"></div><svg class="rep-intro-traces" viewBox="0 0 1440 850" preserveAspectRatio="none" aria-hidden="true"><g class="rep-intro-trace-base"><path data-draw d="M-80 720 L350 290 L780 720 L1210 290 L1520 600"/><path data-draw d="M-140 810 L350 320 L840 810 L1330 320 L1540 530"/><path data-draw d="M690 -80 L1130 360 L1570 -80"/></g><g class="rep-intro-trace-flow"><path d="M-80 720 L350 290 L780 720 L1210 290 L1520 600"/><path d="M690 -80 L1130 360 L1570 -80"/></g></svg><div class="rep-intro-particles" aria-hidden="true">'+particles.map(([x,y,delay],index)=>'<i class="rep-intro-particle rep-intro-particle--'+index%3+'" style="--spark-x:'+x+'%;--spark-y:'+y+'%;--spark-delay:-'+delay+'s"></i>').join('')+'</div>';
}

function emblem(){
 return '<div class="rep-intro-emblem" aria-hidden="true"><div class="rep-intro-emblem-glow"></div><svg class="rep-intro-geometry" viewBox="0 0 640 640"><g class="rep-intro-geometry-slow"><path class="rep-intro-diamond rep-intro-diamond--outer" data-draw d="M320 26 L614 320 L320 614 L26 320 Z"/><path class="rep-intro-diamond rep-intro-diamond--inner" data-draw d="M320 69 L571 320 L320 571 L69 320 Z"/></g><g class="rep-intro-geometry-reverse"><circle class="rep-intro-orbit-ring" cx="320" cy="320" r="256"/><circle class="rep-intro-orbit-dot" cx="320" cy="64" r="5"/><circle class="rep-intro-orbit-dot rep-intro-orbit-dot--gold" cx="320" cy="576" r="4"/></g><g class="rep-intro-diamond-solid"><path class="rep-intro-glass rep-intro-glass--red" d="M257 165 L455 320 L257 475 L59 320 Z"/><path class="rep-intro-glass rep-intro-glass--blue" d="M383 165 L581 320 L383 475 L185 320 Z"/></g></svg></div>';
}

/** Brand-only opening. Financial values remain exclusively on the following scenes. */
export function representativeIntro({period,metric='fardos',label='',groupCount=1}={}){
 if(!dateOK(period?.inicio)||!dateOK(period?.coveredThrough)||period.inicio>period.coveredThrough)throw new Error('A capa precisa de um período confirmado.');
 if(!['sales','fardos'].includes(metric))throw new Error('Escolha fardos ou R$ para a apresentação.');
 if(!Number.isSafeInteger(groupCount)||groupCount<1)throw new Error('A capa precisa de ao menos um grupo confirmado.');
 const focus=groupCount>1?'Visão geral da equipe':String(label||'Resultados por representante'),year=period.coveredThrough.slice(0,4),unit=metric==='sales'?'R$':'Fardos';
 const html='<div class="rep-scene rep-scene--intro">'+titleBackdrop()+'<div class="rep-scene-top rep-intro-top" data-reveal><span><i></i>Distribuidora Demo · Comercial</span><div class="rep-scene-context"><span>'+esc(unit)+'</span><time class="rep-scene-date">'+esc(day(period.inicio)+' — '+day(period.coveredThrough))+'</time></div></div><div class="rep-intro-main"><div class="rep-intro-copy"><span class="rep-intro-eyebrow" data-reveal>Apresentação de resultados</span><h1 class="rep-intro-title" data-reveal>Resultados<br><span>comerciais.</span></h1><div class="rep-intro-rule" aria-hidden="true"></div><div class="rep-intro-focus" data-reveal><span>'+esc(focus)+'</span><small>'+esc(year)+(groupCount>1?' · '+groupCount+' grupos acompanhados':'')+'</small></div></div><div class="rep-intro-brand-stage">'+emblem()+'<div class="rep-intro-logo-entry" data-reveal><div class="rep-intro-logo-float"><img class="rep-intro-logo" src="assets/logo.svg" alt="BI Comercial Demo" width="480" height="224" draggable="false"><div class="rep-intro-logo-sheen" aria-hidden="true"></div></div></div><span class="rep-intro-brand-caption" data-reveal>Presença no campo. Foco no resultado.</span></div></div><div class="rep-intro-footer" data-reveal><span>Resultados por representante</span><span class="rep-intro-advance">Avance para explorar os resultados <b aria-hidden="true">→</b></span></div></div>';
 return {id:'presentation-intro',title:'Abertura',chapter:'Abertura',kind:'intro',html};
}
