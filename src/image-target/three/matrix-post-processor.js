import { Matrix4, Vector3, Quaternion } from "three";
import { OneEuroFilter } from '../../libs/one-euro-filter.js';
import { zscore, modifiedZscore, iqr } from 'divinator';

/**
 * Matrix Post-Processor
 * 
 * Applies One Euro Filter for adaptive smoothing (position, rotation, scale)
 * and uses Divinator for outlier detection (Z-score, Modified Z-score, IQR)
 */
export class MatrixPostProcessor {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled !== false,
      
      // One Euro Filter settings
      filterMinCF: config.filterMinCF ?? 0.001,      // Base cutoff frequency (Hz)
      filterBeta: config.filterBeta ?? 1.0,          // Speed coefficient
      filterDCutOff: config.filterDCutOff ?? 0.001,  // Derivative cutoff (Hz)
      
      // Scale filter settings
      scaleFilterMinCF: config.scaleFilterMinCF ?? 0.0005,
      scaleFilterBeta: config.scaleFilterBeta ?? 0.5,
      
      // Outlier detection settings
      outlierDetectionEnabled: config.outlierDetectionEnabled !== false,
      outlierMethod: config.outlierMethod ?? 'zScore', // 'zScore', 'modifiedZScore', 'iqr'
      outlierThreshold: config.outlierThreshold ?? 3.0, // Z-score threshold or IQR multiplier
      outlierHistorySize: config.outlierHistorySize ?? 30, // Frames to analyze
      minHistoryForOutlierDetection: config.minHistoryForOutlierDetection ?? 8,
      
      // Debugging
      debugMode: config.debugMode ?? false,
      debugLogInterval: config.debugLogInterval ?? 1000,
    };

    // Per-target state
    this.targetStates = new Map();
    this.lastDebugLogTime = new Map();
  }

  /**
   * Get or create state for a target
   * @public - needed for visualizer to check if frame was skipped
   */
  _getTargetState(targetIndex) {
    if (!this.targetStates.has(targetIndex)) {
      this.targetStates.set(targetIndex, {
        // One Euro Filters for each component
        positionFilter: new OneEuroFilter({
          minCutOff: this.config.filterMinCF,
          beta: this.config.filterBeta,
          dCutOff: this.config.filterDCutOff
        }),
        quaternionFilter: new OneEuroFilter({
          minCutOff: this.config.filterMinCF,
          beta: this.config.filterBeta,
          dCutOff: this.config.filterDCutOff
        }),
        scaleFilter: new OneEuroFilter({
          minCutOff: this.config.scaleFilterMinCF,
          beta: this.config.scaleFilterBeta,
          dCutOff: this.config.filterDCutOff
        }),
        
        // Matrix state
        previousMatrix: null,
        smoothedMatrix: null,
        
        // Outlier detection history
        positionDeltaHistory: [], // Array of position delta magnitudes
        rotationDeltaHistory: [], // Array of rotation delta angles (radians)
        scaleDeltaHistory: [],    // Array of scale delta ratios
        
        // Tracking
        lastWasSkipped: false,
        lastUpdateTime: null,
      });
    }
    return this.targetStates.get(targetIndex);
  }

  /**
   * Decompose matrix into position, rotation, and scale
   */
  _decomposeMatrix(matrix) {
    if (!matrix || !(matrix instanceof Matrix4)) {
      return null;
    }
    const pos = new Vector3();
    const rot = new Quaternion();
    const scale = new Vector3();
    try {
      matrix.decompose(pos, rot, scale);
      return { position: pos, rotation: rot, scale };
    } catch (e) {
      return null;
    }
  }

  /**
   * Compose matrix from position, rotation, and scale
   */
  _composeMatrix(position, rotation, scale) {
    if (!position || !rotation || !scale) {
      return null;
    }
    try {
      const matrix = new Matrix4();
      matrix.compose(position, rotation, scale);
      return matrix;
    } catch (e) {
      return null;
    }
  }

  /**
   * Detect if a delta is an outlier using divinator
   * Divinator works on arrays and returns arrays of booleans
   */
  _isOutlier(delta, history, method, threshold) {
    if (history.length < this.config.minHistoryForOutlierDetection) {
      return false;
    }

    try {
      // Create array with history + new delta (new delta is at the end)
      const dataArray = [...history, delta];
      let result;

      switch (method) {
        case 'zScore':
        case 'zscore':
          result = zscore(dataArray, threshold);
          break;
        case 'modifiedZScore':
        case 'modifiedZscore':
          result = modifiedZscore(dataArray, threshold);
          break;
        case 'iqr':
          result = iqr(dataArray, threshold);
          break;
        default:
          return false;
      }

      // Check if the last element (the new delta) is marked as outlier
      return result[result.length - 1] === true;
    } catch (e) {
      // Fallback to simple threshold calculation
      if (history.length === 0) return false;
      const mean = history.reduce((a, b) => a + b, 0) / history.length;
      const stdDev = Math.sqrt(
        history.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / history.length
      );
      return Math.abs(delta - mean) > threshold * stdDev;
    }
  }

  /**
   * Main processing function
   */
  process(targetIndex, worldMatrix) {
    if (!this.config.enabled) {
      return worldMatrix;
    }

    // If no tracking data, return null
    if (worldMatrix === null) {
      return null;
    }

    const state = this._getTargetState(targetIndex);
    const now = performance.now();
    state.lastUpdateTime = now;

    const matrix = new Matrix4();
    matrix.elements = [...worldMatrix];

    // Decompose matrix
    const curr = this._decomposeMatrix(matrix);
    if (!curr) {
      return worldMatrix;
    }

    // Calculate deltas for outlier detection
    let positionDelta = 0;
    let rotationDelta = 0;
    let scaleDelta = 0;

    if (state.previousMatrix) {
      const prev = this._decomposeMatrix(state.previousMatrix);
      if (prev) {
        positionDelta = curr.position.distanceTo(prev.position);
        rotationDelta = curr.rotation.angleTo(prev.rotation);
        const prevScaleLength = prev.scale.length();
        scaleDelta = prevScaleLength > 0
          ? Math.abs(curr.scale.length() - prevScaleLength) / prevScaleLength
          : 0;
      }
    }

    // Check for outliers before filtering
    let isOutlier = false;
    if (this.config.outlierDetectionEnabled && state.previousMatrix) {
      const posOutlier = this._isOutlier(
        positionDelta,
        state.positionDeltaHistory,
        this.config.outlierMethod,
        this.config.outlierThreshold
      );
      const rotOutlier = this._isOutlier(
        rotationDelta,
        state.rotationDeltaHistory,
        this.config.outlierMethod,
        this.config.outlierThreshold
      );
      const scaleOutlier = this._isOutlier(
        scaleDelta,
        state.scaleDeltaHistory,
        this.config.outlierMethod,
        this.config.outlierThreshold * 0.8
      );

      isOutlier = posOutlier || rotOutlier || scaleOutlier;

      if (isOutlier) {
        state.lastWasSkipped = true;
        if (this.config.debugMode) {
          this._logDebug(targetIndex, state, 'OUTLIER_DETECTED', {
            positionDelta,
            rotationDelta,
            scaleDelta,
            method: this.config.outlierMethod
          });
        }

        if (state.smoothedMatrix) {
          return state.smoothedMatrix.elements;
        }
        return worldMatrix;
      } else {
        state.lastWasSkipped = false;
      }
    }

    // Add to history
    if (state.previousMatrix) {
      state.positionDeltaHistory.push(positionDelta);
      state.rotationDeltaHistory.push(rotationDelta);
      state.scaleDeltaHistory.push(scaleDelta);

      // Maintain history size
      if (state.positionDeltaHistory.length > this.config.outlierHistorySize) {
        state.positionDeltaHistory.shift();
        state.rotationDeltaHistory.shift();
        state.scaleDeltaHistory.shift();
      }
    }

    // Apply One Euro Filter to each component
    const filteredPos = state.positionFilter.filter(now, [
      curr.position.x,
      curr.position.y,
      curr.position.z
    ]);

    const filteredQuat = state.quaternionFilter.filter(now, [
      curr.rotation.w,
      curr.rotation.x,
      curr.rotation.y,
      curr.rotation.z
    ]);

    const filteredScale = state.scaleFilter.filter(now, [
      curr.scale.x,
      curr.scale.y,
      curr.scale.z
    ]);

    // Recompose matrix
    const filteredMatrix = this._composeMatrix(
      new Vector3(filteredPos[0], filteredPos[1], filteredPos[2]),
      new Quaternion(filteredQuat[1], filteredQuat[2], filteredQuat[3], filteredQuat[0]), // x, y, z, w
      new Vector3(filteredScale[0], filteredScale[1], filteredScale[2])
    );

    if (!filteredMatrix) {
      return worldMatrix;
    }

    // Update state
    state.smoothedMatrix = filteredMatrix;
    state.previousMatrix = matrix;

    return filteredMatrix.elements;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    const oldConfig = { ...this.config };
    Object.assign(this.config, newConfig);

    const changedKeys = Object.keys(newConfig).filter(key =>
      oldConfig[key] !== this.config[key]
    );

    if (changedKeys.length > 0) {
      console.log('[MindAR PostProcessor] Config updated:', changedKeys);

      // Update filter parameters for all targets
      this.targetStates.forEach((state) => {
        if (newConfig.filterMinCF !== undefined || newConfig.filterBeta !== undefined || newConfig.filterDCutOff !== undefined) {
          state.positionFilter.updateParams({
            minCutOff: this.config.filterMinCF,
            beta: this.config.filterBeta,
            dCutOff: this.config.filterDCutOff
          });
          state.quaternionFilter.updateParams({
            minCutOff: this.config.filterMinCF,
            beta: this.config.filterBeta,
            dCutOff: this.config.filterDCutOff
          });
        }

        if (newConfig.scaleFilterMinCF !== undefined || newConfig.scaleFilterBeta !== undefined) {
          state.scaleFilter.updateParams({
            minCutOff: this.config.scaleFilterMinCF,
            beta: this.config.scaleFilterBeta,
            dCutOff: this.config.filterDCutOff
          });
        }

        // Trim history if size changed
        if (newConfig.outlierHistorySize !== undefined) {
          const newSize = this.config.outlierHistorySize;
          if (state.positionDeltaHistory.length > newSize) {
            state.positionDeltaHistory = state.positionDeltaHistory.slice(-newSize);
            state.rotationDeltaHistory = state.rotationDeltaHistory.slice(-newSize);
            state.scaleDeltaHistory = state.scaleDeltaHistory.slice(-newSize);
          }
        }
      });
    }
  }

  /**
   * Reset state for a specific target
   */
  resetTarget(targetIndex) {
    const state = this.targetStates.get(targetIndex);
    if (state) {
      state.positionFilter.reset();
      state.quaternionFilter.reset();
      state.scaleFilter.reset();
    }
    this.targetStates.delete(targetIndex);
  }

  /**
   * Reset all states
   */
  reset() {
    this.targetStates.forEach((state) => {
      state.positionFilter.reset();
      state.quaternionFilter.reset();
      state.scaleFilter.reset();
    });
    this.targetStates.clear();
  }

  /**
   * Log debug information
   */
  _logDebug(targetIndex, state, event, data = {}) {
    const now = performance.now();
    const lastLogTime = this.lastDebugLogTime.get(targetIndex) || 0;

    const shouldLog = event === 'OUTLIER_DETECTED' ||
      (now - lastLogTime) >= this.config.debugLogInterval;

    if (shouldLog) {
      this.lastDebugLogTime.set(targetIndex, now);
      console.log(`[MindAR PostProcessor]`, {
        targetIndex,
        event,
        ...data
      });
    }
  }

  /**
   * Get current state info for debugging
   */
  getStateInfo(targetIndex) {
    const state = this.targetStates.get(targetIndex);
    if (!state) return null;

    return {
      positionFilterParams: state.positionFilter.getParams(),
      quaternionFilterParams: state.quaternionFilter.getParams(),
      scaleFilterParams: state.scaleFilter.getParams(),
      positionHistorySize: state.positionDeltaHistory.length,
      rotationHistorySize: state.rotationDeltaHistory.length,
      scaleHistorySize: state.scaleDeltaHistory.length,
      lastWasSkipped: state.lastWasSkipped,
    };
  }
}
