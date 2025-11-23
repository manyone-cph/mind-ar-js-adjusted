import {Logger} from '../../libs/logger.js';

class WorkDistributionManager {
  constructor(config = {}) {
    this.config = {
      enableDistribution: config.enableDistribution ?? true,
      detectionSkipInterval: config.detectionSkipInterval ?? 2, // Skip detection every N frames when tracking
      maxTrackingPerFrame: config.maxTrackingPerFrame ?? 1, // Max tracking targets to process per frame
      ...config
    };

    this.detectionFrameCounter = 0;
    this.trackingRotationIndex = 0;
    this.isEnabled = false;

    this.logger = new Logger('WorkDistributionManager', true, config.debugMode ? 'debug' : 'info');
    this.logger.info('Work distribution manager initialized', {
      detectionSkipInterval: this.config.detectionSkipInterval,
      maxTrackingPerFrame: this.config.maxTrackingPerFrame
    });
  }

  shouldEnableDistribution(qualityLevel) {
    // Only enable work distribution for medium/low quality
    const shouldEnable = qualityLevel === 'medium' || qualityLevel === 'low';
    if (shouldEnable !== this.isEnabled) {
      const previousState = this.isEnabled;
      this.isEnabled = shouldEnable;
      if (shouldEnable) {
        this.reset();
        this.logger.info('Work distribution enabled', {
          qualityLevel,
          detectionSkipInterval: this.config.detectionSkipInterval,
          maxTrackingPerFrame: this.config.maxTrackingPerFrame
        });
      } else {
        this.logger.info('Work distribution disabled', {
          qualityLevel,
          previousState
        });
      }
    }
    return this.isEnabled;
  }

  shouldSkipDetection(isTracking) {
    if (!this.isEnabled || !this.config.enableDistribution) {
      return false;
    }

    // Never skip detection when not tracking - we need it to acquire targets
    if (!isTracking) {
      this.detectionFrameCounter = 0;
      return false;
    }

    // If we're tracking, skip detection on some frames to reduce load
    this.detectionFrameCounter++;
    if (this.detectionFrameCounter % this.config.detectionSkipInterval === 0) {
      return true;
    }

    return false;
  }

  getTrackingTargetsToProcess(allTrackingStates) {
    if (!this.isEnabled || !this.config.enableDistribution) {
      // Reuse cached array to avoid allocations
      if (!this._cachedAllStates) {
        this._cachedAllStates = [];
      }
      // Resize array if needed, reuse objects when possible
      while (this._cachedAllStates.length < allTrackingStates.length) {
        this._cachedAllStates.push({ stateIndex: 0, state: null });
      }
      this._cachedAllStates.length = allTrackingStates.length;
      
      // Update in place to avoid allocations
      for (let i = 0; i < allTrackingStates.length; i++) {
        this._cachedAllStates[i].stateIndex = i;
        this._cachedAllStates[i].state = allTrackingStates[i];
      }
      return this._cachedAllStates;
    }

    // Reuse cached arrays to avoid allocations
    if (!this._cachedActiveStates) {
      this._cachedActiveStates = [];
    }
    if (!this._cachedTargets) {
      this._cachedTargets = [];
    }

    // Build list of active tracking states with their original indices
    // Reuse objects to avoid allocations
    if (!this._cachedActiveStateObjects) {
      this._cachedActiveStateObjects = [];
    }
    
    this._cachedActiveStates.length = 0;
    let objectIndex = 0;
    for (let i = 0; i < allTrackingStates.length; i++) {
      if (allTrackingStates[i].isTracking) {
        // Reuse cached object if available, otherwise create new
        if (!this._cachedActiveStateObjects[objectIndex]) {
          this._cachedActiveStateObjects[objectIndex] = { stateIndex: 0, state: null };
        }
        this._cachedActiveStateObjects[objectIndex].stateIndex = i;
        this._cachedActiveStateObjects[objectIndex].state = allTrackingStates[i];
        this._cachedActiveStates.push(this._cachedActiveStateObjects[objectIndex]);
        objectIndex++;
      }
    }

    if (this._cachedActiveStates.length === 0) {
      this._cachedTargets.length = 0;
      return this._cachedTargets;
    }

    // When quality is low, process only one target per frame, rotating through them
    const maxPerFrame = this.config.maxTrackingPerFrame;
    const startIndex = this.trackingRotationIndex;
    this._cachedTargets.length = 0;

    for (let i = 0; i < this._cachedActiveStates.length && this._cachedTargets.length < maxPerFrame; i++) {
      const index = (startIndex + i) % this._cachedActiveStates.length;
      this._cachedTargets.push(this._cachedActiveStates[index]);
    }

    // Rotate for next frame
    this.trackingRotationIndex = (this.trackingRotationIndex + this._cachedTargets.length) % this._cachedActiveStates.length;

    if (this.logger.levelValue >= 3) { // Only if debug level
      // Only create targetIndices array if actually logging
      const targetIndices = [];
      for (let i = 0; i < this._cachedTargets.length; i++) {
        targetIndices.push(this._cachedTargets[i].stateIndex);
      }
      this.logger.debug('Tracking targets selected', {
        totalActive: this._cachedActiveStates.length,
        processingThisFrame: this._cachedTargets.length,
        rotationIndex: this.trackingRotationIndex,
        targetIndices
      });
    }

    return this._cachedTargets;
  }

  reset() {
    this.detectionFrameCounter = 0;
    this.trackingRotationIndex = 0;
    // Clear cached arrays to allow GC
    this._cachedActiveStates = null;
    this._cachedTargets = null;
    this._cachedAllStates = null;
    this._cachedActiveStateObjects = null;
  }

  getStats() {
    return {
      enabled: this.isEnabled,
      detectionFrameCounter: this.detectionFrameCounter,
      trackingRotationIndex: this.trackingRotationIndex
    };
  }
}

export {
  WorkDistributionManager
};

