import {
  beginIntegrationConnection,
  disconnectIntegration,
  getIntegrationConnections,
  isIntegrationUsable,
  chatIntegrationRequest,
} from '../integrationActions';

describe('integration connection client', () => {
  afterEach(() => jest.restoreAllMocks());

  it('routes connection and explicit mail requests without executing an unapproved write', () => {
    expect(chatIntegrationRequest('지메일 연결해줘')).toEqual({ id: 'google-gmail', action: 'connect' });
    expect(chatIntegrationRequest('/connect Google Drive')).toEqual({ id: 'google-drive', action: 'connect' });
    expect(chatIntegrationRequest('name@example.org 으로 메일 보내줘')).toEqual({ id: 'google-gmail', action: 'compose' });
    expect(chatIntegrationRequest('이메일을 보내는 방법 설명해줘')).toBeNull();
    expect(isIntegrationUsable({ mode: 'oauth', configured: true, connected: false })).toBe(false);
  });

  it('reads verified OAuth connection state from the coordinator', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        integrations: [{
          id: 'google-gmail',
          configured: true,
          connectable: true,
          connected: true,
          mode: 'oauth',
          accountLabel: 'user@example.com',
        }],
      }),
    } as any);

    const result = await getIntegrationConnections('https://coordinator.example/', 'token');

    expect(result[0]).toMatchObject({ id: 'google-gmail', connected: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://coordinator.example/v1/integrations',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('starts one-tap OAuth only with a secure authorization URL', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ authorizationUrl: 'https://accounts.example/oauth' }),
    } as any);

    await expect(beginIntegrationConnection(
      'https://coordinator.example',
      'token',
      'google-gmail',
    )).resolves.toBe('https://accounts.example/oauth');
  });

  it('rejects an unsafe authorization URL and supports disconnect', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ authorizationUrl: 'http://unsafe.example/oauth' }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          id: 'google-gmail', configured: true, connectable: true, connected: false, mode: 'oauth',
        }),
      } as any);

    await expect(beginIntegrationConnection(
      'https://coordinator.example', 'token', 'google-gmail',
    )).rejects.toThrow('invalid authorization URL');
    await expect(disconnectIntegration(
      'https://coordinator.example', 'token', 'google-gmail',
    )).resolves.toMatchObject({ connected: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
