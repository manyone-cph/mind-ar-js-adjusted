class Logger {
  constructor(component, enabled = true, level = 'info') {
    this.component = component;
    this.enabled = enabled;
    this.level = level;
    
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    this.levelValue = levels[level] ?? levels.info;
  }

  _shouldLog(level) {
    if (!this.enabled) return false;
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    const levelValue = levels[level] ?? levels.info;
    return levelValue <= this.levelValue;
  }

  _formatMessage(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const prefix = `[MindAR:${this.component}]`;
    return { timestamp, level, prefix, message, ...data };
  }

  error(message, data = {}) {
    if (!this._shouldLog('error')) return;
    const formatted = this._formatMessage('ERROR', message, data);
    console.error(`${formatted.prefix} ${formatted.message}`, formatted);
  }

  warn(message, data = {}) {
    if (!this._shouldLog('warn')) return;
    const formatted = this._formatMessage('WARN', message, data);
    console.warn(`${formatted.prefix} ${formatted.message}`, formatted);
  }

  info(message, data = {}) {
    if (!this._shouldLog('info')) return;
    const formatted = this._formatMessage('INFO', message, data);
    console.log(`${formatted.prefix} ${formatted.message}`, formatted);
  }

  debug(message, data = {}) {
    if (!this._shouldLog('debug')) return;
    const formatted = this._formatMessage('DEBUG', message, data);
    console.log(`${formatted.prefix} ${formatted.message}`, formatted);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  setLevel(level) {
    this.level = level;
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    this.levelValue = levels[level] ?? levels.info;
  }
}

export {
  Logger
};

