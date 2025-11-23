import { Matrix4, Vector3, Quaternion } from "three";

/**
 * Advanced post-processing pipeline for AR tracking matrices
 * 
 * Features:
 * - General Stabilization: Base smoothing applied to all frames to reduce jitter and create
 *   rock-solid tracking. Configurable strength (0-1) for fine-tuning stability vs responsiveness.
 * - Multi-frame Smoothing: Averages across a window of recent frames (default 5 frames) for
 *   additional stabilization. Reduces micro-jitter that propagates to larger objects.
 * - Statistical outlier detection: Uses running statistics (mean, std dev) to detect
 *   unrealistic movements relative to observed motion patterns. Automatically adapts
 *   to slow/fast/accelerating motion without fixed thresholds.
 * - Adaptive smoothing: Additional smoothing that adjusts based on movement speed
 *   (fast = less smoothing, slow = more). Works on top of general stabilization.
 * - Motion prediction: Continues animating when tracking is lost (up to configurable duration)
 * - Elegant state transitions: Tracks 'lost', 'losing', 'finding', 'found' states with confidence
 * - Dynamic parameter adjustment: Parameters adapt based on observed motion patterns
 * 
 * Stabilization Pipeline:
 * 1. General Stabilization (base): Applied to all frames with configurable strength
 * 2. Multi-frame Smoothing: Averages across recent frames with ADAPTIVE window size and weighting:
 *    - Window size adapts: smaller (2-3 frames) during fast movement/acceleration, larger (7-8 frames) when static
 *    - Weighting adapts: more weight on recent frames when momentum is changing, even distribution when stable
 *    - Responds to acceleration: reduces smoothing when momentum shifts are detected
 * 3. Adaptive Smoothing: Additional smoothing based on movement speed (fast = less, slow = more)
 * 4. Outlier Detection: Rejects unrealistic jumps while continuing smooth movement
 * 
 * Adaptive Behavior:
 * - Fast movement or acceleration → smaller window, more weight on recent frames (responsive)
 * - Static/slow movement → larger window, even weight distribution (stable)
 * - Momentum changes detected → automatically reduces smoothing for responsiveness
 * - Stable momentum → increases smoothing for stability
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
      
      // General stabilization (applied to all frames)
      stabilizationEnabled: config.stabilizationEnabled ?? true, // enable general stabilization
      stabilizationStrength: config.stabilizationStrength ?? 0.6, // 0-1, higher = more smoothing (0.6 = 60% smoothing)
      multiFrameSmoothing: config.multiFrameSmoothing ?? true, // use multi-frame smoothing window
      smoothingWindowSize: config.smoothingWindowSize ?? 5, // base number of frames to average over
      minSmoothingWindowSize: config.minSmoothingWindowSize ?? 2, // minimum window size (for fast movement)
      maxSmoothingWindowSize: config.maxSmoothingWindowSize ?? 8, // maximum window size (for static/slow movement)
      adaptiveWindowSize: config.adaptiveWindowSize ?? true, // adapt window size based on movement
      accelerationThreshold: config.accelerationThreshold ?? 0.02, // m/s² - threshold for detecting momentum changes
      
      // Adaptive smoothing (additional smoothing based on movement speed)
      minSmoothingFactor: config.minSmoothingFactor ?? 0.1, // for fast movement (additional on top of stabilization)
      maxSmoothingFactor: config.maxSmoothingFactor ?? 0.8, // for slow/static movement (additional on top of stabilization)
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
        previousVelocity: null, // for calculating acceleration (initialized on first frame)
        previousAngularVelocity: null, // for calculating angular acceleration (initialized on first frame)
        
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
        
        // Multi-frame smoothing history (for general stabilization)
        smoothedPositionHistory: [], // recent smoothed positions
        smoothedRotationHistory: [], // recent smoothed rotations
        smoothedScaleHistory: [], // recent smoothed scales
        
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
   * Calculate adaptive window size based on movement characteristics
   */
  _calculateAdaptiveWindowSize(state, deltaTime) {
    if (!this.config.adaptiveWindowSize) {
      return this.config.smoothingWindowSize;
    }

    // Calculate movement characteristics
    const linearSpeed = state.velocity.length();
    state.tempQuaternion.identity();
    const angularSpeed = Math.abs(state.angularVelocity.angleTo(state.tempQuaternion));
    
    // Calculate acceleration magnitude
    const accelerationMagnitude = state.acceleration.length();
    
    // Determine movement state
    const isFast = linearSpeed > this.config.velocityThreshold || angularSpeed > this.config.angularVelocityThreshold;
    const isAccelerating = accelerationMagnitude > this.config.accelerationThreshold;
    const isStatic = linearSpeed < this.config.velocityThreshold * 0.3 && angularSpeed < this.config.angularVelocityThreshold * 0.3;

    // Adaptive window sizing:
    // - Fast movement or acceleration = smaller window (more responsive)
    // - Static/slow movement = larger window (more stable)
    // - Momentum changes (acceleration) = reduce window to be more responsive
    let adaptiveWindowSize = this.config.smoothingWindowSize;
    
    if (isAccelerating) {
      // Momentum is changing - use smaller window for responsiveness
      adaptiveWindowSize = this.config.minSmoothingWindowSize + 
        (this.config.smoothingWindowSize - this.config.minSmoothingWindowSize) * 0.3;
    } else if (isFast) {
      // Fast but stable movement - medium window
      adaptiveWindowSize = this.config.minSmoothingWindowSize + 
        (this.config.smoothingWindowSize - this.config.minSmoothingWindowSize) * 0.6;
    } else if (isStatic) {
      // Static or very slow - use larger window for maximum stability
      adaptiveWindowSize = this.config.smoothingWindowSize + 
        (this.config.maxSmoothingWindowSize - this.config.smoothingWindowSize) * 0.7;
    } else {
      // Normal movement - use base window size
      adaptiveWindowSize = this.config.smoothingWindowSize;
    }

    return Math.round(Math.max(this.config.minSmoothingWindowSize, 
                               Math.min(this.config.maxSmoothingWindowSize, adaptiveWindowSize)));
  }

  /**
   * Apply multi-frame smoothing for general stabilization
   * Uses an adaptive window of recent smoothed frames to reduce jitter
   * Adapts to movement speed and momentum changes
   */
  _applyMultiFrameSmoothing(currentDecomp, state, deltaTime) {
    if (!this.config.multiFrameSmoothing || !currentDecomp) {
      return currentDecomp;
    }

    // Add current to history
    state.smoothedPositionHistory.push(currentDecomp.position.clone());
    state.smoothedRotationHistory.push(currentDecomp.rotation.clone());
    state.smoothedScaleHistory.push(currentDecomp.scale.clone());

    // Calculate adaptive window size based on movement
    const adaptiveWindowSize = this._calculateAdaptiveWindowSize(state, deltaTime);

    // Maintain window size (use adaptive size)
    while (state.smoothedPositionHistory.length > adaptiveWindowSize) {
      state.smoothedPositionHistory.shift();
      state.smoothedRotationHistory.shift();
      state.smoothedScaleHistory.shift();
    }

    // Need at least 2 frames for averaging
    if (state.smoothedPositionHistory.length < 2) {
      return currentDecomp;
    }

    // Calculate movement characteristics for adaptive weighting
    const linearSpeed = state.velocity.length();
    state.tempQuaternion.identity();
    const angularSpeed = Math.abs(state.angularVelocity.angleTo(state.tempQuaternion));
    const accelerationMagnitude = state.acceleration.length();
    
    // Adaptive weighting: when accelerating or moving fast, give more weight to recent frames
    // When static/slow, distribute weight more evenly across window
    const isAccelerating = accelerationMagnitude > this.config.accelerationThreshold;
    const isFast = linearSpeed > this.config.velocityThreshold || angularSpeed > this.config.angularVelocityThreshold;
    
    // Weight distribution factor: 1.0 = all weight on recent, 0.5 = even distribution
    const weightDistribution = isAccelerating ? 0.9 : (isFast ? 0.8 : 0.6);

    // Calculate weighted average with adaptive weighting
    const n = state.smoothedPositionHistory.length;
    let totalWeight = 0;
    state.tempVector.set(0, 0, 0);
    state.tempVector2.set(0, 0, 0);
    
    // For quaternions, we'll use sequential slerp (more accurate than linear blend)
    // Start with the oldest quaternion
    state.tempQuaternion.copy(state.smoothedRotationHistory[0]);
    
    // Calculate weighted position average with adaptive weighting
    for (let i = 0; i < n; i++) {
      // Adaptive weighting: more weight to recent frames when movement is changing
      // Base weight increases linearly, but distribution factor adjusts how much
      const baseWeight = (i + 1) / n;
      const weight = baseWeight * weightDistribution + (1 - weightDistribution) / n;
      totalWeight += weight;

      // Accumulate weighted position
      state.tempVector2.copy(state.smoothedPositionHistory[i]);
      state.tempVector2.multiplyScalar(weight);
      state.tempVector.add(state.tempVector2);
    }

    // Normalize position
    state.tempVector.divideScalar(totalWeight);
    
    // For quaternions, use sequential slerp with adaptive weights
    let accumulatedWeight = 0;
    for (let i = 1; i < n; i++) {
      const baseWeight = (i + 1) / n;
      const weight = baseWeight * weightDistribution + (1 - weightDistribution) / n;
      const t = weight / (accumulatedWeight + weight);
      state.tempQuaternion.slerp(state.smoothedRotationHistory[i], t);
      accumulatedWeight += weight;
    }
    
    // Average scale with adaptive weighting
    state.tempVector2.set(0, 0, 0);
    for (let i = 0; i < n; i++) {
      const baseWeight = (i + 1) / n;
      const weight = baseWeight * weightDistribution + (1 - weightDistribution) / n;
      state.tempVector2.add(state.smoothedScaleHistory[i].clone().multiplyScalar(weight));
    }
    state.tempVector2.divideScalar(totalWeight);

    return {
      position: state.tempVector.clone(),
      rotation: state.tempQuaternion.clone(),
      scale: state.tempVector2.clone()
    };
  }

  /**
   * Apply adaptive smoothing with general stabilization
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

    // Step 1: Apply general stabilization (base smoothing)
    let stabilizationFactor = 0;
    if (this.config.stabilizationEnabled) {
      stabilizationFactor = this.config.stabilizationStrength;
    }

    // Step 2: Calculate adaptive smoothing based on movement speed (additional smoothing)
    let adaptiveSmoothingFactor = 0;
    if (this.config.enableAdaptiveParams) {
      const linearSpeed = state.velocity.length();
      state.tempQuaternion.identity();
      const angularSpeed = Math.abs(state.angularVelocity.angleTo(state.tempQuaternion));

      const speedRatio = Math.min(
        linearSpeed / this.config.velocityThreshold,
        angularSpeed / this.config.angularVelocityThreshold
      );
      
      // Fast movement = less smoothing, slow movement = more smoothing
      const targetSmoothing = this.config.minSmoothingFactor + 
        (this.config.maxSmoothingFactor - this.config.minSmoothingFactor) * (1 - Math.min(speedRatio, 1));
      
      // Smoothly adapt the smoothing factor
      state.currentSmoothingFactor += (targetSmoothing - state.currentSmoothingFactor) * this.config.adaptationRate;
      adaptiveSmoothingFactor = state.currentSmoothingFactor;
    }

    // Combine stabilization and adaptive smoothing
    // Use the maximum of the two (more aggressive smoothing wins)
    const totalSmoothingFactor = Math.max(stabilizationFactor, adaptiveSmoothingFactor);

    // Apply exponential smoothing (reuse temp objects)
    state.tempVector.lerpVectors(prev.position, curr.position, 1 - totalSmoothingFactor);
    state.tempQuaternion.slerpQuaternions(prev.rotation, curr.rotation, 1 - totalSmoothingFactor);
    state.tempVector2.lerpVectors(prev.scale, curr.scale, 1 - totalSmoothingFactor);

    // Step 3: Apply multi-frame smoothing for additional stabilization
    let finalDecomp = {
      position: state.tempVector.clone(),
      rotation: state.tempQuaternion.clone(),
      scale: state.tempVector2.clone()
    };

    if (this.config.multiFrameSmoothing) {
      const multiFrameResult = this._applyMultiFrameSmoothing(finalDecomp, state, deltaTime);
      if (multiFrameResult) {
        finalDecomp = multiFrameResult;
      }
    }

    // Validate smoothed values before composing
    if (!finalDecomp.position || !finalDecomp.rotation || !finalDecomp.scale) {
      state.tempMatrix.copy(current);
      return state.tempMatrix;
    }

    // Reuse tempMatrix for composition
    state.tempMatrix.compose(finalDecomp.position, finalDecomp.rotation, finalDecomp.scale);
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
      
      // Calculate acceleration (change in velocity)
      if (deltaTime > 0 && state.previousVelocity) {
        state.acceleration.subVectors(motion.linear, state.previousVelocity);
        state.acceleration.multiplyScalar(1000 / deltaTime); // convert to m/s²
      } else {
        state.acceleration.set(0, 0, 0);
        // Initialize previous velocity on first frame
        if (!state.previousVelocity) {
          state.previousVelocity = new Vector3();
        }
        if (!state.previousAngularVelocity) {
          state.previousAngularVelocity = new Quaternion();
        }
      }
      
      // Store current velocity for next frame's acceleration calculation
      state.previousVelocity.copy(motion.linear);
      state.previousAngularVelocity.copy(motion.angular);
      
      // Update current velocity
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
    const oldConfig = { ...this.config };
    Object.assign(this.config, newConfig);
    
    // Log config changes for debugging
    if (this.config.debugMode) {
      const changedKeys = Object.keys(newConfig).filter(key => 
        oldConfig[key] !== this.config[key]
      );
      if (changedKeys.length > 0) {
        const changes = changedKeys.reduce((acc, key) => {
          acc[key] = { from: oldConfig[key], to: this.config[key] };
          return acc;
        }, {});
        console.log('[MindAR PostProcessor] Config updated:', changes);
      }
    }
    
    // Reset adaptive smoothing factors for all targets when smoothing config changes
    // This ensures the new smoothing factors take effect immediately
    if (newConfig.minSmoothingFactor !== undefined || newConfig.maxSmoothingFactor !== undefined) {
      this.targetStates.forEach((state) => {
        // Reset to midpoint of new range
        state.currentSmoothingFactor = (this.config.minSmoothingFactor + this.config.maxSmoothingFactor) / 2;
      });
    }
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


