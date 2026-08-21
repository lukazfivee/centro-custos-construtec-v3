#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const distDir = path.join(__dirname, '..', 'dist');

const ymlFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.yml') && f.startsWith('latest'));
const exeFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.exe'));

if (!ymlFiles.length) {
  console.log('Nenhum arquivo latest*.yml encontrado em dist/');
  process.exit(0);
}

if (!exeFiles.length) {
  console.log('Nenhum arquivo .exe encontrado em dist/');
  process.exit(1);
}

const setupExe = exeFiles.find(f => f.includes('Setup')) || exeFiles[0];
const setupPath = path.join(distDir, setupExe);
const setupSize = fs.statSync(setupPath).size;
const setupHash = crypto.createHash('sha512').update(fs.readFileSync(setupPath)).digest('base64');

const pkg = require(path.join(__dirname, '..', 'package.json'));
const version = pkg.version;

const yaml = [
  `version: ${version}`,
  `files:`,
  `  - url: ${setupExe}`,
  `    sha512: ${setupHash}`,
  `    size: ${setupSize}`,
  `path: ${setupExe}`,
  `sha512: ${setupHash}`,
  `releaseDate: '${new Date().toISOString()}'`,
].join('\n');

for (const ymlFile of ymlFiles) {
  const ymlPath = path.join(distDir, ymlFile);
  const oldContent = fs.readFileSync(ymlPath, 'utf8');
  const newContent = oldContent
    .replace(/url: .+/g, `url: ${setupExe}`)
    .replace(/path: .+/g, `path: ${setupExe}`);

  if (oldContent !== newContent) {
    fs.writeFileSync(ymlPath, newContent, 'utf8');
    console.log(`Corrigido: ${ymlFile} -> ${setupExe}`);
  } else {
    console.log(`${ymlFile} já está correto`);
  }
}

console.log(`SHA512: ${setupHash}`);
console.log(`Tamanho: ${setupSize} bytes`);
