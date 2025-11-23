export class ResizeHandler {
  constructor(canvas, camera, container, video, controller) {
    // Canvas is required - application must provide it
    if (!canvas) {
      throw new Error('MindAR ResizeHandler: canvas is required.');
    }
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('MindAR ResizeHandler: canvas must be an HTMLCanvasElement.');
    }

    this.canvas = canvas;
    this.camera = camera;
    this.container = container;
    this.video = video;
    this.controller = controller;
  }

  resize() {
    if (!this.video) return;

    this.video.setAttribute('width', this.video.videoWidth);
    this.video.setAttribute('height', this.video.videoHeight);

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
      videoDisplayHeight = this.container.clientHeight;
      videoDisplayHeight *= inputAdjust;
    } else {
      videoDisplayWidth = this.container.clientWidth;
      videoDisplayHeight = videoDisplayWidth / this.controller.inputWidth * this.controller.inputHeight;
      videoDisplayHeight *= inputAdjust;
    }
    let fovAdjust = this.container.clientHeight / videoDisplayHeight;

    // const fov = 2 * Math.atan(1 / proj[5] / vh * container.clientHeight) * 180 / Math.PI; // vertical fov
    const fov = 2 * Math.atan(1 / proj[5] * fovAdjust) * 180 / Math.PI; // vertical fov
    const near = proj[14] / (proj[10] - 1.0);
    const far = proj[14] / (proj[10] + 1.0);
    const ratio = proj[5] / proj[0]; // (r-l) / (t-b)

    // Update camera projection matrix (critical for AR tracking)
    this.camera.fov = fov;
    this.camera.near = near;
    this.camera.far = far;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();

    // Update video element styling
    this.video.style.top = (-(vh - this.container.clientHeight) / 2) + "px";
    this.video.style.left = (-(vw - this.container.clientWidth) / 2) + "px";
    this.video.style.width = vw + "px";
    this.video.style.height = vh + "px";

    // Update canvas styling (application handles renderer.setSize() itself)
    this.canvas.style.position = 'absolute';
    this.canvas.style.left = 0;
    this.canvas.style.top = 0;
    this.canvas.style.width = this.container.clientWidth + 'px';
    this.canvas.style.height = this.container.clientHeight + 'px';
  }
}

