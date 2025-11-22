export class MatrixUpdater {
  constructor(anchors, faceMeshes, controller) {
    this.anchors = anchors;
    this.faceMeshes = faceMeshes;
    this.controller = controller;
  }

  update(hasFace, estimateResult) {
    // Update anchor visibility
    for (let i = 0; i < this.anchors.length; i++) {
      if (this.anchors[i].css) {
        this.anchors[i].group.children.forEach((obj) => {
          obj.element.style.visibility = hasFace ? "visible" : "hidden";
        });
      } else {
        this.anchors[i].group.visible = hasFace;
      }
    }

    // Update face mesh visibility
    for (let i = 0; i < this.faceMeshes.length; i++) {
      this.faceMeshes[i].visible = hasFace;
    }

    if (hasFace) {
      const { metricLandmarks, faceMatrix, faceScale, blendshapes } = estimateResult;

      // Update anchor matrices
      for (let i = 0; i < this.anchors.length; i++) {
        const landmarkIndex = this.anchors[i].landmarkIndex;
        const landmarkMatrix = this.controller.getLandmarkMatrix(landmarkIndex);

        if (this.anchors[i].css) {
          const cssScale = 0.001;
          const scaledElements = [
            cssScale * landmarkMatrix[0], cssScale * landmarkMatrix[1], landmarkMatrix[2], landmarkMatrix[3],
            cssScale * landmarkMatrix[4], cssScale * landmarkMatrix[5], landmarkMatrix[6], landmarkMatrix[7],
            cssScale * landmarkMatrix[8], cssScale * landmarkMatrix[9], landmarkMatrix[10], landmarkMatrix[11],
            cssScale * landmarkMatrix[12], cssScale * landmarkMatrix[13], landmarkMatrix[14], landmarkMatrix[15]
          ];
          this.anchors[i].group.matrix.set(...scaledElements);
        } else {
          this.anchors[i].group.matrix.set(...landmarkMatrix);
        }
      }

      // Update face mesh matrices
      for (let i = 0; i < this.faceMeshes.length; i++) {
        this.faceMeshes[i].matrix.set(...faceMatrix);
      }
    }
  }
}

