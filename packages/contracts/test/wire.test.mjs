import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const root = new URL('../', import.meta.url);
for (const file of readdirSync(new URL('examples/', root)).filter(name => name.endsWith('.json'))) {
  test(`wire example: ${file}`, () => {
    const example = JSON.parse(readFileSync(new URL(`examples/${file}`, root)));
    const schema = JSON.parse(readFileSync(new URL(`schema/${example.contract}.json`, root)));
    const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
    assert.equal(ajv.compile(schema)(example.value), example.valid);
  });
}
