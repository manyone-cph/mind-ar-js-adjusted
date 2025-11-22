# MindAR

<div align="center">

![MindAR Logo](https://hiukim.github.io/mind-ar-js-doc/assets/images/multi-targets-demo-8b5fc868f6b0847a9818e8bf0ba2c1c3.gif)

**A powerful, open-source Web Augmented Reality framework built with pure JavaScript**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/mind-ar.svg)](https://badge.fury.io/js/mind-ar)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)](https://nodejs.org/)

</div>

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Documentation](#documentation)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Architecture](#architecture)
- [Development](#development)
- [Browser Compatibility](#browser-compatibility)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)
- [Credits](#credits)

## Overview

MindAR is a comprehensive Web Augmented Reality (WebAR) library that enables developers to create immersive AR experiences directly in web browsers without requiring native mobile apps. Built entirely in JavaScript, MindAR provides end-to-end AR capabilities from computer vision processing to 3D rendering.

### Key Highlights

- 🌐 **Pure JavaScript**: No native dependencies, runs entirely in the browser
- 🚀 **High Performance**: GPU-accelerated through WebGL and TensorFlow.js
- 📱 **Mobile-Friendly**: Works on both desktop and mobile devices
- 🎨 **Three.js Integration**: Seamless integration with Three.js for 3D rendering
- 🔧 **Developer-Friendly**: Simple API and comprehensive documentation
- 🎯 **Two Tracking Modes**: Image tracking and face tracking capabilities

## Features

### Image Tracking
- Track multiple image targets simultaneously
- Real-time 6DOF pose estimation
- Robust tracking with filtering and smoothing
- Support for custom target image compilation
- Works with printed images, screens, or any flat surface

### Face Tracking
- Real-time face mesh detection and tracking
- Face landmark detection (468 points)
- Blend shapes support for facial expressions
- Virtual try-on capabilities (glasses, hats, masks, etc.)
- Face occlusion support

### Technical Features
- **GPU Acceleration**: Leverages WebGL through TensorFlow.js for high-performance computer vision
- **Web Workers**: Background processing to maintain smooth UI
- **ES Modules**: Modern JavaScript module system support
- **TypeScript Compatible**: Can be used with TypeScript projects
- **Custom Shaders**: Optimized GLSL shaders for image processing
- **Responsive Design**: Automatically adapts to different screen sizes and orientations

## Installation

### NPM Installation

```bash
npm install mind-ar
```

### CDN Usage

For quick prototyping, you can use the CDN version:

```html
<!-- Image Tracking -->
<script type="module">
  import { MindARThree } from 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js';
  // Your code here
</script>

<!-- Face Tracking -->
<script type="module">
  import { MindARThree } from 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-face-three.prod.js';
  // Your code here
</script>
```

### Peer Dependencies

MindAR requires Three.js as a peer dependency:

```bash
npm install three
```

## Quick Start

### Image Tracking with Three.js

```javascript
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js';
import * as THREE from 'three';

const mindarThree = new MindARThree({
  container: document.body,
  imageTargetSrc: './assets/card.mind',
  resolution: '720p'  // Optional: Set camera resolution
});

const { renderer, scene, camera } = mindarThree;

// Add your 3D objects
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const cube = new THREE.Mesh(geometry, material);

const anchor = mindarThree.addAnchor(0);
anchor.group.add(cube);

// Start AR
await mindarThree.start();
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
```

### Face Tracking with Three.js

```javascript
import { MindARThree } from 'mind-ar/dist/mindar-face-three.prod.js';
import * as THREE from 'three';

const mindarThree = new MindARThree({
  container: document.body,
  resolution: '720p'  // Optional: Set camera resolution
});

const { renderer, scene, camera } = mindarThree;

// Add 3D object to face
const geometry = new THREE.BoxGeometry(0.06, 0.06, 0.06);
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const cube = new THREE.Mesh(geometry, material);

const anchor = mindarThree.addAnchor(0);
anchor.group.add(cube);

await mindarThree.start();
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
```

## Documentation

Comprehensive documentation is available at: **[https://hiukim.github.io/mind-ar-js-doc](https://hiukim.github.io/mind-ar-js-doc)**

The documentation includes:
- Detailed API reference
- Step-by-step tutorials
- Advanced usage patterns
- Performance optimization guides
- Troubleshooting tips

## API Reference

### MindARThree (Image Tracking)

#### Constructor Options

```javascript
const mindarThree = new MindARThree({
  container: HTMLElement,           // Required: Container element
  imageTargetSrc: string,            // Required: Path to .mind file
  maxTrack: number,                  // Optional: Max number of targets (default: 1)
  uiLoading: string,                 // Optional: "yes" | "no" (default: "yes")
  uiScanning: string,                 // Optional: "yes" | "no" (default: "yes")
  uiError: string,                   // Optional: "yes" | "no" (default: "yes")
  filterMinCF: number,               // Optional: Filter cutoff frequency
  filterBeta: number,                // Optional: Filter beta value
  warmupTolerance: number,            // Optional: Warmup tolerance
  missTolerance: number,              // Optional: Miss tolerance
  userDeviceId: string,              // Optional: Specific user-facing camera ID
  environmentDeviceId: string,       // Optional: Specific environment-facing camera ID
  resolution: string                  // Optional: Camera resolution (e.g., "360p", "720p", "1080p")
});
```

**Resolution Parameter**: The `resolution` parameter allows you to specify the desired camera resolution using standard video resolution strings. Supported formats include:
- `"144p"`, `"240p"`, `"360p"`, `"480p"`, `"720p"`, `"1080p"`, `"1440p"`, `"2160p"` (4K)
- Numeric formats like `"720"` or `"720p"` are also accepted
- The browser will automatically adapt to the closest available resolution
- Works seamlessly in both landscape and portrait orientations
- If not specified, the browser's default camera resolution will be used

**Example**:
```javascript
const mindarThree = new MindARThree({
  container: document.body,
  imageTargetSrc: './targets.mind',
  resolution: '720p'  // Request 720p resolution
});

// Change resolution at runtime
await mindarThree.setResolution('1080p');  // Switch to 1080p
// The AR session will automatically restart with the new resolution
// All anchors and 3D objects are preserved during the restart
```

#### Methods

- `start()`: Start the AR session
- `stop()`: Stop the AR session
- `switchCamera()`: Switch between front and back cameras
- `setResolution(resolution)`: Change camera resolution at runtime (e.g., `"360p"`, `"720p"`, `"1080p"`)
- `addAnchor(targetIndex)`: Add a 3D anchor to a target
- `addCSSAnchor(targetIndex)`: Add a CSS3D anchor to a target

#### Anchor Object

```javascript
const anchor = mindarThree.addAnchor(0);

// Properties
anchor.group          // THREE.Group - Add your 3D objects here
anchor.targetIndex    // number - Target index
anchor.visible        // boolean - Whether target is currently visible

// Event handlers
anchor.onTargetFound  // Function - Called when target is found
anchor.onTargetLost   // Function - Called when target is lost
anchor.onTargetUpdate // Function - Called on each frame when target is visible
```

### MindARThree (Face Tracking)

#### Constructor Options

```javascript
const mindarThree = new MindARThree({
  container: HTMLElement,           // Required: Container element
  uiLoading: string,                 // Optional: "yes" | "no" (default: "yes")
  uiScanning: string,                // Optional: "yes" | "no" (default: "yes")
  uiError: string,                   // Optional: "yes" | "no" (default: "yes")
  filterMinCF: number,              // Optional: Filter cutoff frequency
  filterBeta: number,                // Optional: Filter beta value
  userDeviceId: string,              // Optional: Specific camera ID
  environmentDeviceId: string,       // Optional: Specific camera ID
  disableFaceMirror: boolean,        // Optional: Disable face mirroring (default: false)
  resolution: string                 // Optional: Camera resolution (e.g., "360p", "720p", "1080p")
});
```

**Resolution Parameter**: The `resolution` parameter allows you to specify the desired camera resolution using standard video resolution strings. Supported formats include:
- `"144p"`, `"240p"`, `"360p"`, `"480p"`, `"720p"`, `"1080p"`, `"1440p"`, `"2160p"` (4K)
- Numeric formats like `"720"` or `"720p"` are also accepted
- The browser will automatically adapt to the closest available resolution
- Works seamlessly in both landscape and portrait orientations
- If not specified, the browser's default camera resolution will be used

**Example**:
```javascript
const mindarThree = new MindARThree({
  container: document.body,
  resolution: '720p'  // Request 720p resolution
});

// Change resolution at runtime
await mindarThree.setResolution('1080p');  // Switch to 1080p
// The AR session will automatically restart with the new resolution
// All anchors, face meshes, and 3D objects are preserved during the restart
```

#### Methods

- `start()`: Start the AR session
- `stop()`: Stop the AR session
- `switchCamera()`: Switch between front and back cameras
- `setResolution(resolution)`: Change camera resolution at runtime (e.g., `"360p"`, `"720p"`, `"1080p"`)
- `addAnchor(index)`: Add a 3D anchor to face (index 0 for face)
- `addFaceMesh()`: Add a face mesh for occlusion

## Examples

For examples and tutorials, please visit the official documentation:

- 📖 [Documentation Examples](https://hiukim.github.io/mind-ar-js-doc/examples/summary)
- 🎯 [Image Tracking Examples](https://hiukim.github.io/mind-ar-js-doc/examples/summary)
- 😊 [Face Tracking Examples](https://hiukim.github.io/mind-ar-js-doc/face-tracking-examples/tryon)

The examples in the documentation include:
- Basic image tracking
- Multiple targets tracking
- Interactive AR experiences
- Face tracking with virtual try-on
- Face mesh visualization
- Blend shapes examples
- CSS3D integration

**Note**: All examples require HTTPS or localhost due to camera access requirements.

## Architecture

### Core Components

```
mind-ar-js/
├── src/
│   ├── image-target/          # Image tracking implementation
│   │   ├── controller.js      # Main tracking controller
│   │   ├── three.js           # Three.js integration
│   │   ├── detector/          # Feature detection
│   │   ├── tracker/           # Feature tracking
│   │   ├── matching/          # Feature matching
│   │   └── estimation/        # Pose estimation
│   ├── face-target/           # Face tracking implementation
│   │   ├── controller.js      # Face tracking controller
│   │   ├── three.js           # Three.js integration
│   │   └── face-geometry/     # Face mesh geometry
│   ├── libs/                  # Third-party libraries
│   └── ui/                    # UI components
├── dist/                      # Production builds
└── dist-dev/                  # Development builds
```

### Technology Stack

- **TensorFlow.js**: GPU-accelerated computer vision operations
- **Three.js**: 3D rendering engine
- **MediaPipe**: Face mesh detection (for face tracking)
- **WebGL**: GPU acceleration
- **Web Workers**: Background processing

### Image Tracking Pipeline

1. **Feature Detection**: Extract keypoints from camera frame using FREAK descriptors
2. **Feature Matching**: Match detected features with pre-compiled target image features
3. **Pose Estimation**: Calculate 6DOF pose using RANSAC and homography
4. **Tracking**: Track features across frames for smooth tracking
5. **Filtering**: Apply One Euro Filter for stable pose output
6. **Rendering**: Render 3D content using Three.js

### Face Tracking Pipeline

1. **Face Detection**: Detect face using MediaPipe Face Mesh
2. **Landmark Extraction**: Extract 468 facial landmarks
3. **Pose Estimation**: Calculate face pose and orientation
4. **Blend Shapes**: Extract facial expression parameters
5. **Rendering**: Render 3D content anchored to face

## Development

### Prerequisites

- Node.js >= 14.0.0
- npm or yarn
- Modern web browser with WebGL support
- Webcam for testing

### Setup Development Environment

1. Clone the repository:
```bash
git clone https://github.com/hiukim/mind-ar-js.git
cd mind-ar-js
```

2. Install dependencies:
```bash
npm install
```

### Build Commands

```bash
# Development build (watch mode for Three.js)
npm run watch

# Development build (one-time)
npm run build-dev

# Production build
npm run build

# Development server with hot reload
npm run dev
```

### Project Structure

- `/src` - Source code
  - `/image-target` - Image tracking modules
  - `/face-target` - Face tracking modules
  - `/libs` - Utility libraries
  - `/ui` - UI components
- `/dist` - Production build output
- `/dist-dev` - Development build output
- `/testing` - Testing utilities

### Development Workflow

1. **Development**: Use `npm run watch` - automatically rebuilds on file changes
2. **Testing**: Create your own test HTML files that import from `dist-dev`
3. **Local Server**: Use a local web server (Chrome Web Server extension, Python's http.server, etc.)
4. **Production**: Run `npm run build` to create optimized production builds

### Building Custom Target Images

Use the online compiler tool: [https://hiukim.github.io/mind-ar-js-doc/tools/compile](https://hiukim.github.io/mind-ar-js-doc/tools/compile)

## Browser Compatibility

### Supported Browsers

- ✅ Chrome/Edge 90+
- ✅ Firefox 88+
- ✅ Safari 14+ (iOS 14+)
- ✅ Opera 76+

### Required Features

- WebGL 2.0 support
- Web Workers
- MediaDevices API (getUserMedia)
- ES6 Modules
- Canvas API

### Mobile Considerations

- **iOS**: Requires iOS 14+ and Safari
- **Android**: Chrome or Firefox recommended
- **HTTPS Required**: Camera access requires HTTPS (or localhost)
- **Performance**: Lower-end devices may experience reduced frame rates

## Troubleshooting

### Common Issues

#### Camera Not Accessing

**Problem**: Camera permission denied or not starting

**Solutions**:
- Ensure you're using HTTPS or localhost
- Check browser permissions for camera access
- Try a different browser
- Verify camera is not being used by another application

#### Poor Tracking Performance

**Problem**: Tracking is jittery or inaccurate

**Solutions**:
- Ensure good lighting conditions
- Use high-contrast target images
- Adjust filter parameters (`filterMinCF`, `filterBeta`)
- Reduce tracking resolution if on mobile
- Check browser console for errors

#### Build Errors

**Problem**: npm install or build fails

**Solutions**:
- Ensure Node.js >= 14.0.0
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- On Mac, if node-canvas fails: `brew install pkg-config cairo pango libpng jpeg giflib librsvg pixman`

#### ESBuild Import Issues

**Problem**: require() errors when using esbuild

**Solution**: Import classes directly:
```javascript
import { MindARThree } from 'mind-ar/src/image-target/three.js'
```
Use `esbuild-plugin-inline-worker` for worker support.

### Getting Help

- 📖 [Documentation](https://hiukim.github.io/mind-ar-js-doc)
- 💬 [GitHub Issues](https://github.com/hiukim/mind-ar-js/issues)

## Contributing

MindAR is an open-source project and welcomes contributions! We're particularly looking for help in:

- 🎯 **Computer Vision**: Improving tracking accuracy and performance
- 💻 **JavaScript**: API improvements and code quality
- 🎨 **3D Graphics**: Visual examples and demos
- 📚 **Documentation**: Tutorials and guides
- 🐛 **Bug Fixes**: Identifying and fixing issues

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow existing code style
- Add comments for complex logic
- Test on multiple browsers
- Update documentation as needed
- Write clear commit messages

## License

MindAR is licensed under the MIT License. See [LICENSE](LICENSE) file for details.

## Credits

### Core Technologies

- **ARToolkit**: Computer vision algorithms inspiration
- **MediaPipe**: Face mesh detection model
- **TensorFlow.js**: WebGL backend for GPU acceleration
- **Three.js**: 3D rendering engine

### Special Thanks

- All contributors and the open-source community
- Users who provide feedback and report issues

## Related Projects

- **[MindAR Studio](https://studio.mindar.org)** - No-code face tracking AR editor
- **[Pictarize](https://pictarize.com)** - Hosted platform for image tracking AR
- **[Unity WebAR Foundation](https://github.com/hiukim/unity-webar-foundation)** - Unity plugin for WebAR
- **[WebAR Development Course](https://www.udemy.com/course/introduction-to-web-ar-development/)** - Comprehensive WebAR course

## Roadmap

Future features under consideration:

- 🤚 Hand tracking
- 👤 Body tracking
- 🏢 Plane detection
- 📐 Improved tracking accuracy
- ⚡ Performance optimizations
- 📱 Enhanced mobile support

---

<div align="center">

**Made with ❤️ by the MindAR community**

[Documentation](https://hiukim.github.io/mind-ar-js-doc) • [Examples](https://hiukim.github.io/mind-ar-js-doc/examples/summary) • [GitHub](https://github.com/hiukim/mind-ar-js) • [Issues](https://github.com/hiukim/mind-ar-js/issues)

</div>
