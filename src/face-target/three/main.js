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
    filterDCutOff = null,
    userDeviceId = null,
    environmentDeviceId = null,
    disableFaceMirror = false,
    resolution = null
  }) {
    this.container = container;
    this.filterMinCF = filterMinCF;
    this.filterBeta = filterBeta;
    this.filterDCutOff = filterDCutOff;
    this.userDeviceId = userDeviceId;
    this.environmentDeviceId = environmentDeviceId;
    this.disableFaceMirror = disableFaceMirror;
    this.resolution = resolution;

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
      this.environmentDeviceId,
      this.resolution
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
    
    // Preserve anchors and face meshes if running
    let preservedAnchors = [];
    let preservedCSSAnchors = [];
    let preservedFaceMeshes = [];
    
    if (wasRunning && this.anchorManager) {
      // Store anchor metadata (landmarkIndex and css flag)
      const anchors = this.anchorManager.getAnchors();
      preservedAnchors = anchors
        .filter(anchor => !anchor.css)
        .map(anchor => ({
          landmarkIndex: anchor.landmarkIndex,
          group: anchor.group  // Preserve the group with user's 3D objects
        }));
      
      preservedCSSAnchors = anchors
        .filter(anchor => anchor.css)
        .map(anchor => ({
          landmarkIndex: anchor.landmarkIndex,
          group: anchor.group  // Preserve the group with user's 3D objects
        }));
      
      // Store face mesh references (they'll need to be recreated with new controller)
      const faceMeshes = this.anchorManager.getFaceMeshes();
      preservedFaceMeshes = faceMeshes.map(mesh => ({
        visible: mesh.visible,
        material: mesh.material.clone()  // Clone material to preserve settings
      }));
    }

    // Stop current session if running
    if (wasRunning) {
      this.ui.showLoading();
      this.stop();
    }

    // Update resolution
    this.resolution = resolution;
    if (this.videoManager) {
      this.videoManager.setResolution(resolution);
    }

    // Restart if it was running
    if (wasRunning) {
      await this.start();
      
      // Restore anchors and face meshes
      if (this.anchorManager) {
        // Re-add anchors (this will create new anchor entries, but we'll attach to existing groups)
        preservedAnchors.forEach(preserved => {
          const children = [];
          while (preserved.group.children.length > 0) {
            children.push(preserved.group.children[0]);
          }
          this.scene.remove(preserved.group);
          
          // Create new anchor with new group
          const newAnchor = this.anchorManager.addAnchor(preserved.landmarkIndex);
          // Move all children to new group
          children.forEach(child => newAnchor.group.add(child));
        });
        
        preservedCSSAnchors.forEach(preserved => {
          // Collect all children before removing the group
          const children = [];
          while (preserved.group.children.length > 0) {
            children.push(preserved.group.children[0]);
          }
          this.cssScene.remove(preserved.group);
          
          // Create new anchor with new group
          const newAnchor = this.anchorManager.addCSSAnchor(preserved.landmarkIndex);
          // Move all children to new group
          children.forEach(child => newAnchor.group.add(child));
        });
        
        // Recreate face meshes
        preservedFaceMeshes.forEach(preserved => {
          const newFaceMesh = this.anchorManager.addFaceMesh();
          newFaceMesh.visible = preserved.visible;
          newFaceMesh.material = preserved.material;
        });
      }
    }
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

  getConfig() {
    const config = {
      filterMinCF: this.filterMinCF,
      filterBeta: this.filterBeta,
      filterDCutOff: this.filterDCutOff
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

    // Create AR session first to get controller
    this.arSession = new ARSession(video, {
      filterMinCF: this.filterMinCF,
      filterBeta: this.filterBeta,
      filterDCutOff: this.filterDCutOff,
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

