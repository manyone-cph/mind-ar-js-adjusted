import {memory, nextFrame} from '@tensorflow/tfjs';
import {WorkDistributionManager} from '../performance/work-distribution-manager.js';
import {MemoryManager} from '../performance/memory-manager.js';
import {SmartScheduler, scheduleIdleWork} from '../performance/smart-scheduler.js';
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
      detectionSkipInterval: 3, // Skip detection every 3 frames when tracking (less aggressive)
      maxTrackingPerFrame: 1, // Process 1 tracking target per frame when quality is low
      debugMode: debugMode
    });
    
    this.memoryManager = new MemoryManager({
      enableCleanup: true,
      cleanupInterval: 60, // Cleanup every 60 frames
      memoryThreshold: 100, // Alert if more than 100 tensors
      aggressiveCleanup: true,
      debugMode: debugMode
    });

    this.smartScheduler = new SmartScheduler({
      enableAdaptiveSkipping: true,
      skipThreshold: 1.5, // Skip if frame time > 1.5x target
      maxConsecutiveSkips: 3, // Max 3 consecutive skips
      skipRecoveryFrames: 5, // Wait 5 frames between skip opportunities
      debugMode: debugMode
    });

    // Register cleanup callbacks
    this.memoryManager.registerCleanupCallback(() => {
      // Force disposal of any lingering tensors
      if (this.debugMode) {
        const stats = this.memoryManager.getMemoryStats();
        if (stats.numTensors > 50) {
          this.logger.debug('Memory stats', stats);
        }
      }
    });

    // Register idle callbacks for non-critical work
    this.memoryManager.registerIdleCallback(() => {
      // Perform non-critical cleanup during idle time
      scheduleIdleWork(() => {
        // Additional cleanup that can wait
        if (this.debugMode && this.memoryManager.frameCount % 120 === 0) {
          const skipStats = this.smartScheduler.getSkipStats();
          this.logger.debug('Scheduler stats', skipStats);
        }
      });
    });
    
    this.hasEverDetected = false; // Track if we've ever successfully detected a target
    this.shouldSkipNextFrame = false; // Flag for adaptive frame skipping

    // Cache callback objects to avoid allocations
    this._cachedProcessDoneCallback = {type: 'processDone'};
    this._cachedUpdateMatrixCallbacks = []; // Per-target callback objects
    this._cachedMatrixArrays = []; // Per-target matrix arrays for slice operations
    this._cachedRotatedMatrices = []; // Per-target rotated matrix arrays
    this._cachedWorldMatrices = []; // Per-target world matrix arrays (from glModelViewMatrix)

    this.logger = new Logger('FrameProcessor', true, debugMode ? 'debug' : 'info');
    this.logger.info('Frame processor initialized', {
      maxTrack,
      warmupTolerance,
      missTolerance,
      targetFPS
    });
  }

  async processFrame(input, metadata = null) {
    if (this.processingPaused) {
      return;
    }

    const frameStartTime = performance.now();

    // Use metadata timing if available (from requestVideoFrameCallback)
    const now = metadata ? metadata.expectedDisplayTime : performance.now();
    
    // Check adaptive frame skipping first (based on previous frame performance)
    if (this.shouldSkipNextFrame) {
      this.shouldSkipNextFrame = false;
      this.logger.debug('Frame skipped (adaptive scheduling)');
      return;
    }
    
    // Basic FPS limiting
    if (this.targetFPS && this.frameInterval > 0) {
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
    
    // Check if we should skip detection (work distribution will handle the logic)
    const shouldSkipDetection = this.workDistributionManager.shouldSkipDetection(isTracking);
    
    if (shouldSkipDetection) {
      this.logger.debug('Detection skipped (work distribution)', {
        qualityLevel,
        trackingCount: nTracking,
        isTracking,
        detectionFrameCounter: this.workDistributionManager.getStats().detectionFrameCounter
      });
    }
    
    // Always run detection if we haven't reached maxTrack, unless we're skipping for work distribution
    // This ensures we can always detect initially and re-acquire if tracking is lost
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
          this.hasEverDetected = true;
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

    // Dispose input tensor immediately after use
    inputT.dispose();
    
    // Record frame for memory management
    this.memoryManager.recordFrame();
    
    const totalFrameTime = performance.now() - frameStartTime;
    
    // Check if we should skip next frame based on performance (adaptive skipping)
    const targetFrameTime = this.targetFPS ? (1000 / this.targetFPS) : 33.33;
    this.shouldSkipNextFrame = this.smartScheduler.shouldSkipFrame(totalFrameTime, targetFrameTime);
    this.smartScheduler.recordFrame(totalFrameTime);
    
    const oldQuality = this.performanceManager.getQuality();
    const oldQualityLevel = this.performanceManager.getQualityLevel();
    const qualityChanged = this.performanceManager.recordFrameTime(totalFrameTime);
    const newQuality = this.performanceManager.getQuality();
    const newQualityLevel = this.performanceManager.getQualityLevel();
    
    if (qualityChanged && this.tracker && this.cropDetector) {
      // Apply quality to tracker
      this.tracker.setQuality(newQuality);
      
      // For detector, maintain minimum quality of 0.5 if we haven't detected yet
      // This ensures initial detection can work even on slow devices
      const detectorQuality = this.hasEverDetected ? newQuality : Math.max(newQuality, 0.5);
      this.cropDetector.detector.setQuality(detectorQuality);
      
      // Only log when quality level actually changes (not just numeric value)
      if (oldQualityLevel !== newQualityLevel) {
        this.logger.debug('Quality level changed', {
          oldQualityLevel,
          newQualityLevel,
          quality: newQuality.toFixed(2)
        });
      }
    }
    
    if (this.debugMode) {
      // Reuse cached breakdown object to avoid allocations
      if (!this._cachedBreakdown) {
        this._cachedBreakdown = {};
      }
      
      // Update cached object in place
      this._cachedBreakdown.total = totalFrameTime.toFixed(2);
      this._cachedBreakdown.inputLoad = inputLoadTime.toFixed(2);
      this._cachedBreakdown.detection = detectionTime.toFixed(2);
      this._cachedBreakdown.tracking = trackingTime.toFixed(2);
      this._cachedBreakdown.other = (totalFrameTime - inputLoadTime - detectionTime - trackingTime).toFixed(2);
      
      const perfStats = this.performanceManager.getStats();
      if (perfStats) {
        this._cachedBreakdown.quality = perfStats.quality;
        this._cachedBreakdown.qualityLevel = perfStats.qualityLevel;
        this._cachedBreakdown.avgFPS = perfStats.currentFPS;
        this._cachedBreakdown.avgFrameTime = perfStats.avgFrameTime;
      } else {
        delete this._cachedBreakdown.quality;
        delete this._cachedBreakdown.qualityLevel;
        delete this._cachedBreakdown.avgFPS;
        delete this._cachedBreakdown.avgFrameTime;
      }
      
      if (isDistributionEnabled) {
        const workStats = this.workDistributionManager.getStats();
        this._cachedBreakdown.workDistribution = workStats.enabled;
        this._cachedBreakdown.detectionSkipped = shouldSkipDetection;
        this._cachedBreakdown.detectionFrameCounter = workStats.detectionFrameCounter;
        this._cachedBreakdown.trackingRotationIndex = workStats.trackingRotationIndex;
      } else {
        delete this._cachedBreakdown.workDistribution;
        delete this._cachedBreakdown.detectionSkipped;
        delete this._cachedBreakdown.detectionFrameCounter;
        delete this._cachedBreakdown.trackingRotationIndex;
      }
      
      // Add memory stats periodically
      if (this.memoryManager.frameCount % 30 === 0) {
        const memoryStats = this.memoryManager.getMemoryStats();
        this._cachedBreakdown.memoryTensors = memoryStats.numTensors;
        this._cachedBreakdown.memoryGPU = memoryStats.numBytesInGPUFormatted;
      } else {
        delete this._cachedBreakdown.memoryTensors;
        delete this._cachedBreakdown.memoryGPU;
      }
      
      // Add scheduler stats periodically
      if (this.smartScheduler.totalFrames % 60 === 0 && this.smartScheduler.totalFrames > 0) {
        const skipStats = this.smartScheduler.getSkipStats();
        this._cachedBreakdown.skipRate = skipStats.skipRate;
        this._cachedBreakdown.consecutiveSkips = skipStats.consecutiveSkips;
      } else {
        delete this._cachedBreakdown.skipRate;
        delete this._cachedBreakdown.consecutiveSkips;
      }
      
      this.logger.debug('Frame timing', this._cachedBreakdown);
    }
    
    // Log quality status periodically (every 60 frames)
    const perfStats = this.performanceManager.getStats();
    if (perfStats && perfStats.frameCount > 0 && perfStats.frameCount % 60 === 0) {
      const memoryStats = this.memoryManager.getMemoryStats();
      const skipStats = this.smartScheduler.getSkipStats();
      this.logger.debug('Performance status', {
        quality: perfStats.quality,
        qualityLevel: perfStats.qualityLevel,
        avgFPS: perfStats.currentFPS,
        avgFrameTime: perfStats.avgFrameTime,
        workDistributionEnabled: isDistributionEnabled,
        trackingCount: nTracking,
        frameCount: perfStats.frameCount,
        memoryTensors: memoryStats.numTensors,
        memoryGPU: memoryStats.numBytesInGPUFormatted,
        skipRate: skipStats.skipRate
      });
    }
    
    // Reuse cached callback object
    if (this.onUpdate) {
      this.onUpdate(this._cachedProcessDoneCallback);
    }
  }

  _getMatchingIndexes() {
    // Reuse cached array to avoid allocations
    if (!this._cachedMatchingIndexes) {
      this._cachedMatchingIndexes = [];
    }
    this._cachedMatchingIndexes.length = 0;
    
    const states = this.trackingStateManager.getAllStates();
    for (let i = 0; i < states.length; i++) {
      const trackingState = states[i];
      if (trackingState.isTracking === true) continue;
      this._cachedMatchingIndexes.push(i);
    }
    return this._cachedMatchingIndexes;
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
          // Reuse cached callback object
          if (this.onUpdate) {
            if (!this._cachedUpdateMatrixCallbacks[i]) {
              this._cachedUpdateMatrixCallbacks[i] = {type: 'updateMatrix', targetIndex: i, worldMatrix: null};
            }
            this._cachedUpdateMatrixCallbacks[i].targetIndex = i;
            this._cachedUpdateMatrixCallbacks[i].worldMatrix = null;
            this.onUpdate(this._cachedUpdateMatrixCallbacks[i]);
          }
        }
      } else {
        trackingState.trackMiss = 0;
      }
    }
    
    if (trackingState.showing) {
      // Cache world matrix array to avoid allocations in glModelViewMatrix
      if (!this._cachedWorldMatrices[i]) {
        this._cachedWorldMatrices[i] = new Array(16);
      }
      
      // Call glModelViewMatrix and copy result into cached array
      const tempWorldMatrix = this.glModelViewMatrix(trackingState.currentModelViewTransform, this.markerDimensions[i][1]);
      for (let j = 0; j < 16; j++) {
        this._cachedWorldMatrices[i][j] = tempWorldMatrix[j];
      }
      const worldMatrix = this._cachedWorldMatrices[i];

      const isInputRotated = input.width === this.inputHeight && input.height === this.inputWidth;
      
      // Reuse cached arrays to avoid allocations
      let finalMatrix;
      if (isInputRotated) {
        // getRotatedZ90Matrix now returns a cached array, but we need our own copy
        // since the function's cache might be reused by other calls
        if (!this._cachedRotatedMatrices[i]) {
          this._cachedRotatedMatrices[i] = new Array(16);
        }
        const rotated = this.getRotatedZ90Matrix(worldMatrix);
        // Copy into our per-target cached array
        for (let j = 0; j < 16; j++) {
          this._cachedRotatedMatrices[i][j] = rotated[j];
        }
        finalMatrix = this._cachedRotatedMatrices[i];
      } else {
        // Cache matrix array for slice
        if (!this._cachedMatrixArrays[i]) {
          this._cachedMatrixArrays[i] = new Array(16);
        }
        // Copy worldMatrix into cached array (equivalent to slice)
        for (let j = 0; j < 16; j++) {
          this._cachedMatrixArrays[i][j] = worldMatrix[j];
        }
        finalMatrix = this._cachedMatrixArrays[i];
      }

      // Reuse cached callback object
      if (this.onUpdate) {
        if (!this._cachedUpdateMatrixCallbacks[i]) {
          this._cachedUpdateMatrixCallbacks[i] = {type: 'updateMatrix', targetIndex: i, worldMatrix: null};
        }
        this._cachedUpdateMatrixCallbacks[i].targetIndex = i;
        this._cachedUpdateMatrixCallbacks[i].worldMatrix = finalMatrix;
        this.onUpdate(this._cachedUpdateMatrixCallbacks[i]);
      }
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

