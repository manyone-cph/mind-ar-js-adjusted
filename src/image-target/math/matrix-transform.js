// Cache for rotated matrix to avoid allocations (thread-safe per call)
let _cachedRotatedMatrix = null;

export function getRotatedZ90Matrix(m) {
  // Reuse cached array if available, otherwise create new
  if (!_cachedRotatedMatrix) {
    _cachedRotatedMatrix = new Array(16);
  }
  
  // Update in place
  _cachedRotatedMatrix[0] = -m[1];
  _cachedRotatedMatrix[1] = m[0];
  _cachedRotatedMatrix[2] = m[2];
  _cachedRotatedMatrix[3] = m[3];
  _cachedRotatedMatrix[4] = -m[5];
  _cachedRotatedMatrix[5] = m[4];
  _cachedRotatedMatrix[6] = m[6];
  _cachedRotatedMatrix[7] = m[7];
  _cachedRotatedMatrix[8] = -m[9];
  _cachedRotatedMatrix[9] = m[8];
  _cachedRotatedMatrix[10] = m[10];
  _cachedRotatedMatrix[11] = m[11];
  _cachedRotatedMatrix[12] = -m[13];
  _cachedRotatedMatrix[13] = m[12];
  _cachedRotatedMatrix[14] = m[14];
  _cachedRotatedMatrix[15] = m[15];
  
  return _cachedRotatedMatrix;
}

// Cache for world matrix to avoid allocations (thread-safe per call)
let _cachedWorldMatrix = null;

export function glModelViewMatrix(modelViewTransform, targetHeight) {
  // Reuse cached array if available, otherwise create new
  if (!_cachedWorldMatrix) {
    _cachedWorldMatrix = new Array(16);
  }
  
  // Update in place
  _cachedWorldMatrix[0] = modelViewTransform[0][0];
  _cachedWorldMatrix[1] = -modelViewTransform[1][0];
  _cachedWorldMatrix[2] = -modelViewTransform[2][0];
  _cachedWorldMatrix[3] = 0;
  _cachedWorldMatrix[4] = -modelViewTransform[0][1];
  _cachedWorldMatrix[5] = modelViewTransform[1][1];
  _cachedWorldMatrix[6] = modelViewTransform[2][1];
  _cachedWorldMatrix[7] = 0;
  _cachedWorldMatrix[8] = -modelViewTransform[0][2];
  _cachedWorldMatrix[9] = modelViewTransform[1][2];
  _cachedWorldMatrix[10] = modelViewTransform[2][2];
  _cachedWorldMatrix[11] = 0;
  _cachedWorldMatrix[12] = modelViewTransform[0][1] * targetHeight + modelViewTransform[0][3];
  _cachedWorldMatrix[13] = -(modelViewTransform[1][1] * targetHeight + modelViewTransform[1][3]);
  _cachedWorldMatrix[14] = -(modelViewTransform[2][1] * targetHeight + modelViewTransform[2][3]);
  _cachedWorldMatrix[15] = 1;
  
  return _cachedWorldMatrix;
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

