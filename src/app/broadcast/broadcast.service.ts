import {computed, inject, Injectable, signal} from "@angular/core";
import {CameraService} from "../camera.service";
import {ModelService} from "../model.service";
import {MovenetModelService} from "../movenet-model.service";
import {Helpers} from "../helpers";
import _ from 'lodash';

@Injectable({
  providedIn: 'root'
})
export class BroadcastService {
  constructor() {
  }

  dotsRefs: Record<string, any> = {}
  readonly activePic = signal('dickMask');
  readonly dickPickCords = signal({
    x: 0,
    y: 0
  });
  readonly shouldShowDick = computed(() => {
    return this.dickPickCords().x > 0
      && this.dickPickCords().y > 0
  });
  readonly transitionDuration = 50;
  private readonly cameraService = inject(CameraService);
  readonly streamStarted = this.cameraService.streamStarted
  readonly supports = this.cameraService.supports
  private readonly modelService = inject(ModelService);
  readonly canEnableCam = computed(() => {
    return this.cameraService.supports() && this.modelService.model();
  });
  readonly modelReady = this.modelService.model
  private readonly movenetModelService = inject(MovenetModelService);
  private readonly dotsCords: Record<string, {
    x: number,
    y: number,
    color: string
  }> = {
    nose: {x: 0, y: 0, color: 'blue'},
    leftEye: {x: 0, y: 0, color: 'red'},
    rightEye: {x: 0, y: 0, color: 'red'},
    leftEar: {x: 0, y: 0, color: 'red'},
    rightEar: {x: 0, y: 0, color: 'red'},
    leftShoulder: {x: 0, y: 0, color: 'red'},
    rightShoulder: {x: 0, y: 0, color: 'red'},
    leftElbow: {x: 0, y: 0, color: 'red'},
    rightElbow: {x: 0, y: 0, color: 'red'},
    leftWrist: {x: 0, y: 0, color: 'red'},
    rightWrist: {x: 0, y: 0, color: 'red'},
    leftHip: {x: 0, y: 0, color: 'red'},
    rightHip: {x: 0, y: 0, color: 'red'},
    leftKnee: {x: 0, y: 0, color: 'red'},
    rightKnee: {x: 0, y: 0, color: 'red'},
    leftAnkle: {x: 0, y: 0, color: 'red'},
    rightAnkle: {x: 0, y: 0, color: 'red'},
  }
  private readonly pointWidth = 4;
  private readonly picksDimensions: Record<string, {
    width: number
    height: number
  }> = {
    'dickpick': {
      width: 80,
      height: 103
    },
    'dickMask': {
      width: 100,
      height: 191
    },
  }
  private readonly previousCoords: Record<string, { x: number[], y: number[] }> = {};
  private readonly confidenceThreshold = 0.4;
  private readonly predictDelay = 100;
  private readonly bufferLength = 10;
  private readonly stdDeviationThreshold = 0.3;
  private readonly predictWebcamThrottled = _.throttle(() => {
    this.predictWebcam();
  }, this.predictDelay);

  get imgWidth() {
    return this.picksDimensions[this.activePic()].width;
  }

  get imgHeight() {
    return this.picksDimensions[this.activePic()].height;
  }

  get cropPoints() {
    const [x, y] = this.movenetModelService.getCropPoint();
    return {x, y};
  }


  get windowCords() {
    return this.cropPoints;
  }

  get windowWidth() {
    return this.movenetModelService.cropWidth;
  }


  get faceSquare() {
    return this.faceWidth * this.faceHeight;
  }

  get faceWidth() {
    return this.movenetModelService.calculateFaceWidth(
      this.dotsCords['leftEar'],
      this.dotsCords['rightEar']
    )
  }

  get faceHeight() {
    return this.movenetModelService.calculateFaceHeight(
      this.dotsCords['leftEar'],
      this.dotsCords['rightEar']
    )
  }

  get zoom() {
    return this.faceWidth / this.imgWidth;
  }

  load(
    video: HTMLVideoElement
  ) {
    this.modelService.load().then(() => {
      this.cameraService.bind(video);
    });
  }

  enable() {
    if (!this.modelService.model()) return;
    if (this.cameraService.supports()) {
      this._enableCam();
    } else {
      console.warn('getUserMedia() is not supported by your browser');
    }
  }

  putDot(
    cords: Record<string, { x: number; y: number; confidence: number }>,
    key: string
  ) {
    if (!this.getCords(key)) return;
    const enoughConfidence = cords[key].confidence >= this.confidenceThreshold;

    if (enoughConfidence) {
      this.putIfOk(key, this.calcAbsoluteCords(cords[key]));

      if (key !== 'nose') return;
      const {x, y} = this.getCords(key);
      const imgW = this.imgWidth * this.zoom;
      const imgH = this.imgHeight * this.zoom;
      console.log('dick', {
        x,
        y,
        imgW,
        imgH,
        imgWidth: this.imgWidth,
        imgHeight: this.imgHeight,
        zoom: this.zoom
      })
      this.dickPickCords.set({
        x: x - imgW / 2,
        y: y - imgH / 2
      });
    }

    this.updateDot(key);
  }

  putIfOk(
    key: string,
    value: [number, number],
  ) {
    if (!this.previousCoords[key]) {
      this.previousCoords[key] = {x: [], y: []};
    }
    const shouldUpdateDotsCordsX = this.calculateStdDeviation(this.previousCoords[key].x, value[0]);
    const shouldUpdateDotsCordsY = this.calculateStdDeviation(this.previousCoords[key].y, value[1]);

    const lastX = this.previousCoords[key]?.x?.[this.previousCoords[key]?.x?.length - 1];
    const lastY = this.previousCoords[key]?.y?.[this.previousCoords[key]?.y?.length - 1];
    let lastXGreater = true;
    let lastYGreater = true;

    if (lastX) {
      lastXGreater = lastX + 1 > value[0];
    }
    if (lastY) {
      lastYGreater = lastY + 1 > value[1];
    }

    if (this.isOk(shouldUpdateDotsCordsX) && lastXGreater) {
      this.dotsCords[key].x = value[0];
    }
    if (this.isOk(shouldUpdateDotsCordsY) && lastYGreater) {
      this.dotsCords[key].y = value[1];
    }
  }

  getCords(
    key: string
  ) {
    return this.dotsCords[key];
  }

  calcAbsoluteCords(
    value: {
      x: number
      y: number
    },
  ): [number, number] {
    const {x, y} = this.cropPoints;
    return [
      Math.ceil((value.x * this.movenetModelService.cropWidth) + x - (this.pointWidth / 2)),
      Math.ceil((value.y * this.movenetModelService.cropWidth) + y - (this.pointWidth / 2))
    ]
  }

  updateDot(
    key: string
  ) {
    if (!this.dotsRefs[key]) return;
    this.dotsRefs[key].style.top = `${this.dotsCords[key].y}px`;
    this.dotsRefs[key].style.left = `${this.dotsCords[key].x}px`;
  }

  async drawPoints(cords: any) {
    Object.keys(this.dotsCords).forEach((key) => {
      this.putDot(cords, key);
    });
  }

  predictWebcam() {
    this.movenetModelService.calculate()
      .then(cords => this.drawPoints(cords))
      .then(() => {
        window.requestAnimationFrame(() => {
          this.predictWebcamThrottled();
        });
      })
      .catch((error: any) => {
        console.error(error);
      });
  }

  makePhotoByTimeout(
    timeout: number
  ) {
    setTimeout(() => {
      this.makePhoto();
    }, timeout)
  }

  makePhoto() {
    this.openPhotoInNewTab(this.cameraService.makePhoto() ?? '');
  }

  openPhotoInNewTab(
    dataUrl: string
  ) {
    const win = window.open();
    if (!win) return;
    win.document.write(`<img src="${dataUrl}"/>`);
  }

  private _enableCam() {
    this.cameraService.enableCam().then(() => {
      this.predictWebcamThrottled();
    })
  }

  private isOk(
    stdDeviation: number
  ) {
    return stdDeviation > this.stdDeviationThreshold;
  }

  private calculateStdDeviation(
    coords: number[],
    newValue: number,
  ): number {
    if (newValue) coords.push(newValue);
    if (coords.length > this.bufferLength) coords.shift();
    return Helpers.calculateStdDeviation(
      coords,
      Helpers.calculateMean(coords)
    );
  }
}
