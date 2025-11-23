import {memory, nextFrame} from '@tensorflow/tfjs';

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

    const nTracking = this.trackingStateManager.getTrackingCount();

    let detectionTime = 0;
    let matchingTime = 0;
    if (nTracking < this.maxTrack) {
      const matchingIndexes = this._getMatchingIndexes();
      
      const detectStart = performance.now();
      const {targetIndex: matchedTargetIndex, modelViewTransform} = await this._detectAndMatch(inputT, matchingIndexes);
      detectionTime = performance.now() - detectStart;
      matchingTime = detectionTime;

      if (matchedTargetIndex !== -1) {
        const state = this.trackingStateManager.getState(matchedTargetIndex);
        state.isTracking = true;
        state.currentModelViewTransform = modelViewTransform;
      }
    }

    let trackingTime = 0;
    for (let i = 0; i < this.trackingStateManager.getAllStates().length; i++) {
      const trackingState = this.trackingStateManager.getState(i);
      this._processTrackingState(inputT, input, i, trackingState);
      
      if (trackingState.isTracking) {
        const trackStart = performance.now();
        let modelViewTransform = await this._trackAndUpdate(inputT, trackingState.currentModelViewTransform, i);
        trackingTime += performance.now() - trackStart;
        
        if (modelViewTransform === null) {
          trackingState.isTracking = false;
        } else {
          trackingState.currentModelViewTransform = modelViewTransform;
        }
      }
    }

    inputT.dispose();
    
    const totalFrameTime = performance.now() - frameStartTime;
    
    const oldQuality = this.performanceManager.getQuality();
    const qualityChanged = this.performanceManager.recordFrameTime(totalFrameTime);
    const newQuality = this.performanceManager.getQuality();
    
    if (qualityChanged && this.tracker && this.cropDetector) {
      this.tracker.setQuality(newQuality);
      this.cropDetector.detector.setQuality(newQuality);
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
      }
      console.log('Frame timing:', breakdown);
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
      console.log(`Detection: ${detectTime.toFixed(2)}ms, Matching: ${matchTime.toFixed(2)}ms`);
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

