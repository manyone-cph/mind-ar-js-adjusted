// Ref: https://jaantollander.com/post/noise-filtering-using-one-euro-filter/#mjx-eqn%3A1

const DEFAULT_DERIVATIVE_CUTOFF = 0.001; // 1Hz. period in milliseconds

const smoothingFactor = (te, cutoff) => {
  const r = 2 * Math.PI * cutoff * te;
  return r / (r+1);
}

const exponentialSmoothing = (a, x, xPrev) => {
  return a * x + (1 - a) * xPrev;
}

class OneEuroFilter {
  constructor({minCutOff, beta, dCutOff = null}) {
    // Validate and set minCutOff
    if (typeof minCutOff !== 'number' || minCutOff < 0) {
      throw new Error('minCutOff must be a non-negative number');
    }
    this.minCutOff = minCutOff;
    
    // Validate and set beta
    if (typeof beta !== 'number' || beta < 0) {
      throw new Error('beta must be a non-negative number');
    }
    this.beta = beta;
    
    // Validate and set dCutOff (derivative cutoff)
    const derivativeCutoff = dCutOff === null ? DEFAULT_DERIVATIVE_CUTOFF : dCutOff;
    if (typeof derivativeCutoff !== 'number' || derivativeCutoff < 0) {
      throw new Error('dCutOff must be a non-negative number');
    }
    this.dCutOff = derivativeCutoff;

    this.xPrev = null;
    this.dxPrev = null;
    this.tPrev = null;
    this.initialized = false;
  }

  reset() {
    this.initialized = false;
    this.xPrev = null;
    this.dxPrev = null;
    this.tPrev = null;
  }

  updateParams({minCutOff, beta, dCutOff}) {
    if (minCutOff !== undefined) {
      if (typeof minCutOff !== 'number' || minCutOff < 0) {
        throw new Error('minCutOff must be a non-negative number');
      }
      this.minCutOff = minCutOff;
    }
    if (beta !== undefined) {
      if (typeof beta !== 'number' || beta < 0) {
        throw new Error('beta must be a non-negative number');
      }
      this.beta = beta;
    }
    if (dCutOff !== undefined) {
      if (typeof dCutOff !== 'number' || dCutOff < 0) {
        throw new Error('dCutOff must be a non-negative number');
      }
      this.dCutOff = dCutOff;
    }
  }

  getParams() {
    return {
      minCutOff: this.minCutOff,
      beta: this.beta,
      dCutOff: this.dCutOff
    };
  }

  filter(t, x) {
    // Validate input
    if (!Array.isArray(x) || x.length === 0) {
      throw new Error('Input must be a non-empty array');
    }
    if (typeof t !== 'number' || t < 0) {
      throw new Error('Time must be a non-negative number');
    }

    if (!this.initialized) {
      this.initialized = true;
      this.xPrev = x.slice(); // Create a copy
      this.dxPrev = x.map(() => 0);
      this.tPrev = t;
      return x.slice(); // Return a copy
    }

    const {xPrev, tPrev, dxPrev} = this;

    // Handle edge case: input array length changed (shouldn't happen, but be defensive)
    if (x.length !== xPrev.length) {
      // Reset filter if array dimensions changed
      this.reset();
      this.initialized = true;
      this.xPrev = x.slice();
      this.dxPrev = x.map(() => 0);
      this.tPrev = t;
      return x.slice();
    }

    // Handle edge case: time hasn't advanced or went backwards
    const te = t - tPrev;
    if (te <= 0) {
      // If time hasn't advanced, return previous filtered value
      return xPrev.slice();
    }

    // Handle very large time deltas (e.g., after pause/resume)
    // Reset if time delta is too large (more than 1 second)
    if (te > 1000) {
      this.reset();
      this.initialized = true;
      this.xPrev = x.slice();
      this.dxPrev = x.map(() => 0);
      this.tPrev = t;
      return x.slice();
    }

    const ad = smoothingFactor(te, this.dCutOff);

    const dx = [];
    const dxHat = [];
    const xHat = [];
    for (let i = 0; i < x.length; i++) {
      // The filtered derivative of the signal.
      dx[i] = (x[i] - xPrev[i]) / te;
      dxHat[i] = exponentialSmoothing(ad, dx[i], dxPrev[i]);

      // The filtered signal
      const cutOff = this.minCutOff + this.beta * Math.abs(dxHat[i]);
      const a = smoothingFactor(te, cutOff);
      xHat[i] = exponentialSmoothing(a, x[i], xPrev[i]);
    }

    // update prev (create copies to avoid reference issues)
    this.xPrev = xHat.slice(); 
    this.dxPrev = dxHat.slice();
    this.tPrev = t;

    return xHat;
  }
}

export {
  OneEuroFilter
}
