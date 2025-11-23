class TrackingStateManager {
  constructor(markerDimensions) {
    this.markerDimensions = markerDimensions;
    this.states = [];
    this.reset();
  }

  reset() {
    this.states = [];
    for (let i = 0; i < this.markerDimensions.length; i++) {
      this.states.push({
        showing: false,
        isTracking: false,
        currentModelViewTransform: null,
        trackCount: 0,
        trackMiss: 0
      });
    }
  }

  getState(index) {
    return this.states[index];
  }

  getAllStates() {
    return this.states;
  }

  getTrackingCount() {
    return this.states.reduce((acc, s) => acc + (s.isTracking ? 1 : 0), 0);
  }

  updateDimensions(markerDimensions) {
    this.markerDimensions = markerDimensions;
    this.reset();
  }
}

export {
  TrackingStateManager
};

