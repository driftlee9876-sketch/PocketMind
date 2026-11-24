import { NativeModules } from 'react-native';
import { pairWiredHost, runWiredInference } from '../wiredInference';

beforeEach(() => { NativeModules.PocketMindWorker = { wiredRequest: jest.fn(), cancelWiredRequest: jest.fn() }; });
const signal = new AbortController().signal;
const session = { token: 'a'.repeat(43), model: 'private GGUF', device: 'Vulkan0' };

test('pairs over both fixed loopback tunnels before using the model', async () => {
  const request = NativeModules.PocketMindWorker.wiredRequest
    .mockResolvedValueOnce(JSON.stringify({ ...session, service: 'pocketmind-wired' }))
    .mockResolvedValueOnce(JSON.stringify({ data: [{ id: 'pocketmind-wired' }] }));
  await expect(pairWiredHost('12345678', signal)).resolves.toEqual(session);
  expect(request.mock.calls.map((call: string[]) => call[1])).toEqual(['pair', 'models']);
  expect(request.mock.calls[1][2]).toBe(session.token);
});

test('an unavailable cable cannot silently send the prompt elsewhere', async () => {
  const request = NativeModules.PocketMindWorker.wiredRequest.mockRejectedValue(new Error('USB closed'));
  await expect(runWiredInference(session, [], '안녕', signal)).rejects.toThrow('USB closed');
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][1]).toBe('chat');
});
