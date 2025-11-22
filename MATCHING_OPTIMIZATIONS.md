# Matching Performance Optimizations

## Problem Identified

From profiling data, the **matching operation was taking 27-68ms**, making it the main performance bottleneck:
- Detection: 10-12ms (fast)
- **Matching: 27-68ms (VERY SLOW - bottleneck!)**
- Tracking: 3-10ms (acceptable)
- arraySync: 3-6ms (acceptable)

## Root Cause

The matching algorithm in `matching.js` has two expensive nested loops:

1. **First matching pass** (lines 18-50): Loops through all querypoints, queries hierarchical cluster tree, then computes Hamming distances for all potential matches
2. **Second matching pass** (lines 94-125): After computing homography, loops through **ALL querypoints** and **ALL keypoints** again to refine matches

The second pass is particularly expensive because it:
- Loops through ALL querypoints (could be hundreds)
- For each querypoint, loops through ALL keypoints (could be hundreds)
- Computes Hamming distance for each potential match
- Repeats homography multiplication for each querypoint

## Optimizations Implemented

### 1. Limit Querypoints in First Pass
- **Change**: Process at most 300 querypoints in the first matching pass
- **Benefit**: Prevents excessive computation when detection finds many features
- **Impact**: Reduces matching time when there are >300 detected features

### 2. Limit Querypoints in Second Pass
- **Change**: Process at most 200 querypoints in the second matching pass
- **Benefit**: Significantly reduces the O(n×m) complexity of the second pass
- **Impact**: Major performance improvement (second pass is the most expensive)

### 3. Pre-compute Mapped Querypoints
- **Change**: Pre-compute all homography-transformed querypoints before the loop
- **Benefit**: Avoids repeated homography matrix multiplication inside the loop
- **Impact**: Reduces redundant computations

### 4. Early Exit in Hamming Distance
- **Change**: Skip bit counting when XOR result is 0 (identical values)
- **Benefit**: Fast path for identical descriptor bytes
- **Impact**: Small but consistent improvement

### 5. Early Exit in Matching Loops
- **Change**: Stop searching when a very good match (Hamming distance < 5) is found
- **Benefit**: Avoids unnecessary Hamming distance computations
- **Impact**: Reduces iterations when good matches are found early

## Expected Performance Improvement

### Before:
- Matching: 27-68ms
- Total frame: 38-91ms

### After (Expected):
- Matching: 10-25ms (50-60% reduction)
- Total frame: 20-50ms (much better frame rates)

## Trade-offs

### Quality Impact:
- **Minimal**: Limiting querypoints to 300/200 still processes the most significant features
- The hierarchical cluster tree already prioritizes the most relevant keypoints
- Early exits only occur when very good matches are found, maintaining quality

### Detection Quality:
- No impact on detection quality (720p/1080p maintained)
- Only affects how many detected features are used for matching

## Testing

To verify the improvements:

1. **Enable profiling:**
   ```javascript
   mindar.enablePerformanceProfiling(true);
   ```

2. **Check console output:**
   - Look for "Detection: Xms, Matching: Yms" logs
   - Matching time should be significantly reduced (target: <25ms)

3. **Monitor frame rates:**
   - Total frame time should be <33ms for 30fps
   - Should see fewer frame drops

## Code Changes

### Files Modified:
- `src/image-target/matching/matching.js`: Added querypoint limits and early exits
- `src/image-target/matching/hamming-distance.js`: Added early exit for identical bytes

### Key Changes:
1. **First pass limit**: `MAX_QUERYPOINTS_FIRST_PASS = 300`
2. **Second pass limit**: `MAX_QUERYPOINTS_SECOND_PASS = 200`
3. **Early exit threshold**: `EARLY_EXIT_THRESHOLD = 5` (Hamming distance)
4. **Pre-computed mappings**: All homography transformations computed before loop

## Future Optimizations (If Needed)

If matching is still slow after these optimizations:

1. **Parallel matching**: Use Web Workers for parallel keyframe matching
2. **GPU-accelerated Hamming**: Move Hamming distance computation to GPU
3. **Adaptive limits**: Dynamically adjust querypoint limits based on performance
4. **Spatial indexing**: Use spatial hash for faster keypoint lookup in second pass

