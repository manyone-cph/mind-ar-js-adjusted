import { Matrix4, Vector3, Quaternion, Scene, WebGLRenderer, PerspectiveCamera, Group, sRGBEncoding } from "three";
import * as tf from '@tensorflow/tfjs';
//import { CSS3DRenderer } from '../libs/CSS3DRenderer.js';
import {CSS3DRenderer} from 'three/addons/renderers/CSS3DRenderer.js'
import { Controller } from "./controller.js";
import { UI } from "../ui/ui.js";

const cssScaleDownMatrix = new Matrix4();
cssScaleDownMatrix.compose(new Vector3(), new Quaternion(), new Vector3(0.001, 0.001, 0.001));

const invisibleMatrix = new Matrix4().set(0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1);

export class MindARThree {
  constructor({
    container, imageTargetSrc, maxTrack, uiLoading = "yes", uiScanning = "yes", uiError = "yes",
    filterMinCF = null, filterBeta = null, warmupTolerance = null, missTolerance = null,
    userDeviceId = null, environmentDeviceId = null
  }) {
    this.container = container;
    this.imageTargetSrc = imageTargetSrc;
    this.maxTrack = maxTrack;
    this.filterMinCF = filterMinCF;
    this.filterBeta = filterBeta;
    this.warmupTolerance = warmupTolerance;
    this.missTolerance = missTolerance;
    this.ui = new UI({ uiLoading, uiScanning, uiError });
    this.userDeviceId = userDeviceId;
    this.environmentDeviceId = environmentDeviceId;

    this.shouldFaceUser = false;

    this.scene = new Scene();
    this.cssScene = new Scene();
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.cssRenderer = new CSS3DRenderer({ antialias: true });
    this.renderer.outputEncoding = sRGBEncoding;
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.camera = new PerspectiveCamera();
    this.anchors = [];

    this.renderer.domElement.style.position = 'absolute';
    this.cssRenderer.domElement.style.position = 'absolute';
    this.container.appendChild(this.renderer.domElement);
    this.container.appendChild(this.cssRenderer.domElement);

    window.addEventListener('resize', this.resize.bind(this));
  }

  async start() {
    this.ui.showLoading();
    await this._startVideo();
    await this._startAR();
  }

  stop() {
    this.controller.stopProcessVideo();
    
    // Stop canvas update loop if running
    if (this.canvasUpdateLoopId !== null && this.canvasUpdateLoopId !== undefined) {
      cancelAnimationFrame(this.canvasUpdateLoopId);
      this.canvasUpdateLoopId = null;
    }
    
    const tracks = this.video.srcObject.getTracks();
    tracks.forEach(function (track) {
      track.stop();
    });
    this.video.remove();
    
    // Clean up tracking canvas
    if (this.trackingCanvas) {
      this.trackingCanvas = null;
      this.trackingCanvasContext = null;
      this.updateTrackingCanvas = null;
    }
  }

  switchCamera() {
    this.shouldFaceUser = !this.shouldFaceUser;
    this.stop();
    this.start();
  }

  switchTarget(targetIndex) {
    // Switch tracking focus to a specific target index
    // targetIndex: -1 to check all targets, or 0-N to focus on specific target
    if (this.controller) {
      this.controller.interestedTargetIndex = targetIndex;
    }
  }

  processVideoWithCanvas() {
    // Start a loop to continuously update the canvas from high-res video
    // This runs in parallel with the controller's processing loop
    // The canvas is updated frequently so it's always fresh when the controller reads it
    if (!this.trackingCanvas || !this.trackingCanvasContext) {
      // Fallback to video if canvas is not available
      console.warn('[MindAR] Canvas not available, using video directly');
      this.controller.processVideo(this.video);
      return;
    }
    
    const updateLoop = () => {
      if (this.controller && this.controller.processingVideo) {
        this.updateTrackingCanvas();
        requestAnimationFrame(updateLoop);
      } else {
        // Stop updating if controller stopped processing
        this.canvasUpdateLoopId = null;
      }
    };
    
    // Store the loop ID so we can stop it if needed
    this.canvasUpdateLoopId = requestAnimationFrame(updateLoop);
    
    // Start processing the canvas (controller will read from it in its own loop)
    // The canvas update loop ensures it's always up-to-date
    this.controller.processVideo(this.trackingCanvas);
  }

  addAnchor(targetIndex) {
    const group = new Group();
    group.visible = false;
    group.matrixAutoUpdate = false;
    const anchor = { group, targetIndex, onTargetFound: null, onTargetLost: null, onTargetUpdate: null, css: false, visible: false };
    this.anchors.push(anchor);
    this.scene.add(group);
    return anchor;
  }

  addCSSAnchor(targetIndex) {
    const group = new Group();
    group.visible = false;
    group.matrixAutoUpdate = false;
    const anchor = { group, targetIndex, onTargetFound: null, onTargetLost: null, onTargetUpdate: null, css: true, visible: false };
    this.anchors.push(anchor);
    this.cssScene.add(group);
    return anchor;
  }

  _startVideo() {
    return new Promise((resolve, reject) => {
      this.video = document.createElement('video');

      this.video.setAttribute('autoplay', '');
      this.video.setAttribute('muted', '');
      this.video.setAttribute('playsinline', '');
      this.video.style.position = 'absolute'
      this.video.style.top = '0px'
      this.video.style.left = '0px'
      this.video.style.zIndex = '-2'
      this.container.appendChild(this.video);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.ui.showCompatibility();
        reject();
        return;
      }

      const constraints = {
        audio: false,
        video: {
          // Don't restrict resolution - let device choose best available
          // We'll use high-res for rendering and downsample for tracking
          // This ensures mobile devices can initialize properly
          // Mobile-friendly constraints
          width: { ideal: 1280 },
          height: { ideal: 720 },
        }
      };
      if (this.shouldFaceUser) {
        if (this.userDeviceId) {
          constraints.video.deviceId = { exact: this.userDeviceId };
        } else {
          constraints.video.facingMode = 'user';
        }
      } else {
        if (this.environmentDeviceId) {
          constraints.video.deviceId = { exact: this.environmentDeviceId };
        } else {
          constraints.video.facingMode = 'environment';
        }
      }

      navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
        this.video.srcObject = stream;
        // Use 'loadedmetadata' event for better mobile compatibility
        // Also handle 'loadeddata' as fallback for some mobile browsers
        const onVideoReady = () => {
          if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
            this.video.setAttribute('width', this.video.videoWidth);
            this.video.setAttribute('height', this.video.videoHeight);
            console.log(`[MindAR] Video initialized: ${this.video.videoWidth}x${this.video.videoHeight}`);
            this.video.removeEventListener('loadedmetadata', onVideoReady);
            this.video.removeEventListener('loadeddata', onVideoReady);
            resolve();
          }
        };
        
        this.video.addEventListener('loadedmetadata', onVideoReady);
        this.video.addEventListener('loadeddata', onVideoReady);
        
        // Fallback timeout for mobile devices that might not fire events properly
        setTimeout(() => {
          if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
            onVideoReady();
          } else {
            console.warn('[MindAR] Video metadata timeout, attempting to proceed anyway');
            // Try to proceed with current video state
            if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
              onVideoReady();
            } else {
              // Last resort: use default dimensions if available
              const tracks = stream.getVideoTracks();
              if (tracks.length > 0) {
                const settings = tracks[0].getSettings();
                if (settings.width && settings.height) {
                  this.video.setAttribute('width', settings.width);
                  this.video.setAttribute('height', settings.height);
                  console.log(`[MindAR] Video initialized from track settings: ${settings.width}x${settings.height}`);
                  resolve();
                } else {
                  reject(new Error('Video dimensions not available'));
                }
              } else {
                reject(new Error('No video tracks available'));
              }
            }
          }
        }, 3000);
      }).catch((err) => {
        console.error("[MindAR] getUserMedia error:", err);
        console.error("[MindAR] Error name:", err.name);
        console.error("[MindAR] Error message:", err.message);
        // Try with more permissive constraints as fallback
        const fallbackConstraints = {
          audio: false,
          video: this.shouldFaceUser ? { facingMode: 'user' } : { facingMode: 'environment' }
        };
        console.log("[MindAR] Attempting fallback with simpler constraints");
        navigator.mediaDevices.getUserMedia(fallbackConstraints).then((stream) => {
          this.video.srcObject = stream;
          this.video.addEventListener('loadedmetadata', () => {
            this.video.setAttribute('width', this.video.videoWidth);
            this.video.setAttribute('height', this.video.videoHeight);
            console.log(`[MindAR] Video initialized (fallback): ${this.video.videoWidth}x${this.video.videoHeight}`);
            resolve();
          });
        }).catch((fallbackErr) => {
          console.error("[MindAR] Fallback getUserMedia also failed:", fallbackErr);
          reject(fallbackErr);
        });
      });
    });
  }

  _startAR() {
    return new Promise(async (resolve, reject) => {
      const video = this.video;
      const container = this.container;

      // Wait for video to be ready before proceeding
      // On mobile, video metadata might not be immediately available
      if (!video.videoWidth || !video.videoHeight) {
        // Wait for video dimensions to be available
        await new Promise((videoResolve) => {
          const checkVideo = () => {
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              videoResolve();
            } else {
              // Check again after a short delay
              setTimeout(checkVideo, 100);
            }
          };
          checkVideo();
        });
      }

      // Create downsampled canvas for Mind-AR processing
      // Use fixed optimal resolution for tracking (640x480 works best for Mind-AR)
      // This ensures consistent tracking performance across all devices
      // The high-resolution video is still used for Three.js scene rendering
      this.trackingWidth = 640;
      this.trackingHeight = 480;
      
      // Try to create canvas for downsampling, but fallback to video if it fails
      let useCanvas = true;
      this.trackingCanvas = document.createElement('canvas');
      this.trackingCanvas.width = this.trackingWidth;
      this.trackingCanvas.height = this.trackingHeight;
      
      try {
        this.trackingCanvasContext = this.trackingCanvas.getContext('2d', { willReadFrequently: true });
        if (!this.trackingCanvasContext) {
          console.warn('[MindAR] Canvas 2d context not available, falling back to video');
          useCanvas = false;
        }
      } catch (e) {
        console.warn('[MindAR] Failed to create canvas context, falling back to video:', e);
        useCanvas = false;
      }
      
      // Set up canvas update function that will be called each frame
      // This downsamples the high-res video to the tracking resolution
      this.updateTrackingCanvas = () => {
        if (useCanvas && this.trackingCanvasContext && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          try {
            this.trackingCanvasContext.drawImage(
              video,
              0, 0, video.videoWidth, video.videoHeight,  // Source: full resolution video
              0, 0, this.trackingWidth, this.trackingHeight  // Destination: downsampled canvas
            );
          } catch (e) {
            // If canvas drawing fails, disable canvas mode
            console.warn('[MindAR] Canvas drawImage failed, falling back to video:', e);
            useCanvas = false;
          }
        }
      };
      
      console.log(`[MindAR] Video resolution: ${video.videoWidth}x${video.videoHeight}, Tracking resolution: ${useCanvas ? `${this.trackingWidth}x${this.trackingHeight} (canvas)` : 'native (video)'}`);

      // Store full video dimensions for projection matrix scaling
      this.fullVideoWidth = video.videoWidth;
      this.fullVideoHeight = video.videoHeight;
      
      // If using canvas, calculate scale factors; otherwise use 1.0 (no scaling needed)
      if (useCanvas) {
        this.downsampleScaleX = this.fullVideoWidth / this.trackingWidth;
        this.downsampleScaleY = this.fullVideoHeight / this.trackingHeight;
      } else {
        // No downsampling - use video directly
        this.downsampleScaleX = 1.0;
        this.downsampleScaleY = 1.0;
        this.trackingWidth = this.fullVideoWidth;
        this.trackingHeight = this.fullVideoHeight;
      }

      // Controller uses downsampled dimensions for performance (or native if canvas unavailable)
      // We'll scale the projection matrix results to match full resolution if using canvas
      this.controller = new Controller({
        inputWidth: this.trackingWidth,  // Downsampled for performance, or native video resolution
        inputHeight: this.trackingHeight,  // Downsampled for performance, or native video resolution
        filterMinCF: this.filterMinCF,
        filterBeta: this.filterBeta,
        warmupTolerance: this.warmupTolerance,
        missTolerance: this.missTolerance,
        maxTrack: this.maxTrack,
        onUpdate: (data) => {
          if (data.type === 'updateMatrix') {
            const { targetIndex, worldMatrix } = data;

            for (let i = 0; i < this.anchors.length; i++) {
              if (this.anchors[i].targetIndex === targetIndex) {
                if (this.anchors[i].css) {
                  this.anchors[i].group.children.forEach((obj) => {
                    obj.element.style.visibility = worldMatrix === null ? "hidden" : "visible";
                  });
                } else {
                  this.anchors[i].group.visible = worldMatrix !== null;
                }

                if (worldMatrix !== null) {
                  let m = new Matrix4();
                  m.elements = [...worldMatrix];
                  
                  // Apply resolution correction: scale the world matrix to account for downsampling
                  // Only needed if we're using canvas downsampling (scale factors > 1.0)
                  if (this.downsampleScaleX > 1.0 || this.downsampleScaleY > 1.0) {
                    // The world matrix is calculated from a projection matrix based on downsampled resolution,
                    // but Three.js expects coordinates based on full video resolution.
                    //
                    // The projection matrix uses:
                    //   - Focal length: f = (inputHeight/2) / tan(fovy/2) - proportional to inputHeight
                    //   - Principal point: (inputWidth/2, inputHeight/2) - proportional to input dimensions
                    //
                    // When tracking at lower resolution, the focal length is smaller, which means
                    // the same 3D position results in different estimated translations.
                    // The translation components need to be scaled UP by the ratio of full/tracking resolution
                    // to correct for the downsampled projection matrix.
                    const scaleX = this.downsampleScaleX;  // > 1, scales up
                    const scaleY = this.downsampleScaleY;  // > 1, scales up
                    const scaleZ = (scaleX + scaleY) / 2;  // Average for depth
                    
                    // World matrix is column-major: translation is in elements [12, 13, 14]
                    // Scale translation components UP to correct for downsampled projection matrix
                    m.elements[12] *= scaleX / 2; // X translation
                    m.elements[13] *= scaleY / 2; // Y translation
                    m.elements[14] *= scaleZ; // Z translation (depth)
                  }
                  
                  m.multiply(this.postMatrixs[targetIndex]);
                  if (this.anchors[i].css) {
                    m.multiply(cssScaleDownMatrix);
                  }
                  this.anchors[i].group.matrix = m;
                } else {
                  this.anchors[i].group.matrix = invisibleMatrix;
                }

                if (this.anchors[i].visible && worldMatrix === null) {
                  this.anchors[i].visible = false;
                  if (this.anchors[i].onTargetLost) {
                    this.anchors[i].onTargetLost();
                  }
                }

                if (!this.anchors[i].visible && worldMatrix !== null) {
                  this.anchors[i].visible = true;
                  if (this.anchors[i].onTargetFound) {
                    this.anchors[i].onTargetFound();
                  }
                }
                
                if (this.anchors[i].onTargetUpdate) {
                  this.anchors[i].onTargetUpdate();
                }
              }
            }

            let isAnyVisible = this.anchors.reduce((acc, anchor) => {
              return acc || anchor.visible;
            }, false);
            if (isAnyVisible) {
              this.ui.hideScanning();
            } else {
              this.ui.showScanning();
            }
          }
        }
      });

      this.resize();

      const { dimensions: imageTargetDimensions } = await this.controller.addImageTargets(this.imageTargetSrc);

      this.postMatrixs = [];
      for (let i = 0; i < imageTargetDimensions.length; i++) {
        const position = new Vector3();
        const quaternion = new Quaternion();
        const scale = new Vector3();
        const [markerWidth, markerHeight] = imageTargetDimensions[i];
        position.x = markerWidth / 2;
        position.y = markerWidth / 2 + (markerHeight - markerWidth) / 2;
        scale.x = markerWidth;
        scale.y = markerWidth;
        scale.z = markerWidth;
        const postMatrix = new Matrix4();
        postMatrix.compose(position, quaternion, scale);
        this.postMatrixs.push(postMatrix);
      }

      // Update canvas before dummy run (if using canvas)
      if (useCanvas) {
        this.updateTrackingCanvas();
        await this.controller.dummyRun(this.trackingCanvas);
      } else {
        // Use video directly if canvas is not available
        await this.controller.dummyRun(video);
      }
      this.ui.hideLoading();
      this.ui.showScanning();

      // Process the downsampled canvas or video directly
      if (useCanvas) {
        // Process the downsampled canvas - we'll update the canvas each frame before processing
        this.processVideoWithCanvas();
      } else {
        // Fallback: process video directly (original Mind-AR behavior)
        this.controller.processVideo(video);
      }
      resolve();
    });
  }

  resize() {
    const { renderer, cssRenderer, camera, container, video } = this;
    if (!video) return;

    this.video.setAttribute('width', this.video.videoWidth);
    this.video.setAttribute('height', this.video.videoHeight);

    let vw, vh; // display css width, height
    const videoRatio = video.videoWidth / video.videoHeight;
    const containerRatio = container.clientWidth / container.clientHeight;
    if (videoRatio > containerRatio) {
      vh = container.clientHeight;
      vw = vh * videoRatio;
    } else {
      vw = container.clientWidth;
      vh = vw / videoRatio;
    }

    const proj = this.controller.getProjectionMatrix();

    // TODO: move this logic to controller
    // Handle when phone is rotated, video width and height are swapped
    const inputRatio = this.controller.inputWidth / this.controller.inputHeight;
    let inputAdjust;
    if (inputRatio > containerRatio) {
      inputAdjust = this.video.width / this.controller.inputWidth;
    } else {
      inputAdjust = this.video.height / this.controller.inputHeight;
    }
    let videoDisplayHeight;
    let videoDisplayWidth;
    if (inputRatio > containerRatio) {
      videoDisplayHeight = container.clientHeight;
      videoDisplayHeight *= inputAdjust;
    } else {
      videoDisplayWidth = container.clientWidth;
      videoDisplayHeight = videoDisplayWidth / this.controller.inputWidth * this.controller.inputHeight;
      videoDisplayHeight *= inputAdjust;
    }
    let fovAdjust = container.clientHeight / videoDisplayHeight;

    // const fov = 2 * Math.atan(1 / proj[5] / vh * container.clientHeight) * 180 / Math.PI; // vertical fov
    const fov = 2 * Math.atan(1 / proj[5] * fovAdjust) * 180 / Math.PI; // vertical fov
    const near = proj[14] / (proj[10] - 1.0);
    const far = proj[14] / (proj[10] + 1.0);
    const ratio = proj[5] / proj[0]; // (r-l) / (t-b)

    camera.fov = fov;
    camera.near = near;
    camera.far = far;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();

    video.style.top = (-(vh - container.clientHeight) / 2) + "px";
    video.style.left = (-(vw - container.clientWidth) / 2) + "px";
    video.style.width = vw + "px";
    video.style.height = vh + "px";

    const canvas = renderer.domElement;
    const cssCanvas = cssRenderer.domElement;

    canvas.style.position = 'absolute';
    canvas.style.left = 0;
    canvas.style.top = 0;
    canvas.style.width = container.clientWidth + 'px';
    canvas.style.height = container.clientHeight + 'px';

    cssCanvas.style.position = 'absolute';
    cssCanvas.style.left = 0;
    cssCanvas.style.top = 0;
    cssCanvas.style.width = container.clientWidth + 'px';
    cssCanvas.style.height = container.clientHeight + 'px';

    renderer.setSize(container.clientWidth, container.clientHeight);
    cssRenderer.setSize(container.clientWidth, container.clientHeight);
  }
}

if (!window.MINDAR) {
  window.MINDAR = {};
}
if (!window.MINDAR.IMAGE) {
  window.MINDAR.IMAGE = {};
}

window.MINDAR.IMAGE.MindARThree = MindARThree;
//window.MINDAR.IMAGE.THREE = THREE;
window.MINDAR.IMAGE.tf = tf;
