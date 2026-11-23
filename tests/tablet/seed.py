import json
import os
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

base = 'http://127.0.0.1:18770'
token = os.environ['POCKETMIND_API_TOKEN']
for app, expected in [('youtube','youtube.force-ssl'),('google-drive','drive.file'),('google-gmail','gmail.readonly')]:
    req = Request(base + '/v1/integrations/'+app+'/connect', data=b'{}', headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    auth = urlparse(json.load(urlopen(req, timeout=5))['authorizationUrl'])
    args = parse_qs(auth.query)
    scopes = args['scope'][0].split()
    assert auth.hostname == 'accounts.google.com' and args['include_granted_scopes'] == ['false']
    assert 'https://www.googleapis.com/auth/'+expected in scopes
    if app == 'google-drive':
        assert not any('youtube' in scope for scope in scopes)
    with urlopen(base+'/v1/oauth/google/callback?'+urlencode({'state':args['state'][0],'code':'test-code'}), timeout=5) as reply:
        assert app in reply.read().decode()
print('Isolated Google scopes and synthetic OAuth callbacks passed')
