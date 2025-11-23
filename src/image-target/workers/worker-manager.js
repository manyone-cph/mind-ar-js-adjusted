import ControllerWorker from "../controller.worker.js?worker&inline";

class WorkerManager {
  constructor() {
    this.worker = new ControllerWorker();
    this.matchCallback = null;
    this.trackUpdateCallback = null;
    
    this.worker.onmessage = (e) => {
      if (e.data.type === 'matchDone' && this.matchCallback !== null) {
        this.matchCallback(e.data);
        this.matchCallback = null;
      }
      if (e.data.type === 'trackUpdateDone' && this.trackUpdateCallback !== null) {
        this.trackUpdateCallback(e.data);
        this.trackUpdateCallback = null;
      }
    };
  }

  setup(config) {
    this.worker.postMessage({
      type: 'setup',
      ...config
    });
  }

  match(featurePoints, targetIndexes) {
    return new Promise((resolve) => {
      this.matchCallback = (data) => {
        resolve({
          targetIndex: data.targetIndex,
          modelViewTransform: data.modelViewTransform,
          debugExtra: data.debugExtra
        });
      };
      this.worker.postMessage({
        type: 'match',
        featurePoints,
        targetIndexes
      });
    });
  }

  trackUpdate(modelViewTransform, trackingFeatures) {
    return new Promise((resolve) => {
      this.trackUpdateCallback = (data) => {
        resolve(data.modelViewTransform);
      };
      const { worldCoords, screenCoords } = trackingFeatures;
      this.worker.postMessage({
        type: 'trackUpdate',
        modelViewTransform,
        worldCoords,
        screenCoords
      });
    });
  }

  dispose() {
    this.worker.postMessage({ type: "dispose" });
    this.matchCallback = null;
    this.trackUpdateCallback = null;
  }
}

export {
  WorkerManager
};

