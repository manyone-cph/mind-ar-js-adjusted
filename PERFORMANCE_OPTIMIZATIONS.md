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

### 4. Frame Rate Limiting (Medium Impact)

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

### 5. Optimize Canvas Operations (Medium Impact)

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
2. **Add frame rate limiting** - Simple time-based throttling
3. **Optimize canvas context** - Cache transforms, use hints

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

