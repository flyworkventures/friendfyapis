/**
 * Yapılandırılmış logger.
 * Örnek: ✅ [AUTH] User authenticated  |  ❌ [DATABASE] MySQL bağlantı hatası
 *
 * Ortam: LOG_LEVEL=debug|info|warn|error (varsayılan: info)
 */

const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const EMOJI = {
  debug: '🔍',
  info: '✅',
  warn: '⚠️',
  error: '❌',
};

function resolveMinLevel() {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

function serializeMeta(meta) {
  if (meta === undefined || meta === null) return '';
  if (meta instanceof Error) {
    return meta.stack || meta.message;
  }
  if (typeof meta === 'string') return meta;
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

class Logger {
  constructor(tag = 'APP') {
    this.tag = tag;
  }

  child(tag) {
    return new Logger(tag);
  }

  _log(level, message, meta) {
    if (LEVELS[level] < resolveMinLevel()) return;

    const emoji = EMOJI[level];
    const prefix = `${emoji} [${this.tag}]`;
    const extra = serializeMeta(meta);
    const line = extra ? `${prefix} ${message} ${extra}` : `${prefix} ${message}`;

    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  debug(message, meta) {
    this._log('debug', message, meta);
  }

  info(message, meta) {
    this._log('info', message, meta);
  }

  warn(message, meta) {
    this._log('warn', message, meta);
  }

  error(message, meta) {
    this._log('error', message, meta);
  }
}

const root = new Logger('FRIENDIFY');

function createLogger(tag) {
  return new Logger(tag);
}

module.exports = root;
module.exports.Logger = Logger;
module.exports.createLogger = createLogger;
