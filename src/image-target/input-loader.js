import * as tf from '@tensorflow/tfjs';

// More efficient implementation for tf.browser.fromPixels
//   original implementation: /node_modules/@tensorflow/tfjs-backend-webgl/src/kernels/FromPixels.ts
// 
// This implementation return grey scale instead of RGBA in the orignal implementation 

class InputLoader {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.texShape = [height, width];

    const context = document.createElement('canvas').getContext('2d', {
      willReadFrequently: false, // Optimize for GPU reads, not CPU reads
      alpha: false // No alpha channel needed for grayscale processing
    });
    context.canvas.width = width;
    context.canvas.height = height;
    this.context = context;

    this.program = this.buildProgram(width, height);

    const backend = tf.backend();
    //this.tempPixelHandle = backend.makeTensorInfo(this.texShape, 'int32');
    this.tempPixelHandle = backend.makeTensorInfo(this.texShape, 'float32');
    // warning!!!
    // usage type should be TextureUsage.PIXELS, but tfjs didn't export this enum type, so we hard-coded 2 here 
    //   i.e. backend.texData.get(tempPixelHandle.dataId).usage = TextureUsage.PIXELS;
    backend.texData.get(this.tempPixelHandle.dataId).usage = 2;

    // Cache rotation state to avoid recalculating every frame
    this.cachedIsRotated = null;
    this.cachedInputWidth = null;
    this.cachedInputHeight = null;
    this.rotationCenterX = width / 2;
    this.rotationCenterY = height / 2;
    this.rotationAngle = Math.PI / 2; // 90 degrees in radians, cached
  }

  // old method
  _loadInput(input) {
    return tf.tidy(() => {
      let inputImage = tf.browser.fromPixels(input);
      inputImage = inputImage.mean(2);
      return inputImage;
    });
  }

  // input is instance of HTMLVideoElement or HTMLImageElement
  loadInput(input) {
    const context = this.context;
    
    // Check if rotation state has changed (cache to avoid recalculation)
    const isInputRotated = input.width === this.height && input.height === this.width;
    const rotationStateChanged = (
      this.cachedIsRotated !== isInputRotated ||
      this.cachedInputWidth !== input.width ||
      this.cachedInputHeight !== input.height
    );

    // Update cache if state changed
    if (rotationStateChanged) {
      this.cachedIsRotated = isInputRotated;
      this.cachedInputWidth = input.width;
      this.cachedInputHeight = input.height;
    }

    // Optimize: Skip clearRect() since drawImage() will overwrite the entire canvas
    // clearRect() is only needed if we're doing partial updates, which we're not
    // context.clearRect(0, 0, this.context.canvas.width, this.context.canvas.height);

    if (isInputRotated) { // rotate 90 degree and draw
      // Use cached rotation parameters
      context.save(); // save the current context state
      context.translate(this.rotationCenterX, this.rotationCenterY);
      context.rotate(this.rotationAngle); // use cached angle

      // draw the image with its center at the origin
      context.drawImage(input, -input.width / 2, -input.height / 2);
      context.restore(); // restore the context to its original state
    } else {
      // Direct draw without transformation
      context.drawImage(input, 0, 0, input.width, input.height);
    }

    const backend = tf.backend();
    backend.gpgpu.uploadPixelDataToTexture(backend.getTexture(this.tempPixelHandle.dataId), this.context.canvas);

    //const res = backend.compileAndRun(this.program, [this.tempPixelHandle]);
    const res = this._compileAndRun(this.program, [this.tempPixelHandle]);
    //const res = this._runWebGLProgram(this.program, [this.tempPixelHandle], 'float32');
    //backend.disposeData(tempPixelHandle.dataId);
    return res;
  }

  buildProgram(width, height) {
    const textureMethod = tf.env().getNumber('WEBGL_VERSION') === 2? 'texture': 'texture2D';

    const program = {
      variableNames: ['A'],
      outputShape: this.texShape,
      userCode:`
	void main() {
	  ivec2 coords = getOutputCoords();
	  int texR = coords[0];
	  int texC = coords[1];
	  vec2 uv = (vec2(texC, texR) + halfCR) / vec2(${width}.0, ${height}.0);

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
