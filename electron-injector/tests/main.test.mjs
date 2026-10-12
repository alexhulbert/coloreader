import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {documentScript} from '../main.mjs';

test('document script keeps the core and adapter in their own world', () => {
    const calls = [];
    const context = {calls, fetch: () => {}};
    runInNewContext(documentScript('exports.enable = (theme) => calls.push(theme);'), context);
    runInNewContext('globalThis.__coloreaderInjector.update({mode: 1}); globalThis.__coloreaderInjector.update(null);', context);
    assert.equal(calls.length, 1);
    assert.deepEqual({...calls[0]}, {mode: 1, immediateModify: true});
    assert.equal(typeof context.DarkReader.Plugins.fetch, 'function');
    assert.equal(context.DarkReader.enable, undefined);
    assert.equal(context.module, undefined);
});
