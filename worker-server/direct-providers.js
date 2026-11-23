'use strict';

const crypto = require('node:crypto');

const ms = 'https://login.microsoftonline.com/common/oauth2/v2.0/';
const providers = {
  microsoft: {
    prefix: 'MICROSOFT', authorize: ms + 'authorize', token: ms + 'token',
    base: 'https://graph.microsoft.com/v1.0', profile: '/me?$select=displayName,userPrincipalName',
  },
  github: {
    prefix: 'GITHUB', authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token',
    base: 'https://api.github.com', profile: '/user',
  },
};

function required(data, key) {
  if (typeof data[key] !== 'string' || !data[key].trim()) throw Error(key + ' 값을 입력해 주세요.');
  return data[key].trim();
}

function segment(input, key) {
  const value = required(input, key);
  if (value === '.' || value === '..' || /[/\\]/.test(value)) throw Error(key + ' 형식을 확인해 주세요.');
  return encodeURIComponent(value);
}

function repo(input) {
  return '/repos/' + segment(input, 'owner') + '/' + segment(input, 'repo');
}

function mail(input) {
  const address = required(input, 'to');
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address)) throw Error('수신자 이메일 주소를 확인해 주세요.');
  return {
    subject: required(input, 'subject'), body: { contentType: 'Text', content: required(input, 'body') },
    toRecipients: [{ emailAddress: { address } }],
  };
}

function dates(input) {
  const start = new Date(required(input, 'start')), end = new Date(required(input, 'end'));
  if (!Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) || end <= start ||
      ![input.start, input.end].every(x => /(?:Z|[+-]\d\d:\d\d)$/i.test(x))) throw Error('시작과 종료 시각에 시간대를 포함해 주세요.');
  return [start.toISOString(), end.toISOString()];
}

const get = path => ({path});
const post = (path, body) => ({path, method: 'POST', body});

const apps = {
  github: {
    provider: 'github', scopes: ['public_repo'],
    actions: {
      list_repositories: () => get('/user/repos?per_page=20&sort=updated'),
      search_issues: i => get('/search/issues?' + new URLSearchParams({q: required({query: i.query || i.prompt}, 'query'), per_page: '15'})),
      create_issue: i => post(repo(i) + '/issues', {title: required(i, 'title'), body: i.body || ''}),
      merge_pull_request: i => {
        const number = Number(i.number);
        if (!Number.isSafeInteger(number) || number < 1 || !/^[a-f0-9]{40}$/i.test(i.sha || ''))
          throw Error('PR 번호와 승인할 최신 커밋 SHA를 입력해 주세요.');
        return {path: repo(i) + '/pulls/' + number + '/merge', method: 'PUT', body: {sha: i.sha}};
      },
    },
  },
  'microsoft-outlook': {
    provider: 'microsoft', scopes: ['Mail.ReadWrite', 'Mail.Send'],
    actions: {
      search_messages: i => {
        const q = new URLSearchParams({'$select': 'id,subject,from,receivedDateTime,bodyPreview', '$top': '15'});
        if (i.query || i.prompt) q.set('$search', '"' + String(i.query || i.prompt).replace(/["\\]/g, ' ') + '"');
        return get('/me/messages?' + q);
      },
      create_draft: i => post('/me/messages', mail(i)),
      send_message: i => post('/me/sendMail', {message: mail(i), saveToSentItems: true}),
    },
  },
  'microsoft-calendar': {
    provider: 'microsoft', scopes: ['Calendars.ReadWrite'],
    actions: {
      list_events: () => get('/me/events?$top=20&$select=id,subject,start,end,isCancelled'),
      create_event: i => {
        const [start, end] = dates(i);
        return post('/me/events', {subject: required(i, 'subject'), start: {dateTime: start.slice(0, -1), timeZone: 'UTC'},
          end: {dateTime: end.slice(0, -1), timeZone: 'UTC'}});
      },
      cancel_event: i => post('/me/events/' + segment(i, 'eventId') + '/cancel', {comment: i.comment || ''}),
    },
  },
  'microsoft-onedrive': {
    provider: 'microsoft', scopes: ['Files.ReadWrite'],
    actions: {
      list_files: i => get((i.folderId ? '/me/drive/items/' + segment(i, 'folderId') : '/me/drive/root') +
        '/children?$top=20&$select=id,name,webUrl,size,folder'),
      // Do not return short-lived, pre-authenticated download URLs to saved chat history.
      delete_file: i => ({path: '/me/drive/items/' + segment(i, 'fileId'), method: 'DELETE'}),
    },
  },
  'microsoft-teams': {
    provider: 'microsoft', tenant: 'organizations', scopes: ['Chat.Read', 'ChatMessage.Send', 'OnlineMeetings.ReadWrite'],
    actions: {
      search_messages: i => post('/search/query', {requests: [{entityTypes: ['chatMessage'], query: {
        queryString: required({query: i.query || i.prompt}, 'query')}, size: 10}]}),
      create_meeting: i => {
        const [startDateTime, endDateTime] = dates(i);
        return post('/me/onlineMeetings', {subject: required(i, 'subject'), startDateTime, endDateTime});
      },
      send_message: i => post('/chats/' + segment(i, 'chatId') + '/messages', {body: {contentType: 'text', content: required(i, 'body')}}),
    },
  },
};

const fail = (message, status) => Object.assign(new Error(message), {status});
function directProviders({env, baseUrl, connections, pending, persist, encrypt, decrypt, ttl}) {
  const refreshing = new Map();
  function context(id) {
    if (!Object.hasOwn(apps, id)) return null;
    const app = apps[id], provider = providers[app.provider];
    const clientId = env[provider.prefix + '_OAUTH_CLIENT_ID'], secret = env[provider.prefix + '_OAUTH_CLIENT_SECRET'];
    if (!baseUrl || !clientId || !secret) return null;
    return {app, provider, clientId, secret, redirect: baseUrl + '/v1/oauth/' + app.provider + '/callback'};
  }
  function endpoint(url, app) {
    return app.tenant ? url.replace('/common/', '/' + app.tenant + '/') : url;
  }
  async function token(ctx, parameters) {
    const response = await fetch(endpoint(ctx.provider.token, ctx.app), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({...parameters, client_id: ctx.clientId, client_secret: ctx.secret}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token || data.error)
      throw fail('로그인 토큰을 확인하지 못했어요. 앱에서 다시 연결해 주세요.', 409);
    if (String(data.token_type || '').toLowerCase() !== 'bearer') throw fail('지원되지 않는 인증 방식입니다.', 409);
    if (data.scope && !ctx.app.scopes.every(s => data.scope.toLowerCase().split(/[ ,]+/).includes(s.toLowerCase())))
      throw fail('선택한 앱의 권한 승인이 필요합니다.', 409);
    return data;
  }
  async function request(ctx, access, route) {
    if (!/^\/(?!\/)/.test(route.path)) throw Error('잘못된 API 경로입니다.');
    const headers = {Authorization: 'Bearer ' + access, Accept: 'application/json', 'User-Agent': 'PocketMind'};
    if (route.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(ctx.provider.base + route.path, {
      method: route.method || 'GET', headers, body: route.body === undefined ? undefined : JSON.stringify(route.body),
      redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw fail('서비스 요청에 실패했어요 (HTTP ' + response.status + '). 계정 권한과 입력값을 확인해 주세요.',
      response.status === 401 || response.status === 403 ? 409 : 502);
    const body = await response.text();
    return body ? JSON.parse(body) : {ok: true};
  }
  function writeTokens(record, data) {
    record.accessToken = encrypt(data.access_token);
    if (data.refresh_token) record.refreshToken = encrypt(data.refresh_token);
    record.expiresAt = data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null;
  }
  async function access(id) {
    const record = connections()[id];
    if (!record || !record.accessToken) throw fail('먼저 계정을 연결해 주세요.', 409);
    if (!record.expiresAt || record.expiresAt > Date.now() + 60000) return decrypt(record.accessToken);
    if (!record.refreshToken) throw fail('앱 연결을 갱신해 주세요.', 409);
    if (refreshing.has(record)) return refreshing.get(record);
    const refresh = (async () => {
      const data = await token(context(id), {grant_type: 'refresh_token', refresh_token: decrypt(record.refreshToken)});
      if (connections()[id] !== record) throw fail('계정 연결이 변경되었어요.', 409);
      writeTokens(record, data);
      await persist();
      return data.access_token;
    })();
    refreshing.set(record, refresh);
    try {return await refresh;} finally {refreshing.delete(record);}
  }
  return {
    ids: () => Object.keys(apps).filter(id => context(id)),
    supports: id => Boolean(context(id)),
    async start(id) {
      const ctx = context(id), nonce = crypto.randomBytes(32).toString('base64url');
      const verifier = crypto.randomBytes(48).toString('base64url');
      pending()[nonce] = {integrationId: id, provider: ctx.app.provider, verifier: encrypt(verifier), expiresAt: Date.now() + ttl};
      await persist();
      const url = new URL(endpoint(ctx.provider.authorize, ctx.app));
      const scopes = ctx.app.provider === 'microsoft' ? ['offline_access', 'User.Read', ...ctx.app.scopes] : ctx.app.scopes;
      url.search = new URLSearchParams({client_id: ctx.clientId, response_type: 'code', redirect_uri: ctx.redirect,
        scope: scopes.join(' '), state: nonce, code_challenge_method: 'S256',
        code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url')}).toString();
      return url.toString();
    },
    async callback(provider, url) {
      const nonce = url.searchParams.get('state'), item = pending()[nonce];
      if (!item || item.provider !== provider || item.expiresAt <= Date.now()) throw fail('로그인 요청이 만료되었어요.', 400);
      delete pending()[nonce];
      await persist();
      if (url.searchParams.has('error') || !url.searchParams.get('code')) throw fail('로그인이 완료되지 않았어요.', 400);
      const ctx = context(item.integrationId);
      if (!ctx) throw fail('연결 설정이 변경되었어요.', 409);
      const data = await token(ctx, {code: url.searchParams.get('code'), grant_type: 'authorization_code',
        redirect_uri: ctx.redirect, code_verifier: decrypt(item.verifier)});
      const profile = await request(ctx, data.access_token, get(ctx.provider.profile));
      const identity = String(profile.id || '');
      if (!identity) throw fail('서비스 계정을 확인할 수 없어요.', 409);
      const record = {accountId: identity, accountLabel: String(profile.login || profile.userPrincipalName || profile.displayName || identity).slice(0, 120),
        generation: crypto.randomUUID(), connectedAt: Date.now()};
      writeTokens(record, data);
      connections()[item.integrationId] = record;
      await persist();
      return item.integrationId;
    },
    async status(id) {
      const base = {id, configured: true, connectable: true, connected: false, mode: 'oauth', actions: Object.keys(apps[id].actions)};
      const before = connections()[id];
      if (!before?.generation) return base;
      try {
        const profile = await request(context(id), await access(id), get(context(id).provider.profile));
        if (connections()[id] !== before || String(profile.id) !== before.accountId) throw Error('계정 연결이 변경되었어요.');
        return {...base, connected: true, accountLabel: before.accountLabel};
      } catch (e) {return {...base, statusError: e.message};}
    },
    async disconnect(id) {
      delete connections()[id];
      for (const [key, item] of Object.entries(pending())) if (item.integrationId === id) delete pending()[key];
      await persist();
    },
    async run(action) {
      const {integrationId: id} = action, ctx = context(id);
      if (!ctx || !Object.hasOwn(ctx.app.actions, action.action)) throw fail('지원되지 않는 작업입니다.', 409);
      const value = await access(id);
      if (!action.accountGeneration || action.accountGeneration !== connections()[id]?.generation) throw fail('계정이 변경되었어요. 다시 요청해 주세요.', 409);
      return request(ctx, value, ctx.app.actions[action.action](action.input));
    },
  };
}
module.exports = {directProviders};
