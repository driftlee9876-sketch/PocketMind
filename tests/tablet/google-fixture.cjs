// Test data only. No request is sent to a Google account.
global.fetch = async (url, options = {}) => {
  const u = new URL(url);
  if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/token')
    return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600});
  if (options.headers?.Authorization !== 'Bearer fixture-access') throw Error('Unexpected test token');
  if (u.hostname === 'openidconnect.googleapis.com') return Response.json({email:'tablet@example.invalid'});
  if (u.pathname.endsWith('/messages') && u.searchParams.get('q') === 'in:inbox')
    return Response.json({messages:[{id:'mail-test-01'}]});
  if (u.pathname.endsWith('/messages/mail-test-01')) return Response.json({id:'mail-test-01',threadId:'private-thread',
    snippet:'Tablet preview verified',payload:{headers:[{name:'Subject',value:'Tablet mail subject'},{name:'From',value:'Tablet test sender'}]}});
  if (u.pathname === '/drive/v3/files' && u.searchParams.get('q')?.includes('trashed = false'))
    return Response.json({files:[{id:'private-file-id',name:'Tablet Drive report.pdf',modifiedTime:'2026-11-20T12:00:00Z'}]});
  throw Error('Unexpected fixture route: ' + u.pathname);
};
