import { Matrix4, Vector3, Quaternion } from "three";

/**
 * Advanced post-processing pipeline for AR tracking matrices
 * 
 * IMPORTANT: This system is UNIT-AGNOSTIC. All thresholds and parameters are relative to observed
 * motion patterns, not absolute values. It works correctly whether your world uses units of 0.1,
 * 1.0, 1000, or any other scale. The system automatically adapts to whatever units your world uses.
 * 
 * Features:
 * - General Stabilization: Base smoothing applied to all frames to reduce jitter and create
 *   rock-solid tracking. Configurable strength (0-1) for fine-tuning stability vs responsiveness.
 * - Multi-frame Smoothing: Averages across a window of recent frames (default 10 frames, up to 15) for
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
 * 1. General Stabilization (base): Applied to all frames with configurable strength (default 70% smoothing)
 * 2. Multi-frame Smoothing: Averages across recent frames with ADAPTIVE window size and weighting:
 *    - Window size adapts: smaller (4 frames) during fast movement/acceleration, larger (up to 12 frames) when static
 *    - Weighting adapts: more weight on recent frames when momentum is changing, even distribution when stable
 *    - Responds to acceleration: maintains larger windows even during movement for better noise reduction
 * 3. Adaptive Smoothing: Additional smoothing based on movement speed (fast = less, slow = more)
 * 4. Outlier Detection: Rejects unrealistic jumps (2.5 sigma for position/rotation, 2.0 for scale) - balanced for stability
 * 
 * Adaptive Behavior:
 * - Fast movement or acceleration → medium window (4-8 frames), balanced weight distribution (responsive but smooth)
 * - Static/slow movement → larger window (up to 12 frames), even weight distribution (very stable, ~200ms at 60fps)
 * - Momentum changes detected → maintains decent window size for noise reduction
 * - Stable momentum → increases smoothing and window size for maximum stability
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
 * - All thresholds are relative to observed motion, making it work with any world scale
 * 
 * Unit Independence:
 * - Position thresholds: Relative to mean position delta (no absolute values)
 * - Velocity thresholds: Relative to mean velocity (multipliers, not m/s)
 * - Acceleration thresholds: Relative to mean acceleration (multipliers, not m/s²)
 * - Reattachment distance: Relative to mean position delta (multipliers, not meters)
 * - Rotation thresholds: Radians (unitless, so always OK)
 */
export class MatrixPostProcessor {
  constructor(config = {}) {
    // Configuration with defaults
    this.config = {
      enabled: config.enabled !== false, // Enable/disable post-processing (default: true)
      // Outlier detection (statistical, relative to observed motion)
      // These values represent how many standard deviations from the mean are considered outliers
      // Example: 2.0 means jumps beyond 2 standard deviations are rejected
      // - Lower values (1.5-2.0) = more aggressive filtering, catches smaller anomalies
      // - Higher values (3.0-3.5) = more permissive, allows larger jumps during fast motion
      // The system automatically adapts: if motion is slow, even small jumps are caught.
      // If motion is fast/accelerating, larger jumps are acceptable.
      outlierSigmaMultiplier: config.outlierSigmaMultiplier ?? 2.5, // standard deviations for position/rotation (balanced: aggressive but not too strict)
      outlierScaleSigmaMultiplier: config.outlierScaleSigmaMultiplier ?? 2.0, // standard deviations for scale (more aggressive since scale should be stable)
      outlierHistorySize: config.outlierHistorySize ?? 30, // frames to analyze for statistical outlier detection (increased for better statistics)
      minHistoryForOutlierDetection: config.minHistoryForOutlierDetection ?? 8, // minimum frames needed before outlier detection activates (increased for more stable stats)
      
      // General stabilization (applied to all frames)
      stabilizationEnabled: config.stabilizationEnabled ?? true, // enable general stabilization
      stabilizationStrength: config.stabilizationStrength ?? 0.7, // 0-1, higher = more smoothing (0.7 = 70% smoothing, balanced for stability vs responsiveness)
      multiFrameSmoothing: config.multiFrameSmoothing ?? true, // use multi-frame smoothing window
      multiFrameStrength: config.multiFrameStrength ?? 1.3, // 0.1-4.0, strength of multi-frame smoothing (1.3 = ~65% multi-frame blend, balanced)
      smoothingWindowSize: config.smoothingWindowSize ?? 8, // base number of frames to average over (balanced: good smoothing without excessive lag)
      minSmoothingWindowSize: config.minSmoothingWindowSize ?? 4, // minimum window size (for fast movement, maintains responsiveness)
      maxSmoothingWindowSize: config.maxSmoothingWindowSize ?? 12, // maximum window size (for static/slow movement, ~200ms at 60fps - good balance)
      adaptiveWindowSize: config.adaptiveWindowSize ?? true, // adapt window size based on movement
      // Acceleration threshold is now relative to observed motion (as multiplier of mean acceleration)
      accelerationThresholdMultiplier: config.accelerationThresholdMultiplier ?? 2.0, // multiplier of mean acceleration to detect momentum changes
      
      // Adaptive smoothing (additional smoothing based on movement speed)
      minSmoothingFactor: config.minSmoothingFactor ?? 0.2, // for fast movement (additional on top of stabilization, increased)
      maxSmoothingFactor: config.maxSmoothingFactor ?? 0.85, // for slow/static movement (additional on top of stabilization, increased)
      // Velocity thresholds are now relative to observed motion (as multipliers of mean velocity)
      // These are unitless multipliers - they adapt to whatever units the world uses
      velocityThresholdMultiplier: config.velocityThresholdMultiplier ?? 1.5, // multiplier of mean velocity to consider "fast"
      angularVelocityThreshold: config.angularVelocityThreshold ?? 0.1, // rad/s (radians are unitless, so this is OK)
      
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
      // Reattachment distance is now relative to observed motion (as multiplier of mean position delta)
      // Uses a combination of multiplier and std dev for more robust detection
      reattachmentDistanceMultiplier: config.reattachmentDistanceMultiplier ?? 4.0, // multiplier of mean position delta for max reattachment distance (balanced)
      reattachmentMinDistance: config.reattachmentMinDistance ?? null, // optional: minimum absolute distance (null = fully relative, unit-agnostic)
      reattachmentMaxDistance: config.reattachmentMaxDistance ?? null, // optional: maximum absolute distance (null = fully relative, unit-agnostic)
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
        
        // Running statistics for velocity/acceleration (for relative thresholds)
        velocityMagnitudeHistory: [], // history of velocity magnitudes for relative thresholds
        accelerationMagnitudeHistory: [], // history of acceleration magnitudes for relative thresholds
        velocityStats: { mean: 0, stdDev: 0 },
        accelerationStats: { mean: 0, stdDev: 0 },
        
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
    // Validate inputs before composing - just check for null/undefined
    // Three.js compose method will handle type validation and throw if types are wrong
    if (!position || !rotation || !scale) {
      return null;
    }
    
    try {
      const matrix = new Matrix4();
      matrix.compose(position, rotation, scale);
      return matrix;
    } catch (e) {
      // Only log if it's not a type error (which we expect Three.js to handle)
      // Silently fail - caller should handle null return
      return null;
    }
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

    // Calculate velocity in world units per second (unit-agnostic)
    const linearVelocity = new Vector3()
      .subVectors(curr.position, prev.position)
      .multiplyScalar(1000 / deltaTime); // convert to units per second (not m/s - works with any unit)

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
    // All thresholds are now relative to observed motion - no absolute values
    // Minimum thresholds are relative to mean (small fraction of mean) to avoid false positives when stdDev is very small
    const minPositionThreshold = state.positionDeltaStats.mean > 0 
      ? state.positionDeltaStats.mean * 0.1  // 10% of mean as minimum (relative to observed motion)
      : 0; // No minimum if we have no history yet
    const minRotationThreshold = 0.008; // ~0.46 degrees minimum (radians are unitless, so this is OK)
    const minScaleThreshold = state.scaleDeltaStats.mean > 0
      ? state.scaleDeltaStats.mean * 0.1  // 10% of mean as minimum (relative to observed motion)
      : 0.0001; // Very small absolute fallback for scale (scale is typically 0-2 range)

    // Position outlier check
    // Also check if delta is significantly larger than recent maximum (additional safeguard)
    const recentMaxPosition = state.positionDeltaHistory.length > 0 
      ? Math.max(...state.positionDeltaHistory.slice(-5)) 
      : 0;
    const positionThreshold = Math.max(
      minPositionThreshold,
      state.positionDeltaStats.mean + (this.config.outlierSigmaMultiplier * state.positionDeltaStats.stdDev)
    );
    // Reject if beyond threshold OR if it's more than 2x the recent maximum (catches sudden large jumps)
    if (positionDelta > positionThreshold || (recentMaxPosition > 0 && positionDelta > recentMaxPosition * 2.0)) {
      return true;
    }

    // Rotation outlier check
    const recentMaxRotation = state.rotationDeltaHistory.length > 0 
      ? Math.max(...state.rotationDeltaHistory.slice(-5)) 
      : 0;
    const rotationThreshold = Math.max(
      minRotationThreshold,
      state.rotationDeltaStats.mean + (this.config.outlierSigmaMultiplier * state.rotationDeltaStats.stdDev)
    );
    // Reject if beyond threshold OR if it's more than 2x the recent maximum
    if (rotationDelta > rotationThreshold || (recentMaxRotation > 0 && rotationDelta > recentMaxRotation * 2.0)) {
      return true;
    }

    // Scale outlier check (usually more stable, so use different multiplier)
    const recentMaxScale = state.scaleDeltaHistory.length > 0 
      ? Math.max(...state.scaleDeltaHistory.slice(-5)) 
      : 0;
    const scaleThreshold = Math.max(
      minScaleThreshold,
      state.scaleDeltaStats.mean + (this.config.outlierScaleSigmaMultiplier * state.scaleDeltaStats.stdDev)
    );
    // Reject if beyond threshold OR if it's more than 1.5x the recent maximum (scale is more sensitive)
    if (scaleDelta > scaleThreshold || (recentMaxScale > 0 && scaleDelta > recentMaxScale * 1.5)) {
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
    
    // Determine movement state using relative thresholds
    // Update velocity/acceleration statistics for relative thresholds
    this._updateStatistics(state.velocityMagnitudeHistory, state.velocityStats);
    this._updateStatistics(state.accelerationMagnitudeHistory, state.accelerationStats);
    
    // Use relative thresholds (multipliers of mean) instead of absolute values
    const velocityThreshold = state.velocityStats.mean > 0 
      ? state.velocityStats.mean * this.config.velocityThresholdMultiplier
      : 0; // Fallback to 0 if no history
    const accelerationThreshold = state.accelerationStats.mean > 0
      ? state.accelerationStats.mean * this.config.accelerationThresholdMultiplier
      : 0; // Fallback to 0 if no history
    
    const isFast = linearSpeed > velocityThreshold || angularSpeed > this.config.angularVelocityThreshold;
    const isAccelerating = accelerationMagnitude > accelerationThreshold;
    const isStatic = linearSpeed < velocityThreshold * 0.3 && angularSpeed < this.config.angularVelocityThreshold * 0.3;

    // Adaptive window sizing:
    // - Fast movement or acceleration = smaller window (more responsive) but still larger than before
    // - Static/slow movement = larger window (more stable)
    // - Momentum changes (acceleration) = reduce window slightly but maintain good smoothing
    let adaptiveWindowSize = this.config.smoothingWindowSize;
    
    if (isAccelerating) {
      // Momentum is changing - use smaller window for responsiveness but still maintain decent smoothing
      // Increased from 0.3 to 0.5 to maintain larger windows even during acceleration
      adaptiveWindowSize = this.config.minSmoothingWindowSize + 
        (this.config.smoothingWindowSize - this.config.minSmoothingWindowSize) * 0.5;
    } else if (isFast) {
      // Fast but stable movement - use larger window for better smoothing
      // Increased from 0.6 to 0.75 to maintain better smoothing during fast movement
      adaptiveWindowSize = this.config.minSmoothingWindowSize + 
        (this.config.smoothingWindowSize - this.config.minSmoothingWindowSize) * 0.75;
    } else if (isStatic) {
      // Static or very slow - use larger window for maximum stability
      // Increased from 0.7 to 0.85 to use even larger windows when static
      adaptiveWindowSize = this.config.smoothingWindowSize + 
        (this.config.maxSmoothingWindowSize - this.config.smoothingWindowSize) * 0.85;
    } else {
      // Normal movement - use base window size (which is now larger)
      adaptiveWindowSize = this.config.smoothingWindowSize;
    }

    return Math.round(Math.max(this.config.minSmoothingWindowSize, 
                               Math.min(this.config.maxSmoothingWindowSize, adaptiveWindowSize)));
  }

  /**
   * Clear multi-frame smoothing history
   * Used when tracking is lost or when reattaching to prevent averaging with stale data
   */
  _clearMultiFrameHistory(state) {
    state.smoothedPositionHistory = [];
    state.smoothedRotationHistory = [];
    state.smoothedScaleHistory = [];
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

    // Validate current decomposition before adding to history
    if (!currentDecomp.position || !currentDecomp.rotation || !currentDecomp.scale) {
      return currentDecomp;
    }

    // If previous frame was skipped, clear history to prevent averaging with stale data
    // This prevents glitches when transitioning from skipped frame to normal frame
    if (state.lastWasSkipped && state.smoothedPositionHistory.length > 0) {
      // Keep only the most recent entry to maintain some continuity
      // but clear older entries that might be from before the skip
      if (state.smoothedPositionHistory.length > 1) {
        const lastPos = state.smoothedPositionHistory[state.smoothedPositionHistory.length - 1];
        const lastRot = state.smoothedRotationHistory[state.smoothedRotationHistory.length - 1];
        const lastScale = state.smoothedScaleHistory[state.smoothedScaleHistory.length - 1];
        state.smoothedPositionHistory = [lastPos];
        state.smoothedRotationHistory = [lastRot];
        state.smoothedScaleHistory = [lastScale];
      }
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
      
      // Update statistics for relative thresholds
      this._updateStatistics(state.velocityMagnitudeHistory, state.velocityStats);
      this._updateStatistics(state.accelerationMagnitudeHistory, state.accelerationStats);
      
      // Use relative thresholds
      const velocityThreshold = state.velocityStats.mean > 0 
        ? state.velocityStats.mean * this.config.velocityThresholdMultiplier
        : 0;
      const accelerationThreshold = state.accelerationStats.mean > 0
        ? state.accelerationStats.mean * this.config.accelerationThresholdMultiplier
        : 0;
      
      // Adaptive weighting: when accelerating or moving fast, give more weight to recent frames
      // When static/slow, distribute weight more evenly across window
      // Updated to maintain better smoothing even during movement
      const isAccelerating = accelerationMagnitude > accelerationThreshold;
      const isFast = linearSpeed > velocityThreshold || angularSpeed > this.config.angularVelocityThreshold;
    
    // Weight distribution factor: 1.0 = all weight on recent, 0.5 = even distribution
    // Reduced from 0.9/0.8/0.6 to 0.75/0.65/0.5 to give more weight to older frames for better smoothing
    const weightDistribution = isAccelerating ? 0.75 : (isFast ? 0.65 : 0.5);

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

    // Apply multi-frame strength factor
    // Factor 1.0 = current behavior (50% current, 50% multi-frame averaged)
    // Factor > 1.0 = stronger multi-frame smoothing (more weight on averaged result)
    // Factor < 1.0 = lighter multi-frame smoothing (more weight on current frame)
    const strength = Math.max(0.1, Math.min(4.0, this.config.multiFrameStrength));
    
    // Calculate blend factor: how much of the multi-frame averaged result to use
    // At strength 0.1: 5% multi-frame, 95% current (very light)
    // At strength 1.0: 50% multi-frame, 50% current (balanced - current behavior)
    // At strength 4.0: 95% multi-frame, 5% current (very strong)
    // Linear interpolation between these points
    let blendFactor;
    if (strength <= 1.0) {
      // 0.1 -> 0.05, 1.0 -> 0.5
      blendFactor = 0.05 + (strength - 0.1) / 0.9 * 0.45;
    } else {
      // 1.0 -> 0.5, 4.0 -> 0.95
      blendFactor = 0.5 + (strength - 1.0) / 3.0 * 0.45;
    }
    
    // Blend between current frame and multi-frame averaged result
    const blendedPos = new Vector3().lerpVectors(
      currentDecomp.position,
      state.tempVector,
      blendFactor
    );
    const blendedRot = new Quaternion().slerpQuaternions(
      currentDecomp.rotation,
      state.tempQuaternion,
      blendFactor
    );
    const blendedScale = new Vector3().lerpVectors(
      currentDecomp.scale,
      state.tempVector2,
      blendFactor
    );
    
    return {
      position: blendedPos,
      rotation: blendedRot,
      scale: blendedScale
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

      // Update statistics for relative thresholds
      this._updateStatistics(state.velocityMagnitudeHistory, state.velocityStats);
      const velocityThreshold = state.velocityStats.mean > 0 
        ? state.velocityStats.mean * this.config.velocityThresholdMultiplier
        : 0.001; // Small fallback to avoid division by zero

      const speedRatio = Math.min(
        linearSpeed / velocityThreshold,
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
      if (multiFrameResult && multiFrameResult.position && multiFrameResult.rotation && multiFrameResult.scale) {
        finalDecomp = multiFrameResult;
      }
    }

    // Validate smoothed values before composing
    if (!finalDecomp || !finalDecomp.position || !finalDecomp.rotation || !finalDecomp.scale) {
      state.tempMatrix.copy(current);
      return state.tempMatrix;
    }

    // Reuse tempMatrix for composition - use helper to validate
    const composed = this._composeMatrix(finalDecomp.position, finalDecomp.rotation, finalDecomp.scale);
    if (composed) {
      state.tempMatrix.copy(composed);
      return state.tempMatrix;
    } else {
      // Fallback to current if composition failed
      state.tempMatrix.copy(current);
      return state.tempMatrix;
    }
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
        // Clear multi-frame smoothing history when entering 'lost' state
        // This prevents averaging with stale data when tracking resumes
        this._clearMultiFrameHistory(state);
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
      // No previous smoothed matrix - clear history and use new matrix
      this._clearMultiFrameHistory(state);
      return newMatrix;
    }

    const newDecomp = this._decomposeMatrix(newMatrix);
    const smoothedDecomp = this._decomposeMatrix(state.smoothedMatrix);

    // Validate decompositions
    if (!newDecomp || !smoothedDecomp || 
        !newDecomp.position || !smoothedDecomp.position) {
      // Decomposition failed - clear history and return new matrix
      this._clearMultiFrameHistory(state);
      state.smoothedMatrix.copy(newMatrix);
      return newMatrix;
    }

    const distance = newDecomp.position.distanceTo(smoothedDecomp.position);
    
    // Calculate relative reattachment threshold based on observed motion
    // Update position statistics if available
    if (state.positionDeltaHistory.length > 0) {
      this._updateStatistics(state.positionDeltaHistory, state.positionDeltaStats);
    }
    let reattachmentThreshold = state.positionDeltaStats.mean > 0
      ? state.positionDeltaStats.mean * this.config.reattachmentDistanceMultiplier
      : distance * 1.5; // Fallback: 1.5x current distance if no history
    
    // Apply optional min/max bounds if provided (for edge cases, but defaults are null for unit-agnostic)
    if (this.config.reattachmentMinDistance !== null && reattachmentThreshold < this.config.reattachmentMinDistance) {
      reattachmentThreshold = this.config.reattachmentMinDistance;
    }
    if (this.config.reattachmentMaxDistance !== null && reattachmentThreshold > this.config.reattachmentMaxDistance) {
      reattachmentThreshold = this.config.reattachmentMaxDistance;
    }

    if (distance > reattachmentThreshold) {
      // Too far - likely a different target or major jump
      // Clear history to prevent averaging with stale data
      this._clearMultiFrameHistory(state);
      state.reattaching = false;
      
      // Still apply light smoothing to prevent sudden jumps
      // Use very aggressive smoothing (high value = more smoothing = slower transition)
      if (smoothedDecomp && newDecomp &&
          smoothedDecomp.position && smoothedDecomp.rotation && smoothedDecomp.scale &&
          newDecomp.position && newDecomp.rotation && newDecomp.scale) {
        const aggressiveSmoothing = Math.min(0.9, this.config.reattachmentSmoothing + 0.4);
        const smoothedPos = new Vector3().lerpVectors(
          smoothedDecomp.position,
          newDecomp.position,
          1 - aggressiveSmoothing
        );
        const smoothedRot = new Quaternion().slerpQuaternions(
          smoothedDecomp.rotation,
          newDecomp.rotation,
          1 - aggressiveSmoothing
        );
        const smoothedScale = new Vector3().lerpVectors(
          smoothedDecomp.scale,
          newDecomp.scale,
          1 - aggressiveSmoothing
        );
        
        const result = this._composeMatrix(smoothedPos, smoothedRot, smoothedScale);
        if (result) {
          // Update smoothedMatrix to the result to maintain continuity
          state.smoothedMatrix.copy(result);
          return result;
        }
      }
      // Fallback: return new matrix if composition failed
      state.smoothedMatrix.copy(newMatrix);
      return newMatrix;
    }

    // Smoothly transition to the new matrix
    if (!state.reattaching) {
      state.reattaching = true;
      state.reattachmentStartMatrix = state.smoothedMatrix.clone();
      // Clear history when starting reattachment to avoid averaging with stale data
      this._clearMultiFrameHistory(state);
    }

    const reattachmentDecomp = this._decomposeMatrix(state.reattachmentStartMatrix);
    
    // Validate reattachment decomposition
    if (!reattachmentDecomp || !reattachmentDecomp.position || 
        !reattachmentDecomp.rotation || !reattachmentDecomp.scale) {
      // Decomposition failed - return new matrix
      state.reattaching = false;
      state.smoothedMatrix.copy(newMatrix);
      return newMatrix;
    }
    
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
    
    if (!result) {
      // Composition failed - return new matrix with light smoothing applied directly
      const fallbackResult = new Matrix4();
      fallbackResult.copy(newMatrix);
      // Apply light smoothing manually
      const fallbackDecomp = this._decomposeMatrix(fallbackResult);
      const startDecomp = this._decomposeMatrix(state.reattachmentStartMatrix);
      if (fallbackDecomp && startDecomp) {
        const smoothedPos2 = new Vector3().lerpVectors(
          startDecomp.position,
          fallbackDecomp.position,
          this.config.reattachmentSmoothing
        );
        const smoothedRot2 = new Quaternion().slerpQuaternions(
          startDecomp.rotation,
          fallbackDecomp.rotation,
          this.config.reattachmentSmoothing
        );
        const smoothedScale2 = new Vector3().lerpVectors(
          startDecomp.scale,
          fallbackDecomp.scale,
          this.config.reattachmentSmoothing
        );
        const fallbackComposed = this._composeMatrix(smoothedPos2, smoothedRot2, smoothedScale2);
        if (fallbackComposed) {
          state.smoothedMatrix.copy(fallbackComposed);
          return fallbackComposed;
        }
      }
      // Last resort: return new matrix
      state.smoothedMatrix.copy(newMatrix);
      return newMatrix;
    }
    
    // Update smoothedMatrix to maintain continuity
    state.smoothedMatrix.copy(result);
    
    // Check if we're close enough to stop reattaching
    const resultDecomp = this._decomposeMatrix(result);
    if (resultDecomp && resultDecomp.position && newDecomp.position) {
      if (resultDecomp.position.distanceTo(newDecomp.position) < 0.01) {
        state.reattaching = false;
      }
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
    // If post-processor is disabled, return raw matrix
    if (!this.config.enabled) {
      return worldMatrix;
    }
    
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
          // Made even more conservative (reduced from 0.05 to 0.03) to reject outliers more aggressively
          const lightSmoothingFactor = Math.min(this.config.minSmoothingFactor, 0.03); // Max 3% smoothing for outliers
          
          // Smooth between last smoothed matrix and current (rejected) matrix
          const smoothedDecomp = this._decomposeMatrix(state.smoothedMatrix);
          const currentDecomp = this._decomposeMatrix(matrix);
          
          // Apply light smoothing
          if (smoothedDecomp && currentDecomp &&
              smoothedDecomp.position && smoothedDecomp.rotation && smoothedDecomp.scale &&
              currentDecomp.position && currentDecomp.rotation && currentDecomp.scale) {
            state.tempVector.lerpVectors(smoothedDecomp.position, currentDecomp.position, 1 - lightSmoothingFactor);
            state.tempQuaternion.slerpQuaternions(smoothedDecomp.rotation, currentDecomp.rotation, 1 - lightSmoothingFactor);
            state.tempVector2.lerpVectors(smoothedDecomp.scale, currentDecomp.scale, 1 - lightSmoothingFactor);
            
            // Update smoothed matrix with continued smoothing
            const composed = this._composeMatrix(state.tempVector, state.tempQuaternion, state.tempVector2);
            if (composed) {
              state.smoothedMatrix.copy(composed);
            }
            // If composition failed, keep existing smoothedMatrix
          }
          
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
          
          if (prevDecomp && currentDecomp &&
              prevDecomp.position && prevDecomp.rotation && prevDecomp.scale &&
              currentDecomp.position && currentDecomp.rotation && currentDecomp.scale) {
            state.tempVector.lerpVectors(prevDecomp.position, currentDecomp.position, 1 - lightSmoothingFactor);
            state.tempQuaternion.slerpQuaternions(prevDecomp.rotation, currentDecomp.rotation, 1 - lightSmoothingFactor);
            state.tempVector2.lerpVectors(prevDecomp.scale, currentDecomp.scale, 1 - lightSmoothingFactor);
            
            if (!state.smoothedMatrix) {
              state.smoothedMatrix = new Matrix4();
            }
            const composed = this._composeMatrix(state.tempVector, state.tempQuaternion, state.tempVector2);
            if (composed) {
              state.smoothedMatrix.copy(composed);
            } else {
              // Fallback: use current matrix
              state.smoothedMatrix.copy(matrix);
            }
          } else {
            // Fallback: use current matrix if decomposition failed
            if (!state.smoothedMatrix) {
              state.smoothedMatrix = new Matrix4();
            }
            state.smoothedMatrix.copy(matrix);
          }
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
      
      // Validate smoothed result before using it - check for NaN or invalid values
      // This prevents glitches from propagating through the pipeline
      const validateMatrix = (m) => {
        if (!m || !m.elements) return false;
        for (let i = 0; i < 16; i++) {
          if (!isFinite(m.elements[i]) || isNaN(m.elements[i])) {
            return false;
          }
        }
        return true;
      };

      // If previous frame was skipped, we need to be careful about velocity calculation
      // Use smoothedMatrix instead of previousMatrix for velocity to avoid jumps
      const velocityReferenceMatrix = state.lastWasSkipped && state.smoothedMatrix 
        ? state.smoothedMatrix 
        : state.previousMatrix;
      
      // Calculate velocity using the appropriate reference
      const motion = this._calculateVelocity(matrix, velocityReferenceMatrix, deltaTime);
      
      // Calculate acceleration (change in velocity)
      if (deltaTime > 0 && state.previousVelocity) {
        state.acceleration.subVectors(motion.linear, state.previousVelocity);
        state.acceleration.multiplyScalar(1000 / deltaTime); // convert to units per second² (unit-agnostic)
        
        // Track acceleration magnitude for relative thresholds
        const accelMagnitude = state.acceleration.length();
        state.accelerationMagnitudeHistory.push(accelMagnitude);
        // Maintain history size (same as velocity history)
        if (state.accelerationMagnitudeHistory.length > this.config.outlierHistorySize) {
          state.accelerationMagnitudeHistory.shift();
        }
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
      
      // Track velocity magnitude for relative thresholds
      const velocityMagnitude = state.velocity.length();
      state.velocityMagnitudeHistory.push(velocityMagnitude);
      // Maintain history size
      if (state.velocityMagnitudeHistory.length > this.config.outlierHistorySize) {
        state.velocityMagnitudeHistory.shift();
      }
      
      // Store current velocity for next frame's acceleration calculation
      state.previousVelocity.copy(motion.linear);
      state.previousAngularVelocity.copy(motion.angular);
      
      // Update current velocity
      state.velocity.copy(motion.linear);
      state.angularVelocity.copy(motion.angular);

      // Apply smoothing (only if we have a previous matrix to smooth against)
      // If previous frame was skipped, smooth from smoothedMatrix instead of previousMatrix
      // to avoid jumps caused by the rejected outlier frame
      const smoothingReferenceMatrix = state.lastWasSkipped && state.smoothedMatrix 
        ? state.smoothedMatrix 
        : state.previousMatrix;
      
      if (smoothingReferenceMatrix) {
        const smoothedResult = this._applySmoothing(matrix, smoothingReferenceMatrix, state, deltaTime);
        // Copy result to smoothedMatrix (reuse if it exists, otherwise create)
        if (smoothedResult && validateMatrix(smoothedResult)) {
          // Check for sudden jumps in smoothed result compared to previous smoothed matrix
          if (state.smoothedMatrix) {
            const prevSmoothedDecomp = this._decomposeMatrix(state.smoothedMatrix);
            const newSmoothedDecomp = this._decomposeMatrix(smoothedResult);
            
            if (prevSmoothedDecomp && newSmoothedDecomp && 
                prevSmoothedDecomp.position && newSmoothedDecomp.position &&
                prevSmoothedDecomp.rotation && newSmoothedDecomp.rotation) {
              const jumpDistance = prevSmoothedDecomp.position.distanceTo(newSmoothedDecomp.position);
              const jumpRotation = prevSmoothedDecomp.rotation.angleTo(newSmoothedDecomp.rotation);
              
              // If smoothed result has a large jump compared to previous smoothed position or rotation,
              // it might be introducing a glitch - apply additional smoothing
              // Use relative thresholds based on observed motion
              // Update position statistics if available
              if (state.positionDeltaHistory.length > 0) {
                this._updateStatistics(state.positionDeltaHistory, state.positionDeltaStats);
              }
              const baseThreshold = state.positionDeltaStats.mean > 0
                ? state.positionDeltaStats.mean * this.config.reattachmentDistanceMultiplier
                : jumpDistance * 1.2; // Fallback if no history
              
              const maxSmoothJump = state.lastWasSkipped 
                ? baseThreshold * 0.2  // Tighter threshold after skip (20% of relative threshold)
                : baseThreshold * 0.35; // Normal threshold (35% of relative threshold)
              const maxSmoothRotation = state.lastWasSkipped 
                ? 0.15  // ~8.6 degrees (tighter threshold after skip)
                : 0.25; // ~14.3 degrees (normal threshold)
              
              // Check both position and rotation jumps
              if (jumpDistance > maxSmoothJump || jumpRotation > maxSmoothRotation) {
                // Apply additional smoothing to prevent glitch
                // Use stronger smoothing if we just skipped a frame (increased smoothing)
                const antiGlitchSmoothing = state.lastWasSkipped ? 0.85 : 0.75;
                const smoothedPos = new Vector3().lerpVectors(
                  prevSmoothedDecomp.position,
                  newSmoothedDecomp.position,
                  1 - antiGlitchSmoothing
                );
                const smoothedRot = new Quaternion().slerpQuaternions(
                  prevSmoothedDecomp.rotation,
                  newSmoothedDecomp.rotation,
                  1 - antiGlitchSmoothing
                );
                const smoothedScale = new Vector3().lerpVectors(
                  prevSmoothedDecomp.scale,
                  newSmoothedDecomp.scale,
                  1 - antiGlitchSmoothing
                );
                
                // Validate before composing
                if (smoothedPos && smoothedRot && smoothedScale) {
                  if (!state.smoothedMatrix) {
                    state.smoothedMatrix = new Matrix4();
                  }
                  const composed = this._composeMatrix(smoothedPos, smoothedRot, smoothedScale);
                  if (composed) {
                    state.smoothedMatrix.copy(composed);
                  } else {
                    // Fallback to smoothed result if composition failed
                    state.smoothedMatrix.copy(smoothedResult);
                  }
                } else {
                  // Fallback to smoothed result if validation failed
                  state.smoothedMatrix.copy(smoothedResult);
                }
              } else {
                // Normal case - use smoothed result
                if (!state.smoothedMatrix) {
                  state.smoothedMatrix = new Matrix4();
                }
                state.smoothedMatrix.copy(smoothedResult);
              }
            } else {
              // Decomposition failed - use smoothed result
              if (!state.smoothedMatrix) {
                state.smoothedMatrix = new Matrix4();
              }
              state.smoothedMatrix.copy(smoothedResult);
            }
          } else {
            // First smoothed matrix
            if (!state.smoothedMatrix) {
              state.smoothedMatrix = new Matrix4();
            }
            state.smoothedMatrix.copy(smoothedResult);
          }
        } else {
          // Fallback if smoothing failed or result is invalid
          if (!state.smoothedMatrix) {
            state.smoothedMatrix = new Matrix4();
          }
          // Use previous smoothed matrix if available, otherwise use raw matrix
          if (state.smoothedMatrix && validateMatrix(state.smoothedMatrix)) {
            // Keep previous smoothed matrix
          } else {
            state.smoothedMatrix.copy(matrix);
          }
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
    
    // Always log config changes (not just when debugMode is enabled)
    const changedKeys = Object.keys(newConfig).filter(key => 
      oldConfig[key] !== this.config[key]
    );
    
    if (changedKeys.length > 0) {
      const changes = changedKeys.reduce((acc, key) => {
        acc[key] = { from: oldConfig[key], to: this.config[key] };
        return acc;
      }, {});
      
      // Always log config changes
      console.log('[MindAR PostProcessor] Config updated at runtime:', changes);
      
      // Apply changes to all target states to ensure immediate effect
      this.targetStates.forEach((state, targetIndex) => {
        // Handle outlier history size changes
        if (newConfig.outlierHistorySize !== undefined) {
          const newSize = this.config.outlierHistorySize;
          // Trim history arrays if new size is smaller
          if (state.positionDeltaHistory.length > newSize) {
            state.positionDeltaHistory = state.positionDeltaHistory.slice(-newSize);
            state.rotationDeltaHistory = state.rotationDeltaHistory.slice(-newSize);
            state.scaleDeltaHistory = state.scaleDeltaHistory.slice(-newSize);
          }
        }
        
        // Handle smoothing window size changes
        if (newConfig.smoothingWindowSize !== undefined || 
            newConfig.minSmoothingWindowSize !== undefined || 
            newConfig.maxSmoothingWindowSize !== undefined) {
          // Calculate current adaptive window size
          const adaptiveWindowSize = this._calculateAdaptiveWindowSize(state, 16.67);
          // Trim multi-frame smoothing history if needed
          if (state.smoothedPositionHistory.length > adaptiveWindowSize) {
            state.smoothedPositionHistory = state.smoothedPositionHistory.slice(-adaptiveWindowSize);
            state.smoothedRotationHistory = state.smoothedRotationHistory.slice(-adaptiveWindowSize);
            state.smoothedScaleHistory = state.smoothedScaleHistory.slice(-adaptiveWindowSize);
          }
        }
        
        // Reset adaptive smoothing factors when smoothing config changes
        if (newConfig.minSmoothingFactor !== undefined || newConfig.maxSmoothingFactor !== undefined) {
          // Reset to midpoint of new range
          state.currentSmoothingFactor = (this.config.minSmoothingFactor + this.config.maxSmoothingFactor) / 2;
        }
        
        // Clear multi-frame history when multi-frame smoothing is disabled or config changes significantly
        if (newConfig.multiFrameSmoothing !== undefined && !this.config.multiFrameSmoothing) {
          this._clearMultiFrameHistory(state);
        }
        
        // Reset prediction state when prediction config changes
        if (newConfig.predictionEnabled !== undefined && !this.config.predictionEnabled) {
          state.predictionStartTime = null;
          state.predictionConfidence = 0;
        }
        
        // Reset state machine confidence thresholds when they change
        if (newConfig.foundConfidenceThreshold !== undefined || 
            newConfig.lostConfidenceThreshold !== undefined ||
            newConfig.stateTransitionFrames !== undefined) {
          // State machine will use new thresholds on next update
          // No immediate reset needed, but we could reset state if desired
        }
        
        // Log detailed changes per target if debug mode is enabled
        if (this.config.debugMode) {
          this._logDebug(targetIndex, state, 'CONFIG_CHANGED', {
            changedKeys,
            changes
          });
        }
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


