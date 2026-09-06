import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoreClient, CoreClientError } from '../../../dist/apps/harness/src/core-client.js';
import { Context } from '@deepseek-ai/cordis';
import * as plugin from '../../../dist/apps/harness/src/cordis-plugin.js';
const id = '00000000-0000-4000-8000-000000000001';
const config = { baseUrl: 'http://127.0.0.1:8000', tenantId: id, domainId: id, getAccessToken: async () => 'synthetic-test-token' };

test('client binds tenant and exposes no approval action', async () => {
  const calls = [];
  const client = new CoreClient({ ...config, fetch: async (url, request) => {
    calls.push({ url, request }); return Response.json({ status: 'knowledge_gap' });
  }});
  await client.query({ question: 'Synthetic question' });
  assert.equal(calls[0].request.headers['X-Tenant-ID'], id);
  assert.equal(calls[0].request.headers.Authorization, 'Bearer synthetic-test-token');
  assert.equal(calls[0].request.redirect, 'error');
  assert.equal(client.approve, undefined);
  assert.equal(client.publish, undefined);
});

test('credential callback runs separately for each request', async () => {
  let requests = 0;
  const client = new CoreClient({ ...config, getAccessToken: async () => `synthetic-${++requests}`, fetch: async () => Response.json({}) });
  await client.query({ question: 'a' }); await client.query({ question: 'b' });
  assert.equal(requests, 2);
});

test('remote cleartext and embedded credentials are rejected', () => {
  assert.throws(() => new CoreClient({ ...config, baseUrl: 'http://enterprise.invalid' }));
  assert.throws(() => new CoreClient({ ...config, baseUrl: 'https://user:password@example.invalid' }));
});

test('errors do not echo confidential server details', async () => {
  const client = new CoreClient({ ...config, fetch: async () => Response.json({ secret: 'private source' }, { status: 403 }) });
  await assert.rejects(client.query({ question: 'a' }), e => e instanceof CoreClientError && !e.message.includes('private source'));
});

test('real Cordis lifecycle mounts and disposes the client', async () => {
  const ctx = new Context();
  let signal;
  const fiber = ctx.plugin(plugin, { ...config, fetch: async (_, request) => { signal = request.signal; return Response.json({}); } });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(ctx.cortexKnowledge?.client);
  const client = ctx.cortexKnowledge.client;
  await client.query({ question: 'a' });
  assert.equal(signal.aborted, false);
  await fiber.dispose();
  assert.equal(signal.aborted, true);
  assert.equal(ctx.get('cortexKnowledge'), undefined);
});
