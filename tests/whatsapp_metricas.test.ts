import test from 'node:test';
import assert from 'node:assert/strict';
import { intervaloDoMes, montarUrlPricing, lerPricingAnalytics } from '../lib/whatsapp/metaMetricas.ts';

test('intervaloDoMes: do dia 1 até o fim de hoje, em UTC', () => {
  const { inicio, fim } = intervaloDoMes(new Date('2026-11-17T15:30:00Z'));
  assert.equal(new Date(inicio * 1000).toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(new Date(fim * 1000).toISOString(), '2026-11-18T00:00:00.000Z');
});

test('montarUrlPricing: usa o WABA e não vaza token na URL', () => {
  const u = montarUrlPricing('123', 1, 2, 'v21.0');
  assert.ok(u.startsWith('https://graph.facebook.com/v21.0/123?fields='));
  assert.ok(decodeURIComponent(u).includes('pricing_analytics.start(1).end(2)'));
  assert.ok(!u.includes('access_token'));
});

test('lerPricingAnalytics: soma volume e custo por categoria', () => {
  const linhas = lerPricingAnalytics({
    pricing_analytics: {
      data: [
        {
          data_points: [
            { pricing_category: 'MARKETING', volume: 10, cost: 0.5 },
            { pricing_category: 'UTILITY', volume: 4, cost: 0.02 },
            { pricing_category: 'MARKETING', volume: 5, cost: 0.25 },
          ],
        },
      ],
    },
  });
  const m = linhas.find((l) => l.categoria === 'marketing')!;
  assert.equal(m.volume, 15);
  assert.equal(m.custo, 0.75);
  assert.equal(linhas.length, 2);
});

test('lerPricingAnalytics: resposta vazia ou estranha vira lista vazia', () => {
  assert.deepEqual(lerPricingAnalytics({}), []);
  assert.deepEqual(lerPricingAnalytics(null), []);
  assert.deepEqual(lerPricingAnalytics({ pricing_analytics: { data: 'x' } }), []);
});
