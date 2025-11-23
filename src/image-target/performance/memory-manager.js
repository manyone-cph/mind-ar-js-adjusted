import {Logger} from '../../libs/logger.js';
import * as tf from '@tensorflow/tfjs';

class MemoryManager {
  constructor(config = {}) {
    this.config = {
      enableCleanup: config.enableCleanup ?? true,
      cleanupInterval: config.cleanupInterval ?? 60, // frames
      memoryThreshold: config.memoryThreshold ?? 100, // max tensors before cleanup
      aggressiveCleanup: config.aggressiveCleanup ?? true,
      ...config
    };

    this.frameCount = 0;
    this.lastCleanupFrame = 0;
    this.cleanupCallbacks = [];
    this.idleCallbacks = [];

    this.logger = new Logger('MemoryManager', true, config.debugMode ? 'debug' : 'info');
    this.logger.info('Memory manager initialized', {
      enableCleanup: this.config.enableCleanup,
      cleanupInterval: this.config.cleanupInterval,
      memoryThreshold: this.config.memoryThreshold
    });
  }

  registerCleanupCallback(callback) {
    this.cleanupCallbacks.push(callback);
  }

  registerIdleCallback(callback) {
    this.idleCallbacks.push(callback);
  }

  recordFrame() {
    this.frameCount++;

    if (this.config.enableCleanup) {
      const shouldCleanup = (this.frameCount - this.lastCleanupFrame) >= this.config.cleanupInterval;
      
      if (shouldCleanup) {
        this.performCleanup();
        this.lastCleanupFrame = this.frameCount;
      }
    }

    // Schedule idle callbacks
    if (this.idleCallbacks.length > 0 && typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        this.idleCallbacks.forEach(callback => {
          try {
            callback();
          } catch (error) {
            this.logger.warn('Idle callback error', { error: error.message });
          }
        });
      }, { timeout: 1000 });
    }
  }

  performCleanup() {
    const beforeMemory = tf.memory();
    const beforeTensors = beforeMemory.numTensors;
    const beforeBytes = beforeMemory.numBytesInGPU;

    // Run registered cleanup callbacks
    this.cleanupCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        this.logger.warn('Cleanup callback error', { error: error.message });
      }
    });

    // Aggressive cleanup: dispose any leaked tensors if threshold exceeded
    if (this.config.aggressiveCleanup && beforeTensors > this.config.memoryThreshold) {
      this.logger.warn('High tensor count detected, performing aggressive cleanup', {
        tensorCount: beforeTensors,
        threshold: this.config.memoryThreshold
      });
      
      // Force garbage collection hint (browser may or may not honor this)
      if (global.gc && typeof global.gc === 'function') {
        global.gc();
      }
    }

    const afterMemory = tf.memory();
    const afterTensors = afterMemory.numTensors;
    const afterBytes = afterMemory.numBytesInGPU;
    const freedTensors = beforeTensors - afterTensors;
    const freedBytes = beforeBytes - afterBytes;

    if (freedTensors > 0 || freedBytes > 0) {
      this.logger.debug('Memory cleanup performed', {
        beforeTensors,
        afterTensors,
        freedTensors,
        beforeBytes: (beforeBytes / 1024 / 1024).toFixed(2) + ' MB',
        afterBytes: (afterBytes / 1024 / 1024).toFixed(2) + ' MB',
        freedBytes: (freedBytes / 1024 / 1024).toFixed(2) + ' MB'
      });
    }
  }

  getMemoryStats() {
    const memory = tf.memory();
    return {
      numTensors: memory.numTensors,
      numBytes: memory.numBytes,
      numBytesInGPU: memory.numBytesInGPU,
      numBytesInGPUFormatted: (memory.numBytesInGPU / 1024 / 1024).toFixed(2) + ' MB',
      numBytesFormatted: (memory.numBytes / 1024 / 1024).toFixed(2) + ' MB'
    };
  }

  forceCleanup() {
    this.performCleanup();
    this.lastCleanupFrame = this.frameCount;
  }

  reset() {
    this.frameCount = 0;
    this.lastCleanupFrame = 0;
  }
}

export {
  MemoryManager
};

