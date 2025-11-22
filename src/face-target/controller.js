import {FaceMeshHelper} from "./face-mesh-helper.js";
import {opencv, waitCV} from "../libs/opencv-helper.js";
import {Estimator} from "./face-geometry/estimator.js";
import {createThreeFaceGeometry as  _createThreeFaceGeometry} from "./face-geometry/face-geometry.js";
import {positions as canonicalMetricLandmarks} from "./face-geometry/face-data.js";
import {OneEuroFilter} from '../libs/one-euro-filter.js';

const DEFAULT_FILTER_CUTOFF = 0.001; // 1Hz. time period in milliseconds
const DEFAULT_FILTER_BETA = 1;
const DEFAULT_FILTER_DCUTOFF = 0.001; // 1Hz. derivative cutoff

class Controller {
  constructor({onUpdate=null, filterMinCF=null, filterBeta=null, filterDCutOff=null}) {
    this.customFaceGeometries = [];
    this.estimator = null;
    this.lastEstimateResult = null;
    this.filterMinCF = filterMinCF === null? DEFAULT_FILTER_CUTOFF: filterMinCF;
    this.filterBeta = filterBeta === null? DEFAULT_FILTER_BETA: filterBeta;
    this.filterDCutOff = filterDCutOff === null? DEFAULT_FILTER_DCUTOFF: filterDCutOff;
    this.onUpdate = onUpdate;
    this.flipFace = false;

    //console.log("filter", this.filterMinCF, this.filterBeta);

    this.landmarkFilters = [];
    for (let i = 0; i < canonicalMetricLandmarks.length; i++) {
      this.landmarkFilters[i] = new OneEuroFilter({minCutOff: this.filterMinCF, beta: this.filterBeta, dCutOff: this.filterDCutOff});
    }
    this.faceMatrixFilter = new OneEuroFilter({minCutOff: this.filterMinCF, beta: this.filterBeta, dCutOff: this.filterDCutOff});
    this.faceScaleFilter = new OneEuroFilter({minCutOff: this.filterMinCF, beta: this.filterBeta, dCutOff: this.filterDCutOff});
  }

  async setup(flipFace) {
    this.flipFace = flipFace;
    await waitCV();
    this.faceMeshHelper = new FaceMeshHelper();
    await this.faceMeshHelper.init();
  }

  onInputResized(input) {
    this.estimator = new Estimator(input);
  }

  getCameraParams() {
    return {
      fov: this.estimator.fov * 180 / Math.PI,
      aspect: this.estimator.frameWidth / this.estimator.frameHeight,
      near: this.estimator.near,
      far: this.estimator.far
    }
  }
  
  async dummyRun(input) {
    await this.faceMeshHelper.detect(input);
  }


  processVideo(input) {
    if (this.processingVideo) return;

    const flippedCanvasElement = document.createElement('canvas');
    flippedCanvasElement.width = input.width;
    flippedCanvasElement.height = input.height;
    const flippedInputContext = flippedCanvasElement.getContext('2d');

    this.processingVideo = true;

    const doProcess = async () => {
      let results;

      if (this.flipFace) {
        flippedInputContext.clearRect(0, 0, flippedCanvasElement.width, flippedCanvasElement.height);
        flippedInputContext.save();
        flippedInputContext.translate(flippedCanvasElement.width, 0);
        flippedInputContext.scale(-1, 1);
        flippedInputContext.drawImage(input, 0, 0, flippedCanvasElement.width, flippedCanvasElement.height);
        flippedInputContext.restore();
        results = await this.faceMeshHelper.detect(flippedCanvasElement);
      } else {
        results = await this.faceMeshHelper.detect(input);
      }

      if (results.faceLandmarks.length === 0) {
	this.lastEstimateResult = null;
	this.onUpdate({hasFace: false});

	for (let i = 0; i < this.landmarkFilters.length; i++) {
	  this.landmarkFilters[i].reset();
	}
	this.faceMatrixFilter.reset();
	this.faceScaleFilter.reset();
      } else {
	const landmarks = results.faceLandmarks[0].map((l) => {
	  return [l.x, l.y, l.z];
	});
	const estimateResult = this.estimator.estimate(landmarks);

	if (this.lastEstimateResult === null) {
	  this.lastEstimateResult = estimateResult;
	} else {
	  const lastMetricLandmarks = this.lastEstimateResult.metricLandmarks;
	  const lastFaceMatrix = this.lastEstimateResult.faceMatrix;
	  const lastFaceScale = this.lastEstimateResult.faceScale;

	  const newMetricLandmarks = [];
	  for (let i = 0; i < lastMetricLandmarks.length; i++) {
	    newMetricLandmarks[i] = this.landmarkFilters[i].filter(Date.now(), estimateResult.metricLandmarks[i]);
	  }

	  const newFaceMatrix = this.faceMatrixFilter.filter(Date.now(), estimateResult.faceMatrix);

	  const newFaceScale = this.faceScaleFilter.filter(Date.now(), [estimateResult.faceScale]);

	  this.lastEstimateResult = {
	    metricLandmarks: newMetricLandmarks,
	    faceMatrix: newFaceMatrix,
	    faceScale: newFaceScale[0],
      blendshapes: results.faceBlendshapes[0],
	  }
	}

	//console.log("resuts", results);
	//console.log("estimateResult", estimateResult);
	if (this.onUpdate) {
	  this.onUpdate({hasFace: true, estimateResult: this.lastEstimateResult});
	}

	for (let i = 0; i < this.customFaceGeometries.length; i++) {
	  this.customFaceGeometries[i].updatePositions(estimateResult.metricLandmarks);
	}
      }
      if (this.processingVideo) {
	window.requestAnimationFrame(doProcess);
      }
    }
    window.requestAnimationFrame(doProcess);
  }

  stopProcessVideo() {
    this.processingVideo = false;
  }

  setFilterParams({filterMinCF, filterBeta, filterDCutOff}) {
    // Validate parameters
    if (filterMinCF !== undefined && (typeof filterMinCF !== 'number' || filterMinCF < 0)) {
      throw new Error('filterMinCF must be a non-negative number');
    }
    if (filterBeta !== undefined && (typeof filterBeta !== 'number' || filterBeta < 0)) {
      throw new Error('filterBeta must be a non-negative number');
    }
    if (filterDCutOff !== undefined && (typeof filterDCutOff !== 'number' || filterDCutOff < 0)) {
      throw new Error('filterDCutOff must be a non-negative number');
    }

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

    // Update all existing filter instances
    if (this.landmarkFilters && this.landmarkFilters.length > 0) {
      for (let i = 0; i < this.landmarkFilters.length; i++) {
        if (this.landmarkFilters[i]) {
          this.landmarkFilters[i].updateParams({
            minCutOff: this.filterMinCF,
            beta: this.filterBeta,
            dCutOff: this.filterDCutOff
          });
        }
      }
    }
    if (this.faceMatrixFilter) {
      this.faceMatrixFilter.updateParams({
        minCutOff: this.filterMinCF,
        beta: this.filterBeta,
        dCutOff: this.filterDCutOff
      });
    }
    if (this.faceScaleFilter) {
      this.faceScaleFilter.updateParams({
        minCutOff: this.filterMinCF,
        beta: this.filterBeta,
        dCutOff: this.filterDCutOff
      });
    }
  }

  getConfig() {
    return {
      filterMinCF: this.filterMinCF,
      filterBeta: this.filterBeta,
      filterDCutOff: this.filterDCutOff
    };
  }

  createThreeFaceGeometry(THREE) {
    const faceGeometry = _createThreeFaceGeometry(THREE);
    this.customFaceGeometries.push(faceGeometry);
    return faceGeometry;
  }

  getLandmarkMatrix(landmarkIndex) {
    const {metricLandmarks, faceMatrix, faceScale} = this.lastEstimateResult;

    // final matrix = faceMatrix x landmarkMatrix
    // landmarkMatrix = [
    //   faceScale, 0, 0, metricLandmarks[landmarkIndex][0],
    //   0, faceScale, 0, metricLandmarks[landmarkIndex][1],
    //   0, 0, faceScale, metricLandmarks[landmarkIndex][2],
    //   0, 0, 0, 1
    // ]
    const fm = faceMatrix;
    const s = faceScale;
    const t = [metricLandmarks[landmarkIndex][0], metricLandmarks[landmarkIndex][1], metricLandmarks[landmarkIndex][2]];
    const m = [
      fm[0] * s, fm[1] * s, fm[2] * s, fm[0] * t[0] + fm[1] * t[1] + fm[2] * t[2] + fm[3],
      fm[4] * s, fm[5] * s, fm[6] * s, fm[4] * t[0] + fm[5] * t[1] + fm[6] * t[2] + fm[7],
      fm[8] * s, fm[9] * s, fm[10] * s, fm[8] * t[0] + fm[9] * t[1] + fm[10] * t[2] + fm[11],
      fm[12] * s, fm[13] * s, fm[14] * s, fm[12] * t[0] + fm[13] * t[1] + fm[14] * t[2] + fm[15],
    ];
    return m;
  }
}

export {
 Controller
}
