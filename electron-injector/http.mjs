export async function readLimited(response, limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
        size += chunk.length;
        if (size > limit) throw new Error('Response too large');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
}
