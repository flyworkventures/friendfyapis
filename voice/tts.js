function textToPseudoChunks(text, chunkSize = 120) {
  const safe = String(text || '');
  const chunks = [];
  for (let i = 0; i < safe.length; i += chunkSize) {
    chunks.push(safe.slice(i, i + chunkSize));
  }
  return chunks;
}

function toBase64TextChunk(input) {
  return Buffer.from(input, 'utf8').toString('base64');
}

module.exports = {
  textToPseudoChunks,
  toBase64TextChunk
};
