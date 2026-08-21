const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const roots = ['server.js','db.js','lib','middleware','routes','services','public'];
const files = [];
function collect(item) {
  const absolute = path.join(__dirname,'..',item);
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    fs.readdirSync(absolute).forEach((child) => collect(path.join(item,child)));
  } else if (item.endsWith('.js')) files.push(item);
}
roots.forEach(collect);
for (const file of files) {
  const result = spawnSync(process.execPath,['--check',file],{ cwd:path.join(__dirname,'..'),stdio:'inherit' });
  if (result.status !== 0) process.exit(result.status);
}
console.log(`${files.length} arquivos JavaScript verificados.`);
