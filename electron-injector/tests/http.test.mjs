import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readLimited} from '../http.mjs';

test('response reads stop and cancel at the byte limit', async () => {
    assert.deepEqual(await readLimited(new Response('ok'), 2), Buffer.from('ok'));
    assert.deepEqual(await readLimited(new Response(null), 2), Buffer.alloc(0));
    let reads = 0;
    let cancelled = false;
    const response = new Response(new ReadableStream({
        pull(controller) { reads++; controller.enqueue(new Uint8Array(4096)); },
        cancel() { cancelled = true; },
    }));
    await assert.rejects(readLimited(response, 8192), /too large/);
    assert.ok(cancelled);
    assert.ok(reads < 10, 'response kept reading past the limit');
});
