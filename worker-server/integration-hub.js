'use strict';

// The trusted broker owns provider credentials. Its catalog can only narrow PocketMind's action allowlist.
function parseHubCatalog(response, actionRisks) {
  if (!Array.isArray(response?.integrations)) throw new Error('Invalid integration hub catalog');
  const catalog = new Map();
  for (const item of response.integrations) {
    if (!item || !Object.hasOwn(actionRisks, item.id) || !Array.isArray(item.actions) || item.connectable !== true) continue;
    const actions = [...new Set(item.actions.filter(id => typeof id === 'string' && Object.hasOwn(actionRisks[item.id], id)))];
    if (!actions.length) continue;
    catalog.set(item.id, {
      id: item.id, mode: 'oauth', configured: true, connectable: true,
      connected: item.connected === true, actions,
      accountLabel: typeof item.accountLabel === 'string' ? item.accountLabel.slice(0, 120) : null,
    });
  }
  return catalog;
}

module.exports = { parseHubCatalog };
