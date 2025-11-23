import { PROJECTION_NEAR, PROJECTION_FAR, PROJECTION_FOVY } from '../config/defaults.js';

export function createProjectionTransform(inputWidth, inputHeight) {
  const f = (inputHeight / 2) / Math.tan(PROJECTION_FOVY / 2);
  return [
    [f, 0, inputWidth / 2],
    [0, f, inputHeight / 2],
    [0, 0, 1]
  ];
}

export function createProjectionMatrix({projectionTransform, width, height, near = PROJECTION_NEAR, far = PROJECTION_FAR}) {
  const proj = [
    [2 * projectionTransform[0][0] / width, 0, -(2 * projectionTransform[0][2] / width - 1), 0],
    [0, 2 * projectionTransform[1][1] / height, -(2 * projectionTransform[1][2] / height - 1), 0],
    [0, 0, -(far + near) / (far - near), -2 * far * near / (far - near)],
    [0, 0, -1, 0]
  ];
  const projMatrix = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      projMatrix.push(proj[j][i]);
    }
  }
  return projMatrix;
}

