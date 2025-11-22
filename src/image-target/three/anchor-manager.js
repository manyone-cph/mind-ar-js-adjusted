import { Group } from "three";

export class AnchorManager {
  constructor(scene, cssScene) {
    this.scene = scene;
    this.cssScene = cssScene;
    this.anchors = [];
  }

  addAnchor(targetIndex) {
    const group = new Group();
    group.visible = false;
    group.matrixAutoUpdate = false;
    const anchor = {
      group,
      targetIndex,
      onTargetFound: null,
      onTargetLost: null,
      onTargetUpdate: null,
      css: false,
      visible: false
    };
    this.anchors.push(anchor);
    this.scene.add(group);
    return anchor;
  }

  addCSSAnchor(targetIndex) {
    const group = new Group();
    group.visible = false;
    group.matrixAutoUpdate = false;
    const anchor = {
      group,
      targetIndex,
      onTargetFound: null,
      onTargetLost: null,
      onTargetUpdate: null,
      css: true,
      visible: false
    };
    this.anchors.push(anchor);
    this.cssScene.add(group);
    return anchor;
  }

  getAnchors() {
    return this.anchors;
  }
}

