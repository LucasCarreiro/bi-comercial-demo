// Gera os arquivos estáticos derivados do gerador fictício (public/js/demo-api.js):
// a base de clientes (client-catalog.js) e as sementes JSON usadas pela versão PHP.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const context = {console, Intl, Date, Math, JSON, Map, Set, Array, Object, String, Number};
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(path.join(dir, 'public/js/demo-api.js'), 'utf8'), context);
const demo = context.BI_DEMO;

const catalog = demo.clientCatalog();
fs.writeFileSync(path.join(dir, 'public/js/client-catalog.js'),
  '// Base de clientes FICTÍCIA gerada por gerar-dados-demo.mjs a partir de js/demo-api.js.\n' +
  'export const INITIAL_CLIENT_CATALOG=' + JSON.stringify(catalog) + ';\n');

const auxiliary = demo.auxiliarySeed();
fs.writeFileSync(path.join(dir, 'public/data/auxiliary.json'), JSON.stringify(auxiliary, null, 1) + '\n');
fs.writeFileSync(path.join(dir, 'public/data/planning.json'), JSON.stringify(demo.planningSeed(auxiliary), null, 1) + '\n');
console.log('clientes:', catalog.clients.length, '| participantes Top:', auxiliary.topRetailers.length);
