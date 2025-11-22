import { Controller } from "../controller.js";

export class ARSession {
  constructor(video, controllerConfig) {
    this.video = video;
    this.controllerConfig = controllerConfig;
    this.controller = null;
  }

  async start(flipFace) {
    this.controller = new Controller({
      filterMinCF: this.controllerConfig.filterMinCF,
      filterBeta: this.controllerConfig.filterBeta,
    });

    this.controller.onUpdate = this.controllerConfig.onUpdate;

    await this.controller.setup(flipFace);
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
}

