# Performance Profiling Guide

## Overview

Performance profiling has been added to identify bottlenecks in the ML processing pipeline. When enabled, it logs detailed timing breakdowns for each operation.

---

## How to Enable Profiling

### Option 1: Enable for All Operations (Detailed)
```javascript
const mindar = new MindARThree({
  container: document.body,
  imageTargetSrc: './targets.mind'
});

// Enable detailed profiling
mindar.enablePerformanceProfiling(true);

await mindar.start();
```

### Option 2: Enable via Debug Mode
```javascript
// Profiling automatically enabled when debugMode is true
// (Currently only logs slow operations by default)
```

---

## What Gets Profiled

### Frame-Level Timing
- **Total frame time** - Complete frame processing time
- **Input load time** - Video → Tensor conversion
- **Detection time** - Feature detection (if running)
- **Tracking time** - Feature tracking (if running)
- **Other time** - Overhead and other operations

### Detection Breakdown (when detection runs)
- **Pyramid building** - Gaussian pyramid construction
- **DoG pyramid** - Difference-of-Gaussian computation
- **Extremas** - Local max/min finding
- **Localization** - Feature point localization
- **Orientation** - Orientation histogram computation
- **FREAK descriptors** - Binary descriptor computation
- **arraySync** - GPU-CPU synchronization time

### Tracking Breakdown (when tracking)
- **Projection** - Marker projection onto frame
- **Matching** - Feature matching computation
- **arraySync** - GPU-CPU synchronization time

---

## Console Output

### Normal Mode (Only Slow Operations)
```
⚠ Slow frame detected: {total: "85.23", inputLoad: "1.45", detection: "72.18", tracking: "8.50", other: "3.10"} ms
⚠ Slow detection: {total: "72.18", pyramid: "25.30", dog: "12.45", extremas: "15.20", ...} ms
⚠ Slow tracking: {total: "8.50", projection: "3.20", matching: "4.10", arraySync: "1.20"} ms
```

### Debug Mode (All Operations)
```
Frame timing: {total: "45.23", inputLoad: "1.45", detection: "38.18", tracking: "3.50", other: "2.10"} ms
Detection breakdown: {total: "38.18", pyramid: "15.30", dog: "8.45", extremas: "10.20", ...} ms
Tracking breakdown: {total: "3.50", projection: "1.20", matching: "1.80", arraySync: "0.50"} ms
```

---

## Interpreting Results

### If Detection is the Bottleneck:
- **Pyramid building** taking >30ms → Too many octaves or large image
- **DoG pyramid** taking >15ms → Normal for large images
- **Extremas** taking >20ms → Many feature points, consider reducing
- **FREAK descriptors** taking >20ms → Many features, normal

### If Tracking is the Bottleneck:
- **Projection** taking >5ms → Complex projection, may be normal
- **Matching** taking >10ms → Many features to match
- **arraySync** taking >3ms → Large tensor sync, consider optimization

### If arraySync is High:
- Indicates GPU-CPU synchronization overhead
- May benefit from keeping more operations on GPU
- Consider reducing tensor sizes

---

## Expected Timings (720p/1080p)

### Good Performance:
- **Total frame:** <33ms (for 30fps)
- **Detection:** 30-80ms (when running)
- **Tracking:** 5-15ms (when tracking)
- **Input load:** <2ms

### Concerning Performance:
- **Total frame:** >50ms → Frame drops likely
- **Detection:** >100ms → Very slow, investigate
- **Tracking:** >20ms → May need optimization
- **arraySync:** >5ms → High sync overhead

---

## Troubleshooting Steps

1. **Enable profiling:**
   ```javascript
   mindar.enablePerformanceProfiling(true);
   ```

2. **Run your app and check console**

3. **Identify the bottleneck:**
   - Look for the largest time values
   - Check which operation is consistently slow

4. **Take action based on results:**
   - If detection is slow → Consider reducing octaves or crop size
   - If tracking is slow → May be normal for complex scenes
   - If arraySync is high → GPU-CPU sync overhead

---

## Example Output Analysis

```
⚠ Slow detection: {
  total: "125.45",
  pyramid: "45.20",    ← HIGH: Pyramid building is expensive
  dog: "20.15",        ← Normal
  extremas: "25.30",   ← HIGH: Many extremas found
  localization: "15.20",
  orientation: "12.50",
  freak: "8.10",
  arraySync: "3.00"
} ms
```

**Analysis:** 
- Pyramid building (45ms) is the main bottleneck
- Extremas (25ms) is also high
- **Recommendation:** Consider reducing octaves or crop size

---

## Notes

- Profiling adds minimal overhead (<1ms)
- Only logs when operations exceed thresholds (unless debugMode)
- Use this data to identify specific bottlenecks
- Combine with Chrome DevTools Performance tab for deeper analysis

