import ControllerWorker from "../controller.worker.js?worker&inline";
import { Logger } from "../../libs/logger.js";

class WorkerManager {
  constructor() {
    this.worker = new ControllerWorker();
    this.matchCallback = null;
    this.trackUpdateCallback = null;
    this.logger = new Logger('WorkerManager', true, 'info');
    
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

    this.worker.onerror = (error) => {
      this.logger.error('Worker error', { error: error.message });
    };
  }

  setup(config) {
    this.logger.info('Setting up worker', {
      inputWidth: config.inputWidth,
      inputHeight: config.inputHeight,
      matchingDataListCount: config.matchingDataList?.length || 0
    });
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
    this.logger.info('Disposing worker');
    this.worker.postMessage({ type: "dispose" });
    this.matchCallback = null;
    this.trackUpdateCallback = null;
  }
}

export {
  WorkerManager
};

