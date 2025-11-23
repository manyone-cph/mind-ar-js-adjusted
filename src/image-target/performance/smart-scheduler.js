import {Logger} from '../../libs/logger.js';

class SmartScheduler {
  constructor(config = {}) {
    this.config = {
      enableAdaptiveSkipping: config.enableAdaptiveSkipping ?? true,
      skipThreshold: config.skipThreshold ?? 1.5, // Skip if frame time > threshold * target
      maxConsecutiveSkips: config.maxConsecutiveSkips ?? 3, // Max frames to skip in a row
      skipRecoveryFrames: config.skipRecoveryFrames ?? 5, // Frames to wait after skip before skipping again
      ...config
    };

    this.consecutiveSkips = 0;
    this.framesSinceLastSkip = 0;
    this.lastFrameTime = 0;
    this.frameSkipCount = 0;
    this.totalFrames = 0;

    this.logger = new Logger('SmartScheduler', true, config.debugMode ? 'debug' : 'info');
    this.logger.info('Smart scheduler initialized', {
      enableAdaptiveSkipping: this.config.enableAdaptiveSkipping,
      skipThreshold: this.config.skipThreshold,
      maxConsecutiveSkips: this.config.maxConsecutiveSkips
    });
  }

  shouldSkipFrame(frameTime, targetFrameTime) {
    if (!this.config.enableAdaptiveSkipping) {
      return false;
    }

    this.totalFrames++;
    this.framesSinceLastSkip++;

    // If frame time is significantly over target, consider skipping
    const frameTimeRatio = frameTime / targetFrameTime;
    
    // Skip if frame took too long AND we haven't skipped too many in a row
    const shouldSkip = frameTimeRatio > this.config.skipThreshold && 
                       this.consecutiveSkips < this.config.maxConsecutiveSkips &&
                       this.framesSinceLastSkip >= this.config.skipRecoveryFrames;

    if (shouldSkip) {
      this.consecutiveSkips++;
      this.frameSkipCount++;
      this.framesSinceLastSkip = 0;
      
      this.logger.debug('Frame skipped (adaptive)', {
        frameTime: frameTime.toFixed(2),
        targetFrameTime: targetFrameTime.toFixed(2),
        ratio: frameTimeRatio.toFixed(2),
        consecutiveSkips: this.consecutiveSkips
      });
    } else {
      // Reset consecutive skips if we didn't skip
      if (this.consecutiveSkips > 0 && this.framesSinceLastSkip >= this.config.skipRecoveryFrames) {
        this.consecutiveSkips = 0;
      }
    }

    return shouldSkip;
  }

  recordFrame(frameTime) {
    this.lastFrameTime = frameTime;
  }

  getSkipStats() {
    const skipRate = this.totalFrames > 0 ? (this.frameSkipCount / this.totalFrames * 100).toFixed(1) : '0.0';
    return {
      totalFrames: this.totalFrames,
      skippedFrames: this.frameSkipCount,
      skipRate: skipRate + '%',
      consecutiveSkips: this.consecutiveSkips
    };
  }

  reset() {
    this.consecutiveSkips = 0;
    this.framesSinceLastSkip = 0;
    this.lastFrameTime = 0;
    this.frameSkipCount = 0;
    this.totalFrames = 0;
  }
}

// Enhanced requestVideoFrameCallback wrapper with better timing
function createVideoFrameScheduler(videoElement, callback, debugMode = false) {
  const logger = new Logger('VideoFrameScheduler', true, debugMode ? 'debug' : 'info');
  
  if (!videoElement || typeof videoElement.requestVideoFrameCallback !== 'function') {
    logger.warn('requestVideoFrameCallback not available, falling back to requestAnimationFrame');
    return null;
  }

  let lastFrameTime = 0;
  let frameCount = 0;
  let scheduled = false;

  const scheduleNext = (now, metadata) => {
    scheduled = false;
    frameCount++;

    // Use metadata for better timing if available
    const frameTime = metadata ? (metadata.mediaTime - lastFrameTime) * 1000 : performance.now() - lastFrameTime;
    lastFrameTime = metadata ? metadata.mediaTime * 1000 : performance.now();

    // Call the frame processor
    callback(now, metadata).then(() => {
      if (!scheduled) {
        scheduled = true;
        videoElement.requestVideoFrameCallback(scheduleNext);
      }
    }).catch(error => {
      logger.error('Frame processing error', { error: error.message });
      if (!scheduled) {
        scheduled = true;
        videoElement.requestVideoFrameCallback(scheduleNext);
      }
    });
  };

  return {
    start: () => {
      if (!scheduled) {
        scheduled = true;
        videoElement.requestVideoFrameCallback(scheduleNext);
        logger.info('Video frame scheduler started');
      }
    },
    stop: () => {
      scheduled = false;
      logger.info('Video frame scheduler stopped');
    },
    getStats: () => ({
      frameCount,
      lastFrameTime
    })
  };
}

// Enhanced requestIdleCallback wrapper with fallback
function scheduleIdleWork(callback, options = {}) {
  const timeout = options.timeout || 1000;
  
  if (typeof requestIdleCallback !== 'undefined') {
    return requestIdleCallback(callback, { timeout });
  } else {
    // Fallback to setTimeout with small delay
    return setTimeout(callback, 0);
  }
}

export {
  SmartScheduler,
  createVideoFrameScheduler,
  scheduleIdleWork
};

