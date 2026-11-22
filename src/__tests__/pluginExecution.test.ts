import { AI_PLUGIN_CATALOG, runAutonomousPlugins } from '../aiModelsAndPlugins';

describe('plugin execution policy', () => {
  it('does not let a slash command bypass the enabled plugin list', async () => {
    const pluginId = 'ai-devils-advocate';
    expect(AI_PLUGIN_CATALOG.some((plugin) => plugin.id === pluginId)).toBe(true);
    const output = await runAutonomousPlugins(`/${pluginId} PocketMind plan`, []);
    expect(output).toHaveLength(0);
  });

  it('runs an explicitly requested plugin only when enabled', async () => {
    const pluginId = 'ai-devils-advocate';
    const output = await runAutonomousPlugins(`/${pluginId} PocketMind plan`, [pluginId]);
    expect(output).toHaveLength(1);
    expect(output[0].id).toBe(pluginId);
    expect(output[0].result).toContain('지침 주입');
  });

  it('runs more than four matching automatic plugins in a bounded, ordered way', async () => {
    const prompt = '3줄요약 핵심만 swot 사업전략 단계별로 심층분석 논리적으로 반론 리스크검증 api설계';
    const output = await runAutonomousPlugins(prompt, AI_PLUGIN_CATALOG.map((plugin) => plugin.id));
    expect(output.length).toBeGreaterThan(4);
    expect(output.length).toBeLessThanOrEqual(8);
  });
});
