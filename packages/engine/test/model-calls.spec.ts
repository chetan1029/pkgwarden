import { describe, expect, it } from 'vitest';
import { failingModel, scriptedModel } from '../src/index.js';
import { makeEngine, TEST_LARGE, TEST_SMALL } from './support.js';

describe('model calls', () => {
  it('falls back to the next model when the first one is down', async () => {
    const backup = scriptedModel({ ...TEST_LARGE, tier: 'small', id: 'backup' }, () => ({
      output: { risk: 'low', summary: 'ok' },
    }));
    const result = await makeEngine({ models: { small: [failingModel(TEST_SMALL), backup] } }).run('root', {
      text: 'x',
    });
    expect(result.outcome.status).toBe('done');
    expect(result.events.find(e => e.type === 'model.fallback')).toMatchObject({ from: 'test-small', to: 'backup' });
  });

  it('asks once for a fix when the answer breaks the schema, then gives up', async () => {
    const sloppy = scriptedModel(TEST_SMALL, () => ({ text: '{"risk":"maybe"}' }));
    const result = await makeEngine({ models: { small: [sloppy] } }).run('judge', { text: 'x' });
    expect(result.outcome.status).toBe('failed');
    expect(result.events.filter(e => e.type === 'model.invalid_output')).toHaveLength(2);
    expect(sloppy.requests).toHaveLength(2);
  });

  it('treats a refusal as refused, not as an answer', async () => {
    const declining = scriptedModel(TEST_SMALL, () => ({ text: '', stopReason: 'refusal' }));
    const result = await makeEngine({ models: { small: [declining] } }).run('judge', { text: 'x' });
    expect(result.outcome.status).toBe('refused');
  });
});
