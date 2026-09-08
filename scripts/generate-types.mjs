import { readdir, readFile, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';
const root = new URL('../packages/contracts/', import.meta.url);
const files = (await readdir(new URL('schema/', root))).filter(name => name.endsWith('.json')).sort();
for (const file of files) {
  const name = file.replace('.json', '');
  const schema = JSON.parse(await readFile(new URL(`schema/${file}`, root), 'utf8'));
  const text = await compile(schema, name, { bannerComment: '/* Generated from the checked-in wire schema. Do not edit. */' });
  const path = new URL(`src/${name}.ts`, root);
  if (process.argv.includes('--check')) {
    if (await readFile(path, 'utf8') !== text) throw new Error(`Generated type drift: ${name}`);
  } else await writeFile(path, text);
}
console.log(`${files.length} TypeScript wire contracts verified/generated`);
