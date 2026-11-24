'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { directProviders } = require('../direct-providers');

test('Microsoft and GitHub bind the official login, account and available actions', async t => {
  const states = {}, accounts = {};
  const env = {GITHUB_OAUTH_CLIENT_ID: 'test-github', GITHUB_OAUTH_CLIENT_SECRET: 'test-only',
    MICROSOFT_OAUTH_CLIENT_ID: 'test-ms', MICROSOFT_OAUTH_CLIENT_SECRET: 'test-only-ms'};
  const options = {env, baseUrl: 'https://coordinator.example', connections: () => accounts, pending: () => states,
    persist: async () => {}, encrypt: value => 'encrypted:' + value, decrypt: value => value.slice(10), ttl: 60000};
  const direct = directProviders(options);
  assert.deepEqual(directProviders({...options, env: {}}).ids(), []);
  assert.equal(direct.ids().length, 5);
  assert.equal(direct.supports('constructor'), false);
  let grant, query, approved, user = 'github-one';
  const mock = t.mock.method(global, 'fetch', async (url, init) => {
    if (url === 'https://github.com/login/oauth/access_token') {
      grant = init.body;
      return Response.json({token_type: 'bearer', access_token: 'github-token-for-fixture', scope: 'public_repo'});
    }
    if (url === 'https://api.github.com/user') return Response.json({id: user, login: 'example'});
    if (url === 'https://api.github.com/repos/example/repo/issues') {
      approved = JSON.parse(init.body); return Response.json({number: 7});
    }
    if (url.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/token')) {
      return Response.json({token_type: 'Bearer', access_token: 'ms-fixture', refresh_token: 'ms-refresh', expires_in: 3599,
        scope: 'User.Read Mail.ReadWrite Mail.Send'});
    }
    if (url.startsWith('https://graph.microsoft.com/v1.0/me?')) return Response.json({id: 'ms-one', displayName: 'test'});
    if (url.startsWith('https://graph.microsoft.com/v1.0/me/messages?')) {query = new URL(url); return Response.json({value: []});}
    throw Error('Unexpected test URL');
  });
  const gh = new URL(await direct.start('github'));
  assert.equal(gh.origin, 'https://github.com');
  assert.equal(gh.searchParams.get('redirect_uri'), 'https://coordinator.example/v1/oauth/github/callback');
  const nonce = gh.searchParams.get('state');
  const callback = new URL('https://coordinator.example/v1/oauth/github/callback?code=test&state=' + nonce);
  await assert.rejects(direct.callback('microsoft', callback));
  const challenge = gh.searchParams.get('code_challenge');
  assert.equal(await direct.callback('github', callback), 'github');
  assert.equal(crypto.createHash('sha256').update(grant.get('code_verifier')).digest('base64url'), challenge);
  await assert.rejects(direct.callback('github', callback));
  const status = await direct.status('github');
  assert.ok(status.connected); assert.equal(status.accountLabel, 'example');
  assert.ok(accounts.github.accessToken.startsWith('encrypted:'));
  const command = {integrationId: 'github', action: 'create_issue', accountGeneration: accounts.github.generation,
    input: {owner: 'example', repo: 'repo', title: 'fixture'}};
  await assert.rejects(direct.run({...command, input: {...command.input, owner: '..'}}));
  assert.deepEqual(await direct.run(command), {number: 7}); assert.equal(approved.title, 'fixture');
  user = 'different-account'; assert.equal((await direct.status('github')).connected, false);
  await direct.disconnect('github'); await assert.rejects(direct.run(command));
  assert.equal((await direct.status('github')).connected, false);

  const ms = new URL(await direct.start('microsoft-outlook'));
  assert.equal(ms.hostname, 'login.microsoftonline.com');
  assert.match(ms.searchParams.get('scope'), /Mail.Send/);
  assert.doesNotMatch(ms.searchParams.get('scope'), /Calendars/);
  callback.searchParams.set('state', ms.searchParams.get('state'));
  await direct.callback('microsoft', callback);
  const outlook = {integrationId: 'microsoft-outlook', accountGeneration: accounts['microsoft-outlook'].generation,
    action: 'search_messages', input: {query: '휴가'}};
  assert.deepEqual(await direct.run(outlook), {value: []});
  assert.equal(query.searchParams.get('$search'), '"휴가"');
  await assert.rejects(direct.run({...outlook, action: 'execute'}));
  const teams = new URL(await direct.start('microsoft-teams'));
  assert.ok(teams.pathname.startsWith('/organizations/'));
  await direct.disconnect('microsoft-teams');
  assert.equal(states[teams.searchParams.get('state')], undefined);
  assert.ok(mock.mock.callCount() >= 7);
});
