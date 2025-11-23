import { Scene } from "three";

export class RendererSetup {
  constructor({ canvas, scene, camera }) {
    // Canvas is required - application must provide it
    if (!canvas) {
      throw new Error('MindAR: canvas is required. Please provide a canvas element.');
    }
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('MindAR: canvas must be an HTMLCanvasElement.');
    }

    // Scene and camera are required - application must provide them
    if (!scene) {
      throw new Error('MindAR: scene is required. Please provide a Three.js Scene.');
    }
    if (!camera) {
      throw new Error('MindAR: camera is required. Please provide a Three.js PerspectiveCamera.');
    }

    this.canvas = canvas;
    this.scene = scene;
    this.camera = camera;
    
    // CSS scene is created internally (doesn't need a renderer)
    this.cssScene = new Scene();
  }

  getScene() {
    return this.scene;
  }

  getCSSScene() {
    return this.cssScene;
  }

  getCanvas() {
    return this.canvas;
  }

  getCamera() {
    return this.camera;
  }
}

