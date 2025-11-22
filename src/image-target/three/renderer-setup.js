import { Scene, WebGLRenderer, PerspectiveCamera, sRGBEncoding } from "three";
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';

export class RendererSetup {
  constructor(container) {
    this.container = container;
    this.scene = new Scene();
    this.cssScene = new Scene();
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.cssRenderer = new CSS3DRenderer({ antialias: true });
    this.renderer.outputEncoding = sRGBEncoding;
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.camera = new PerspectiveCamera();

    this.renderer.domElement.style.position = 'absolute';
    this.cssRenderer.domElement.style.position = 'absolute';
    this.container.appendChild(this.renderer.domElement);
    this.container.appendChild(this.cssRenderer.domElement);
  }

  getScene() {
    return this.scene;
  }

  getCSSScene() {
    return this.cssScene;
  }

  getRenderer() {
    return this.renderer;
  }

  getCSSRenderer() {
    return this.cssRenderer;
  }

  getCamera() {
    return this.camera;
  }
}

