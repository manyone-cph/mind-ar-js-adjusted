import * as tf from '@tensorflow/tfjs';
import { VideoManager } from "./video-manager.js";
import { RendererSetup } from "./renderer-setup.js";
import { AnchorManager } from "./anchor-manager.js";
import { MatrixUpdater } from "./matrix-updater.js";
import { ResizeHandler } from "./resize-handler.js";
import { ARSession } from "./ar-session.js";
import { UI } from "../../ui/ui.js";

export class MindARThree {
  constructor({
    container,
    imageTargetSrc,
    maxTrack,
    uiLoading = "yes",
    uiScanning = "yes",
    uiError = "yes",
    filterMinCF = null,
    filterBeta = null,
    filterDCutOff = null,
    warmupTolerance = null,
    missTolerance = null,
    userDeviceId = null,
    environmentDeviceId = null,
    resolution = null,
    targetFPS = null
  }) {
    this.container = container;
    this.imageTargetSrc = imageTargetSrc;
    this.maxTrack = maxTrack;
    this.filterMinCF = filterMinCF;
    this.filterBeta = filterBeta;
    this.filterDCutOff = filterDCutOff;
    this.warmupTolerance = warmupTolerance;
    this.missTolerance = missTolerance;
    this.userDeviceId = userDeviceId;
    this.environmentDeviceId = environmentDeviceId;
    this.resolution = resolution;
    this.targetFPS = targetFPS;

    this.shouldFaceUser = false;

    // Initialize UI
    this.ui = new UI({ uiLoading, uiScanning, uiError });

    // Initialize renderer setup
    this.rendererSetup = new RendererSetup(container);
    this.scene = this.rendererSetup.getScene();
    this.cssScene = this.rendererSetup.getCSSScene();
    this.renderer = this.rendererSetup.getRenderer();
    this.cssRenderer = this.rendererSetup.getCSSRenderer();
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
    this.ui.showLoading();
    await this.videoManager.start();
    await this._startAR();
  }

  stop() {
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
    // Note: anchorManager persists across restarts (created in constructor),
    // so anchors and their 3D objects are automatically preserved
    if (wasRunning) {
      await this.start();
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

  setTargetFPS(targetFPS) {
    // Validate targetFPS
    if (targetFPS !== null && (typeof targetFPS !== 'number' || targetFPS <= 0)) {
      throw new Error('targetFPS must be a positive number or null (for unlimited)');
    }

    this.targetFPS = targetFPS;
    
    // Update controller if AR session is running
    if (this.arSession && this.arSession.getController()) {
      this.arSession.getController().setTargetFPS(targetFPS);
    }
  }

  setFilterParams({filterMinCF, filterBeta, filterDCutOff}) {
    // Update stored values
    if (filterMinCF !== undefined) {
      this.filterMinCF = filterMinCF;
    }
    if (filterBeta !== undefined) {
      this.filterBeta = filterBeta;
    }
    if (filterDCutOff !== undefined) {
      this.filterDCutOff = filterDCutOff;
    }

    // Update controller if AR session is running
    if (this.arSession && this.arSession.getController()) {
      this.arSession.getController().setFilterParams({filterMinCF, filterBeta, filterDCutOff});
    }
  }

  setWarmupTolerance(warmupTolerance) {
    // Update stored value
    this.warmupTolerance = warmupTolerance;

    // Update controller if AR session is running
    if (this.arSession && this.arSession.getController()) {
      this.arSession.getController().setWarmupTolerance(warmupTolerance);
    }
  }

  setMissTolerance(missTolerance) {
    // Update stored value
    this.missTolerance = missTolerance;

    // Update controller if AR session is running
    if (this.arSession && this.arSession.getController()) {
      this.arSession.getController().setMissTolerance(missTolerance);
    }
  }

  setMaxTrack(maxTrack) {
    // Update stored value
    this.maxTrack = maxTrack;

    // Update controller if AR session is running
    if (this.arSession && this.arSession.getController()) {
      this.arSession.getController().setMaxTrack(maxTrack);
    }
  }

  getConfig() {
    const config = {
      filterMinCF: this.filterMinCF,
      filterBeta: this.filterBeta,
      filterDCutOff: this.filterDCutOff,
      warmupTolerance: this.warmupTolerance,
      missTolerance: this.missTolerance,
      maxTrack: this.maxTrack,
      targetFPS: this.targetFPS
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

  async _startAR() {
    const video = this.videoManager.getVideo();

    // Initialize matrix updater
    this.matrixUpdater = new MatrixUpdater(
      this.anchorManager.getAnchors(),
      this.postMatrixs
    );

    // Initialize resize handler
    this.resizeHandler = new ResizeHandler(
      this.renderer,
      this.cssRenderer,
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
        filterMinCF: this.filterMinCF,
        filterBeta: this.filterBeta,
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

