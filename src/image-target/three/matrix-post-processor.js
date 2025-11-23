import { Matrix4, Vector3, Quaternion } from "three";

/**
 * Advanced post-processing pipeline for AR tracking matrices
 * 
 * Features:
 * - Statistical outlier detection: Uses running statistics (mean, std dev) to detect
 *   unrealistic movements relative to observed motion patterns. Automatically adapts
 *   to slow/fast/accelerating motion without fixed thresholds.
 * - Adaptive smoothing: Adjusts smoothing based on movement speed (fast = less smoothing, slow = more)
 * - Motion prediction: Continues animating when tracking is lost (up to configurable duration)
 * - Elegant state transitions: Tracks 'lost', 'losing', 'finding', 'found' states with confidence
 * - Dynamic parameter adjustment: Parameters adapt based on observed motion patterns
 * 
 * Outlier Detection:
 * The system tracks a history of position, rotation, and scale deltas (changes between frames).
 * It calculates running statistics (mean, standard deviation) and rejects deltas that exceed
 * N standard deviations from the mean (configurable via outlierSigmaMultiplier).
 * 
 * This means:
 * - If motion is slow/static: mean and std dev are small, so even small jumps are caught
 * - If motion is fast/accelerating: mean and std dev are larger, so larger jumps are acceptable
 * - The system automatically adapts without needing fixed "max jump" values
 */
export class MatrixPostProcessor {
  constructor(config = {}) {
    // Configuration with defaults
    this.config = {
      // Outlier detection (statistical, relative to observed motion)
      // These values represent how many standard deviations from the mean are considered outliers
      // Example: 3.0 means jumps beyond 3 standard deviations are rejected
      // - Lower values (2.0-2.5) = more aggressive filtering, catches smaller anomalies
      // - Higher values (3.5-4.0) = more permissive, allows larger jumps during fast motion
      // The system automatically adapts: if motion is slow, even small jumps are caught.
      // If motion is fast/accelerating, larger jumps are acceptable.
      outlierSigmaMultiplier: config.outlierSigmaMultiplier ?? 3.0, // standard deviations for position/rotation
      outlierScaleSigmaMultiplier: config.outlierScaleSigmaMultiplier ?? 2.5, // standard deviations for scale (usually more stable)
      outlierHistorySize: config.outlierHistorySize ?? 20, // frames to analyze for statistical outlier detection
      minHistoryForOutlierDetection: config.minHistoryForOutlierDetection ?? 5, // minimum frames needed before outlier detection activates
      
      // Adaptive smoothing
      minSmoothingFactor: config.minSmoothingFactor ?? 0.1, // for fast movement
      maxSmoothingFactor: config.maxSmoothingFactor ?? 0.8, // for slow/static movement
      velocityThreshold: config.velocityThreshold ?? 0.05, // m/s - threshold between fast/slow
      angularVelocityThreshold: config.angularVelocityThreshold ?? 0.1, // rad/s
      
      // Motion prediction
      predictionEnabled: config.predictionEnabled ?? true,
      predictionDuration: config.predictionDuration ?? 300, // ms to continue predicting after loss
      predictionDecayRate: config.predictionDecayRate ?? 0.95, // per frame decay
      minPredictionConfidence: config.minPredictionConfidence ?? 0.3, // minimum confidence to use prediction
      
      // State management
      foundConfidenceThreshold: config.foundConfidenceThreshold ?? 0.7, // confidence needed to consider "found"
      lostConfidenceThreshold: config.lostConfidenceThreshold ?? 0.3, // confidence below which considered "lost"
      stateTransitionFrames: config.stateTransitionFrames ?? 3, // frames needed for state change
      
      // Reattachment
      reattachmentMaxDistance: config.reattachmentMaxDistance ?? 0.2, // meters - max distance for smooth reattachment
      reattachmentSmoothing: config.reattachmentSmoothing ?? 0.3, // smoothing factor during reattachment
      
      // Performance
      enableAdaptiveParams: config.enableAdaptiveParams ?? true, // dynamically adjust parameters
      adaptationRate: config.adaptationRate ?? 0.1, // how quickly to adapt parameters
      
      // Debugging
      debugMode: config.debugMode ?? false, // enable debug logging
      debugLogInterval: config.debugLogInterval ?? 1000, // ms between debug logs (to avoid spam)
    };

    // Per-target state
    this.targetStates = new Map();
    this.lastDebugLogTime = new Map(); // targetIndex -> last log time
  }

  /**
   * Get or create state for a target
   * @public - needed for visualizer to check if frame was skipped
   */
  _getTargetState(targetIndex) {
    if (!this.targetStates.has(targetIndex)) {
      this.targetStates.set(targetIndex, {
        // Current state (initialize as Matrix4 objects to avoid allocations)
        currentMatrix: new Matrix4(),
        previousMatrix: null, // Will be created on first frame
        smoothedMatrix: null, // Will be created on first frame
        
        // Motion analysis
        velocity: new Vector3(),
        angularVelocity: new Quaternion(),
        acceleration: new Vector3(),
        
        // Prediction
        predictedMatrix: null,
        predictionVelocity: new Vector3(),
        predictionAngularVelocity: new Quaternion(),
        predictionStartTime: null,
        predictionConfidence: 0,
        
        // Reusable temporary objects to avoid allocations
        tempMatrix: new Matrix4(),
        tempMatrix2: new Matrix4(),
        tempVector: new Vector3(),
        tempVector2: new Vector3(),
        tempQuaternion: new Quaternion(),
        tempQuaternion2: new Quaternion(),
        
        // State machine
        state: 'lost', // 'lost', 'finding', 'found', 'losing'
        stateConfidence: 0,
        stateFrameCount: 0,
        
        // History for statistical outlier detection
        // Track deltas (changes) between frames
        positionDeltaHistory: [], // array of position deltas (Vector3 distances)
        rotationDeltaHistory: [], // array of rotation deltas (angles in radians)
        scaleDeltaHistory: [], // array of scale deltas (ratios)
        
        // Running statistics for outlier detection
        positionDeltaStats: { mean: 0, stdDev: 0, variance: 0 },
        rotationDeltaStats: { mean: 0, stdDev: 0, variance: 0 },
        scaleDeltaStats: { mean: 0, stdDev: 0, variance: 0 },
        
        // Adaptive parameters (dynamically adjusted)
        currentSmoothingFactor: (this.config.minSmoothingFactor + this.config.maxSmoothingFactor) / 2,
        
        // Tracking for visualization
        lastWasSkipped: false,
        
        // Reattachment
        reattaching: false,
        reattachmentStartMatrix: null,
        
        // Timing
        lastUpdateTime: null,
        lastValidTime: null,
      });
    }
    return this.targetStates.get(targetIndex);
  }

  /**
   * Extract position, rotation, and scale from matrix
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
   * Note: This creates a new matrix - caller should reuse if possible
   */
  _composeMatrix(position, rotation, scale) {
    const matrix = new Matrix4();
    matrix.compose(position, rotation, scale);
    return matrix;
  }

  /**
   * Calculate velocity between two matrices
   */
  _calculateVelocity(current, previous, deltaTime) {
    if (!previous || deltaTime <= 0) {
      return { linear: new Vector3(), angular: new Quaternion() };
    }

    const curr = this._decomposeMatrix(current);
    const prev = this._decomposeMatrix(previous);

    const linearVelocity = new Vector3()
      .subVectors(curr.position, prev.position)
      .multiplyScalar(1000 / deltaTime); // convert to m/s

    const angularVelocity = new Quaternion()
      .multiplyQuaternions(
        curr.rotation.clone().invert(),
        prev.rotation
      );

    return { linear: linearVelocity, angular: angularVelocity };
  }

  /**
   * Calculate running statistics (mean, variance, std dev) from a history array
   */
  _updateStatistics(history, stats) {
    if (history.length === 0) {
      stats.mean = 0;
      stats.variance = 0;
      stats.stdDev = 0;
      return;
    }

    // Calculate mean
    const sum = history.reduce((acc, val) => acc + val, 0);
    stats.mean = sum / history.length;

    // Calculate variance
    const squaredDiffs = history.map(val => {
      const diff = val - stats.mean;
      return diff * diff;
    });
    const varianceSum = squaredDiffs.reduce((acc, val) => acc + val, 0);
    stats.variance = varianceSum / history.length;

    // Calculate standard deviation
    stats.stdDev = Math.sqrt(stats.variance);
  }

  /**
   * Detect if a matrix change is an outlier using statistical analysis
   * Compares deltas against running statistics of observed motion
   */
  _isOutlier(current, previous, state, deltaTime) {
    if (!previous) return false;

    // Need minimum history to make statistical decisions
    if (state.positionDeltaHistory.length < this.config.minHistoryForOutlierDetection) {
      return false;
    }

    const curr = this._decomposeMatrix(current);
    const prev = this._decomposeMatrix(previous);

    // Calculate current deltas
    const positionDelta = curr.position.distanceTo(prev.position);
    const rotationDelta = curr.rotation.angleTo(prev.rotation);
    const prevScaleLength = prev.scale.length();
    const scaleDelta = prevScaleLength > 0 
      ? Math.abs(curr.scale.length() - prevScaleLength) / prevScaleLength
      : 0;

    // Update statistics from history
    this._updateStatistics(state.positionDeltaHistory, state.positionDeltaStats);
    this._updateStatistics(state.rotationDeltaHistory, state.rotationDeltaStats);
    this._updateStatistics(state.scaleDeltaHistory, state.scaleDeltaStats);

    // Check if current delta is an outlier (beyond N standard deviations)
    // Use a minimum threshold to avoid false positives when stdDev is very small
    const minPositionThreshold = 0.001; // 1mm minimum
    const minRotationThreshold = 0.01; // ~0.57 degrees minimum
    const minScaleThreshold = 0.001; // 0.1% minimum

    // Position outlier check
    const positionThreshold = Math.max(
      minPositionThreshold,
      state.positionDeltaStats.mean + (this.config.outlierSigmaMultiplier * state.positionDeltaStats.stdDev)
    );
    if (positionDelta > positionThreshold) {
      return true;
    }

    // Rotation outlier check
    const rotationThreshold = Math.max(
      minRotationThreshold,
      state.rotationDeltaStats.mean + (this.config.outlierSigmaMultiplier * state.rotationDeltaStats.stdDev)
    );
    if (rotationDelta > rotationThreshold) {
      return true;
    }

    // Scale outlier check (usually more stable, so use different multiplier)
    const scaleThreshold = Math.max(
      minScaleThreshold,
      state.scaleDeltaStats.mean + (this.config.outlierScaleSigmaMultiplier * state.scaleDeltaStats.stdDev)
    );
    if (scaleDelta > scaleThreshold) {
      return true;
    }

    return false;
  }

  /**
   * Apply adaptive smoothing
   */
  _applySmoothing(current, previous, state, deltaTime) {
    if (!previous || !current) {
      if (current) {
        state.tempMatrix.copy(current);
        return state.tempMatrix;
      }
      return null;
    }

    const curr = this._decomposeMatrix(current);
    const prev = this._decomposeMatrix(previous);

    // Validate decomposed values
    if (!curr || !prev || !curr.position || !curr.rotation || !curr.scale ||
        !prev.position || !prev.rotation || !prev.scale) {
      state.tempMatrix.copy(current);
      return state.tempMatrix;
    }

    // Calculate movement speed
    const linearSpeed = state.velocity.length();
    state.tempQuaternion.identity();
    const angularSpeed = Math.abs(state.angularVelocity.angleTo(state.tempQuaternion));

    // Adapt smoothing factor based on movement speed
    if (this.config.enableAdaptiveParams) {
      const speedRatio = Math.min(
        linearSpeed / this.config.velocityThreshold,
        angularSpeed / this.config.angularVelocityThreshold
      );
      
      // Fast movement = less smoothing, slow movement = more smoothing
      const targetSmoothing = this.config.minSmoothingFactor + 
        (this.config.maxSmoothingFactor - this.config.minSmoothingFactor) * (1 - Math.min(speedRatio, 1));
      
      // Smoothly adapt the smoothing factor
      state.currentSmoothingFactor += (targetSmoothing - state.currentSmoothingFactor) * this.config.adaptationRate;
    }

    const smoothingFactor = state.currentSmoothingFactor;

    // Apply exponential smoothing (reuse temp objects)
    state.tempVector.lerpVectors(prev.position, curr.position, 1 - smoothingFactor);
    state.tempQuaternion.slerpQuaternions(prev.rotation, curr.rotation, 1 - smoothingFactor);
    state.tempVector2.lerpVectors(prev.scale, curr.scale, 1 - smoothingFactor);

    // Validate smoothed values before composing
    if (!state.tempVector || !state.tempQuaternion || !state.tempVector2) {
      state.tempMatrix.copy(current);
      return state.tempMatrix;
    }

    // Reuse tempMatrix for composition
    state.tempMatrix.compose(state.tempVector, state.tempQuaternion, state.tempVector2);
    return state.tempMatrix;
  }

  /**
   * Predict future position based on current motion
   */
  _predictMotion(state, deltaTime) {
    if (!state.smoothedMatrix || !state.previousMatrix) {
      return null;
    }

    const curr = this._decomposeMatrix(state.smoothedMatrix);
    const prev = this._decomposeMatrix(state.previousMatrix);

    // Estimate velocity from last two frames
    const estimatedVelocity = new Vector3()
      .subVectors(curr.position, prev.position)
      .multiplyScalar(1000 / deltaTime);

    const estimatedAngularVelocity = new Quaternion()
      .multiplyQuaternions(
        curr.rotation.clone().invert(),
        prev.rotation
      );

    // Predict position
    const predictedPos = new Vector3()
      .copy(curr.position)
      .add(estimatedVelocity.clone().multiplyScalar(deltaTime / 1000));

    // Predict rotation (simplified - just continue rotation)
    const predictedRot = curr.rotation.clone();

    // Predict scale (assume constant)
    const predictedScale = curr.scale.clone();

    return this._composeMatrix(predictedPos, predictedRot, predictedScale);
  }

  /**
   * Update state machine
   */
  _updateStateMachine(state, hasTracking, deltaTime, targetIndex) {
    const now = performance.now();
    const previousState = state.state;
    
    if (hasTracking) {
      // We have tracking data
      if (state.state === 'lost' || state.state === 'losing') {
        state.stateConfidence += (1 - state.stateConfidence) * 0.3;
        if (state.stateConfidence > this.config.foundConfidenceThreshold) {
          state.state = 'finding';
          state.stateFrameCount = 0;
        }
      } else if (state.state === 'finding') {
        state.stateFrameCount++;
        if (state.stateFrameCount >= this.config.stateTransitionFrames) {
          state.state = 'found';
          state.stateConfidence = 1.0;
        }
      } else if (state.state === 'found') {
        state.stateConfidence = Math.min(1.0, state.stateConfidence + 0.1);
        // Reset prediction when we have good tracking
        state.predictionStartTime = null;
        state.predictionConfidence = 0;
      }
    } else {
      // No tracking data
      if (state.state === 'found' || state.state === 'finding') {
        state.stateConfidence -= 0.2;
        if (state.stateConfidence < this.config.lostConfidenceThreshold) {
          state.state = 'losing';
          state.stateFrameCount = 0;
          // Start prediction if we have previous data
          if (this.config.predictionEnabled && state.smoothedMatrix && state.previousMatrix) {
            state.predictionStartTime = now;
            state.predictionConfidence = 1.0;
            const motion = this._calculateVelocity(
              state.smoothedMatrix,
              state.previousMatrix,
              deltaTime || 16.67
            );
            state.predictionVelocity.copy(motion.linear);
            state.predictionAngularVelocity.copy(motion.angular);
          }
        }
      } else if (state.state === 'losing') {
        state.stateFrameCount++;
        if (state.stateFrameCount >= this.config.stateTransitionFrames) {
          state.state = 'lost';
          state.stateConfidence = 0.0;
          // Keep prediction running even in 'lost' state for a while
        }
      } else if (state.state === 'lost') {
        state.stateConfidence = 0.0;
      }
    }
    
    // Log state transitions
    if (this.config.debugMode && previousState !== state.state) {
      this._logDebug(targetIndex, state, 'STATE_CHANGE', {
        from: previousState,
        to: state.state,
        confidence: state.stateConfidence,
      });
    }
  }

  /**
   * Handle reattachment when tracking resumes
   */
  _handleReattachment(state, newMatrix) {
    if (!state.smoothedMatrix || !newMatrix) {
      return newMatrix;
    }

    const newDecomp = this._decomposeMatrix(newMatrix);
    const smoothedDecomp = this._decomposeMatrix(state.smoothedMatrix);

    const distance = newDecomp.position.distanceTo(smoothedDecomp.position);

    if (distance > this.config.reattachmentMaxDistance) {
      // Too far - likely a different target or major jump
      // Don't smooth, just use the new matrix
      state.reattaching = false;
      return newMatrix;
    }

    // Smoothly transition to the new matrix
    if (!state.reattaching) {
      state.reattaching = true;
      state.reattachmentStartMatrix = state.smoothedMatrix.clone();
    }

    const reattachmentDecomp = this._decomposeMatrix(state.reattachmentStartMatrix);
    const smoothedPos = new Vector3().lerpVectors(
      reattachmentDecomp.position,
      newDecomp.position,
      this.config.reattachmentSmoothing
    );
    const smoothedRot = new Quaternion().slerpQuaternions(
      reattachmentDecomp.rotation,
      newDecomp.rotation,
      this.config.reattachmentSmoothing
    );
    const smoothedScale = new Vector3().lerpVectors(
      reattachmentDecomp.scale,
      newDecomp.scale,
      this.config.reattachmentSmoothing
    );

    const result = this._composeMatrix(smoothedPos, smoothedRot, smoothedScale);
    
    // Check if we're close enough to stop reattaching
    const resultDecomp = this._decomposeMatrix(result);
    if (resultDecomp.position.distanceTo(newDecomp.position) < 0.01) {
      state.reattaching = false;
    }

    return result;
  }

  /**
   * Main processing function
   * @param {number} targetIndex - Index of the target
   * @param {Array<number>|null} worldMatrix - Raw world matrix from tracker (16 elements) or null if lost
   * @returns {Array<number>|null} - Processed matrix or null if target should be hidden
   */
  process(targetIndex, worldMatrix) {
    const state = this._getTargetState(targetIndex);
    const now = performance.now();
    const deltaTime = state.lastUpdateTime ? now - state.lastUpdateTime : 16.67; // default to 60fps
    state.lastUpdateTime = now;

    // Update state machine
    this._updateStateMachine(state, worldMatrix !== null, deltaTime, targetIndex);

    // If we're in 'lost' state, check if we should use prediction or return null
    if (state.state === 'lost') {
      if (worldMatrix === null) {
        // No tracking - try prediction if available
        if (this.config.predictionEnabled && state.predictionStartTime && state.smoothedMatrix) {
          const predictionAge = now - state.predictionStartTime;
          if (predictionAge < this.config.predictionDuration) {
            state.predictionConfidence *= this.config.predictionDecayRate;
            if (state.predictionConfidence >= this.config.minPredictionConfidence) {
              const predicted = this._predictMotion(state, deltaTime);
              if (predicted) {
                const blendFactor = 1 - (predictionAge / this.config.predictionDuration);
                const smoothedDecomp = this._decomposeMatrix(state.smoothedMatrix);
                const predictedDecomp = this._decomposeMatrix(predicted);
                
                const blendedPos = new Vector3().lerpVectors(
                  smoothedDecomp.position,
                  predictedDecomp.position,
                  blendFactor * 0.3
                );
                const blendedRot = new Quaternion().slerpQuaternions(
                  smoothedDecomp.rotation,
                  predictedDecomp.rotation,
                  blendFactor * 0.2
                );
                const blendedScale = smoothedDecomp.scale.clone();
                
                return this._composeMatrix(blendedPos, blendedRot, blendedScale).elements;
              }
            }
          }
        }
        return null;
      }
      // Tracking resumed - handle reattachment
      const matrix = new Matrix4();
      matrix.elements = [...worldMatrix];
      return this._handleReattachment(state, matrix).elements;
    }

    // If we have tracking data
    if (worldMatrix !== null) {
      const matrix = new Matrix4();
      matrix.elements = [...worldMatrix];
      state.lastValidTime = now;

      // Calculate deltas for statistical analysis (before checking if it's an outlier)
      let positionDelta = 0;
      let rotationDelta = 0;
      let scaleDelta = 0;
      
      if (state.previousMatrix) {
        const prevDecomp = this._decomposeMatrix(state.previousMatrix);
        const currDecomp = this._decomposeMatrix(matrix);
        
        // Position delta (distance)
        positionDelta = currDecomp.position.distanceTo(prevDecomp.position);
        
        // Rotation delta (angle)
        rotationDelta = currDecomp.rotation.angleTo(prevDecomp.rotation);
        
        // Scale delta (relative change)
        const prevScaleLength = prevDecomp.scale.length();
        scaleDelta = prevScaleLength > 0
          ? Math.abs(currDecomp.scale.length() - prevScaleLength) / prevScaleLength
          : 0;
      }

      // Check for outliers using statistical analysis
      // (This uses the history from previous frames, not including the current delta)
      const isOutlier = state.previousMatrix && this._isOutlier(matrix, state.previousMatrix, state, deltaTime);
      
      if (isOutlier) {
        // Outlier detected - continue smoothing instead of freezing
        // Apply very light smoothing between last smoothed matrix and current (rejected) matrix
        // This prevents freezing while still rejecting the outlier jump
        state.lastWasSkipped = true;
        
        // Debug logging
        if (this.config.debugMode) {
          this._logDebug(targetIndex, state, 'OUTLIER_REJECTED', {
            positionDelta,
            rotationDelta,
            scaleDelta,
            positionThreshold: state.positionDeltaStats.mean + (this.config.outlierSigmaMultiplier * state.positionDeltaStats.stdDev),
            rotationThreshold: state.rotationDeltaStats.mean + (this.config.outlierSigmaMultiplier * state.rotationDeltaStats.stdDev),
          });
        }
        
        // Don't add this outlier delta to history
        // But continue smoothing from last smoothed position towards current (with very light smoothing)
        if (state.smoothedMatrix) {
          // Apply very light smoothing (use minSmoothingFactor or even lighter) to continue movement
          // This prevents freezing while still rejecting the outlier
          const lightSmoothingFactor = Math.min(this.config.minSmoothingFactor, 0.05); // Max 5% smoothing for outliers
          
          // Smooth between last smoothed matrix and current (rejected) matrix
          const smoothedDecomp = this._decomposeMatrix(state.smoothedMatrix);
          const currentDecomp = this._decomposeMatrix(matrix);
          
          // Apply light smoothing
          state.tempVector.lerpVectors(smoothedDecomp.position, currentDecomp.position, 1 - lightSmoothingFactor);
          state.tempQuaternion.slerpQuaternions(smoothedDecomp.rotation, currentDecomp.rotation, 1 - lightSmoothingFactor);
          state.tempVector2.lerpVectors(smoothedDecomp.scale, currentDecomp.scale, 1 - lightSmoothingFactor);
          
          // Update smoothed matrix with continued smoothing
          state.smoothedMatrix.compose(state.tempVector, state.tempQuaternion, state.tempVector2);
          
          // Update previousMatrix to current (even though we're rejecting it)
          // This prevents us from getting stuck comparing against the same old frame
          state.previousMatrix.copy(matrix);
          
          return state.smoothedMatrix.elements;
        }
        if (state.previousMatrix) {
          // Fallback: apply light smoothing to previous matrix
          const lightSmoothingFactor = Math.min(this.config.minSmoothingFactor, 0.05);
          const prevDecomp = this._decomposeMatrix(state.previousMatrix);
          const currentDecomp = this._decomposeMatrix(matrix);
          
          state.tempVector.lerpVectors(prevDecomp.position, currentDecomp.position, 1 - lightSmoothingFactor);
          state.tempQuaternion.slerpQuaternions(prevDecomp.rotation, currentDecomp.rotation, 1 - lightSmoothingFactor);
          state.tempVector2.lerpVectors(prevDecomp.scale, currentDecomp.scale, 1 - lightSmoothingFactor);
          
          if (!state.smoothedMatrix) {
            state.smoothedMatrix = new Matrix4();
          }
          state.smoothedMatrix.compose(state.tempVector, state.tempQuaternion, state.tempVector2);
          state.previousMatrix.copy(matrix);
          return state.smoothedMatrix.elements;
        }
        // If we have no previous matrices, just use current (shouldn't happen)
        state.previousMatrix.copy(matrix);
        if (!state.smoothedMatrix) {
          state.smoothedMatrix = new Matrix4();
        }
        state.smoothedMatrix.copy(matrix);
        return matrix.elements;
      } else {
        state.lastWasSkipped = false;
      }

      // Not an outlier - add deltas to history for future statistical analysis
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

      // Calculate velocity
      const motion = this._calculateVelocity(matrix, state.previousMatrix, deltaTime);
      state.velocity.copy(motion.linear);
      state.angularVelocity.copy(motion.angular);

      // Apply smoothing (only if we have a previous matrix to smooth against)
      if (state.previousMatrix) {
        const smoothedResult = this._applySmoothing(matrix, state.previousMatrix, state, deltaTime);
        // Copy result to smoothedMatrix (reuse if it exists, otherwise create)
        if (smoothedResult) {
          if (!state.smoothedMatrix) {
            state.smoothedMatrix = new Matrix4();
          }
          state.smoothedMatrix.copy(smoothedResult);
        } else {
          // Fallback if smoothing failed
          if (!state.smoothedMatrix) {
            state.smoothedMatrix = new Matrix4();
          }
          state.smoothedMatrix.copy(matrix);
        }
      } else {
        // First frame - no smoothing yet
        if (!state.smoothedMatrix) {
          state.smoothedMatrix = new Matrix4();
        }
        state.smoothedMatrix.copy(matrix);
      }
      
      // Update previousMatrix (reuse if it exists)
      if (!state.previousMatrix) {
        state.previousMatrix = new Matrix4();
      }
      state.previousMatrix.copy(matrix);

      // Reset prediction
      state.predictionStartTime = null;
      state.predictionConfidence = 0;

      // Debug logging (periodic, not every frame)
      if (this.config.debugMode) {
        this._logDebug(targetIndex, state, 'FRAME_PROCESSED', {
          positionDelta,
          rotationDelta,
          smoothingFactor: state.currentSmoothingFactor,
          historySize: state.positionDeltaHistory.length,
        });
      }

      return state.smoothedMatrix.elements;
    }

    // This should not be reached if state machine is working correctly
    // But handle edge case: no tracking and not in 'lost' state
    return null;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
  }

  /**
   * Reset state for a specific target
   */
  resetTarget(targetIndex) {
    this.targetStates.delete(targetIndex);
  }

  /**
   * Reset all states
   */
  reset() {
    this.targetStates.clear();
  }

  /**
   * Log debug information (throttled to avoid spam)
   */
  _logDebug(targetIndex, state, event, data = {}) {
    const now = performance.now();
    const lastLogTime = this.lastDebugLogTime.get(targetIndex) || 0;
    
    // Always log state changes and outliers, but throttle other events
    const shouldLog = event === 'STATE_CHANGE' || 
                      event === 'OUTLIER_REJECTED' ||
                      (now - lastLogTime) >= this.config.debugLogInterval;
    
    if (shouldLog) {
      this.lastDebugLogTime.set(targetIndex, now);
      
      const logData = {
        targetIndex,
        event,
        state: state.state,
        confidence: state.stateConfidence,
        ...data
      };
      
      console.log(`[MindAR PostProcessor]`, logData);
    }
  }

  /**
   * Get current state info for debugging
   */
  getStateInfo(targetIndex) {
    const state = this.targetStates.get(targetIndex);
    if (!state) return null;
    
    // Update statistics for display
    if (state.positionDeltaHistory.length > 0) {
      this._updateStatistics(state.positionDeltaHistory, state.positionDeltaStats);
      this._updateStatistics(state.rotationDeltaHistory, state.rotationDeltaStats);
      this._updateStatistics(state.scaleDeltaHistory, state.scaleDeltaStats);
    }
    
    return {
      state: state.state,
      confidence: state.stateConfidence,
      hasPrediction: state.predictionStartTime !== null,
      predictionConfidence: state.predictionConfidence,
      smoothingFactor: state.currentSmoothingFactor,
      velocity: state.velocity.length(),
      // Statistical information
      positionStats: {
        mean: state.positionDeltaStats.mean,
        stdDev: state.positionDeltaStats.stdDev,
        threshold: state.positionDeltaStats.mean + (this.config.outlierSigmaMultiplier * state.positionDeltaStats.stdDev),
        historySize: state.positionDeltaHistory.length
      },
      rotationStats: {
        mean: state.rotationDeltaStats.mean,
        stdDev: state.rotationDeltaStats.stdDev,
        threshold: state.rotationDeltaStats.mean + (this.config.outlierSigmaMultiplier * state.rotationDeltaStats.stdDev),
        historySize: state.rotationDeltaHistory.length
      },
      scaleStats: {
        mean: state.scaleDeltaStats.mean,
        stdDev: state.scaleDeltaStats.stdDev,
        threshold: state.scaleDeltaStats.mean + (this.config.outlierScaleSigmaMultiplier * state.scaleDeltaStats.stdDev),
        historySize: state.scaleDeltaHistory.length
      }
    };
  }
}


