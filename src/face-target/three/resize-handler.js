export class ResizeHandler {
  constructor(renderer, cssRenderer, camera, container, video, controller, shouldFaceUser, disableFaceMirror) {
    this.renderer = renderer;
    this.cssRenderer = cssRenderer;
    this.camera = camera;
    this.container = container;
    this.video = video;
    this.controller = controller;
    this.shouldFaceUser = shouldFaceUser;
    this.disableFaceMirror = disableFaceMirror;
  }

  resize() {
    if (!this.video) return;

    if (true) { // only needed if video dimension updated (e.g. when mobile orientation changes)
      this.video.setAttribute('width', this.video.videoWidth);
      this.video.setAttribute('height', this.video.videoHeight);
      this.controller.onInputResized(this.video);

      const { fov, aspect, near, far } = this.controller.getCameraParams();
      this.camera.fov = fov;
      this.camera.aspect = aspect;
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();

      this.renderer.setSize(this.video.videoWidth, this.video.videoHeight);
      this.cssRenderer.setSize(this.video.videoWidth, this.video.videoHeight);
    }

    let vw, vh; // display css width, height
    const videoRatio = this.video.videoWidth / this.video.videoHeight;
    const containerRatio = this.container.clientWidth / this.container.clientHeight;
    if (videoRatio > containerRatio) {
      vh = this.container.clientHeight;
      vw = vh * videoRatio;
    } else {
      vw = this.container.clientWidth;
      vh = vw / videoRatio;
    }

    this.video.style.top = (-(vh - this.container.clientHeight) / 2) + "px";
    this.video.style.left = (-(vw - this.container.clientWidth) / 2) + "px";
    this.video.style.width = vw + "px";
    this.video.style.height = vh + "px";

    if (this.shouldFaceUser && !this.disableFaceMirror) {
      this.video.style.transform = 'scaleX(-1)';
    } else {
      this.video.style.transform = 'scaleX(1)';
    }

    const canvas = this.renderer.domElement;
    const cssCanvas = this.cssRenderer.domElement;

    canvas.style.position = 'absolute';
    canvas.style.top = this.video.style.top;
    canvas.style.left = this.video.style.left;
    canvas.style.width = this.video.style.width;
    canvas.style.height = this.video.style.height;

    cssCanvas.style.position = 'absolute';
    cssCanvas.style.top = this.video.style.top;
    cssCanvas.style.left = this.video.style.left;
    // cannot set style width for cssCanvas, because that is also used as renderer size
    //cssCanvas.style.width = video.style.width;
    //cssCanvas.style.height = video.style.height;
    cssCanvas.style.transformOrigin = "top left";
    cssCanvas.style.transform = 'scale(' + (vw / parseFloat(cssCanvas.style.width)) + ',' + (vh / parseFloat(cssCanvas.style.height)) + ')';
  }
}

