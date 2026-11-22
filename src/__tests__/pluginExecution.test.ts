import { AI_PLUGIN_CATALOG, rankPluginsForPrompt, runAutonomousPlugins } from '../aiModelsAndPlugins';

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
    const executeMocks = AI_PLUGIN_CATALOG.map((plugin) =>
      jest.spyOn(plugin, 'execute').mockResolvedValue(`mock:${plugin.id}`),
    );
    const prompt = selected.map((item) => item.keyword).join(' ');
    const output = await runAutonomousPlugins(prompt, AI_PLUGIN_CATALOG.map((plugin) => plugin.id));

    expect(output.length).toBeGreaterThan(4);
    expect(output.length).toBeLessThanOrEqual(8);
    const catalogIndexes = output.map((item) => AI_PLUGIN_CATALOG.findIndex((plugin) => plugin.id === item.id));
    expect(catalogIndexes).toEqual([...catalogIndexes].sort((a, b) => a - b));
    executeMocks.forEach((mock) => mock.mockRestore());
  });

  it('routes a related natural-language command to an enabled on-demand plugin', async () => {
    const pluginId = 'ai-devils-advocate';
    const matches = rankPluginsForPrompt('이 사업 계획의 반론과 리스크를 검증해줘', [pluginId]);
    expect(matches[0]?.plugin.id).toBe(pluginId);

    const output = await runAutonomousPlugins(
      '이 사업 계획의 반론과 리스크를 검증해줘',
      [pluginId],
    );
    expect(output.map((item) => item.id)).toContain(pluginId);
  });

  it('inspects the entire enabled catalog but does not run disabled matches', async () => {
    const apiPlugin = 'ai-api-spec';
    expect(rankPluginsForPrompt('REST API 엔드포인트를 설계해줘', [apiPlugin])[0]?.plugin.id)
      .toBe(apiPlugin);
    expect(rankPluginsForPrompt('REST API 엔드포인트를 설계해줘', [])).toHaveLength(0);
  });
});
