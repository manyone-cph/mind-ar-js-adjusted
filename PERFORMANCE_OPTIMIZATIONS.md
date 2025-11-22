# Video Processing Performance Optimizations

## Change Log

### ✅ Implemented Optimizations

#### 1. requestVideoFrameCallback (Implemented: 2024)
**File Modified:** `src/image-target/controller.js`
**Method:** `processVideo()`

**Changes Made:**
- Refactored `processVideo()` to extract frame processing logic into reusable `processFrame()` function
- Added `requestVideoFrameCallback` support with automatic fallback to polling-based approach
- Modern browsers (Chrome 94+, Edge 94+, Safari 15.4+) now use event-driven frame processing
- Older browsers automatically fall back to the original `while(true)` + `tf.nextFrame()` approach

**Benefits:**
- Only processes frames when new video frames are actually available
- Eliminates unnecessary polling overhead
- Better synchronization with video playback
- Expected performance improvement: 20-30% on supported browsers

**Code Structure:**
- Frame processing logic extracted to `processFrame()` async function
- Conditional check: `if (input && typeof input.requestVideoFrameCallback === 'function')`
- Graceful fallback maintains compatibility with all browsers

**Testing Notes:**
- Tested on Chrome/Edge (uses requestVideoFrameCallback)
- Tested on older browsers (uses fallback)
- No breaking changes to existing API

#### 2. Frame Rate Limiting (Implemented: 2024)
**Files Modified:** 
- `src/image-target/three/main.js`
- `src/image-target/three/ar-session.js`
- `src/image-target/controller.js`

**Changes Made:**
- Added `targetFPS` parameter to `MindARThree` constructor (default: `null` for unlimited)
- Added `setTargetFPS(targetFPS)` method to `MindARThree` for runtime configuration
- Implemented frame rate limiting in `Controller.processVideo()` using `performance.now()`
- Frame rate limiting works with both `requestVideoFrameCallback` and polling fallback paths
- Frames are skipped when processing would exceed the target FPS

**Benefits:**
- Reduces unnecessary frame processing
- Better battery life on mobile devices
- More consistent performance
- Configurable at initialization or runtime
- Set to `null` to disable (unlimited FPS)

**API Usage:**
```javascript
// At initialization
const mindar = new MindARThree({
  container: document.body,
  imageTargetSrc: './targets.mind',
  targetFPS: 30  // Limit to 30 FPS
});

// Or at runtime
mindar.setTargetFPS(30);  // Set to 30 FPS
mindar.setTargetFPS(null);  // Disable limiting (unlimited)
```

**Implementation Details:**
- Uses `performance.now()` for high-precision timing
- Calculates frame interval: `1000 / targetFPS` milliseconds
- Skips frames when `timeSinceLastFrame < frameInterval`
- Works seamlessly with `requestVideoFrameCallback` optimization
- Resets timing when FPS is changed or video processing stops

**Testing Notes:**
- Validates input (must be positive number or null)
- Throws error on invalid values
- No breaking changes (defaults to unlimited if not specified)

#### 3. Canvas Operation Optimizations (Implemented: 2024)
**File Modified:** `src/image-target/input-loader.js`
**Class:** `InputLoader`

**Changes Made:**
- Added `willReadFrequently: false` hint to canvas context creation (optimizes for GPU reads)
- Added `alpha: false` to canvas context (no alpha channel needed for grayscale)
- Cached rotation state (`isInputRotated`, input dimensions) to avoid recalculating every frame
- Cached rotation transform parameters (center coordinates, angle) to avoid recalculation
- Removed unnecessary `clearRect()` call (drawImage overwrites entire canvas anyway)
- Optimized context operations by caching transform state

**Benefits:**
- Reduced CPU overhead from redundant calculations
- Faster canvas operations (fewer context state changes)
- Better GPU optimization hints for texture uploads
- Expected performance improvement: 5-10% reduction in frame processing time

**Optimizations Applied:**
1. **Context Creation Hints:**
   - `willReadFrequently: false` - Tells browser to optimize for GPU reads, not CPU reads
   - `alpha: false` - Disables alpha channel since we only need grayscale

2. **Rotation State Caching:**
   - Caches `isInputRotated` boolean and input dimensions
   - Only recalculates when input dimensions change
   - Caches rotation center coordinates (`rotationCenterX`, `rotationCenterY`)
   - Caches rotation angle (90° = π/2 radians) to avoid conversion every frame

3. **Canvas Operations:**
   - Removed `clearRect()` - unnecessary since `drawImage()` overwrites entire canvas
   - Reduced redundant calculations in rotation path

**Code Structure:**
```javascript
// Cached rotation state
this.cachedIsRotated = null;
this.cachedInputWidth = null;
this.cachedInputHeight = null;
this.rotationCenterX = width / 2;  // Cached
this.rotationCenterY = height / 2; // Cached
this.rotationAngle = Math.PI / 2;  // Cached (90°)

// Only recalculate when dimensions change
const rotationStateChanged = (
  this.cachedIsRotated !== isInputRotated ||
  this.cachedInputWidth !== input.width ||
  this.cachedInputHeight !== input.height
);
```

**Testing Notes:**
- No breaking changes to existing API
- Works with both rotated and non-rotated inputs
- Maintains same output quality
- Performance improvements most noticeable on lower-end devices

---

## Current Implementation Analysis

### Current Flow:
1. Video element created and added to DOM
2. Every frame: `drawImage(video)` → canvas → WebGL texture upload → shader processing
3. Processing loop uses `while(true)` with `tf.nextFrame()`

### Performance Bottlenecks Identified:

1. **Canvas `drawImage()` overhead** - CPU-bound, synchronous operation every frame
2. **No `requestVideoFrameCallback`** - Using polling-based approach
3. **Video element in DOM** - May trigger unnecessary repaints
4. **No frame rate limiting** - Processes every frame even if not needed
5. **Texture upload overhead** - Uploading pixel data every frame

---

## Recommended Optimizations

### 1. Use `requestVideoFrameCallback` (High Impact) ✅ IMPLEMENTED

**Status:** ✅ **Implemented** - See Change Log above for details

**Current:** Polling with `while(true)` + `tf.nextFrame()`

**Better:** Use `requestVideoFrameCallback` which fires only when a new video frame is available.

**Benefits:**
- Only processes when a new frame is actually available
- More efficient than polling
- Better synchronization with video playback

**Implementation:**
```javascript
// In controller.js processVideo()
if (this.video.requestVideoFrameCallback) {
  // Modern browsers
  const processFrame = (now, metadata) => {
    if (!this.processingVideo) return;
    
    const inputT = this.inputLoader.loadInput(input);
    // ... process frame ...
    inputT.dispose();
    
    this.video.requestVideoFrameCallback(processFrame);
  };
  this.video.requestVideoFrameCallback(processFrame);
} else {
  // Fallback to current approach
}
```

### 2. Use OffscreenCanvas (High Impact)

**Current:** Canvas in main thread, `drawImage()` is synchronous

**Better:** Use `OffscreenCanvas` with `transferControlToOffscreen()` for WebGL context

**Benefits:**
- Offloads canvas operations to worker thread (if supported)
- Reduces main thread blocking
- Better parallelization

**Note:** Limited browser support, but can fallback gracefully.

### 3. Direct Video Texture Access (Very High Impact)

**Current:** Video → Canvas → Texture → Shader

**Better:** Use video element directly as WebGL texture source

**Benefits:**
- Eliminates `drawImage()` overhead entirely
- GPU can read directly from video texture
- Massive performance gain (can be 2-3x faster)

**Implementation:**
```javascript
// Instead of drawing to canvas, use video directly
// WebGL can sample from video texture directly
// Modify InputLoader to accept video texture directly
```

**Challenges:**
- Need to handle rotation in shader instead of canvas
- May need to adjust texture coordinates

### 4. Frame Rate Limiting (Medium Impact) ✅ IMPLEMENTED

**Status:** ✅ **Implemented** - See Change Log above for details

**Current:** Processes every available frame

**Better:** Limit to target FPS (e.g., 30fps for AR tracking)

**Benefits:**
- Reduces unnecessary processing
- More consistent performance
- Better battery life on mobile

**Implementation:**
```javascript
const TARGET_FPS = 30;
const FRAME_INTERVAL = 1000 / TARGET_FPS;
let lastFrameTime = 0;

const processFrame = (now) => {
  if (now - lastFrameTime < FRAME_INTERVAL) {
    requestAnimationFrame(processFrame);
    return;
  }
  lastFrameTime = now;
  // ... process frame ...
};
```

### 5. Optimize Canvas Operations (Medium Impact) ✅ IMPLEMENTED

**Status:** ✅ **Implemented** - See Change Log above for details

**Current:** `clearRect()` + `drawImage()` every frame

**Optimizations:**
- Cache rotation transform if video dimensions don't change
- Use `willReadFrequently: false` hint (if using ImageData)
- Consider using `ImageBitmap` for better performance

### 6. Texture Reuse and Pooling (Low-Medium Impact)

**Current:** Creates/updates texture every frame

**Better:** Reuse textures, only update when needed

**Note:** Already partially implemented with `tempPixelHandle`, but could be optimized further.

### 7. Video Element Optimization (Low Impact)

**Current:** Video element in DOM with styles

**Optimizations:**
- Use `display: none` or `visibility: hidden` if not needed for display
- Consider using `HTMLVideoElement` without adding to DOM if possible
- Use `preload="none"` to avoid unnecessary loading

### 8. Batch Processing (Low Impact)

**Current:** Processes one frame at a time

**Better:** If multiple targets, batch operations where possible

---

## Priority Recommendations

### Immediate Wins (Easy to implement, high impact):

1. ✅ **Add `requestVideoFrameCallback`** - Drop-in replacement for polling **[COMPLETED]**
2. ✅ **Add frame rate limiting** - Simple time-based throttling **[COMPLETED]**
3. ✅ **Optimize canvas context** - Cache transforms, use hints **[COMPLETED]**

### Medium-term (Requires more changes):

4. **Direct video texture access** - Biggest performance gain but needs shader changes
5. **OffscreenCanvas** - Good for modern browsers with fallback

### Long-term (Architecture changes):

6. **WebCodecs API** - For even better video processing (cutting-edge)
7. **WebGPU migration** - Future-proofing (when widely available)

---

## Quick Win Implementation Example

Here's a quick implementation of `requestVideoFrameCallback` optimization:

```javascript
// In controller.js, modify processVideo():

processVideo(input) {
  if (this.processingVideo) return;
  this.processingVideo = true;

  // ... existing trackingStates setup ...

  // Use requestVideoFrameCallback if available
  if (input.requestVideoFrameCallback) {
    const processFrame = async (now, metadata) => {
      if (!this.processingVideo) return;

      const inputT = this.inputLoader.loadInput(input);
      
      // ... existing detection/tracking logic ...
      
      inputT.dispose();
      this.onUpdate && this.onUpdate({type: 'processDone'});
      
      // Schedule next frame
      if (this.processingVideo) {
        input.requestVideoFrameCallback(processFrame);
      }
    };
    
    input.requestVideoFrameCallback(processFrame);
  } else {
    // Fallback to existing while loop
    const startProcessing = async() => {
      while (true) {
        if (!this.processingVideo) break;
        // ... existing code ...
        await tf.nextFrame();
      }
    };
    startProcessing();
  }
}
```

---

## Performance Measurement

To measure improvements:
1. Use `performance.now()` to track frame processing time
2. Monitor FPS with frame timing
3. Use Chrome DevTools Performance tab
4. Check WebGL draw calls and texture uploads

---

## Browser Compatibility Notes

- `requestVideoFrameCallback`: Chrome 94+, Edge 94+, Safari 15.4+
- `OffscreenCanvas`: Chrome 69+, Firefox 105+, Safari 16.4+
- Direct video texture: All modern browsers support this

Always provide fallbacks for older browsers.

