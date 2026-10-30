import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<16))throw Error('Node >=22.16 required');
let files=0;
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(/\.(mjs|js)$/.test(file)){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);files++}}}
for(const dir of ['src','scripts','integrations','tests','mobile/src'])if(fs.existsSync(dir))walk(dir);
console.log(`PASS: Node version and syntax of ${files} modules. Run npm run build for React/CSS validation.`);
