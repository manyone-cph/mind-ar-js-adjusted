import { UI } from "../../ui/ui.js";

export class VideoManager {
  constructor(container, ui, shouldFaceUser, userDeviceId, environmentDeviceId) {
    this.container = container;
    this.ui = ui;
    this.shouldFaceUser = shouldFaceUser;
    this.userDeviceId = userDeviceId;
    this.environmentDeviceId = environmentDeviceId;
    this.video = null;
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.video = document.createElement('video');

      this.video.setAttribute('autoplay', '');
      this.video.setAttribute('muted', '');
      this.video.setAttribute('playsinline', '');
      this.video.style.position = 'absolute';
      this.video.style.top = '0px';
      this.video.style.left = '0px';
      this.video.style.zIndex = '-2';
      this.container.appendChild(this.video);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.ui.showCompatibility();
        reject();
        return;
      }

      const constraints = {
        audio: false,
        video: {}
      };
      
      if (this.shouldFaceUser) {
        if (this.userDeviceId) {
          constraints.video.deviceId = { exact: this.userDeviceId };
        } else {
          constraints.video.facingMode = 'user';
        }
      } else {
        if (this.environmentDeviceId) {
          constraints.video.deviceId = { exact: this.environmentDeviceId };
        } else {
          constraints.video.facingMode = 'environment';
        }
      }

      navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
        this.video.addEventListener('loadedmetadata', () => {
          this.video.setAttribute('width', this.video.videoWidth);
          this.video.setAttribute('height', this.video.videoHeight);
          resolve();
        });
        this.video.srcObject = stream;
      }).catch((err) => {
        console.log("getUserMedia error", err);
        reject();
      });
    });
  }

  stop() {
    if (this.video && this.video.srcObject) {
      const tracks = this.video.srcObject.getTracks();
      tracks.forEach(function (track) {
        track.stop();
      });
    }
    if (this.video) {
      this.video.remove();
      this.video = null;
    }
  }

  switchCamera() {
    this.shouldFaceUser = !this.shouldFaceUser;
  }

  getVideo() {
    return this.video;
  }
}

