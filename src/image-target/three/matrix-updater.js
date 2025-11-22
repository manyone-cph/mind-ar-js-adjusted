import { Matrix4 } from "three";
import { cssScaleDownMatrix, invisibleMatrix } from "./matrix-utils.js";

export class MatrixUpdater {
  constructor(anchors, postMatrixs) {
    this.anchors = anchors;
    this.postMatrixs = postMatrixs;
  }

  updateMatrix(targetIndex, worldMatrix) {
    for (let i = 0; i < this.anchors.length; i++) {
      if (this.anchors[i].targetIndex === targetIndex) {
        if (this.anchors[i].css) {
          this.anchors[i].group.children.forEach((obj) => {
            obj.element.style.visibility = worldMatrix === null ? "hidden" : "visible";
          });
        } else {
          this.anchors[i].group.visible = worldMatrix !== null;
        }

        if (worldMatrix !== null) {
          let m = new Matrix4();
          m.elements = [...worldMatrix];
          m.multiply(this.postMatrixs[targetIndex]);
          if (this.anchors[i].css) {
            m.multiply(cssScaleDownMatrix);
          }
          this.anchors[i].group.matrix = m;
        } else {
          this.anchors[i].group.matrix = invisibleMatrix;
        }

        if (this.anchors[i].visible && worldMatrix === null) {
          this.anchors[i].visible = false;
          if (this.anchors[i].onTargetLost) {
            this.anchors[i].onTargetLost();
          }
        }

        if (!this.anchors[i].visible && worldMatrix !== null) {
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
}

