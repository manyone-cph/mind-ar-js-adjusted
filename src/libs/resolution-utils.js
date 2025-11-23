/**
 * Converts resolution strings to video constraints
 * 
 * @param {string} resolution - Resolution string (e.g., "360p", "720p", "1080p")
 * @returns {Object} - Video constraints object with width and height
 * @throws {Error} - If resolution format is invalid
 */
export function getResolutionConstraints(resolution) {
  if (!resolution || typeof resolution !== 'string') {
    throw new Error('Resolution must be a non-empty string');
  }

  // Normalize the resolution string (remove spaces, convert to lowercase)
  const normalized = resolution.trim().toLowerCase();
  
  // Map of resolution strings to their standard 16:9 dimensions (landscape)
  // In portrait mode, the browser will swap these automatically
  const resolutionMap = {
    '144p': { width: { ideal: 256 }, height: { ideal: 144 } },
    '240p': { width: { ideal: 426 }, height: { ideal: 240 } },
    '360p': { width: { ideal: 640 }, height: { ideal: 360 } },
    '480p': { width: { ideal: 854 }, height: { ideal: 480 } },
    '720p': { width: { ideal: 1280 }, height: { ideal: 720 } },
    '1080p': { width: { ideal: 1920 }, height: { ideal: 1080 } },
    '1440p': { width: { ideal: 2560 }, height: { ideal: 1440 } },
    '2160p': { width: { ideal: 3840 }, height: { ideal: 2160 } }, // 4K
  };

  if (resolutionMap[normalized]) {
    return resolutionMap[normalized];
  }

  throw new Error(`Invalid resolution format: "${resolution}". Must be one of: ${Object.keys(resolutionMap).join(', ')}`);
}

