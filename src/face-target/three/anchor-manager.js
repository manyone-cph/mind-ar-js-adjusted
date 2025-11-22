import { Group, Mesh, MeshStandardMaterial, BufferGeometry, BufferAttribute } from "three";

export class AnchorManager {
  constructor(scene, cssScene, controller) {
    this.scene = scene;
    this.cssScene = cssScene;
    this.controller = controller;
    this.anchors = [];
    this.faceMeshes = [];
  }

  addAnchor(landmarkIndex) {
    const group = new Group();
    group.matrixAutoUpdate = false;
    const anchor = {
      group,
      landmarkIndex,
      css: false
    };
    this.anchors.push(anchor);
    this.scene.add(group);
    return anchor;
  }

  addCSSAnchor(landmarkIndex) {
    const group = new Group();
    group.matrixAutoUpdate = false;
    const anchor = {
      group,
      landmarkIndex,
      css: true
    };
    this.anchors.push(anchor);
    this.cssScene.add(group);
    return anchor;
  }

  addFaceMesh() {
    const THREE = { BufferGeometry, BufferAttribute };
    const faceGeometry = this.controller.createThreeFaceGeometry(THREE);
    const faceMesh = new Mesh(faceGeometry, new MeshStandardMaterial({ color: 0xffffff }));
    faceMesh.visible = false;
    faceMesh.matrixAutoUpdate = false;
    this.faceMeshes.push(faceMesh);
    return faceMesh;
  }

  getAnchors() {
    return this.anchors;
  }

  getFaceMeshes() {
    return this.faceMeshes;
  }
}

