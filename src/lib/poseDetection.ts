import {
  PoseLandmarker,
  FilesetResolver,
  type PoseLandmarkerResult,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'

export interface BodyMeasurements {
  ancho_hombros: number   // px units (relative to image width)
  cintura: number
  cadera: number
  largo_torso: number
  largo_piernas: number
  altura_estimada: number
  landmarks: NormalizedLandmark[]
}

let landmarker: PoseLandmarker | null = null

export async function initPoseLandmarker(): Promise<void> {
  if (landmarker) return

  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  )

  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'GPU',
    },
    runningMode: 'IMAGE',
    numPoses: 1,
  })
}

// MediaPipe landmark indices
const LANDMARKS = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  NOSE: 0,
}

/**
 * Extracts body measurements from an HTMLImageElement using MediaPipe Pose.
 * All measurements are normalized (0-1) relative to image dimensions.
 * The photo NEVER leaves the device — everything runs in WASM in the browser.
 */
export async function extractMeasurements(
  image: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
): Promise<BodyMeasurements | null> {
  if (!landmarker) {
    await initPoseLandmarker()
  }
  if (!landmarker) throw new Error('PoseLandmarker failed to initialize')

  let result: PoseLandmarkerResult
  try {
    result = landmarker.detect(image as HTMLImageElement)
  } catch {
    throw new Error('Pose detection failed — make sure the full body is visible')
  }

  if (!result.landmarks || result.landmarks.length === 0) {
    return null
  }

  const lm = result.landmarks[0]

  const leftShoulder = lm[LANDMARKS.LEFT_SHOULDER]
  const rightShoulder = lm[LANDMARKS.RIGHT_SHOULDER]
  const leftHip = lm[LANDMARKS.LEFT_HIP]
  const rightHip = lm[LANDMARKS.RIGHT_HIP]
  const leftKnee = lm[LANDMARKS.LEFT_KNEE]
  const rightKnee = lm[LANDMARKS.RIGHT_KNEE]
  const leftAnkle = lm[LANDMARKS.LEFT_ANKLE]
  const rightAnkle = lm[LANDMARKS.RIGHT_ANKLE]

  // Euclidean distance between two landmarks
  const dist = (a: NormalizedLandmark, b: NormalizedLandmark) =>
    Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2))

  // Midpoint
  const mid = (a: NormalizedLandmark, b: NormalizedLandmark) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  })

  const shoulderMid = mid(leftShoulder, rightShoulder)
  const hipMid = mid(leftHip, rightHip)
  const kneeMid = mid(leftKnee, rightKnee)
  const ankleMid = mid(leftAnkle, rightAnkle)

  // Estimate waist as midpoint between shoulder-mid and hip-mid
  const waistY = (shoulderMid.y + hipMid.y) / 2
  const waistWidth = dist(leftShoulder, rightShoulder) * 0.75 // approximation

  const measurements: BodyMeasurements = {
    ancho_hombros: dist(leftShoulder, rightShoulder),
    cintura: waistWidth,
    cadera: dist(leftHip, rightHip),
    largo_torso: Math.abs(hipMid.y - shoulderMid.y),
    largo_piernas: Math.abs(ankleMid.y - hipMid.y),
    altura_estimada: Math.abs(ankleMid.y - Math.min(leftShoulder.y, rightShoulder.y)) * 1.15,
    landmarks: lm,
  }

  // Suppress unused variable warning
  void waistY
  void kneeMid

  return measurements
}

/**
 * Draw a stylized mannequin on a canvas based on extracted measurements.
 * Uses normalized coordinates scaled to canvas dimensions.
 */
export function drawMannequin(
  canvas: HTMLCanvasElement,
  _measurements: BodyMeasurements,
  landmarks: NormalizedLandmark[]
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const W = canvas.width
  const H = canvas.height

  ctx.clearRect(0, 0, W, H)

  // Scale landmark coordinates to canvas
  const pt = (lm: NormalizedLandmark) => ({ x: lm.x * W, y: lm.y * H })

  const lShoulder = pt(landmarks[LANDMARKS.LEFT_SHOULDER])
  const rShoulder = pt(landmarks[LANDMARKS.RIGHT_SHOULDER])
  const lHip = pt(landmarks[LANDMARKS.LEFT_HIP])
  const rHip = pt(landmarks[LANDMARKS.RIGHT_HIP])
  const lKnee = pt(landmarks[LANDMARKS.LEFT_KNEE])
  const rKnee = pt(landmarks[LANDMARKS.RIGHT_KNEE])
  const lAnkle = pt(landmarks[LANDMARKS.LEFT_ANKLE])
  const rAnkle = pt(landmarks[LANDMARKS.RIGHT_ANKLE])

  const shoulderMidX = (lShoulder.x + rShoulder.x) / 2
  const shoulderMidY = (lShoulder.y + rShoulder.y) / 2
  const hipMidX = (lHip.x + rHip.x) / 2
  const hipMidY = (lHip.y + rHip.y) / 2
  void hipMidX // Used only for reference, path uses lHip/rHip directly

  // Head (circle above shoulders)
  const headRadius = Math.abs(lShoulder.x - rShoulder.x) * 0.22
  const headY = shoulderMidY - headRadius * 2.2

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, headY - headRadius, 0, Math.max(lAnkle.y, rAnkle.y))
  gradient.addColorStop(0, 'rgba(200, 180, 195, 0.95)')
  gradient.addColorStop(0.4, 'rgba(180, 155, 175, 0.95)')
  gradient.addColorStop(1, 'rgba(150, 120, 145, 0.9)')

  ctx.fillStyle = gradient
  ctx.strokeStyle = 'rgba(255, 220, 240, 0.3)'
  ctx.lineWidth = 1.5

  // Build body silhouette path
  const waistInset = Math.abs(lShoulder.x - rShoulder.x) * 0.15
  const lWaistX = (lShoulder.x + lHip.x) / 2 + waistInset
  const rWaistX = (rShoulder.x + rHip.x) / 2 - waistInset
  const waistY = (shoulderMidY + hipMidY) / 2

  ctx.beginPath()
  // Left side: shoulder → waist → hip → knee → ankle
  ctx.moveTo(lShoulder.x, lShoulder.y)
  ctx.bezierCurveTo(lShoulder.x - headRadius * 0.3, waistY, lWaistX, waistY, lHip.x, lHip.y)
  ctx.lineTo(lKnee.x, lKnee.y)
  ctx.lineTo(lAnkle.x, lAnkle.y)
  // Cross at ankles
  ctx.lineTo(rAnkle.x, rAnkle.y)
  // Right side: ankle → knee → hip → waist → shoulder
  ctx.lineTo(rKnee.x, rKnee.y)
  ctx.lineTo(rHip.x, rHip.y)
  ctx.bezierCurveTo(rWaistX, waistY, rShoulder.x + headRadius * 0.3, waistY, rShoulder.x, rShoulder.y)
  // Neck
  ctx.lineTo(shoulderMidX + headRadius * 0.4, shoulderMidY - headRadius * 0.5)
  ctx.lineTo(shoulderMidX - headRadius * 0.4, shoulderMidY - headRadius * 0.5)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Head
  ctx.beginPath()
  ctx.arc(shoulderMidX, headY, headRadius, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(200, 175, 195, 0.95)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 220, 240, 0.3)'
  ctx.stroke()

  // Subtle inner highlight
  const innerGrad = ctx.createRadialGradient(
    shoulderMidX - headRadius * 0.2, shoulderMidY,
    headRadius * 0.1,
    shoulderMidX, shoulderMidY,
    headRadius * 3
  )
  innerGrad.addColorStop(0, 'rgba(255, 240, 250, 0.15)')
  innerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = innerGrad
  ctx.beginPath()
  ctx.arc(shoulderMidX, headY, headRadius, 0, Math.PI * 2)
  ctx.fill()
}
