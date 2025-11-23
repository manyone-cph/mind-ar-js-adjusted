import { Matrix4 } from "three";
import { cssScaleDownMatrix, invisibleMatrix } from "./matrix-utils.js";
import { MatrixPostProcessor } from "./matrix-post-processor.js";
import { MatrixVisualizer } from "./matrix-visualizer.js";

export class MatrixUpdater {
  constructor(anchors, postMatrixs, postProcessorConfig = null, visualizerConfig = null) {
    this.anchors = anchors;
    this.postMatrixs = postMatrixs;
    
    // Initialize post-processor if enabled
    // null = disabled, {} = enabled with defaults, or custom config object
    this.postProcessor = postProcessorConfig !== null 
      ? new MatrixPostProcessor(postProcessorConfig)
      : null;
    
    // Initialize visualizer if enabled
    this.visualizer = visualizerConfig !== null
      ? new MatrixVisualizer(visualizerConfig)
      : null;
    
    // Store raw matrices for visualization
    this.rawMatrices = new Map(); // targetIndex -> raw matrix
  }

  updateMatrix(targetIndex, worldMatrix) {
    // Store raw matrix for visualization
    let rawMatrix = null;
    if (this.visualizer && worldMatrix) {
      rawMatrix = new Matrix4();
      rawMatrix.elements = worldMatrix.slice();
      this.rawMatrices.set(targetIndex, rawMatrix);
    }
    
    // Track if this frame was skipped (outlier)
    let wasSkipped = false;
    
    // Apply post-processing if enabled
    let processedMatrix = worldMatrix;
    if (this.postProcessor) {
      processedMatrix = this.postProcessor.process(targetIndex, worldMatrix);
      
      // Check if frame was skipped by checking post-processor state
      const state = this.postProcessor._getTargetState(targetIndex);
      wasSkipped = state.lastWasSkipped;
    }
    
    // Add to visualizer if enabled
    if (this.visualizer) {
      const processedM = processedMatrix ? (() => {
        const m = new Matrix4();
        m.elements = processedMatrix.slice();
        return m;
      })() : null;
      this.visualizer.addDataPoint(targetIndex, rawMatrix, processedM, wasSkipped);
    }

    for (let i = 0; i < this.anchors.length; i++) {
      if (this.anchors[i].targetIndex === targetIndex) {
        // Determine visibility based on processed matrix
        const isVisible = processedMatrix !== null;
        
        if (this.anchors[i].css) {
          this.anchors[i].group.children.forEach((obj) => {
            obj.element.style.visibility = isVisible ? "visible" : "hidden";
          });
        } else {
          this.anchors[i].group.visible = isVisible;
        }

        if (isVisible) {
          let m = this.anchors[i]._tempMatrix || new Matrix4();
          m.elements = processedMatrix.slice();
          m.multiply(this.postMatrixs[targetIndex]);
          if (this.anchors[i].css) {
            m.multiply(cssScaleDownMatrix);
          }
          this.anchors[i].group.matrix = m;
          this.anchors[i]._tempMatrix = m;
        } else {
          this.anchors[i].group.matrix = invisibleMatrix;
        }

        // Track visibility changes for callbacks
        if (this.anchors[i].visible && !isVisible) {
          this.anchors[i].visible = false;
          if (this.anchors[i].onTargetLost) {
            this.anchors[i].onTargetLost();
          }
        }

        if (!this.anchors[i].visible && isVisible) {
          this.anchors[i].visible = true;
          if (this.anchors[i].onTargetFound) {
            this.anchors[i].onTargetFound();
          }
        }

        if (this.anchors[i].onTargetUpdate) {
          this.anchors[i].onTargetUpdate();
        }
      }
    }
  }

  hasAnyVisible() {
    return this.anchors.reduce((acc, anchor) => {
      return acc || anchor.visible;
    }, false);
  }

  /**
   * Update post-processor configuration
   */
  updatePostProcessorConfig(config) {
    if (this.postProcessor) {
      this.postProcessor.updateConfig(config);
    } else {
      console.warn('[MatrixUpdater] postProcessor not available when trying to update config');
    }
  }

  /**
   * Reset post-processor state for a specific target
   */
  resetPostProcessorTarget(targetIndex) {
    if (this.postProcessor) {
      this.postProcessor.resetTarget(targetIndex);
    }
  }

  /**
   * Get post-processor state info for debugging
   */
  getPostProcessorStateInfo(targetIndex) {
    if (this.postProcessor) {
      return this.postProcessor.getStateInfo(targetIndex);
    }
    return null;
  }

  /**
   * Initialize visualizer with container
   */
  initializeVisualizer(container) {
    if (this.visualizer) {
      this.visualizer.initialize(container);
    }
  }

  /**
   * Enable/disable visualizer
   */
  setVisualizerEnabled(enabled) {
    if (this.visualizer) {
      this.visualizer.setEnabled(enabled);
    }
  }
}

