import { CONNECTED_APP_CATALOG } from '../connectedAppsCatalog';

describe('connected app catalog', () => {
  it('contains a broad set of unique one-tap-connector IDs', () => {
    expect(CONNECTED_APP_CATALOG.length).toBeGreaterThanOrEqual(50);
    const ids = CONNECTED_APP_CATALOG.map((app) => app.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      'google-gmail', 'notion', 'github', 'gitlab', 'figma', 'salesforce',
      'hubspot', 'shopify', 'stripe', 'cloudflare', 'aws-s3', 'supabase',
    ]));
  });

  it('uses stable server keys and unique action IDs for every app', () => {
    for (const app of CONNECTED_APP_CATALOG) {
      expect(app.webhookKey).toBe(app.id);
      expect(app.officialSetupUrl).toMatch(/^https:\/\//);
      expect(app.actions.length).toBeGreaterThan(0);
      expect(new Set(app.actions.map((action) => action.id)).size).toBe(app.actions.length);
    }
  });
});
