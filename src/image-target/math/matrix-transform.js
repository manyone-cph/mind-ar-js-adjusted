export function getRotatedZ90Matrix(m) {
  const rotatedMatrix = [
    -m[1], m[0], m[2], m[3],
    -m[5], m[4], m[6], m[7],
    -m[9], m[8], m[10], m[11],
    -m[13], m[12], m[14], m[15]
  ];
  return rotatedMatrix;
}

export function glModelViewMatrix(modelViewTransform, targetHeight) {
  const openGLWorldMatrix = [
    modelViewTransform[0][0], -modelViewTransform[1][0], -modelViewTransform[2][0], 0,
    -modelViewTransform[0][1], modelViewTransform[1][1], modelViewTransform[2][1], 0,
    -modelViewTransform[0][2], modelViewTransform[1][2], modelViewTransform[2][2], 0,
    modelViewTransform[0][1] * targetHeight + modelViewTransform[0][3], 
    -(modelViewTransform[1][1] * targetHeight + modelViewTransform[1][3]), 
    -(modelViewTransform[2][1] * targetHeight + modelViewTransform[2][3]), 
    1
  ];
  return openGLWorldMatrix;
}

export function buildModelViewProjectionTransform(projectionTransform, modelViewTransform) {
  const modelViewProjectionTransform = [
    [
      projectionTransform[0][0] * modelViewTransform[0][0] + projectionTransform[0][2] * modelViewTransform[2][0],
      projectionTransform[0][0] * modelViewTransform[0][1] + projectionTransform[0][2] * modelViewTransform[2][1],
      projectionTransform[0][0] * modelViewTransform[0][2] + projectionTransform[0][2] * modelViewTransform[2][2],
      projectionTransform[0][0] * modelViewTransform[0][3] + projectionTransform[0][2] * modelViewTransform[2][3],
    ],
    [
      projectionTransform[1][1] * modelViewTransform[1][0] + projectionTransform[1][2] * modelViewTransform[2][0],
      projectionTransform[1][1] * modelViewTransform[1][1] + projectionTransform[1][2] * modelViewTransform[2][1],
      projectionTransform[1][1] * modelViewTransform[1][2] + projectionTransform[1][2] * modelViewTransform[2][2],
      projectionTransform[1][1] * modelViewTransform[1][3] + projectionTransform[1][2] * modelViewTransform[2][3],
    ],
    [
      modelViewTransform[2][0],
      modelViewTransform[2][1],
      modelViewTransform[2][2],
      modelViewTransform[2][3],
    ]
  ];
  return modelViewProjectionTransform;
}

export function applyModelViewProjectionTransform(modelViewProjectionTransform, x, y, z) {
  const ux = modelViewProjectionTransform[0][0] * x + modelViewProjectionTransform[0][1] * y + modelViewProjectionTransform[0][3];
  const uy = modelViewProjectionTransform[1][0] * x + modelViewProjectionTransform[1][1] * y + modelViewProjectionTransform[1][3];
  const uz = modelViewProjectionTransform[2][0] * x + modelViewProjectionTransform[2][1] * y + modelViewProjectionTransform[2][3];
  return {x: ux, y: uy, z: uz};
}

export function computeScreenCoordinate(modelViewProjectionTransform, x, y, z) {
  const {x: ux, y: uy, z: uz} = applyModelViewProjectionTransform(modelViewProjectionTransform, x, y, z);
  return {x: ux/uz, y: uy/uz};
}

