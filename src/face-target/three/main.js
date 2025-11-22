import { VideoManager } from "./video-manager.js";
import { RendererSetup } from "./renderer-setup.js";
import { AnchorManager } from "./anchor-manager.js";
import { MatrixUpdater } from "./matrix-updater.js";
import { ResizeHandler } from "./resize-handler.js";
import { ARSession } from "./ar-session.js";
import { UI } from "../../ui/ui.js";
import { BufferGeometry, BufferAttribute } from "three";

const THREE = { BufferGeometry, BufferAttribute };

export class MindARThree {
  constructor({
    container,
    uiLoading = "yes",
    uiScanning = "yes",
    uiError = "yes",
    filterMinCF = null,
    filterBeta = null,
    userDeviceId = null,
    environmentDeviceId = null,
    disableFaceMirror = false,
  }) {
    this.container = container;
    this.filterMinCF = filterMinCF;
    this.filterBeta = filterBeta;
    this.userDeviceId = userDeviceId;
    this.environmentDeviceId = environmentDeviceId;
    this.disableFaceMirror = disableFaceMirror;

    this.shouldFaceUser = true;

    // Initialize UI
    this.ui = new UI({ uiLoading, uiScanning, uiError });

    // Initialize renderer setup
    this.rendererSetup = new RendererSetup(container);
    this.scene = this.rendererSetup.getScene();
    this.cssScene = this.rendererSetup.getCSSScene();
    this.renderer = this.rendererSetup.getRenderer();
    this.cssRenderer = this.rendererSetup.getCSSRenderer();
    this.camera = this.rendererSetup.getCamera();

    // Will be initialized after AR session starts
    this.videoManager = null;
    this.anchorManager = null;
    this.matrixUpdater = null;
    this.resizeHandler = null;
    this.arSession = null;
    this.latestEstimate = null;

    window.addEventListener('resize', this._resize.bind(this));
  }

  async start() {
    this.ui.showLoading();

    // Initialize video manager
    this.videoManager = new VideoManager(
      this.container,
      this.ui,
      this.shouldFaceUser,
      this.userDeviceId,
      this.environmentDeviceId
    );

    await this.videoManager.start();
    await this._startAR();
    this.ui.hideLoading();
  }

  stop() {
    if (this.arSession) {
      this.arSession.stop();
    }
    if (this.videoManager) {
      this.videoManager.stop();
    }
  }

  switchCamera() {
    this.shouldFaceUser = !this.shouldFaceUser;
    if (this.videoManager) {
      this.videoManager.switchCamera();
    }
    this.stop();
    this.start();
  }

  addAnchor(landmarkIndex) {
    if (!this.anchorManager) {
      throw new Error("AR session not started. Call start() first.");
    }
    return this.anchorManager.addAnchor(landmarkIndex);
  }

  addCSSAnchor(landmarkIndex) {
    if (!this.anchorManager) {
      throw new Error("AR session not started. Call start() first.");
    }
    return this.anchorManager.addCSSAnchor(landmarkIndex);
  }

  addFaceMesh() {
    if (!this.anchorManager) {
      throw new Error("AR session not started. Call start() first.");
    }
    return this.anchorManager.addFaceMesh();
  }

  getLatestEstimate() {
    return this.latestEstimate;
  }

  _resize() {
    if (this.resizeHandler) {
      this.resizeHandler.resize();
    }
  }

  async _startAR() {
    const video = this.videoManager.getVideo();

    // Create AR session first to get controller
    this.arSession = new ARSession(video, {
      filterMinCF: this.filterMinCF,
      filterBeta: this.filterBeta,
      onUpdate: ({ hasFace, estimateResult }) => {
        this.latestEstimate = hasFace ? estimateResult : null;
        if (this.matrixUpdater) {
          this.matrixUpdater.update(hasFace, estimateResult);
        }
      }
    });

    const flipFace = this.shouldFaceUser && !this.disableFaceMirror;
    const controller = await this.arSession.start(flipFace);

    // Initialize anchor manager with controller
    this.anchorManager = new AnchorManager(this.scene, this.cssScene, controller);

    // Initialize matrix updater
    this.matrixUpdater = new MatrixUpdater(
      this.anchorManager.getAnchors(),
      this.anchorManager.getFaceMeshes(),
      controller
    );

    // Initialize resize handler
    this.resizeHandler = new ResizeHandler(
      this.renderer,
      this.cssRenderer,
      this.camera,
      this.container,
      video,
      controller,
      this.shouldFaceUser,
      this.disableFaceMirror
    );

    this._resize();
  }
}

// Window global setup
if (!window.MINDAR) {
  window.MINDAR = {};
}
if (!window.MINDAR.FACE) {
  window.MINDAR.FACE = {};
}

window.MINDAR.FACE.MindARThree = MindARThree;

