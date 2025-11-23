class Logger {
  constructor(component, enabled = true, level = 'info') {
    this.component = component;
    this.enabled = enabled;
    this.level = level;
    
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    this.levelValue = levels[level] ?? levels.info;
    
    // Cache Date object and timestamp string to avoid allocations
    this._cachedDate = new Date();
    this._cachedTimestamp = '';
    this._lastTimestampUpdate = 0;
    this._timestampUpdateInterval = 1; // Update timestamp every 1ms
  }

  _shouldLog(level) {
    if (!this.enabled) return false;
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    const levelValue = levels[level] ?? levels.info;
    return levelValue <= this.levelValue;
  }

  _formatMessage(level, message, data = {}) {
    // Update cached timestamp only if enough time has passed
    const now = Date.now();
    if (now - this._lastTimestampUpdate >= this._timestampUpdateInterval) {
      this._cachedDate.setTime(now);
      this._cachedTimestamp = this._cachedDate.toISOString();
      this._lastTimestampUpdate = now;
    }
    
    const prefix = `[MindAR:${this.component}]`;
    
    // Create object with data spread (necessary for console.log serialization)
    // The object is small and will be GC'd quickly after console.log serializes it
    return { timestamp: this._cachedTimestamp, level, prefix, message, ...data };
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

