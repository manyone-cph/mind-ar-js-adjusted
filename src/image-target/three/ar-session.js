import { Matrix4, Vector3, Quaternion } from "three";
import { Controller } from "../controller.js";

export class ARSession {
  constructor(video, imageTargetSrc, controllerConfig, postMatrixsCallback) {
    this.video = video;
    this.imageTargetSrc = imageTargetSrc;
    this.controllerConfig = controllerConfig;
    this.postMatrixsCallback = postMatrixsCallback;
    this.controller = null;
    this.postMatrixs = [];
  }

  async start() {
    this.controller = new Controller({
      inputWidth: this.video.videoWidth,
      inputHeight: this.video.videoHeight,
      filterMinCF: this.controllerConfig.filterMinCF,
      filterBeta: this.controllerConfig.filterBeta,
      filterDCutOff: this.controllerConfig.filterDCutOff,
      warmupTolerance: this.controllerConfig.warmupTolerance,
      missTolerance: this.controllerConfig.missTolerance,
      maxTrack: this.controllerConfig.maxTrack,
      targetFPS: this.controllerConfig.targetFPS,
      onUpdate: this.controllerConfig.onUpdate
    });

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

    if (this.postMatrixsCallback) {
      this.postMatrixsCallback(this.postMatrixs);
    }

    await this.controller.dummyRun(this.video);
    this.controller.processVideo(this.video);

    return this.controller;
  }

  stop() {
    if (this.controller) {
      this.controller.stopProcessVideo();
      this.controller = null;
    }
  }

  getController() {
    return this.controller;
  }

  getPostMatrixs() {
    return this.postMatrixs;
  }
}

