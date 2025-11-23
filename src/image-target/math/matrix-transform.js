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

