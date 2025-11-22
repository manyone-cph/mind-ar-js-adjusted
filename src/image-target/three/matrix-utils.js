import { Matrix4, Vector3, Quaternion } from "three";

export const cssScaleDownMatrix = new Matrix4();
cssScaleDownMatrix.compose(new Vector3(), new Quaternion(), new Vector3(0.001, 0.001, 0.001));

export const invisibleMatrix = new Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1);

