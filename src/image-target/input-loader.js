import * as tf from '@tensorflow/tfjs';

// Direct video texture access implementation
//   Eliminates canvas drawImage() overhead by using video element directly as WebGL texture source
//   Rotation is handled in shader via texture coordinate transformation

class InputLoader {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.texShape = [height, width];

    // No canvas needed - we use video element directly
    this.program = null; // Will be built dynamically based on rotation state

    const backend = tf.backend();
    this.tempPixelHandle = backend.makeTensorInfo(this.texShape, 'float32');
    // warning!!!
    // usage type should be TextureUsage.PIXELS, but tfjs didn't export this enum type, so we hard-coded 2 here 
    //   i.e. backend.texData.get(tempPixelHandle.dataId).usage = TextureUsage.PIXELS;
    backend.texData.get(this.tempPixelHandle.dataId).usage = 2;

    // Cache rotation state to rebuild shader when needed
    this.cachedIsRotated = null;
    this.cachedInputWidth = null;
    this.cachedInputHeight = null;
  }

  // input is instance of HTMLVideoElement or HTMLImageElement
  loadInput(input) {
    // Check if rotation state has changed (cache to avoid rebuilding shader)
    const isInputRotated = input.width === this.height && input.height === this.width;
    const rotationStateChanged = (
      this.cachedIsRotated !== isInputRotated ||
      this.cachedInputWidth !== input.width ||
      this.cachedInputHeight !== input.height
    );

    // Rebuild shader if rotation state changed
    if (rotationStateChanged || !this.program) {
      this.cachedIsRotated = isInputRotated;
      this.cachedInputWidth = input.width;
      this.cachedInputHeight = input.height;
      this.program = this.buildProgram(this.width, this.height, isInputRotated, input.width, input.height);
    }

    // Direct video texture upload - no canvas needed!
    const backend = tf.backend();
    backend.gpgpu.uploadPixelDataToTexture(backend.getTexture(this.tempPixelHandle.dataId), input);

    const res = this._compileAndRun(this.program, [this.tempPixelHandle]);
    return res;
  }

  buildProgram(width, height, isRotated, inputWidth, inputHeight) {
    const textureMethod = tf.env().getNumber('WEBGL_VERSION') === 2? 'texture': 'texture2D';

    // Build shader code with rotation handling in texture coordinates
    let uvTransform = '';
    if (isRotated) {
      // Rotate 90 degrees clockwise in texture space
      // Output coordinates: (texC, texR) where texC ∈ [0, width), texR ∈ [0, height)
      // Input texture: (inputWidth, inputHeight) where inputWidth = height, inputHeight = width
      // For 90° clockwise: output (x, y) → input (y, inputWidth - x - 1)
      // In normalized coords: output (u, v) → input (v, 1.0 - u)
      // Where u = texC/width, v = texR/height
      uvTransform = `
        // Rotate 90 degrees clockwise: map output (texC, texR) to input texture
        float u = (float(texC) + halfCR) / ${width}.0;
        float v = (float(texR) + halfCR) / ${height}.0;
        vec2 uv = vec2(v, 1.0 - u);
      `;
    } else {
      // No rotation - standard UV mapping
      uvTransform = `
        vec2 uv = (vec2(texC, texR) + halfCR) / vec2(${width}.0, ${height}.0);
      `;
    }

    const program = {
      variableNames: ['A'],
      outputShape: this.texShape,
      userCode:`
	void main() {
	  ivec2 coords = getOutputCoords();
	  int texR = coords[0];
	  int texC = coords[1];
	  
	  ${uvTransform}

	  vec4 values = ${textureMethod}(A, uv);
	  setOutput((0.299 * values.r + 0.587 * values.g + 0.114 * values.b) * 255.0);
	}
      `
    }
    return program;
  }

  _compileAndRun(program, inputs) {
    const outInfo = tf.backend().compileAndRun(program, inputs);
    return tf.engine().makeTensorFromDataId(outInfo.dataId, outInfo.shape, outInfo.dtype);
  }

  _runWebGLProgram(program, inputs, outputType) {
    const outInfo = tf.backend().runWebGLProgram(program, inputs, outputType);
    return tf.engine().makeTensorFromDataId(outInfo.dataId, outInfo.shape, outInfo.dtype);
  }
}

export {
  InputLoader
};
