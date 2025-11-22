/**
 * Converts resolution strings like "360p", "720p", "1080p" to video constraints
 * that work in both landscape and portrait modes.
 * 
 * @param {string} resolution - Resolution string (e.g., "360p", "720p", "1080p")
 * @returns {Object|null} - Video constraints object with width and height, or null if invalid
 */
export function getResolutionConstraints(resolution) {
  if (!resolution) {
    return null;
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

  // Check if it's a direct match
  if (resolutionMap[normalized]) {
    return resolutionMap[normalized];
  }

  // Try to extract number from strings like "720p", "1080p", etc.
  const match = normalized.match(/(\d+)p?/);
  if (match) {
    const height = parseInt(match[1], 10);
    // Calculate width based on 16:9 aspect ratio
    const width = Math.round(height * 16 / 9);
    return {
      width: { ideal: width },
      height: { ideal: height }
    };
  }

  // If no match, return null (will use default browser resolution)
  console.warn(`Unknown resolution format: ${resolution}. Using default camera resolution.`);
  return null;
}

