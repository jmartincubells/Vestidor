import { useId } from 'react'
import type { RealMeasurements } from '../pages/OnboardingPage'

interface MannequinPreviewProps {
  measurements: Partial<RealMeasurements> | null | undefined
  facePhotoUrl?: string | null
  userBodyCutout?: string | null
  showOverlay?: boolean
  style?: React.CSSProperties
  className?: string
}

/**
 * Ensures any base64 or URL string has a valid Data URL prefix for SVG <image> compatibility.
 */
function ensureDataUrl(src: string | null | undefined): string | null {
  if (!src) return null
  const trimmed = src.trim()
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  ) {
    return trimmed
  }
  // Raw base64 string from database: add PNG data URL prefix
  return `data:image/png;base64,${trimmed}`
}

export function MannequinPreview({
  measurements,
  facePhotoUrl,
  userBodyCutout,
  showOverlay = true,
  style,
  className,
}: MannequinPreviewProps) {
  const maskId = useId()

  const cutoutUrl = ensureDataUrl(userBodyCutout)
  const faceUrl = ensureDataUrl(facePhotoUrl)

  // Strict sanitization & fallbacks to prevent NaN
  const heightCm = Math.max(120, Math.min(220, Number(measurements?.altura_cm) || 165))
  const hombrosCm = Math.max(25, Math.min(70, Number(measurements?.hombros_cm) || 38))
  const cinturaCm = Math.max(40, Math.min(140, Number(measurements?.cintura_cm) || 70))
  const caderaCm = Math.max(50, Math.min(160, Number(measurements?.cadera_cm) || 95))
  const torsoCm = Math.max(30, Math.min(75, Number(measurements?.largo_torso_cm) || 45))
  const piernasCm = Math.max(50, Math.min(120, Number(measurements?.largo_piernas_cm) || 80))

  const H = 700
  const W = 400
  const cx = W / 2

  const availableH = H * 0.82
  const scale = availableH / heightCm

  const flatShoulder = hombrosCm
  const flatWaist = cinturaCm * 0.32
  const flatHip = caderaCm * 0.32

  const shoulderW = Math.max(32, (flatShoulder * scale) / 2)
  const waistW = Math.max(24, (flatWaist * scale) / 2)
  const hipW = Math.max(32, (flatHip * scale) / 2)
  const torsoH = Math.max(70, torsoCm * scale)
  const legH = Math.max(110, piernasCm * scale)

  const headR = Math.max(22, shoulderW * 0.4)
  const startY = H * 0.05
  const headY = startY + headR
  const shoulderY = headY + headR * 1.35
  const waistY = shoulderY + torsoH * 0.45
  const hipY = shoulderY + torsoH
  const crotchY = hipY + torsoH * 0.16
  const kneeY = crotchY + (legH - torsoH * 0.16) * 0.48
  const ankleY = Math.min(H * 0.94, hipY + legH)

  const outerLegShift = Math.max(10, hipW * 0.5)
  const innerLegGap = Math.max(6, shoulderW * 0.1)
  const armThickness = Math.max(8, shoulderW * 0.18)
  const handY = Math.min(ankleY - 20, hipY + torsoH * 0.22)

  // 1. Torso & Separated Legs Path
  const bodyAndLegsPath = `
    M ${cx - shoulderW} ${shoulderY}
    C ${cx - shoulderW - 2} ${waistY - torsoH * 0.2}, ${cx - waistW} ${waistY}, ${cx - hipW} ${hipY}
    C ${cx - hipW} ${hipY + (crotchY - hipY) * 0.5}, ${cx - outerLegShift - 10} ${kneeY}, ${cx - outerLegShift - 6} ${ankleY}
    L ${cx - innerLegGap - 12} ${ankleY}
    C ${cx - innerLegGap - 6} ${kneeY}, ${cx - innerLegGap - 2} ${crotchY + 20}, ${cx - 3} ${crotchY}
    C ${cx - 1} ${crotchY - 6}, ${cx + 1} ${crotchY - 6}, ${cx + 3} ${crotchY}
    C ${cx + innerLegGap + 2} ${crotchY + 20}, ${cx + innerLegGap + 6} ${kneeY}, ${cx + innerLegGap + 12} ${ankleY}
    L ${cx + outerLegShift + 6} ${ankleY}
    C ${cx + outerLegShift + 10} ${kneeY}, ${cx + hipW} ${hipY + (crotchY - hipY) * 0.5}, ${cx + hipW} ${hipY}
    C ${cx + waistW} ${waistY}, ${cx + shoulderW + 2} ${waistY - torsoH * 0.2}, ${cx + shoulderW} ${shoulderY}
    C ${cx + shoulderW * 0.6} ${shoulderY - 4}, ${cx + headR * 0.4} ${shoulderY - headR * 0.3}, ${cx + headR * 0.35} ${shoulderY - headR * 0.25}
    L ${cx - headR * 0.35} ${shoulderY - headR * 0.25}
    C ${cx - headR * 0.4} ${shoulderY - headR * 0.3}, ${cx - shoulderW * 0.6} ${shoulderY - 4}, ${cx - shoulderW} ${shoulderY}
    Z
  `

  // 2. Left Arm Path
  const leftArmPath = `
    M ${cx - shoulderW} ${shoulderY + 2}
    C ${cx - shoulderW - 14} ${shoulderY + torsoH * 0.2}, ${cx - shoulderW - 16} ${waistY}, ${cx - hipW - 10} ${handY}
    C ${cx - hipW - 13} ${handY + 12}, ${cx - hipW - 1} ${handY + 12}, ${cx - hipW + 1} ${handY}
    C ${cx - waistW - armThickness} ${waistY + 10}, ${cx - shoulderW + armThickness * 0.8} ${shoulderY + torsoH * 0.25}, ${cx - shoulderW + armThickness * 1.5} ${shoulderY + 14}
    Z
  `

  // 3. Right Arm Path
  const rightArmPath = `
    M ${cx + shoulderW} ${shoulderY + 2}
    C ${cx + shoulderW + 14} ${shoulderY + torsoH * 0.2}, ${cx + shoulderW + 16} ${waistY}, ${cx + hipW + 10} ${handY}
    C ${cx + hipW + 13} ${handY + 12}, ${cx + hipW + 1} ${handY + 12}, ${cx + hipW - 1} ${handY}
    C ${cx + waistW + armThickness} ${waistY + 10}, ${cx + shoulderW - armThickness * 0.8} ${shoulderY + torsoH * 0.25}, ${cx + shoulderW - armThickness * 1.5} ${shoulderY + 14}
    Z
  `

  // Fill opacity when overlaying over real body photo
  const hasCutout = Boolean(cutoutUrl && showOverlay)
  const fillStyle = hasCutout ? 'rgba(215, 175, 200, 0.40)' : `url(#bodyGrad-${maskId})`
  const strokeStyle = hasCutout ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 230, 248, 0.8)'

  return (
    <svg
      viewBox="0 0 400 700"
      className={className}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        ...style,
      }}
    >
      <defs>
        {/* Glow Halo Background */}
        <radialGradient id={`halo-${maskId}`} cx="50%" cy="50%" r="48%">
          <stop offset="0%" stopColor="rgba(201, 160, 180, 0.35)" />
          <stop offset="100%" stopColor="rgba(0, 0, 0, 0)" />
        </radialGradient>

        {/* Premium Body Metallic Gradient */}
        <linearGradient id={`bodyGrad-${maskId}`} x1="0" y1={headY} x2="0" y2={ankleY} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgba(225, 195, 215, 0.95)" />
          <stop offset="40%" stopColor="rgba(195, 160, 185, 0.95)" />
          <stop offset="100%" stopColor="rgba(160, 125, 152, 0.90)" />
        </linearGradient>

        {/* Circular clip for face photo */}
        {faceUrl && (
          <clipPath id={`faceClip-${maskId}`}>
            <circle cx={cx} cy={headY} r={headR} />
          </clipPath>
        )}
      </defs>

      {/* Halo Background */}
      <rect width={W} height={H} fill={`url(#halo-${maskId})`} />

      {/* Real Body Photo Cutout Layer (Rendered in background if present) */}
      {cutoutUrl && showOverlay && (
        <image
          href={cutoutUrl}
          xlinkHref={cutoutUrl}
          x="20"
          y="20"
          width="360"
          height="660"
          preserveAspectRatio="xMidYMid meet"
          opacity={0.75}
        />
      )}

      {/* Vector Mannequin Silhouette Layer (Torso, Arms, Separated Legs, Head) */}
      <g>
        {/* Torso & Separated Legs */}
        <path
          d={bodyAndLegsPath}
          fill={fillStyle}
          stroke={strokeStyle}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        {/* Left Arm */}
        <path
          d={leftArmPath}
          fill={fillStyle}
          stroke={strokeStyle}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        {/* Right Arm */}
        <path
          d={rightArmPath}
          fill={fillStyle}
          stroke={strokeStyle}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        {/* Head Circle + Optional Face Photo Overlay */}
        {faceUrl ? (
          <g>
            <circle
              cx={cx}
              cy={headY}
              r={headR}
              fill={fillStyle}
              stroke={strokeStyle}
              strokeWidth="2.5"
            />
            <image
              href={faceUrl}
              xlinkHref={faceUrl}
              x={cx - headR}
              y={headY - headR}
              width={headR * 2}
              height={headR * 2}
              clipPath={`url(#faceClip-${maskId})`}
              preserveAspectRatio="xMidYMid slice"
            />
            <circle
              cx={cx}
              cy={headY}
              r={headR}
              fill="none"
              stroke="#c9a0b4"
              strokeWidth="3"
            />
          </g>
        ) : (
          <circle
            cx={cx}
            cy={headY}
            r={headR}
            fill={fillStyle}
            stroke={strokeStyle}
            strokeWidth="2.5"
          />
        )}
      </g>
    </svg>
  )
}

/**
 * Converts mannequin parameters to a PNG data URL synchronously via canvas export.
 * Used for saving to DB or local storage cache.
 */
export function exportMannequinToDataUrl(
  measurements: Partial<RealMeasurements> | null | undefined,
  facePhotoUrl?: string | null,
  userBodyCutout?: string | null
): string {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 700
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''

    const cutoutUrl = ensureDataUrl(userBodyCutout)
    const faceUrl = ensureDataUrl(facePhotoUrl)

    const heightCm = Math.max(120, Math.min(220, Number(measurements?.altura_cm) || 165))
    const hombrosCm = Math.max(25, Math.min(70, Number(measurements?.hombros_cm) || 38))
    const cinturaCm = Math.max(40, Math.min(140, Number(measurements?.cintura_cm) || 70))
    const caderaCm = Math.max(50, Math.min(160, Number(measurements?.cadera_cm) || 95))
    const torsoCm = Math.max(30, Math.min(75, Number(measurements?.largo_torso_cm) || 45))
    const piernasCm = Math.max(50, Math.min(120, Number(measurements?.largo_piernas_cm) || 80))

    const H = 700
    const W = 400
    const cx = W / 2

    const availableH = H * 0.82
    const scale = availableH / heightCm

    const flatShoulder = hombrosCm
    const flatWaist = cinturaCm * 0.32
    const flatHip = caderaCm * 0.32

    const shoulderW = Math.max(32, (flatShoulder * scale) / 2)
    const waistW = Math.max(24, (flatWaist * scale) / 2)
    const hipW = Math.max(32, (flatHip * scale) / 2)
    const torsoH = Math.max(70, torsoCm * scale)
    const legH = Math.max(110, piernasCm * scale)

    const headR = Math.max(22, shoulderW * 0.4)
    const startY = H * 0.05
    const headY = startY + headR
    const shoulderY = headY + headR * 1.35
    const waistY = shoulderY + torsoH * 0.45
    const hipY = shoulderY + torsoH
    const crotchY = hipY + torsoH * 0.16
    const kneeY = crotchY + (legH - torsoH * 0.16) * 0.48
    const ankleY = Math.min(H * 0.94, hipY + legH)

    const outerLegShift = Math.max(10, hipW * 0.5)
    const innerLegGap = Math.max(6, shoulderW * 0.1)
    const armThickness = Math.max(8, shoulderW * 0.18)
    const handY = Math.min(ankleY - 20, hipY + torsoH * 0.22)

    // Halo background
    const halo = ctx.createRadialGradient(cx, H * 0.5, 20, cx, H * 0.5, W * 0.45)
    halo.addColorStop(0, 'rgba(201, 160, 180, 0.25)')
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, W, H)

    if (cutoutUrl) {
      const img = new Image()
      img.src = cutoutUrl
      ctx.drawImage(img, 20, 20, 360, 660)
      return canvas.toDataURL('image/png')
    }

    // Body gradient
    const grad = ctx.createLinearGradient(0, headY, 0, ankleY)
    grad.addColorStop(0, 'rgba(225, 195, 215, 0.95)')
    grad.addColorStop(0.4, 'rgba(195, 160, 185, 0.95)')
    grad.addColorStop(1, 'rgba(160, 125, 152, 0.90)')
    ctx.fillStyle = grad
    ctx.strokeStyle = 'rgba(255, 230, 248, 0.8)'
    ctx.lineWidth = 2.5

    // Body path
    const pBody = new Path2D(`
      M ${cx - shoulderW} ${shoulderY}
      C ${cx - shoulderW - 2} ${waistY - torsoH * 0.2}, ${cx - waistW} ${waistY}, ${cx - hipW} ${hipY}
      C ${cx - hipW} ${hipY + (crotchY - hipY) * 0.5}, ${cx - outerLegShift - 10} ${kneeY}, ${cx - outerLegShift - 6} ${ankleY}
      L ${cx - innerLegGap - 12} ${ankleY}
      C ${cx - innerLegGap - 6} ${kneeY}, ${cx - innerLegGap - 2} ${crotchY + 20}, ${cx - 3} ${crotchY}
      C ${cx - 1} ${crotchY - 6}, ${cx + 1} ${crotchY - 6}, ${cx + 3} ${crotchY}
      C ${cx + innerLegGap + 2} ${crotchY + 20}, ${cx + innerLegGap + 6} ${kneeY}, ${cx + innerLegGap + 12} ${ankleY}
      L ${cx + outerLegShift + 6} ${ankleY}
      C ${cx + outerLegShift + 10} ${kneeY}, ${cx + hipW} ${hipY + (crotchY - hipY) * 0.5}, ${cx + hipW} ${hipY}
      C ${cx + waistW} ${waistY}, ${cx + shoulderW + 2} ${waistY - torsoH * 0.2}, ${cx + shoulderW} ${shoulderY}
      C ${cx + shoulderW * 0.6} ${shoulderY - 4}, ${cx + headR * 0.4} ${shoulderY - headR * 0.3}, ${cx + headR * 0.35} ${shoulderY - headR * 0.25}
      L ${cx - headR * 0.35} ${shoulderY - headR * 0.25}
      C ${cx - headR * 0.4} ${shoulderY - headR * 0.3}, ${cx - shoulderW * 0.6} ${shoulderY - 4}, ${cx - shoulderW} ${shoulderY}
      Z
    `)
    ctx.fill(pBody)
    ctx.stroke(pBody)

    // Left Arm
    const pLArm = new Path2D(`
      M ${cx - shoulderW} ${shoulderY + 2}
      C ${cx - shoulderW - 14} ${shoulderY + torsoH * 0.2}, ${cx - shoulderW - 16} ${waistY}, ${cx - hipW - 10} ${handY}
      C ${cx - hipW - 13} ${handY + 12}, ${cx - hipW - 1} ${handY + 12}, ${cx - hipW + 1} ${handY}
      C ${cx - waistW - armThickness} ${waistY + 10}, ${cx - shoulderW + armThickness * 0.8} ${shoulderY + torsoH * 0.25}, ${cx - shoulderW + armThickness * 1.5} ${shoulderY + 14}
      Z
    `)
    ctx.fill(pLArm)
    ctx.stroke(pLArm)

    // Right Arm
    const pRArm = new Path2D(`
      M ${cx + shoulderW} ${shoulderY + 2}
      C ${cx + shoulderW + 14} ${shoulderY + torsoH * 0.2}, ${cx + shoulderW + 16} ${waistY}, ${cx + hipW + 10} ${handY}
      C ${cx + hipW + 13} ${handY + 12}, ${cx + hipW + 1} ${handY + 12}, ${cx + hipW - 1} ${handY}
      C ${cx + waistW + armThickness} ${waistY + 10}, ${cx + shoulderW - armThickness * 0.8} ${shoulderY + torsoH * 0.25}, ${cx + shoulderW - armThickness * 1.5} ${shoulderY + 14}
      Z
    `)
    ctx.fill(pRArm)
    ctx.stroke(pRArm)

    // Head
    ctx.beginPath()
    ctx.arc(cx, headY, headR, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    if (faceUrl) {
      const faceImg = new Image()
      faceImg.src = faceUrl
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, headY, headR, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(faceImg, cx - headR, headY - headR, headR * 2, headR * 2)
      ctx.restore()
      ctx.beginPath()
      ctx.arc(cx, headY, headR, 0, Math.PI * 2)
      ctx.strokeStyle = '#c9a0b4'
      ctx.lineWidth = 3
      ctx.stroke()
    }

    return canvas.toDataURL('image/png')
  } catch (err) {
    console.error('exportMannequinToDataUrl error:', err)
    return ''
  }
}
