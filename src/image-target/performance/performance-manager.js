import {Logger} from '../../libs/logger.js';

class PerformanceManager {
  constructor(config = {}) {
    this.config = {
      targetFrameTime: config.targetFrameTime ?? 33.33, // 30 FPS target (ms)
      minFrameTime: config.minFrameTime ?? 16.67, // 60 FPS max (ms)
      adaptationInterval: config.adaptationInterval ?? 30, // frames
      qualityChangeThreshold: config.qualityChangeThreshold ?? 0.15, // 15% change
      minQuality: config.minQuality ?? 0.3, // Minimum quality level (0-1)
      maxQuality: config.maxQuality ?? 1.0, // Maximum quality level (0-1)
      ...config
    };

    this.currentQuality = 0.6;
    this.frameTimes = [];
    this.frameCount = 0;
    this.lastAdaptationFrame = 0;
    this.performanceHistory = [];
    this.maxHistorySize = 60; // Keep last 60 frames

    this.logger = new Logger('PerformanceManager', true, config.debugMode ? 'debug' : 'info');
    this.logger.info('Performance manager initialized', {
      targetFrameTime: this.config.targetFrameTime,
      adaptationInterval: this.config.adaptationInterval,
      minQuality: this.config.minQuality,
      maxQuality: this.config.maxQuality
    });
  }

  recordFrameTime(frameTime) {
    this.frameTimes.push(frameTime);
    this.frameCount++;
    
    if (this.frameTimes.length > this.config.adaptationInterval) {
      this.frameTimes.shift();
    }

    let qualityChanged = false;
    if (this.frameCount - this.lastAdaptationFrame >= this.config.adaptationInterval) {
      qualityChanged = this._adaptQuality();
      this.lastAdaptationFrame = this.frameCount;
    }
    
    return qualityChanged;
  }

  _adaptQuality() {
    if (this.frameTimes.length < 5) return false;

    const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const targetFrameTime = this.config.targetFrameTime;
    
    const performanceRatio = targetFrameTime / avgFrameTime;
    const qualityChange = performanceRatio - 1.0;

    const oldQuality = this.currentQuality;
    const oldQualityLevel = this.getQualityLevel();
    let newQuality = this.currentQuality;

    if (Math.abs(qualityChange) > this.config.qualityChangeThreshold) {
      if (qualityChange > 0) {
        newQuality = Math.min(
          this.currentQuality * (1 + qualityChange * 0.5),
          this.config.maxQuality
        );
      } else {
        newQuality = Math.max(
          this.currentQuality * (1 + qualityChange * 0.5),
          this.config.minQuality
        );
      }
      
      newQuality = Math.max(this.config.minQuality, Math.min(this.config.maxQuality, newQuality));
    }

    const qualityChanged = Math.abs(newQuality - this.currentQuality) > 0.05;
    this.currentQuality = newQuality;

    if (qualityChanged) {
      const newQualityLevel = this.getQualityLevel();
      const avgFPS = (1000 / avgFrameTime).toFixed(1);
      
      this.logger.debug('Quality level changed', {
        oldQuality: oldQuality.toFixed(2),
        newQuality: newQuality.toFixed(2),
        oldQualityLevel,
        newQualityLevel,
        avgFrameTime: avgFrameTime.toFixed(2),
        avgFPS,
        performanceRatio: performanceRatio.toFixed(2)
      });
    } else {
      this.logger.debug('Quality adaptation check', {
        quality: this.currentQuality.toFixed(2),
        qualityLevel: this.getQualityLevel(),
        avgFrameTime: avgFrameTime.toFixed(2),
        avgFPS: (1000 / avgFrameTime).toFixed(1),
        qualityChange: qualityChange.toFixed(3),
        threshold: this.config.qualityChangeThreshold
      });
    }

    this.performanceHistory.push({
      frameTime: avgFrameTime,
      quality: this.currentQuality,
      timestamp: performance.now()
    });

    if (this.performanceHistory.length > this.maxHistorySize) {
      this.performanceHistory.shift();
    }

    return qualityChanged;
  }

  getQuality() {
    return this.currentQuality;
  }

  getQualityLevel() {
    if (this.currentQuality >= 0.8) return 'high';
    if (this.currentQuality >= 0.5) return 'medium';
    return 'low';
  }

  reset() {
    this.currentQuality = 0.6;
    this.frameTimes = [];
    this.frameCount = 0;
    this.lastAdaptationFrame = 0;
    this.performanceHistory = [];
    this._cachedStats = null; // Clear cached stats
  }

  getStats() {
    if (this.frameTimes.length === 0) return null;
    
    // Reuse cached stats object to avoid allocations
    if (!this._cachedStats) {
      this._cachedStats = {};
    }
    
    const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    let maxFrameTime = this.frameTimes[0];
    let minFrameTime = this.frameTimes[0];
    for (let i = 1; i < this.frameTimes.length; i++) {
      if (this.frameTimes[i] > maxFrameTime) maxFrameTime = this.frameTimes[i];
      if (this.frameTimes[i] < minFrameTime) minFrameTime = this.frameTimes[i];
    }
    
    // Update cached object in place
    this._cachedStats.avgFrameTime = avgFrameTime.toFixed(2);
    this._cachedStats.maxFrameTime = maxFrameTime.toFixed(2);
    this._cachedStats.minFrameTime = minFrameTime.toFixed(2);
    this._cachedStats.currentFPS = (1000 / avgFrameTime).toFixed(1);
    this._cachedStats.quality = this.currentQuality.toFixed(2);
    this._cachedStats.qualityLevel = this.getQualityLevel();
    this._cachedStats.frameCount = this.frameCount;
    
    return this._cachedStats;
  }
}

export {
  PerformanceManager
};

