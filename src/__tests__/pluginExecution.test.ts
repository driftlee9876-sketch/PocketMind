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
    const keywords = new Set<string>();
    const targetPlugins = AI_PLUGIN_CATALOG.filter((plugin) => {
      if (!plugin.autoRun) return false;
      const keyword = plugin.triggerKeywords.find((item) => !keywords.has(item.toLocaleLowerCase()));
      if (!keyword) return false;
      keywords.add(keyword.toLocaleLowerCase());
      return true;
    }).slice(0, 5);

    expect(targetPlugins.length).toBe(5);
    const prompt = targetPlugins
      .map((plugin) => plugin.triggerKeywords.find((item) => keywords.has(item.toLocaleLowerCase()))!)
      .join(' ');
    const output = await runAutonomousPlugins(prompt, AI_PLUGIN_CATALOG.map((plugin) => plugin.id));

    expect(output.length).toBeGreaterThan(4);
    expect(output.length).toBeLessThanOrEqual(8);
    const catalogIndexes = output.map((item) => AI_PLUGIN_CATALOG.findIndex((plugin) => plugin.id === item.id));
    expect(catalogIndexes).toEqual([...catalogIndexes].sort((a, b) => a - b));
  });
});
