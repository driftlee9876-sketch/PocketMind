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
    const selected: Array<{ plugin: (typeof AI_PLUGIN_CATALOG)[number]; keyword: string }> = [];
    const seen = new Set<string>();
    for (const plugin of AI_PLUGIN_CATALOG) {
      if (!plugin.autoRun) continue;
      const keyword = plugin.triggerKeywords.find((item) => !seen.has(item.toLocaleLowerCase()));
      if (!keyword) continue;
      seen.add(keyword.toLocaleLowerCase());
      selected.push({ plugin, keyword });
      if (selected.length === 5) break;
    }

    expect(selected).toHaveLength(5);
    const prompt = selected.map((item) => item.keyword).join(' ');
    const output = await runAutonomousPlugins(prompt, AI_PLUGIN_CATALOG.map((plugin) => plugin.id));

    expect(output.length).toBeGreaterThan(4);
    expect(output.length).toBeLessThanOrEqual(8);
    const catalogIndexes = output.map((item) => AI_PLUGIN_CATALOG.findIndex((plugin) => plugin.id === item.id));
    expect(catalogIndexes).toEqual([...catalogIndexes].sort((a, b) => a - b));
  });
});
