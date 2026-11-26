// XLSX/CSV import is local until the user explicitly saves the validated catalog.
const MAX_FILE=8*1024*1024,MAX_XML=16*1024*1024,MAX_EXPANDED=40*1024*1024,MAX_CLIENTS=10000;
const UFS=new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const key=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const text=value=>String(value??'').trim();
const code=value=>{const raw=text(value).replace(/\.0+$/,'');if(!/^\d{1,30}$/.test(raw))throw new Error('O código do cliente deve conter apenas números.');return raw.replace(/^0+(?=\d)/,'');};
function headerMap(row){
 const keys=Array.from(row,key),find=test=>keys.findIndex(test);
 return {
  code:find(value=>['CODIGO','CDIGO','CODCLIENTE','CODIGOCLIENTE','CDIGOCLIENTE','COD'].includes(value)),
  name:find(value=>value.includes('RAZ')&&value.includes('SOCIAL')||['NOME','CLIENTE','NOMECLIENTE'].includes(value)),
  fantasy:find(value=>value.includes('FANTASIA')),
  city:find(value=>['CIDADE','MUNICIPIO','MUNICPIO','CIDADEUF'].includes(value)),
  uf:find(value=>['UF','ESTADO'].includes(value)),
  status:find(value=>value.startsWith('SITUA')||value==='STATUS'),
  repCode:find(value=>['REPRESENTANTE','CODREP','CODIGOREPRESENTANTE','CDIGOREPRESENTANTE'].includes(value)),
  rep:find(value=>value.includes('REPRESENTANTE')&&(value.startsWith('DESCRI')||value.startsWith('NOME'))||['VENDEDOR','NOMEDOVENDEDOR','REP'].includes(value))
 };
}
export function rowsToClientCatalog(rows,name,importedAt=new Date().toISOString()){
 if(!Array.isArray(rows))throw new Error('A planilha não contém linhas válidas.');
 let header=-1,map;
 for(let index=0;index<Math.min(rows.length,30);index++){const candidate=headerMap(rows[index]||[]);if(candidate.code>=0&&candidate.name>=0&&candidate.city>=0){header=index;map=candidate;break;}}
 if(header<0)throw new Error('Não encontrei as colunas Código, Razão Social / Nome e Cidade na planilha.');
 const clients=[],seen=new Set();
 for(let index=header+1;index<rows.length;index++){
  const row=rows[index]||[];if(!row.some(value=>text(value)))continue;
  let clientCode;try{clientCode=code(row[map.code]);}catch{throw new Error('Código inválido na linha '+(index+1)+'. Corrija a planilha antes de importar.');}
  if(seen.has(clientCode))throw new Error('O código '+clientCode+' está repetido. Nenhum cadastro foi salvo.');
  const name=text(row[map.name]),rawCity=text(row[map.city]),suffix=rawCity.match(/\s*\/\s*([A-Za-z]{2})$/),uf=text(map.uf>=0?row[map.uf]:suffix?.[1]).toUpperCase(),city=rawCity.replace(/\s*\/\s*[A-Za-z]{2}$/,'').trim();
  if(!name||name.length>500||!city||city.length>490||!UFS.has(uf))throw new Error('Nome, cidade ou UF inválidos na linha '+(index+1)+'. Nenhum cadastro foi salvo.');
  const rawRepCode=map.repCode>=0?text(row[map.repCode]):'',numericRep=/^\d+(?:\.0+)?$/.test(rawRepCode),rep=text(map.rep>=0?row[map.rep]:numericRep?'':rawRepCode),fantasy=text(map.fantasy>=0?row[map.fantasy]:''),status=text(map.status>=0?row[map.status]:'');
  if([rep,fantasy,status].some(value=>value.length>500||/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value)))throw new Error('Texto inválido na linha '+(index+1)+'.');
  clients.push({code:clientCode,name,fantasy,city:city+' / '+uf,uf,rep,repCode:numericRep?code(rawRepCode):'',status});seen.add(clientCode);
  if(clients.length>MAX_CLIENTS)throw new Error('A base aceita até 10.000 clientes por arquivo.');
 }
 if(!clients.length)throw new Error('A planilha não contém clientes.');
 clients.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||a.city.localeCompare(b.city,'pt-BR')||a.code.localeCompare(b.code));
 return {source:{name:text(name).slice(0,500)||'Base de clientes',importedAt,rowCount:clients.length},clients};
}
export function parseClientCSV(content){
 const value=String(content).replace(/^\uFEFF/,''),first=value.split(/\r?\n/,1)[0]||'',separator=first.includes(';')?';':first.includes('\t')?'\t':',';
 const rows=[];let row=[],cell='',quoted=false;
 for(let index=0;index<value.length;index++){
  const char=value[index];
  if(char==='"'){if(quoted&&value[index+1]==='"'){cell+='"';index++;}else if(quoted||!cell)quoted=!quoted;else throw new Error('O CSV contém aspas inválidas.');}
  else if(char===separator&&!quoted){row.push(cell);cell='';}
  else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&value[index+1]==='\n')index++;row.push(cell);rows.push(row);row=[];cell='';}
  else cell+=char;
 }
 if(quoted)throw new Error('O CSV contém texto entre aspas sem fechamento.');
 if(cell||row.length){row.push(cell);rows.push(row);}
 return rows;
}
function xmlDocument(content,label){
 if(content.length>MAX_XML||/<!DOCTYPE|<!ENTITY/i.test(content))throw new Error('Estrutura XML não permitida no arquivo.');
 const doc=new DOMParser().parseFromString(content,'application/xml');
 if(doc.getElementsByTagName('parsererror').length)throw new Error('Não foi possível ler '+label+' no arquivo Excel.');
 return doc;
}
const children=(node,name)=>[...node.getElementsByTagNameNS('*',name)];
function columnIndex(address){let result=0;for(const char of address.match(/^[A-Z]+/i)?.[0].toUpperCase()||'')result=result*26+char.charCodeAt(0)-64;return result-1;}
async function zipEntries(buffer){
 const bytes=new Uint8Array(buffer),view=new DataView(buffer),decode=new TextDecoder('utf-8',{fatal:true});
 const read16=offset=>view.getUint16(offset,true),read32=offset=>view.getUint32(offset,true);
 let end=-1;
 for(let index=bytes.length-22;index>=Math.max(0,bytes.length-65557);index--)if(read32(index)===0x06054b50&&index+22+read16(index+20)===bytes.length){end=index;break;}
 if(end<0)throw new Error('O arquivo não é um XLSX válido.');
 const count=read16(end+10),size=read32(end+12),offset=read32(end+16);
 if(read16(end+4)!==0||read16(end+6)!==0||read16(end+8)!==count||count>1024||offset+size>end)throw new Error('Estrutura compactada do Excel não suportada.');
 const entries=new Map();let cursor=offset,expanded=0;
 for(let index=0;index<count;index++){
  if(cursor+46>bytes.length||read32(cursor)!==0x02014b50)throw new Error('Arquivo Excel incompleto.');
  const flags=read16(cursor+8),method=read16(cursor+10),compressed=read32(cursor+20),uncompressed=read32(cursor+24),nameSize=read16(cursor+28),extra=read16(cursor+30),comment=read16(cursor+32),local=read32(cursor+42);
  if(cursor+46+nameSize+extra+comment>offset+size||flags&1||![0,8].includes(method)||uncompressed>MAX_XML)throw new Error('Arquivo Excel protegido ou incompatível.');
  const name=decode.decode(bytes.subarray(cursor+46,cursor+46+nameSize));
  if(name.startsWith('/')||name.split('/').includes('..')||name.includes('\\')||entries.has(name))throw new Error('Estrutura de caminhos inválida no Excel.');
  expanded+=uncompressed;if(expanded>MAX_EXPANDED)throw new Error('O arquivo Excel é grande demais após descompactar.');
  if(local+30>offset||read32(local)!==0x04034b50)throw new Error('Arquivo Excel incompleto.');
  const start=local+30+read16(local+26)+read16(local+28);if(start+compressed>offset)throw new Error('Arquivo Excel incompleto.');
  entries.set(name,{method,uncompressed,bytes:bytes.subarray(start,start+compressed)});cursor+=46+nameSize+extra+comment;
 }
 if(cursor!==offset+size)throw new Error('Índice do Excel inválido.');
 return async name=>{
  const entry=entries.get(name);if(!entry)return null;
  let data=entry.bytes;
  if(entry.method===8){
   if(typeof DecompressionStream!=='function')throw new Error('Este navegador não abre XLSX. Use um navegador atualizado ou salve a planilha como CSV.');
   let stream;try{stream=new DecompressionStream('deflate-raw');}catch{throw new Error('Este navegador não abre XLSX. Salve a planilha como CSV.');}
   const reader=new Blob([data]).stream().pipeThrough(stream).getReader(),chunks=[];let length=0;
   while(true){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;if(length>entry.uncompressed||length>MAX_XML){await reader.cancel();throw new Error('Conteúdo descompactado excede o limite permitido.');}chunks.push(item.value);}
   data=new Uint8Array(length);let position=0;for(const chunk of chunks){data.set(chunk,position);position+=chunk.length;}
  }
  if(data.length!==entry.uncompressed)throw new Error('Conteúdo do Excel está incompleto.');
  return decode.decode(data);
 };
}
async function workbookRows(buffer){
 const read=await zipEntries(buffer),workbook=await read('xl/workbook.xml'),relationships=await read('xl/_rels/workbook.xml.rels');
 if(!workbook||!relationships)throw new Error('Não encontrei as planilhas no arquivo XLSX.');
 const rels=new Map(children(xmlDocument(relationships,'os vínculos'),'Relationship').filter(node=>node.getAttribute('TargetMode')!=='External').map(node=>[node.getAttribute('Id'),node.getAttribute('Target')]));
 const sharedXML=await read('xl/sharedStrings.xml'),strings=sharedXML?children(xmlDocument(sharedXML,'os textos'),'si').map(node=>children(node,'t').map(text=>text.textContent).join('')):[];
 const sheets=children(xmlDocument(workbook,'as planilhas'),'sheet');
 for(const sheet of sheets){
  const relId=sheet.getAttribute('r:id')||sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'),target=rels.get(relId);
  if(!target)continue;
  const path=target.startsWith('/')?target.slice(1):'xl/'+target;
  if(path.split('/').includes('..'))continue;
  const xml=await read(path);if(!xml)continue;
  const rows=[];
  for(const row of children(xmlDocument(xml,'os clientes'),'row')){
   const values=[];
   for(const cell of children(row,'c')){
    const column=columnIndex(cell.getAttribute('r')||'');if(column<0||column>1023)throw new Error('A planilha possui colunas fora do limite permitido.');
    const type=cell.getAttribute('t'),value=children(cell,'v')[0]?.textContent??'';
    if(children(cell,'f').length)throw new Error('A base de clientes deve conter valores, sem fórmulas. Exporte a consulta novamente ou cole os valores em outra planilha.');
    values[column]=type==='s'?(strings[Number(value)]??''):type==='inlineStr'?children(cell,'t').map(node=>node.textContent).join(''):value;
   }
   rows.push(values);if(rows.length>MAX_CLIENTS+30)throw new Error('A planilha ultrapassa o limite de 10.000 clientes.');
  }
  if(rows.slice(0,30).some(row=>{const map=headerMap(row);return map.code>=0&&map.name>=0&&map.city>=0;}))return rows;
 }
 throw new Error('Não encontrei uma aba com Código, Razão Social / Nome e Cidade.');
}
export async function readClientCatalog(file){
 if(!file||typeof file.arrayBuffer!=='function'||!file.size||file.size>MAX_FILE)throw new Error('Escolha um arquivo XLSX ou CSV de até 8 MB.');
 const extension=String(file.name||'').split('.').at(-1).toLowerCase(),buffer=await file.arrayBuffer();
 if(buffer.byteLength>MAX_FILE)throw new Error('O arquivo ultrapassa o limite de 8 MB.');
 let rows;
 if(extension==='xlsx')rows=await workbookRows(buffer);
 else if(extension==='csv'||extension==='tsv'){
  let content;try{content=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{content=new TextDecoder('windows-1252').decode(buffer);}
  rows=parseClientCSV(content);
 }else throw new Error('Formato não suportado. Use XLSX, CSV ou TSV.');
 return rowsToClientCatalog(rows,file.name);
}
