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

