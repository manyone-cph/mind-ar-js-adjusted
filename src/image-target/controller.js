import {memory, nextFrame} from '@tensorflow/tfjs';

const tf = {memory, nextFrame};
import {Tracker} from './tracker/tracker.js';
import {CropDetector} from './detector/crop-detector.js';
import {Compiler} from './compiler.js';
import {InputLoader} from './input-loader.js';
import {PerformanceManager} from './performance/performance-manager.js';
import {WorkerManager} from './workers/worker-manager.js';
import {TrackingStateManager} from './core/tracking-state-manager.js';
import {FrameProcessor} from './core/frame-processor.js';
import {Logger} from '../libs/logger.js';
import {
  DEFAULT_FILTER_DCUTOFF,
  DEFAULT_WARMUP_TOLERANCE,
  DEFAULT_MISS_TOLERANCE
} from './config/defaults.js';
import {
  validateTargetFPS,
  validateFilterParams,
  validateWarmupTolerance,
  validateMissTolerance,
  validateMaxTrack
} from './config/validators.js';
import {createProjectionTransform, createProjectionMatrix} from './math/projection.js';
import {getRotatedZ90Matrix, glModelViewMatrix} from './math/matrix-transform.js';

class Controller {
  constructor({
    inputWidth,
    inputHeight,
    onUpdate = null,
    debugMode = false,
    maxTrack = 1,
    warmupTolerance = null,
    missTolerance = null,
    filterDCutOff = null,
    targetFPS = null
  }) {
    this.inputWidth = inputWidth;
    this.inputHeight = inputHeight;
    this.maxTrack = maxTrack;
    this.filterDCutOff = filterDCutOff === null ? DEFAULT_FILTER_DCUTOFF : filterDCutOff;
    this.warmupTolerance = warmupTolerance === null ? DEFAULT_WARMUP_TOLERANCE : warmupTolerance;
    this.missTolerance = missTolerance === null ? DEFAULT_MISS_TOLERANCE : missTolerance;
    this.targetFPS = targetFPS;
    this.onUpdate = onUpdate;
    this.debugMode = debugMode;

    this.logger = new Logger('Controller', true, debugMode ? 'debug' : 'info');
    this.logger.info('Initializing controller', {
      inputWidth,
      inputHeight,
      maxTrack,
      targetFPS,
      filterDCutOff: this.filterDCutOff
    });

    this.cropDetector = new CropDetector(this.inputWidth, this.inputHeight, debugMode);
    this.inputLoader = new InputLoader(this.inputWidth, this.inputHeight);
    this.markerDimensions = null;

    this.projectionTransform = createProjectionTransform(this.inputWidth, this.inputHeight);
    this.projectionMatrix = createProjectionMatrix({
      projectionTransform: this.projectionTransform,
      width: this.inputWidth,
      height: this.inputHeight
    });

    this.performanceManager = new PerformanceManager({
      targetFrameTime: targetFPS ? (1000 / targetFPS) : 33.33,
      minFrameTime: 16.67,
      debugMode: this.debugMode
    });

    this.workerManager = new WorkerManager();
    this.trackingStateManager = null;
    this.frameProcessor = null;
    this.tracker = null;
    this.processingVideo = false;
    this.interestedTargetIndex = -1;
  }

  showTFStats() {
    console.log(tf.memory().numTensors);
    console.table(tf.memory());
  }

  async addImageTargets(fileURL) {
    this.logger.info('Loading image targets from URL', { fileURL });
    try {
      const content = await fetch(fileURL);
      const buffer = await content.arrayBuffer();
      return this.addImageTargetsFromBuffer(buffer);
    } catch (error) {
      this.logger.error('Failed to load image targets from URL', { fileURL, error: error.message });
      throw error;
    }
  }

  addImageTargetsFromBuffer(buffer) {
    this.logger.info('Adding image targets from buffer', { bufferSize: buffer.byteLength });
    const compiler = new Compiler();
    let dataList;
    try {
      dataList = compiler.importData(buffer);
    } catch (error) {
      this.logger.error('Failed to import target data from buffer', { error: error.message });
      throw error;
    }

    if (!dataList || dataList.length === 0) {
      this.logger.warn('No target data found in buffer');
      return {dimensions: [], matchingDataList: [], trackingDataList: []};
    }

    const trackingDataList = [];
    const matchingDataList = [];
    const dimensions = [];
    for (let i = 0; i < dataList.length; i++) {
      matchingDataList.push(dataList[i].matchingData);
      trackingDataList.push(dataList[i].trackingData);
      dimensions.push([dataList[i].targetImage.width, dataList[i].targetImage.height]);
    }

    this.logger.info('Image targets loaded', { count: dimensions.length, dimensions });

    this.markerDimensions = dimensions;
    this.tracker = new Tracker(
      dimensions,
      trackingDataList,
      this.projectionTransform,
      this.inputWidth,
      this.inputHeight,
      this.debugMode
    );

    const quality = this.performanceManager.getQuality();
    this.tracker.setQuality(quality);
    this.cropDetector.detector.setQuality(quality);

    this.trackingStateManager = new TrackingStateManager(dimensions);

    this.workerManager.setup({
      inputWidth: this.inputWidth,
      inputHeight: this.inputHeight,
      projectionTransform: this.projectionTransform,
      debugMode: this.debugMode,
      matchingDataList
    });

    this.frameProcessor = new FrameProcessor({
      inputLoader: this.inputLoader,
      cropDetector: this.cropDetector,
      tracker: this.tracker,
      workerManager: this.workerManager,
      trackingStateManager: this.trackingStateManager,
      performanceManager: this.performanceManager,
      onUpdate: this.onUpdate,
      debugMode: this.debugMode,
      maxTrack: this.maxTrack,
      warmupTolerance: this.warmupTolerance,
      missTolerance: this.missTolerance,
      targetFPS: this.targetFPS,
      markerDimensions: this.markerDimensions,
      getRotatedZ90Matrix,
      glModelViewMatrix: (modelViewTransform, targetHeight) => 
        glModelViewMatrix(modelViewTransform, targetHeight)
    });

    this.logger.info('Controller setup complete', { targetCount: dimensions.length });
    return {dimensions, matchingDataList, trackingDataList};
  }

  dispose() {
    this.logger.info('Disposing controller');
    this.stopProcessVideo();
    this.workerManager.dispose();
  }

  dummyRun(input) {
    const inputT = this.inputLoader.loadInput(input);
    this.cropDetector.detect(inputT);
    if (this.tracker) {
      this.tracker.dummyRun(inputT);
    }
    inputT.dispose();
  }

  getProjectionMatrix() {
    return this.projectionMatrix;
  }

  getRotatedZ90Matrix(m) {
    return getRotatedZ90Matrix(m);
  }

  getWorldMatrix(modelViewTransform, targetIndex) {
    return glModelViewMatrix(modelViewTransform, this.markerDimensions[targetIndex][1]);
  }

  processVideo(input) {
    if (this.processingVideo) {
      this.logger.warn('processVideo called while already processing');
      return;
    }
    if (!this.frameProcessor) {
      this.logger.error('Must call addImageTargets before processVideo');
      throw new Error('Must call addImageTargets before processVideo');
    }

    this.logger.info('Starting video processing', {
      videoWidth: input.videoWidth,
      videoHeight: input.videoHeight,
      hasRequestVideoFrameCallback: typeof input.requestVideoFrameCallback === 'function'
    });
    this.processingVideo = true;
    this.trackingStateManager.reset();

    if (input && typeof input.requestVideoFrameCallback === 'function') {
      // Use enhanced video frame scheduler with metadata support
      const scheduleNextFrame = (now, metadata) => {
        // Pass metadata to frame processor for better timing
        this.frameProcessor.processFrame(input, metadata).then(() => {
          if (this.processingVideo) {
            input.requestVideoFrameCallback(scheduleNextFrame);
          }
        }).catch(error => {
          this.logger.error('Frame processing error', { error: error.message });
          if (this.processingVideo) {
            input.requestVideoFrameCallback(scheduleNextFrame);
          }
        });
      };
      input.requestVideoFrameCallback(scheduleNextFrame);
      this.logger.info('Using requestVideoFrameCallback for frame timing');
    } else {
      const startProcessing = async () => {
        while (true) {
          if (!this.processingVideo) break;

          if (this.frameProcessor.processingPaused) {
            await tf.nextFrame();
            continue;
          }

          if (this.targetFPS && this.frameProcessor.frameInterval > 0) {
            const now = performance.now();
            const timeSinceLastFrame = now - this.frameProcessor.lastFrameTime;

            if (timeSinceLastFrame < this.frameProcessor.frameInterval) {
              await tf.nextFrame();
              continue;
            }

            this.frameProcessor.lastFrameTime = now;
          }

          await this.frameProcessor.processFrame(input);
          await tf.nextFrame();
        }
      };
      startProcessing();
    }
  }

  stopProcessVideo() {
    if (this.processingVideo) {
      this.logger.info('Stopping video processing');
    }
    this.processingVideo = false;
    if (this.frameProcessor) {
      this.frameProcessor.setPaused(false);
      this.frameProcessor.resetFrameTiming();
    }
  }

  pauseProcessing() {
    if (this.frameProcessor) {
      this.frameProcessor.setPaused(true);
    }
  }

  resumeProcessing() {
    if (this.frameProcessor) {
      this.frameProcessor.setPaused(false);
      this.frameProcessor.resetFrameTiming();
    }
  }

  isProcessingPaused() {
    return this.frameProcessor ? this.frameProcessor.processingPaused : false;
  }

  setTargetFPS(targetFPS) {
    validateTargetFPS(targetFPS);
    this.logger.info('Setting target FPS', { targetFPS });
    this.targetFPS = targetFPS;
    if (this.frameProcessor) {
      this.frameProcessor.setTargetFPS(targetFPS);
    }
    if (this.performanceManager) {
      this.performanceManager.config.targetFrameTime = targetFPS ? (1000 / targetFPS) : 33.33;
    }
  }

  setFilterParams({filterDCutOff}) {
    validateFilterParams({filterDCutOff: filterDCutOff});

    if (filterDCutOff !== undefined) {
      this.filterDCutOff = filterDCutOff;
    }
  }

  setWarmupTolerance(warmupTolerance) {
    validateWarmupTolerance(warmupTolerance);
    this.warmupTolerance = warmupTolerance;
    if (this.frameProcessor) {
      this.frameProcessor.warmupTolerance = warmupTolerance;
    }
  }

  setMissTolerance(missTolerance) {
    validateMissTolerance(missTolerance);
    this.missTolerance = missTolerance;
    if (this.frameProcessor) {
      this.frameProcessor.missTolerance = missTolerance;
    }
  }

  setMaxTrack(maxTrack) {
    validateMaxTrack(maxTrack);
    this.logger.info('Setting max track', { maxTrack });
    this.maxTrack = Math.floor(maxTrack);
    if (this.frameProcessor) {
      this.frameProcessor.maxTrack = this.maxTrack;
    }
  }

  getConfig() {
    return {
      filterDCutOff: this.filterDCutOff,
      warmupTolerance: this.warmupTolerance,
      missTolerance: this.missTolerance,
      maxTrack: this.maxTrack,
      targetFPS: this.targetFPS
    };
  }

  async detect(input) {
    const inputT = this.inputLoader.loadInput(input);
    const {featurePoints, debugExtra} = await this.cropDetector.detect(inputT);
    inputT.dispose();
    return {featurePoints, debugExtra};
  }

  async match(featurePoints, targetIndex) {
    const {modelViewTransform, debugExtra} = await this.workerManager.match(featurePoints, [targetIndex]);
    return {modelViewTransform, debugExtra};
  }

  async track(input, modelViewTransform, targetIndex) {
    const inputT = this.inputLoader.loadInput(input);
    const result = this.tracker.track(inputT, modelViewTransform, targetIndex);
    inputT.dispose();
    return result;
  }

  async trackUpdate(modelViewTransform, trackFeatures) {
    if (trackFeatures.worldCoords.length < 4) return null;
    const modelViewTransform2 = await this.workerManager.trackUpdate(modelViewTransform, trackFeatures);
    return modelViewTransform2;
  }
}

export {
  Controller
};

