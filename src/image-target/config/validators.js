import {validateFilterParams as validateFilterParamsShared} from '../../libs/shared-validators.js';

export function validateTargetFPS(targetFPS) {
  if (targetFPS !== null && (typeof targetFPS !== 'number' || targetFPS <= 0)) {
    throw new Error('targetFPS must be a positive number or null (for unlimited)');
  }
}

export {validateFilterParamsShared as validateFilterParams};

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

