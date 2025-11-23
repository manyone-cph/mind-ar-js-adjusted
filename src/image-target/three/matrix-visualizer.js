import { Vector3, Quaternion } from "three";

/**
 * Visualization system for comparing raw vs post-processed tracking data
 * Displays an SVG graph showing position/rotation over time
 */
export class MatrixVisualizer {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled ?? false,
      debug: config.debug ?? false, // If true, collect data but don't render
      historyDuration: config.historyDuration ?? 5000, // 5 seconds in ms
      maxPoints: config.maxPoints ?? 300, // points along x-axis
      height: config.height ?? 150, // graph height in pixels
      position: config.position ?? 'bottom', // 'bottom' or 'top'
    };

    this.dataHistory = new Map(); // targetIndex -> history array
    this.container = null;
    this.svg = null;
    this.isInitialized = false;
    
    // Throttle rendering to avoid excessive DOM manipulation
    this.lastRenderTime = 0;
    this.renderThrottle = 100; // ms - render at most 10 times per second
    this.pendingRender = false;
  }

  /**
   * Initialize the visualization DOM elements
   */
  initialize(container) {
    // In debug mode, we don't render, just collect data
    if (this.config.debug) {
      this.container = container;
      this.isInitialized = true;
      return;
    }
    if (!this.config.enabled || this.isInitialized) return;
    
    this.container = container;
    
    // Create SVG container
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.style.cssText = `
      position: fixed;
      ${this.config.position}: 0;
      left: 0;
      width: 100%;
      height: ${this.config.height}px;
      background: rgba(0, 0, 0, 0.8);
      z-index: 10000;
      pointer-events: none;
      font-family: monospace;
      font-size: 10px;
    `;
    
    // Create style element for CSS
    const style = document.createElement('style');
    style.textContent = `
      .mindar-visualizer-line { stroke-width: 1.5; fill: none; }
      .mindar-visualizer-raw-pos { stroke: #ff6b6b; }
      .mindar-visualizer-processed-pos { stroke: #51cf66; }
      .mindar-visualizer-raw-rot { stroke: #4dabf7; }
      .mindar-visualizer-processed-rot { stroke: #ffd43b; }
      .mindar-visualizer-raw-scale { stroke: #ff922b; }
      .mindar-visualizer-processed-scale { stroke: #845ef7; }
      .mindar-visualizer-skipped { stroke: #ff8787; opacity: 0.7; }
      .mindar-visualizer-grid { stroke: #495057; stroke-width: 0.5; opacity: 0.3; }
      .mindar-visualizer-label { fill: #fff; font-size: 10px; }
    `;
    document.head.appendChild(style);
    
    // Create groups for different elements
    this.gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.gridGroup.setAttribute('class', 'mindar-visualizer-grid');
    this.svg.appendChild(this.gridGroup);
    
    this.dataGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.svg.appendChild(this.dataGroup);
    
    this.labelsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.labelsGroup.setAttribute('class', 'mindar-visualizer-label');
    this.svg.appendChild(this.labelsGroup);
    
    document.body.appendChild(this.svg);
    this.isInitialized = true;
    
    // Handle window resize
    this.resizeHandler = () => this.render();
    window.addEventListener('resize', this.resizeHandler);
    
    // Initial render
    this.render();
  }

  /**
   * Add a data point for a target
   */
  addDataPoint(targetIndex, rawMatrix, processedMatrix, wasSkipped = false, timestamp = null) {
    // In debug mode, collect data but don't render
    if (this.config.debug) {
      if (!this.isInitialized) {
        this.isInitialized = true;
      }
    } else {
      if (!this.config.enabled || !this.isInitialized) return;
    }
    
    if (!this.dataHistory.has(targetIndex)) {
      this.dataHistory.set(targetIndex, []);
    }
    
    const history = this.dataHistory.get(targetIndex);
    const now = timestamp || performance.now();
    
    // Extract position and rotation from matrices
    const rawData = this._extractData(rawMatrix);
    const processedData = rawMatrix && processedMatrix ? this._extractData(processedMatrix) : null;
    
    history.push({
      timestamp: now,
      raw: rawData,
      processed: processedData,
      skipped: wasSkipped
    });
    
    // Remove old data points
    const cutoff = now - this.config.historyDuration;
    let removeCount = 0;
    while (removeCount < history.length && history[removeCount].timestamp < cutoff) {
      removeCount++;
    }
    if (removeCount > 0) {
      history.splice(0, removeCount);
    }
    
    // Limit to maxPoints
    if (history.length > this.config.maxPoints) {
      history.splice(0, history.length - this.config.maxPoints);
    }
    
    // Only schedule render if not in debug mode
    if (!this.config.debug) {
      this._scheduleRender();
    }
  }

  /**
   * Schedule a render (throttled)
   */
  _scheduleRender() {
    const now = performance.now();
    if (now - this.lastRenderTime >= this.renderThrottle) {
      this.render();
      this.lastRenderTime = now;
      this.pendingRender = false;
    } else if (!this.pendingRender) {
      this.pendingRender = true;
      const delay = this.renderThrottle - (now - this.lastRenderTime);
      setTimeout(() => {
        if (this.pendingRender) {
          this.render();
          this.lastRenderTime = performance.now();
          this.pendingRender = false;
        }
      }, delay);
    }
  }

  /**
   * Extract position, rotation, and scale data from a matrix
   */
  _extractData(matrix) {
    if (!matrix) return null;
    
    try {
      const pos = new Vector3();
      const rot = new Quaternion();
      const scale = new Vector3();
      matrix.decompose(pos, rot, scale);
      
      // Calculate rotation as a single angle (magnitude of rotation)
      // For a unit quaternion (w, x, y, z), the rotation angle is: 2 * acos(|w|)
      // We use Math.abs to handle both positive and negative quaternions (they represent the same rotation)
      const rotationAngle = 2 * Math.acos(Math.abs(Math.max(-1, Math.min(1, rot.w))));
      
      // Calculate position magnitude (distance from origin)
      const positionMagnitude = pos.length();
      
      // Calculate scale magnitude (average of x, y, z components)
      const scaleMagnitude = (scale.x + scale.y + scale.z) / 3;
      
      return {
        position: positionMagnitude,
        rotation: rotationAngle,
        scale: scaleMagnitude
      };
    } catch (e) {
      // If decomposition fails, return null
      return null;
    }
  }

  /**
   * Render the graph
   */
  render() {
    if (!this.isInitialized || this.dataHistory.size === 0) return;
    
    const width = this.svg.clientWidth || window.innerWidth;
    const height = this.config.height;
    this.svg.setAttribute('width', width);
    this.svg.setAttribute('height', height);
    
    // Clear previous render
    while (this.dataGroup.firstChild) {
      this.dataGroup.removeChild(this.dataGroup.firstChild);
    }
    while (this.labelsGroup.firstChild) {
      this.labelsGroup.removeChild(this.labelsGroup.firstChild);
    }
    while (this.gridGroup.firstChild) {
      this.gridGroup.removeChild(this.gridGroup.firstChild);
    }
    
    // Draw grid
    this._drawGrid(width, height);
    
    // Draw data for each target (for now, just show first target)
    const targetIndices = Array.from(this.dataHistory.keys());
    if (targetIndices.length > 0) {
      const targetIndex = targetIndices[0]; // Show first target
      const history = this.dataHistory.get(targetIndex);
      
      if (history.length > 1) {
        this._drawData(history, width, height, targetIndex);
        this._drawLabels(width, height, history);
      }
    }
  }

  /**
   * Draw grid lines
   */
  _drawGrid(width, height) {
    // Horizontal grid lines (5 lines)
    for (let i = 0; i <= 5; i++) {
      const y = (height / 5) * i;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '0');
      line.setAttribute('y1', y);
      line.setAttribute('x2', width);
      line.setAttribute('y2', y);
      this.gridGroup.appendChild(line);
    }
    
    // Vertical grid lines (10 lines)
    for (let i = 0; i <= 10; i++) {
      const x = (width / 10) * i;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x);
      line.setAttribute('y1', '0');
      line.setAttribute('x2', x);
      line.setAttribute('y2', height);
      this.gridGroup.appendChild(line);
    }
  }

  /**
   * Draw data lines
   */
  _drawData(history, width, height) {
    if (history.length < 2) return;
    
    const now = performance.now();
    const timeRange = this.config.historyDuration;
    const padding = 20;
    const graphHeight = height - padding * 2;
    const graphWidth = width - padding * 2;
    
    // Find min/max values for scaling
    let minPos = Infinity, maxPos = -Infinity;
    let minRot = Infinity, maxRot = -Infinity;
    let minScale = Infinity, maxScale = -Infinity;
    
    history.forEach(point => {
      if (point.raw) {
        minPos = Math.min(minPos, point.raw.position);
        maxPos = Math.max(maxPos, point.raw.position);
        minRot = Math.min(minRot, point.raw.rotation);
        maxRot = Math.max(maxRot, point.raw.rotation);
        if (point.raw.scale !== undefined && point.raw.scale !== null) {
          minScale = Math.min(minScale, point.raw.scale);
          maxScale = Math.max(maxScale, point.raw.scale);
        }
      }
      if (point.processed) {
        minPos = Math.min(minPos, point.processed.position);
        maxPos = Math.max(maxPos, point.processed.position);
        minRot = Math.min(minRot, point.processed.rotation);
        maxRot = Math.max(maxRot, point.processed.rotation);
        if (point.processed.scale !== undefined && point.processed.scale !== null) {
          minScale = Math.min(minScale, point.processed.scale);
          maxScale = Math.max(maxScale, point.processed.scale);
        }
      }
    });
    
    // Add padding to ranges
    let posRange = maxPos - minPos;
    let rotRange = maxRot - minRot;
    let scaleRange = maxScale - minScale;
    if (posRange === 0) {
      minPos -= 0.1;
      maxPos += 0.1;
      posRange = 0.2;
    }
    if (rotRange === 0) {
      minRot -= 0.1;
      maxRot += 0.1;
      rotRange = 0.2;
    }
    if (scaleRange === 0) {
      minScale -= 0.1;
      maxScale += 0.1;
      scaleRange = 0.2;
    }
    minPos -= posRange * 0.1;
    maxPos += posRange * 0.1;
    minRot -= rotRange * 0.1;
    maxRot += rotRange * 0.1;
    minScale -= scaleRange * 0.1;
    maxScale += scaleRange * 0.1;
    
    // Draw position lines (upper third)
    const posYOffset = padding;
    const posHeight = graphHeight / 3;
    this._drawLine(history, width, posYOffset, posHeight, graphWidth, timeRange, now, 
      (p) => p.raw?.position, (p) => p.processed?.position,
      minPos, maxPos, 'raw-pos', 'processed-pos');
    
    // Draw rotation lines (middle third)
    const rotYOffset = padding + posHeight;
    const rotHeight = graphHeight / 3;
    this._drawLine(history, width, rotYOffset, rotHeight, graphWidth, timeRange, now,
      (p) => p.raw?.rotation, (p) => p.processed?.rotation,
      minRot, maxRot, 'raw-rot', 'processed-rot');
    
    // Draw scale lines (lower third)
    const scaleYOffset = padding + posHeight + rotHeight;
    const scaleHeight = graphHeight / 3;
    this._drawLine(history, width, scaleYOffset, scaleHeight, graphWidth, timeRange, now,
      (p) => p.raw?.scale, (p) => p.processed?.scale,
      minScale, maxScale, 'raw-scale', 'processed-scale');
    
    // Draw skipped markers
    this._drawSkippedMarkers(history, width, posYOffset, posHeight, rotYOffset, rotHeight, 
      scaleYOffset, scaleHeight, graphWidth, timeRange, now, minPos, maxPos, minRot, maxRot, minScale, maxScale);
  }

  /**
   * Draw a single line (position or rotation)
   */
  _drawLine(history, width, yOffset, height, graphWidth, timeRange, now, 
            rawGetter, processedGetter, minVal, maxVal, rawClass, processedClass) {
    const valRange = maxVal - minVal;
    if (valRange === 0) {
      return;
    }
    
    // Raw line
    const rawPath = this._createPath(history, width, yOffset, height, graphWidth, timeRange, now, 
      rawGetter, minVal, valRange);
    if (rawPath) {
      const rawLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      rawLine.setAttribute('d', rawPath);
      rawLine.setAttribute('class', `mindar-visualizer-line mindar-visualizer-${rawClass}`);
      this.dataGroup.appendChild(rawLine);
    }
    
    // Processed line
    const processedPath = this._createPath(history, width, yOffset, height, graphWidth, timeRange, now,
      processedGetter, minVal, valRange);
    if (processedPath) {
      const processedLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      processedLine.setAttribute('d', processedPath);
      processedLine.setAttribute('class', `mindar-visualizer-line mindar-visualizer-${processedClass}`);
      this.dataGroup.appendChild(processedLine);
    }
  }

  /**
   * Create SVG path string from history
   */
  _createPath(history, width, yOffset, height, graphWidth, timeRange, now, 
              valueGetter, minVal, valRange) {
    const padding = 20;
    let path = '';
    let firstPoint = true;
    
    for (let i = 0; i < history.length; i++) {
      const point = history[i];
      const value = valueGetter(point);
      
      if (value === null || value === undefined) continue;
      
      const x = padding + ((now - point.timestamp) / timeRange) * graphWidth;
      const y = yOffset + height - ((value - minVal) / valRange) * height;
      
      if (firstPoint) {
        path += `M ${x} ${y}`;
        firstPoint = false;
      } else {
        path += ` L ${x} ${y}`;
      }
    }
    
    return path.length > 0 ? path : null;
  }

  /**
   * Draw markers for skipped frames
   */
  _drawSkippedMarkers(history, width, posYOffset, posHeight, rotYOffset, rotHeight,
                      scaleYOffset, scaleHeight, graphWidth, timeRange, now, minPos, maxPos, minRot, maxRot, minScale, maxScale) {
    const padding = 20;
    const posValRange = maxPos - minPos;
    const rotValRange = maxRot - minRot;
    const scaleValRange = maxScale - minScale;
    if (posValRange === 0 || rotValRange === 0 || scaleValRange === 0) {
      return;
    }
    
    // Calculate proportional stroke width based on graph width
    // Aim for approximately 0.1% of graph width, with a minimum of 0.5px and maximum of 2px
    // This makes the line thin but visible, proportional to the graph size
    const strokeWidth = Math.max(0.5, Math.min(2, graphWidth * 0.001));
    
    history.forEach(point => {
      if (point.skipped && point.raw) {
        const x = padding + ((now - point.timestamp) / timeRange) * graphWidth;
        
        // Position marker (upper third)
        const posMarker = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        posMarker.setAttribute('x1', x);
        posMarker.setAttribute('y1', posYOffset);
        posMarker.setAttribute('x2', x);
        posMarker.setAttribute('y2', posYOffset + posHeight);
        posMarker.setAttribute('class', 'mindar-visualizer-skipped');
        posMarker.setAttribute('stroke-width', strokeWidth);
        this.dataGroup.appendChild(posMarker);
        
        // Rotation marker (middle third)
        const rotMarker = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        rotMarker.setAttribute('x1', x);
        rotMarker.setAttribute('y1', rotYOffset);
        rotMarker.setAttribute('x2', x);
        rotMarker.setAttribute('y2', rotYOffset + rotHeight);
        rotMarker.setAttribute('class', 'mindar-visualizer-skipped');
        rotMarker.setAttribute('stroke-width', strokeWidth);
        this.dataGroup.appendChild(rotMarker);
        
        // Scale marker (lower third)
        const scaleMarker = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        scaleMarker.setAttribute('x1', x);
        scaleMarker.setAttribute('y1', scaleYOffset);
        scaleMarker.setAttribute('x2', x);
        scaleMarker.setAttribute('y2', scaleYOffset + scaleHeight);
        scaleMarker.setAttribute('class', 'mindar-visualizer-skipped');
        scaleMarker.setAttribute('stroke-width', strokeWidth);
        this.dataGroup.appendChild(scaleMarker);
      }
    });
  }

  /**
   * Draw labels
   */
  _drawLabels(width, height, history) {
    if (history.length === 0) return;
    
    const padding = 20;
    const graphHeight = height - padding * 2;
    const sectionHeight = graphHeight / 3;
    
    // Position label (upper third)
    const posLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    posLabel.setAttribute('x', padding);
    posLabel.setAttribute('y', padding + 15);
    posLabel.textContent = 'Position (m) - Red: Raw, Green: Processed';
    this.labelsGroup.appendChild(posLabel);
    
    // Rotation label (middle third)
    const rotLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    rotLabel.setAttribute('x', padding);
    rotLabel.setAttribute('y', padding + sectionHeight + 15);
    rotLabel.textContent = 'Rotation (rad) - Blue: Raw, Yellow: Processed';
    this.labelsGroup.appendChild(rotLabel);
    
    // Scale label (lower third)
    const scaleLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    scaleLabel.setAttribute('x', padding);
    scaleLabel.setAttribute('y', padding + sectionHeight * 2 + 15);
    scaleLabel.textContent = 'Scale - Orange: Raw, Purple: Processed';
    this.labelsGroup.appendChild(scaleLabel);
    
    // Time label
    const timeLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    timeLabel.setAttribute('x', width - padding - 100);
    timeLabel.setAttribute('y', height - padding);
    timeLabel.textContent = '5s ←';
    this.labelsGroup.appendChild(timeLabel);
  }

  /**
   * Clean up and remove visualization
   */
  destroy() {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    
    // Clear pending render timeout
    if (this.pendingRender) {
      this.pendingRender = false;
    }
    
    // Clear SVG groups properly
    if (this.dataGroup) {
      while (this.dataGroup.firstChild) {
        this.dataGroup.removeChild(this.dataGroup.firstChild);
      }
    }
    if (this.labelsGroup) {
      while (this.labelsGroup.firstChild) {
        this.labelsGroup.removeChild(this.labelsGroup.firstChild);
      }
    }
    if (this.gridGroup) {
      while (this.gridGroup.firstChild) {
        this.gridGroup.removeChild(this.gridGroup.firstChild);
      }
    }
    
    if (this.svg && this.svg.parentNode) {
      this.svg.parentNode.removeChild(this.svg);
    }
    
    this.dataHistory.clear();
    this.isInitialized = false;
    this.lastRenderTime = 0;
  }

  /**
   * Enable/disable visualization
   */
  setEnabled(enabled) {
    this.config.enabled = enabled;
    if (!enabled && this.isInitialized && !this.config.debug) {
      this.destroy();
    } else if (enabled && !this.isInitialized && this.container && !this.config.debug) {
      this.initialize(this.container);
    }
  }

  /**
   * Get graph data for external visualization
   * Returns a copy of the data history
   */
  getGraphData() {
    const result = new Map();
    for (const [targetIndex, history] of this.dataHistory.entries()) {
      result.set(targetIndex, [...history]);
    }
    return result;
  }

  /**
   * Get configuration
   */
  getConfig() {
    return { ...this.config };
  }
}

