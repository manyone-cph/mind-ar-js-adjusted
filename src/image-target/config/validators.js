export function validateTargetFPS(targetFPS) {
  if (targetFPS !== null && (typeof targetFPS !== 'number' || targetFPS <= 0)) {
    throw new Error('targetFPS must be a positive number or null (for unlimited)');
  }
}

export function validateFilterParams({filterMinCF, filterBeta, filterDCutOff}) {
  if (filterMinCF !== undefined && (typeof filterMinCF !== 'number' || filterMinCF < 0)) {
    throw new Error('filterMinCF must be a non-negative number');
  }
  if (filterBeta !== undefined && (typeof filterBeta !== 'number' || filterBeta < 0)) {
    throw new Error('filterBeta must be a non-negative number');
  }
  if (filterDCutOff !== undefined && (typeof filterDCutOff !== 'number' || filterDCutOff < 0)) {
    throw new Error('filterDCutOff must be a non-negative number');
  }
}

export function validateWarmupTolerance(warmupTolerance) {
  if (typeof warmupTolerance !== 'number' || warmupTolerance < 0) {
    throw new Error('warmupTolerance must be a non-negative number');
  }
}

export function validateMissTolerance(missTolerance) {
  if (typeof missTolerance !== 'number' || missTolerance < 0) {
    throw new Error('missTolerance must be a non-negative number');
  }
}

export function validateMaxTrack(maxTrack) {
  if (typeof maxTrack !== 'number' || maxTrack < 1) {
    throw new Error('maxTrack must be a positive integer');
  }
}

