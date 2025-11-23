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

    // If we're tracking, skip detection on some frames to reduce load
    if (isTracking) {
      this.detectionFrameCounter++;
      if (this.detectionFrameCounter % this.config.detectionSkipInterval === 0) {
        return true;
      }
    } else {
      // Always do detection when not tracking
      this.detectionFrameCounter = 0;
      return false;
    }

    return false;
  }

  getTrackingTargetsToProcess(allTrackingStates) {
    if (!this.isEnabled || !this.config.enableDistribution) {
      // Return all states with their indices
      return allTrackingStates.map((state, index) => ({ stateIndex: index, state }));
    }

    // Build list of active tracking states with their original indices
    const activeStatesWithIndices = [];
    for (let i = 0; i < allTrackingStates.length; i++) {
      if (allTrackingStates[i].isTracking) {
        activeStatesWithIndices.push({
          stateIndex: i,
          state: allTrackingStates[i]
        });
      }
    }

    if (activeStatesWithIndices.length === 0) {
      return [];
    }

    // When quality is low, process only one target per frame, rotating through them
    const maxPerFrame = this.config.maxTrackingPerFrame;
    const startIndex = this.trackingRotationIndex;
    const targetsToProcess = [];

    for (let i = 0; i < activeStatesWithIndices.length && targetsToProcess.length < maxPerFrame; i++) {
      const index = (startIndex + i) % activeStatesWithIndices.length;
      targetsToProcess.push(activeStatesWithIndices[index]);
    }

    // Rotate for next frame
    this.trackingRotationIndex = (this.trackingRotationIndex + targetsToProcess.length) % activeStatesWithIndices.length;

    this.logger.debug('Tracking targets selected', {
      totalActive: activeStatesWithIndices.length,
      processingThisFrame: targetsToProcess.length,
      rotationIndex: this.trackingRotationIndex,
      targetIndices: targetsToProcess.map(t => t.stateIndex)
    });

    return targetsToProcess;
  }

  reset() {
    this.detectionFrameCounter = 0;
    this.trackingRotationIndex = 0;
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

