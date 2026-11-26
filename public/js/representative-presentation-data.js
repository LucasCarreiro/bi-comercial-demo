import {loadRepresentativeComparisonData} from './representative-data.js';

const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const lastDay=month=>month+'-'+String(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()).padStart(2,'0');

/** January has no closed month in the new year: present the last completed year. */
export function closedRepresentativePresentationPeriod(today){
 if(!validDate(today))throw new Error('A data atual da apresentação é inválida.');
 const year=Number(today.slice(0,4)),month=Number(today.slice(5,7)),selectedYear=month===1?year-1:year,lastMonth=month===1?12:month-1;
 return {inicio:selectedYear+'-01-01',fim:lastDay(selectedYear+'-'+String(lastMonth).padStart(2,'0')),year:selectedYear};
}

export function closedRepresentativeHistory(history,{year,fim}){
 const cutoff=fim.slice(0,7),raw=new Map((history?.months||[]).map(month=>[month.month,month]));
 const count=Number(fim.slice(5,7)),months=Array.from({length:count},(_,index)=>{
  const month=year+'-'+String(index+1).padStart(2,'0'),expectedEnd=lastDay(month),source=raw.get(month),sourceEnd=source?.effectiveFim||source?.coveredThrough||source?.fim,sourceDate=String(source?.updatedAt||source?.atualizado_em||'').slice(0,10);
  const confirmed=source?.status==='ok'&&Array.isArray(source.clientes)&&source?.inicio===month+'-01'&&validDate(sourceEnd)&&sourceEnd===expectedEnd&&validDate(sourceDate)&&sourceDate>=expectedEnd&&source.freshnessKnown!==false;
  return confirmed?{...source,month,inicio:month+'-01',fim:expectedEnd,coveredThrough:expectedEnd,effectiveFim:expectedEnd}:{...source,month,inicio:month+'-01',fim:expectedEnd,status:'error',clientes:[],error:'O fechamento completo deste mês ainda não foi confirmado pela API.'};
 });
 return {...history,year,asOf:fim,months,coverage:{...history?.coverage,requested:count,completed:count,ok:months.filter(month=>month.status==='ok').length,errors:months.filter(month=>month.status!=='ok').length,missingMonths:months.filter(month=>month.status!=='ok').map(month=>month.month),complete:months.every(month=>month.status==='ok'),currentMonth:cutoff,requestedAsOf:fim}};
}

export function confirmedClosedRepresentativePeriod(period,range){
 const sourceDay=String(period?.updatedAt||period?.atualizado_em||'').slice(0,10);
 return period?.status==='ok'&&Array.isArray(period.clientes)&&period.inicio===range.inicio&&period.fim===range.fim&&period.coveredThrough===range.fim&&validDate(sourceDay)&&sourceDay>=range.fim&&period.freshnessKnown!==false;
}

/** A dedicated read-only data scope; never substitutes dates on the visible report. */
export async function loadClosedRepresentativePresentationData({today,loadPeriod,loadHistory,period,history}){
 const range=closedRepresentativePresentationPeriod(today);
 const exact=confirmedClosedRepresentativePeriod(period,range);
 const historyMatches=Number(history?.year||history?.asOf?.slice(0,4))===range.year;
 const [closedPeriod,rawHistory]=await Promise.all([
  exact?Promise.resolve(period):loadPeriod({inicio:range.inicio,fim:range.fim},{allowStale:false}),
  historyMatches?Promise.resolve(history):loadHistory(range.year,{force:false})
 ]);
 if(!confirmedClosedRepresentativePeriod(closedPeriod,range))throw new Error('A API ainda não confirmou o fechamento até '+range.fim.split('-').reverse().join('/')+'. A apresentação não inclui meses parciais.');
 const closedHistory=closedRepresentativeHistory(rawHistory,range);
 const comparisonData=await loadRepresentativeComparisonData({period:closedPeriod,history:closedHistory,loadPeriod,loadHistory,force:false});
 const previousRange={year:range.year-1,fim:(range.year-1)+range.fim.slice(4)};
 // Leap February uses the actual final day of the corresponding prior month.
 previousRange.fim=lastDay(previousRange.fim.slice(0,7));
 const previousHistory=closedRepresentativeHistory(comparisonData.previousHistory,previousRange);
 return {period:closedPeriod,history:closedHistory,comparisonData:{...comparisonData,previousHistory},range};
}
