const dateOK=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const monthEnd=month=>month+'-'+String(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()).padStart(2,'0');
export function previousRepresentativeDate(value){
 if(!dateOK(value))throw new Error('Data inválida para a comparação anual.');
 const year=Number(value.slice(0,4))-1,month=value.slice(5,7),day=Math.min(Number(value.slice(8,10)),Number(monthEnd(year+'-'+month).slice(8,10)));
 return year+'-'+month+'-'+String(day).padStart(2,'0');
}
/** Each failed comparison stays unavailable; it never becomes a zero purchase. */
export async function loadRepresentativeComparisonData({period,history,loadPeriod,loadHistory,force=false}){
 const errors=[],empty={previousPeriod:null,previousHistory:null,currentYearPeriod:null,previousYearPeriod:null,errors};
 if(!dateOK(period?.coveredThrough))return empty;
 const year=Number(period.fim.slice(0,4)),cutoff=period.coveredThrough,memo=new Map();
 const read=(inicio,fim)=>{const key=inicio+'|'+fim;if(!memo.has(key))memo.set(key,loadPeriod({inicio,fim},{allowStale:true}));return memo.get(key);};
 memo.set(period.inicio+'|'+period.fim,Promise.resolve(period));
 const safe=async(label,job)=>{try{return await job;}catch(error){errors.push(label+': '+error.message);return null;}};
 const partials=(history?.months||[]).filter(month=>month.status==='ok').flatMap(month=>{
  const end=month.effectiveFim||month.coveredThrough||(month.updatedAt?.slice(0,10)<month.fim?month.updatedAt.slice(0,10):month.fim);
  if(!dateOK(end)||end<month.month+'-01'||end>=monthEnd(month.month))return [];
  return [{month:month.month,read:safe('Comparação de '+month.month,read(previousRepresentativeDate(month.month+'-01'),previousRepresentativeDate(end)))}];
 });
 const [previousPeriod,previousHistory,currentYearPeriod,previousYearPeriod,partialResults]=await Promise.all([
  safe('Mesmo período do ano anterior',read(previousRepresentativeDate(period.inicio),previousRepresentativeDate(cutoff))),
  safe('Histórico do ano anterior',loadHistory(year-1,{force})),
  safe('Faturamento deste ano',read(year+'-01-01',cutoff)),
  safe('Faturamento do ano anterior',read((year-1)+'-01-01',(year-1)+'-12-31')),
  Promise.all(partials.map(item=>item.read))
 ]);
 let alignedHistory=previousHistory;
 if(previousHistory){
  const replacements=new Map(partials.map((item,index)=>[previousRepresentativeDate(item.month+'-01').slice(0,7),partialResults[index]]));
  alignedHistory={...previousHistory,months:previousHistory.months.map(month=>replacements.has(month.month)?(replacements.get(month.month)?{...month,...replacements.get(month.month),month:month.month}:{...month,status:'error',clientes:[],error:'Comparação parcial indisponível.'}):month)};
 }
 return {previousPeriod,previousHistory:alignedHistory,currentYearPeriod,previousYearPeriod,errors};
}
