import {memory, nextFrame} from '@tensorflow/tfjs';
import {WorkDistributionManager} from '../performance/work-distribution-manager.js';
import {Logger} from '../../libs/logger.js';

const tf = {memory, nextFrame};

class FrameProcessor {
  constructor({
    inputLoader,
    cropDetector,
    tracker,
    workerManager,
    trackingStateManager,
    performanceManager,
    onUpdate,
    debugMode,
    maxTrack,
    warmupTolerance,
    missTolerance,
    targetFPS,
    markerDimensions,
    getRotatedZ90Matrix,
    glModelViewMatrix
  }) {
    this.inputLoader = inputLoader;
    this.cropDetector = cropDetector;
    this.tracker = tracker;
    this.workerManager = workerManager;
    this.trackingStateManager = trackingStateManager;
    this.performanceManager = performanceManager;
    this.onUpdate = onUpdate;
    this.debugMode = debugMode;
    this.maxTrack = maxTrack;
    this.warmupTolerance = warmupTolerance;
    this.missTolerance = missTolerance;
    this.targetFPS = targetFPS;
    this.markerDimensions = markerDimensions;
    this.getRotatedZ90Matrix = getRotatedZ90Matrix;
    this.glModelViewMatrix = glModelViewMatrix;

    this.frameInterval = targetFPS ? (1000 / targetFPS) : 0;
    this.lastFrameTime = 0;
    this.processingPaused = false;

    this.workDistributionManager = new WorkDistributionManager({
      detectionSkipInterval: 2, // Skip detection every 2 frames when tracking
      maxTrackingPerFrame: 1, // Process 1 tracking target per frame when quality is low
      debugMode: debugMode
    });

    this.logger = new Logger('FrameProcessor', true, debugMode ? 'debug' : 'info');
    this.logger.info('Frame processor initialized', {
      maxTrack,
      warmupTolerance,
      missTolerance,
      targetFPS
    });
  }

  async processFrame(input) {
    if (this.processingPaused) {
      return;
    }

    const frameStartTime = performance.now();

    if (this.targetFPS && this.frameInterval > 0) {
      const now = performance.now();
      const timeSinceLastFrame = now - this.lastFrameTime;
      
      if (timeSinceLastFrame < this.frameInterval) {
        return;
      }
      
      this.lastFrameTime = now;
    }

    const inputLoadStart = performance.now();
    const inputT = this.inputLoader.loadInput(input);
    const inputLoadTime = performance.now() - inputLoadStart;

    const quality = this.performanceManager.getQuality();
    const qualityLevel = this.performanceManager.getQualityLevel();
    const isDistributionEnabled = this.workDistributionManager.shouldEnableDistribution(qualityLevel);

    const nTracking = this.trackingStateManager.getTrackingCount();
    const isTracking = nTracking > 0;

    let detectionTime = 0;
    let matchingTime = 0;
    const shouldSkipDetection = this.workDistributionManager.shouldSkipDetection(isTracking);
    
    if (shouldSkipDetection) {
      this.logger.debug('Detection skipped (work distribution)', {
        qualityLevel,
        trackingCount: nTracking,
        detectionFrameCounter: this.workDistributionManager.getStats().detectionFrameCounter
      });
    }
    
    if (nTracking < this.maxTrack && !shouldSkipDetection) {
      const matchingIndexes = this._getMatchingIndexes();
      
      if (matchingIndexes.length > 0) {
        const detectStart = performance.now();
        const {targetIndex: matchedTargetIndex, modelViewTransform} = await this._detectAndMatch(inputT, matchingIndexes);
        detectionTime = performance.now() - detectStart;
        matchingTime = detectionTime;

        if (matchedTargetIndex !== -1) {
          const state = this.trackingStateManager.getState(matchedTargetIndex);
          state.isTracking = true;
          state.currentModelViewTransform = modelViewTransform;
          this.logger.debug('Target detected', {
            targetIndex: matchedTargetIndex,
            detectionTime: detectionTime.toFixed(2)
          });
        }
      }
    }

    let trackingTime = 0;
    const allStates = this.trackingStateManager.getAllStates();
    
    if (isDistributionEnabled) {
      // Process only a subset of tracking targets per frame
      const targetsToProcess = this.workDistributionManager.getTrackingTargetsToProcess(allStates);
      
      for (const {stateIndex, state: trackingState} of targetsToProcess) {
        this._processTrackingState(inputT, input, stateIndex, trackingState);
        
        if (trackingState.isTracking) {
          const trackStart = performance.now();
          let modelViewTransform = await this._trackAndUpdate(inputT, trackingState.currentModelViewTransform, stateIndex);
          trackingTime += performance.now() - trackStart;
          
          if (modelViewTransform === null) {
            trackingState.isTracking = false;
            this.logger.debug('Tracking lost', { targetIndex: stateIndex });
          } else {
            trackingState.currentModelViewTransform = modelViewTransform;
          }
        }
      }
      
      // Process non-tracking states for state management
      for (let i = 0; i < allStates.length; i++) {
        const trackingState = allStates[i];
        if (!trackingState.isTracking) {
          this._processTrackingState(inputT, input, i, trackingState);
        }
      }
    } else {
      // Process all tracking targets (high quality mode)
      for (let i = 0; i < allStates.length; i++) {
        const trackingState = allStates[i];
        this._processTrackingState(inputT, input, i, trackingState);
        
        if (trackingState.isTracking) {
          const trackStart = performance.now();
          let modelViewTransform = await this._trackAndUpdate(inputT, trackingState.currentModelViewTransform, i);
          trackingTime += performance.now() - trackStart;
          
          if (modelViewTransform === null) {
            trackingState.isTracking = false;
            this.logger.debug('Tracking lost', { targetIndex: i });
          } else {
            trackingState.currentModelViewTransform = modelViewTransform;
          }
        }
      }
    }

    inputT.dispose();
    
    const totalFrameTime = performance.now() - frameStartTime;
    
    const oldQuality = this.performanceManager.getQuality();
    const oldQualityLevel = this.performanceManager.getQualityLevel();
    const qualityChanged = this.performanceManager.recordFrameTime(totalFrameTime);
    const newQuality = this.performanceManager.getQuality();
    const newQualityLevel = this.performanceManager.getQualityLevel();
    
    if (qualityChanged && this.tracker && this.cropDetector) {
      this.tracker.setQuality(newQuality);
      this.cropDetector.detector.setQuality(newQuality);
      this.logger.info('Quality applied to detector and tracker', {
        quality: newQuality.toFixed(2),
        qualityLevel: newQualityLevel,
        oldQuality: oldQuality.toFixed(2),
        oldQualityLevel
      });
    }
    
    if (this.debugMode) {
      const breakdown = {
        total: totalFrameTime.toFixed(2),
        inputLoad: inputLoadTime.toFixed(2),
        detection: detectionTime.toFixed(2),
        tracking: trackingTime.toFixed(2),
        other: (totalFrameTime - inputLoadTime - detectionTime - trackingTime).toFixed(2)
      };
      const perfStats = this.performanceManager.getStats();
      if (perfStats) {
        breakdown.quality = perfStats.quality;
        breakdown.qualityLevel = perfStats.qualityLevel;
        breakdown.avgFPS = perfStats.currentFPS;
        breakdown.avgFrameTime = perfStats.avgFrameTime;
      }
      if (isDistributionEnabled) {
        const workStats = this.workDistributionManager.getStats();
        breakdown.workDistribution = workStats.enabled;
        breakdown.detectionSkipped = shouldSkipDetection;
        breakdown.detectionFrameCounter = workStats.detectionFrameCounter;
        breakdown.trackingRotationIndex = workStats.trackingRotationIndex;
      }
      this.logger.debug('Frame timing', breakdown);
    }
    
    // Log quality status periodically (every 60 frames)
    const perfStats = this.performanceManager.getStats();
    if (perfStats && perfStats.frameCount > 0 && perfStats.frameCount % 60 === 0) {
      this.logger.info('Performance status', {
        quality: perfStats.quality,
        qualityLevel: perfStats.qualityLevel,
        avgFPS: perfStats.currentFPS,
        avgFrameTime: perfStats.avgFrameTime,
        workDistributionEnabled: isDistributionEnabled,
        trackingCount: nTracking,
        frameCount: perfStats.frameCount
      });
    }
    
    this.onUpdate && this.onUpdate({type: 'processDone'});
  }

  _getMatchingIndexes() {
    const matchingIndexes = [];
    const states = this.trackingStateManager.getAllStates();
    for (let i = 0; i < states.length; i++) {
      const trackingState = states[i];
      if (trackingState.isTracking === true) continue;
      matchingIndexes.push(i);
    }
    return matchingIndexes;
  }

  async _detectAndMatch(inputT, targetIndexes) {
    const detectStart = performance.now();
    const {featurePoints} = this.cropDetector.detectMoving(inputT);
    const detectTime = performance.now() - detectStart;
    
    const matchStart = performance.now();
    const {targetIndex: matchedTargetIndex, modelViewTransform} = await this.workerManager.match(featurePoints, targetIndexes);
    const matchTime = performance.now() - matchStart;
    
    if (this.debugMode) {
      this.logger.debug('Detection and matching', {
        detectTime: detectTime.toFixed(2),
        matchTime: matchTime.toFixed(2),
        targetIndexes: targetIndexes.length
      });
    }
    
    return {targetIndex: matchedTargetIndex, modelViewTransform};
  }

  async _trackAndUpdate(inputT, lastModelViewTransform, targetIndex) {
    const {worldCoords, screenCoords} = this.tracker.track(inputT, lastModelViewTransform, targetIndex);
    if (worldCoords.length < 4) return null;
    const modelViewTransform = await this.workerManager.trackUpdate(lastModelViewTransform, {worldCoords, screenCoords});
    return modelViewTransform;
  }

  _processTrackingState(inputT, input, i, trackingState) {
    if (!trackingState.showing) {
      if (trackingState.isTracking) {
        trackingState.trackMiss = 0;
        trackingState.trackCount += 1;
        if (trackingState.trackCount > this.warmupTolerance) {
          trackingState.showing = true;
          trackingState.trackingMatrix = null;
          this.logger.info('Target showing', { targetIndex: i, trackCount: trackingState.trackCount });
        }
      }
    }
    
    if (trackingState.showing) {
      if (!trackingState.isTracking) {
        trackingState.trackCount = 0;
        trackingState.trackMiss += 1;

        if (trackingState.trackMiss > this.missTolerance) {
          trackingState.showing = false;
          trackingState.trackingMatrix = null;
          this.logger.info('Target hidden', { targetIndex: i, trackMiss: trackingState.trackMiss });
          this.onUpdate && this.onUpdate({type: 'updateMatrix', targetIndex: i, worldMatrix: null});
        }
      } else {
        trackingState.trackMiss = 0;
      }
    }
    
    if (trackingState.showing) {
      const worldMatrix = this.glModelViewMatrix(trackingState.currentModelViewTransform, this.markerDimensions[i][1]);

      const isInputRotated = input.width === this.inputHeight && input.height === this.inputWidth;
      const finalMatrix = isInputRotated 
        ? this.getRotatedZ90Matrix(worldMatrix)
        : worldMatrix.slice();

      this.onUpdate && this.onUpdate({type: 'updateMatrix', targetIndex: i, worldMatrix: finalMatrix});
    }
  }

  setPaused(paused) {
    this.processingPaused = paused;
    if (!paused) {
      this.lastFrameTime = 0;
    }
  }

  setTargetFPS(targetFPS) {
    this.targetFPS = targetFPS;
    this.frameInterval = targetFPS ? (1000 / targetFPS) : 0;
    this.lastFrameTime = 0;
  }

  resetFrameTiming() {
    this.lastFrameTime = 0;
  }

}

export {
  FrameProcessor
};

