const MockSttProvider = require('./MockSttProvider');
const { VoiceStreamError } = require('../errors');
let DeepgramSttProvider = null;
try {
  DeepgramSttProvider = require('./DeepgramSttProvider');
} catch (_) {
  // optional file may not exist yet during partial edits
}
let OpenAiWhisperSttProvider = null;
try {
  OpenAiWhisperSttProvider = require('./OpenAiWhisperSttProvider');
} catch (_) {
  // optional file may not exist yet during partial edits
}

function createSttProvider(config) {
  const providerName = (config.provider || 'mock').toLowerCase();
  if (providerName === 'mock') {
    return new MockSttProvider(config);
  }
  if (providerName === 'deepgram') {
    if (!DeepgramSttProvider) {
      throw new VoiceStreamError('STT_PROVIDER_NOT_AVAILABLE', 'Deepgram provider dosyası bulunamadı', { recoverable: false });
    }
    return new DeepgramSttProvider(config);
  }
  if (providerName === 'openai-whisper' || providerName === 'openai') {
    if (!OpenAiWhisperSttProvider) {
      throw new VoiceStreamError('STT_PROVIDER_NOT_AVAILABLE', 'OpenAI Whisper provider dosyası bulunamadı', { recoverable: false });
    }
    return new OpenAiWhisperSttProvider(config);
  }
  throw new VoiceStreamError(
    'STT_PROVIDER_NOT_SUPPORTED',
    `Desteklenmeyen STT provider: ${providerName}`,
    { recoverable: false }
  );
}

module.exports = {
  createSttProvider
};
