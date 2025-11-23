import * as tf from '@tensorflow/tfjs';
import { VideoManager } from "./video-manager.js";
import { RendererSetup } from "./renderer-setup.js";
import { AnchorManager } from "./anchor-manager.js";
import { MatrixUpdater } from "./matrix-updater.js";
import { ResizeHandler } from "./resize-handler.js";
import { ARSession } from "./ar-session.js";
import { UI } from "../../ui/ui.js";
import { Logger } from "../../libs/logger.js";

export class MindARThree {
  constructor({
    container,
    canvas,
    scene,
    camera,
    imageTargetSrc,
    maxTrack,
    uiLoading = "yes",
    uiScanning = "yes",
    uiError = "yes",
    filterDCutOff = null,
    positionFilterMinCF = null,
    positionFilterBeta = null,
    rotationFilterMinCF = null,
    rotationFilterBeta = null,
    scaleFilterMinCF = null,
    scaleFilterBeta = null,
    warmupTolerance = null,
    missTolerance = null,
    userDeviceId = null,
    environmentDeviceId = null,
    resolution = null,
    targetFPS = null,
    postProcessorConfig = null, // null = disabled, {} = enabled with defaults, or custom config object
    visualizerConfig = null, // null = disabled, {} = enabled with defaults, or custom config object
    debug = false, // If true, collect graph data but don't render (for external visualization)
    onVideoRestart = null, // Optional callback called when video element is ready after restart
    onReady = null // Optional callback called when AR system is fully ready
  }) {
    // Required parameters - no fallback
    if (!container) {
      throw new Error('MindAR: container is required.');
    }
    if (!canvas) {
      throw new Error('MindAR: canvas is required. Please provide a canvas element.');
    }
    if (!scene) {
      throw new Error('MindAR: scene is required. Please provide a Three.js Scene.');
    }
    if (!camera) {
      throw new Error('MindAR: camera is required. Please provide a Three.js PerspectiveCamera.');
    }

    this.container = container;
    this.imageTargetSrc = imageTargetSrc;
    this.maxTrack = maxTrack;
    this.filterDCutOff = filterDCutOff;
    this.positionFilterMinCF = positionFilterMinCF;
    this.positionFilterBeta = positionFilterBeta;
    this.rotationFilterMinCF = rotationFilterMinCF;
    this.rotationFilterBeta = rotationFilterBeta;
    this.scaleFilterMinCF = scaleFilterMinCF;
    this.scaleFilterBeta = scaleFilterBeta;
    this.warmupTolerance = warmupTolerance;
    this.missTolerance = missTolerance;
    this.userDeviceId = userDeviceId;
    this.environmentDeviceId = environmentDeviceId;
    this.resolution = resolution;
    this.targetFPS = targetFPS;
    
    // Merge top-level filter settings into postProcessorConfig if enabled
    if (postProcessorConfig !== null) {
      this.postProcessorConfig = {
        ...postProcessorConfig,
        ...(positionFilterMinCF !== null && { positionFilterMinCF }),
        ...(positionFilterBeta !== null && { positionFilterBeta }),
        ...(rotationFilterMinCF !== null && { rotationFilterMinCF }),
        ...(rotationFilterBeta !== null && { rotationFilterBeta }),
        ...(scaleFilterMinCF !== null && { scaleFilterMinCF }),
        ...(scaleFilterBeta !== null && { scaleFilterBeta }),
        ...(filterDCutOff !== null && { filterDCutOff })
      };
    } else {
      this.postProcessorConfig = postProcessorConfig;
    }
    this.visualizerConfig = visualizerConfig;
    this.debug = debug;
    this.onVideoRestart = onVideoRestart;
    this.onReady = onReady;
    
    // Event listeners map
    this._eventListeners = new Map();
    
    // Track if ready event has been emitted
    this._readyEmitted = false;

    this.shouldFaceUser = false;

    this.logger = new Logger('MindARThree', true, 'info');
    this.logger.info('Initializing MindAR', {
      maxTrack,
      hasImageTargetSrc: !!imageTargetSrc,
      postProcessorEnabled: postProcessorConfig !== null,
      visualizerEnabled: visualizerConfig !== null,
      debug: debug
    });

    // Initialize UI
    this.ui = new UI({ uiLoading, uiScanning, uiError });

    // Initialize renderer setup with provided canvas, scene, and camera
    this.rendererSetup = new RendererSetup({ canvas, scene, camera });
    this.scene = this.rendererSetup.getScene();
    this.cssScene = this.rendererSetup.getCSSScene();
    this.canvas = this.rendererSetup.getCanvas();
    this.camera = this.rendererSetup.getCamera();

    // Initialize anchor manager
    this.anchorManager = new AnchorManager(this.scene, this.cssScene);

    // Initialize video manager
    this.videoManager = new VideoManager(
      container,
      this.ui,
      this.shouldFaceUser,
      this.userDeviceId,
      this.environmentDeviceId,
      this.resolution
    );

    // Will be initialized after AR session starts
    this.matrixUpdater = null;
    this.resizeHandler = null;
    this.arSession = null;
    this.postMatrixs = [];

    window.addEventListener('resize', this.resize.bind(this));
  }

  async start() {
    this.logger.info('Starting MindAR session');
    this.ui.showLoading();
    try {
      await this.videoManager.start();
      await this._startAR();
      this.logger.info('MindAR session started successfully');
    } catch (error) {
      this.logger.error('Failed to start MindAR session', { error: error.message });
      throw error;
    }
  }

  stop() {
    this.logger.info('Stopping MindAR session');
    if (this.arSession) {
      this.arSession.stop();
    }
    this.videoManager.stop();
  }

  switchCamera() {
    this.shouldFaceUser = !this.shouldFaceUser;
    this.videoManager.switchCamera();
    this.stop();
    this.start();
  }

  async setResolution(resolution) {
    // Validate resolution format
    if (resolution !== null && typeof resolution !== 'string') {
      throw new Error('Resolution must be a string (e.g., "360p", "720p") or null');
    }

    // If resolution hasn't changed, do nothing
    if (this.resolution === resolution) {
      return;
    }

    // Store current state
    const wasRunning = this.arSession !== null;

    // Stop current session if running
    if (wasRunning) {
      this.ui.showLoading();
      this.stop();
    }

    // Update resolution
    this.resolution = resolution;
    this.videoManager.setResolution(resolution);

    // Restart if it was running
    if (wasRunning) {
      await this.start();
      // Notify that video has restarted
      this._notifyVideoRestart();
    }
  }

  async setImageTargetSrc(imageTargetSrc) {
    // Validate imageTargetSrc format
    if (!imageTargetSrc || typeof imageTargetSrc !== 'string') {
      throw new Error('imageTargetSrc must be a non-empty string');
    }

    // If imageTargetSrc hasn't changed, do nothing
    if (this.imageTargetSrc === imageTargetSrc) {
      return;
    }

    // Store current state
    const wasRunning = this.arSession !== null;

    // Stop current session if running
    if (wasRunning) {
      this.ui.showLoading();
      this.stop();
    }

    // Update imageTargetSrc
    this.imageTargetSrc = imageTargetSrc;

    // Restart if it was running
    if (wasRunning) {
      await this.start();
      // Notify that video has restarted
      this._notifyVideoRestart();
    }
  }

  _notifyVideoRestart() {
    // Wait for video element to be ready, then notify callback
    if (this.onVideoRestart) {
      const waitForVideoReady = () => {
        const video = this.videoManager.getVideo();
        if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          this.onVideoRestart(video);
        } else {
          setTimeout(waitForVideoReady, 100);
        }
      };
      setTimeout(waitForVideoReady, 200);
    }
  }

  addAnchor(targetIndex) {
    return this.anchorManager.addAnchor(targetIndex);
  }

  addCSSAnchor(targetIndex) {
    return this.anchorManager.addCSSAnchor(targetIndex);
  }

  resize() {
    if (this.resizeHandler) {
      this.resizeHandler.resize();
    }
  }

  pauseProcessing() {
    // Pause ML processing while keeping video running
    if (this.arSession && this.arSession.getController()) {
      this.arSession.getController().pauseProcessing();
    }
  }

  resumeProcessing() {
    // Resume ML processing
    if (this.arSession && this.arSession.getController()) {
      this.arSession.getController().resumeProcessing();
    }
  }

  isProcessingPaused() {
    // Check if processing is currently paused
    if (this.arSession && this.arSession.getController()) {
      return this.arSession.getController().isProcessingPaused();
    }
    return false;
  }

  /**
   * Unified configuration update method
   * @param {Object} config - Configuration object with the following structure:
   *   {
     *     // Controller/Tracking settings
     *     filterDCutOff?: number,
   *     warmupTolerance?: number,
   *     missTolerance?: number,
   *     maxTrack?: number,
   *     targetFPS?: number | null,
   *     
   *     // Filter settings (synced to post-processor if enabled)
   *     positionFilterMinCF?: number,
   *     positionFilterBeta?: number,
   *     rotationFilterMinCF?: number,
   *     rotationFilterBeta?: number,
   *     scaleFilterMinCF?: number,
   *     scaleFilterBeta?: number,
   *     
   *     // Post-processor settings
     *     postProcessor?: {
     *       enabled?: boolean | null,  // null = disable, {} = enable with defaults, or config object
     *       outlierDetectionEnabled?: boolean,
     *       positionFilterMinCF?: number,
     *       positionFilterBeta?: number,
     *       rotationFilterMinCF?: number,
     *       rotationFilterBeta?: number,
     *       scaleFilterMinCF?: number,
     *       scaleFilterBeta?: number,
     *       filterDCutOff?: number,
   *       outlierMethod?: 'zScore' | 'modifiedZScore' | 'iqr',
   *       outlierThreshold?: number,
   *       outlierHistorySize?: number,
   *       minHistoryForOutlierDetection?: number,
   *       debugMode?: boolean,
   *       debugLogInterval?: number
   *     },
   *     
   *     // Visualizer settings
   *     visualizer?: {
   *       enabled?: boolean
   *     },
   *     
   *     // Performance profiling
   *     performanceProfiling?: boolean
   *   }
   */
  updateConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('updateConfig requires a configuration object');
    }

    const controller = this.arSession?.getController();

    // Update controller/tracking settings
    if (config.filterDCutOff !== undefined) {
      this.filterDCutOff = config.filterDCutOff;

      if (controller) {
        controller.setFilterParams({
          filterDCutOff: config.filterDCutOff
        });
      }
    }

    // Update filter settings and sync to post-processor if enabled
    const filterUpdates = {};
    if (config.filterDCutOff !== undefined) {
      filterUpdates.filterDCutOff = config.filterDCutOff;
    }
    if (config.positionFilterMinCF !== undefined) {
      this.positionFilterMinCF = config.positionFilterMinCF;
      filterUpdates.positionFilterMinCF = config.positionFilterMinCF;
    }
    if (config.positionFilterBeta !== undefined) {
      this.positionFilterBeta = config.positionFilterBeta;
      filterUpdates.positionFilterBeta = config.positionFilterBeta;
    }
    if (config.rotationFilterMinCF !== undefined) {
      this.rotationFilterMinCF = config.rotationFilterMinCF;
      filterUpdates.rotationFilterMinCF = config.rotationFilterMinCF;
    }
    if (config.rotationFilterBeta !== undefined) {
      this.rotationFilterBeta = config.rotationFilterBeta;
      filterUpdates.rotationFilterBeta = config.rotationFilterBeta;
    }
    if (config.scaleFilterMinCF !== undefined) {
      this.scaleFilterMinCF = config.scaleFilterMinCF;
      filterUpdates.scaleFilterMinCF = config.scaleFilterMinCF;
    }
    if (config.scaleFilterBeta !== undefined) {
      this.scaleFilterBeta = config.scaleFilterBeta;
      filterUpdates.scaleFilterBeta = config.scaleFilterBeta;
    }

    // Sync filter settings to post-processor if enabled
    if (Object.keys(filterUpdates).length > 0 && this.postProcessorConfig !== null && this.matrixUpdater) {
      this.postProcessorConfig = { ...this.postProcessorConfig, ...filterUpdates };
      this.matrixUpdater.updatePostProcessorConfig(filterUpdates);
    }

    if (config.warmupTolerance !== undefined) {
      this.warmupTolerance = config.warmupTolerance;
      if (controller) {
        controller.setWarmupTolerance(config.warmupTolerance);
      }
    }

    if (config.missTolerance !== undefined) {
      this.missTolerance = config.missTolerance;
      if (controller) {
        controller.setMissTolerance(config.missTolerance);
      }
    }

    if (config.maxTrack !== undefined) {
      this.maxTrack = config.maxTrack;
      if (controller) {
        controller.setMaxTrack(config.maxTrack);
      }
    }

    if (config.targetFPS !== undefined) {
      if (config.targetFPS !== null && (typeof config.targetFPS !== 'number' || config.targetFPS <= 0)) {
        throw new Error('targetFPS must be a positive number or null (for unlimited)');
      }
      this.targetFPS = config.targetFPS;
      if (controller) {
        controller.setTargetFPS(config.targetFPS);
      }
    }

    // Update post-processor settings
    if (config.postProcessor !== undefined) {
      const ppConfig = config.postProcessor;
      
      if (ppConfig === null) {
        // Disable post-processor
        if (this.matrixUpdater && this.matrixUpdater.postProcessor) {
          this.matrixUpdater.postProcessor.updateConfig({ enabled: false });
        }
        this.postProcessorConfig = null;
      } else if (typeof ppConfig === 'object') {
        // Update or enable post-processor
        if (this.postProcessorConfig === null) {
          // Was disabled, now enabling
          this.postProcessorConfig = ppConfig;
        } else {
          // Was enabled, merge config
          this.postProcessorConfig = { ...this.postProcessorConfig, ...ppConfig };
        }
        
        if (this.matrixUpdater) {
          this.matrixUpdater.updatePostProcessorConfig(ppConfig);
        } else {
          this.logger.warn('matrixUpdater not available when trying to update post-processor config');
        }
      }
    }

    // Update debug flag
    if (config.debug !== undefined) {
      this.debug = config.debug;
      
      // If debug is enabled, ensure visualizer is set up for data collection
      if (this.debug && this.matrixUpdater) {
        // Create visualizer in debug mode if it doesn't exist
        if (this.visualizerConfig === null) {
          this.visualizerConfig = {
            enabled: false,
            debug: true,
            historyDuration: 5000,
            maxPoints: 300
          };
          // Create visualizer dynamically
          this.matrixUpdater.createVisualizer(this.visualizerConfig);
          this.matrixUpdater.setVisualizerContainer(this.container);
        } else {
          // Update existing config
          this.visualizerConfig = {
            ...this.visualizerConfig,
            enabled: false,
            debug: true
          };
          // Update visualizer config if it exists
          if (this.matrixUpdater.visualizer) {
            this.matrixUpdater.visualizer.config.debug = true;
            this.matrixUpdater.visualizer.config.enabled = false;
          }
        }
      } else if (!this.debug && this.matrixUpdater && this.matrixUpdater.visualizer) {
        // Disable debug mode
        if (this.visualizerConfig) {
          this.visualizerConfig.debug = false;
        }
        if (this.matrixUpdater.visualizer) {
          this.matrixUpdater.visualizer.config.debug = false;
        }
      }
    }

    // Update visualizer settings
    if (config.visualizer !== undefined) {
      if (config.visualizer === null) {
        // Disable visualizer
        this.visualizerConfig = null;
        if (this.matrixUpdater) {
          this.matrixUpdater.setVisualizerEnabled(false);
        }
      } else if (typeof config.visualizer === 'object') {
        // Update or enable visualizer
        if (this.visualizerConfig === null) {
          // Was disabled, now enabling
          this.visualizerConfig = config.visualizer;
        } else {
          // Was enabled, merge config
          this.visualizerConfig = { ...this.visualizerConfig, ...config.visualizer };
        }
        
        if (this.matrixUpdater) {
          if (config.visualizer.enabled !== undefined) {
            this.matrixUpdater.setVisualizerEnabled(config.visualizer.enabled);
          }
        }
      }
    }

    // Update performance profiling
    if (config.performanceProfiling !== undefined) {
      if (controller) {
        controller.debugMode = config.performanceProfiling;
        if (controller.cropDetector && controller.cropDetector.detector) {
          controller.cropDetector.detector.debugMode = config.performanceProfiling;
        }
        if (controller.tracker) {
          controller.tracker.debugMode = config.performanceProfiling;
        }
      }
    }
  }

  getConfig() {
    const config = {
      filterDCutOff: this.filterDCutOff,
      positionFilterMinCF: this.positionFilterMinCF,
      positionFilterBeta: this.positionFilterBeta,
      rotationFilterMinCF: this.rotationFilterMinCF,
      rotationFilterBeta: this.rotationFilterBeta,
      scaleFilterMinCF: this.scaleFilterMinCF,
      scaleFilterBeta: this.scaleFilterBeta,
      warmupTolerance: this.warmupTolerance,
      missTolerance: this.missTolerance,
      maxTrack: this.maxTrack,
      targetFPS: this.targetFPS,
      postProcessor: this.postProcessorConfig,
      visualizer: this.visualizerConfig ? {
        ...this.visualizerConfig,
        enabled: this.matrixUpdater?.visualizer?.config?.enabled ?? false
      } : null,
      debug: this.debug,
      performanceProfiling: this.arSession?.getController()?.debugMode ?? false
    };

    // Include controller config if AR session is running
    if (this.arSession && this.arSession.getController()) {
      return {
        ...config,
        controller: this.arSession.getController().getConfig()
      };
    }

    return config;
  }

  /**
   * Reset post-processor state for a specific target
   * @param {number} targetIndex - Index of the target to reset
   */
  resetPostProcessorTarget(targetIndex) {
    if (this.matrixUpdater) {
      this.matrixUpdater.resetPostProcessorTarget(targetIndex);
    }
  }

  /**
   * Get post-processor state information for debugging
   * @param {number} targetIndex - Index of the target
   * @returns {Object|null} - State information or null if post-processor not enabled
   */
  getPostProcessorStateInfo(targetIndex) {
    if (this.matrixUpdater) {
      return this.matrixUpdater.getPostProcessorStateInfo(targetIndex);
    }
    return null;
  }

  /**
   * Get graph data for external visualization
   * @returns {Map<number, Array>} - Map of targetIndex -> array of data points
   */
  getGraphData() {
    if (this.matrixUpdater) {
      return this.matrixUpdater.getGraphData();
    }
    return new Map();
  }

  async _startAR() {
    const video = this.videoManager.getVideo();

    // Prepare visualizer config - if debug is true, enable data collection but not rendering
    let visualizerConfig = this.visualizerConfig;
    if (this.debug && visualizerConfig === null) {
      // Create default config for debug mode (data collection only)
      visualizerConfig = {
        enabled: false,
        debug: true,
        historyDuration: 5000,
        maxPoints: 300
      };
    } else if (this.debug && visualizerConfig !== null) {
      // Merge debug flag into existing config
      visualizerConfig = {
        ...visualizerConfig,
        enabled: false,
        debug: true
      };
    }

    // Initialize matrix updater with post-processor and visualizer config
    this.matrixUpdater = new MatrixUpdater(
      this.anchorManager.getAnchors(),
      this.postMatrixs,
      this.postProcessorConfig,
      visualizerConfig
    );
    
    // Initialize visualizer if enabled or in debug mode
    if (visualizerConfig !== null) {
      this.matrixUpdater.initializeVisualizer(this.container);
    }

    // Initialize resize handler
    this.resizeHandler = new ResizeHandler(
      this.canvas,
      this.camera,
      this.container,
      video,
      null // Will be set after controller is created
    );

    // Create AR session
    this.arSession = new ARSession(
      video,
      this.imageTargetSrc,
      {
        filterDCutOff: this.filterDCutOff,
        warmupTolerance: this.warmupTolerance,
        missTolerance: this.missTolerance,
        maxTrack: this.maxTrack,
        targetFPS: this.targetFPS,
        onUpdate: (data) => {
          if (data.type === 'updateMatrix') {
            const { targetIndex, worldMatrix } = data;
            this.matrixUpdater.updateMatrix(targetIndex, worldMatrix);

            if (this.matrixUpdater.hasAnyVisible()) {
              this.ui.hideScanning();
            } else {
              this.ui.showScanning();
            }
          }
        },
        onWorkDistributionEnabled: () => {
          // Emit ready event when work distribution is enabled (only once)
          if (!this._readyEmitted) {
            this._readyEmitted = true;
            this.logger.info('Emitting ready event (work distribution enabled)');
            this._emit('ready', {
              controller: this.arSession.getController(),
              video: this.videoManager.getVideo()
            });
            if (this.onReady) {
              this.onReady({
                controller: this.arSession.getController(),
                video: this.videoManager.getVideo()
              });
            }
          }
        }
      },
      (postMatrixs) => {
        this.postMatrixs = postMatrixs;
        this.matrixUpdater.postMatrixs = postMatrixs;
      }
    );

    // Update resize handler with controller reference
    await this.arSession.start();
    this.resizeHandler.controller = this.arSession.getController();

    this.resize();

    this.ui.hideLoading();
    this.ui.showScanning();
    
    // Ready event will be emitted when work distribution is enabled
  }
  
  /**
   * Add event listener
   * @param {string} event - Event name ('ready', etc.)
   * @param {Function} callback - Callback function
   */
  on(event, callback) {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, []);
    }
    this._eventListeners.get(event).push(callback);
  }
  
  /**
   * Remove event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function to remove
   */
  off(event, callback) {
    if (!this._eventListeners.has(event)) {
      return;
    }
    const listeners = this._eventListeners.get(event);
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }
  
  /**
   * Emit event to all listeners
   * @private
   */
  _emit(event, data) {
    if (!this._eventListeners.has(event)) {
      return;
    }
    const listeners = this._eventListeners.get(event);
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        this.logger.error(`Error in event listener for ${event}`, { error });
      }
    });
  }
}

// Window global setup
if (!window.MINDAR) {
  window.MINDAR = {};
}
if (!window.MINDAR.IMAGE) {
  window.MINDAR.IMAGE = {};
}

window.MINDAR.IMAGE.MindARThree = MindARThree;
window.MINDAR.IMAGE.tf = tf;

