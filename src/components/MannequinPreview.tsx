import { useId } from 'react'
import type { RealMeasurements } from '../pages/OnboardingPage'

interface MannequinPreviewProps {
  measurements: Partial<RealMeasurements> | null | undefined
  facePhotoUrl?: string | null
  userBodyCutout?: string | null
  style?: React.CSSProperties
  className?: string
}

export function MannequinPreview({
  measurements,
  facePhotoUrl,
  userBodyCutout,
  style,
  className,
}: MannequinPreviewProps) {
  const maskId = useId()
  
  // Strict sanitization & fallbacks to prevent NaN in SVG path coordinates
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

  const shoulderW = Math.max(35, (flatShoulder * scale) / 2)
  const waistW = Math.max(25, (flatWaist * scale) / 2)
  const hipW = Math.max(35, (flatHip * scale) / 2)
  const torsoH = Math.max(70, torsoCm * scale)
  const legH = Math.max(110, piernasCm * scale)

  const headR = Math.max(24, shoulderW * 0.45)
  const startY = H * 0.06
  const headY = startY + headR
  const shoulderY = headY + headR * 1.4
  const waistY = shoulderY + torsoH * 0.45
  const hipY = shoulderY + torsoH
  const ankleY = Math.min(H * 0.94, hipY + legH)

  // Construct SVG Bezier path for mannequin body
  const bodyPath = `
    M ${cx - shoulderW} ${shoulderY}
    C ${cx - shoulderW - 4} ${waistY - torsoH * 0.15}, ${cx - waistW} ${waistY}, ${cx - hipW} ${hipY}
    L ${cx - hipW * 0.55} ${ankleY}
    L ${cx + hipW * 0.55} ${ankleY}
    L ${cx + hipW} ${hipY}
    C ${cx + waistW} ${waistY}, ${cx + shoulderW + 4} ${waistY - torsoH * 0.15}, ${cx + shoulderW} ${shoulderY}
    L ${cx + headR * 0.35} ${shoulderY - headR * 0.25}
    L ${cx - headR * 0.35} ${shoulderY - headR * 0.25}
    Z
  `

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
        <radialGradient id={`halo-${maskId}`} cx="50%" cy="50%" r="45%">
          <stop offset="0%" stopColor="rgba(201, 160, 180, 0.3)" />
          <stop offset="100%" stopColor="rgba(0, 0, 0, 0)" />
        </radialGradient>

        {/* Premium Body Metallic Gradient */}
        <linearGradient id={`bodyGrad-${maskId}`} x1="0" y1={headY} x2="0" y2={ankleY} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgba(225, 195, 215, 0.95)" />
          <stop offset="40%" stopColor="rgba(195, 160, 185, 0.95)" />
          <stop offset="100%" stopColor="rgba(160, 125, 152, 0.90)" />
        </linearGradient>

        {/* Circular clip for face photo */}
        {facePhotoUrl && (
          <clipPath id={`faceClip-${maskId}`}>
            <circle cx={cx} cy={headY} r={headR} />
          </clipPath>
        )}
      </defs>

      {/* Halo Background */}
      <rect width={W} height={H} fill={`url(#halo-${maskId})`} />

      {userBodyCutout ? (
        <image
          href={userBodyCutout}
          x="20"
          y="20"
          width="360"
          height="660"
          preserveAspectRatio="xMidYMid meet"
        />
      ) : (
        <>
          {/* Mannequin Body Silhouette */}
          <path
            d={bodyPath}
            fill={`url(#bodyGrad-${maskId})`}
            stroke="rgba(255, 230, 248, 0.8)"
            strokeWidth="2.5"
          />

          {/* Head Circle + Optional Face Photo Overlay */}
          {facePhotoUrl ? (
            <g>
              <circle
                cx={cx}
                cy={headY}
                r={headR}
                fill={`url(#bodyGrad-${maskId})`}
                stroke="rgba(255, 230, 248, 0.8)"
                strokeWidth="2.5"
              />
              <image
                href={facePhotoUrl}
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
              fill={`url(#bodyGrad-${maskId})`}
              stroke="rgba(255, 230, 248, 0.8)"
              strokeWidth="2.5"
            />
          )}
        </>
      )}
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

    const shoulderW = Math.max(35, (flatShoulder * scale) / 2)
    const waistW = Math.max(25, (flatWaist * scale) / 2)
    const hipW = Math.max(35, (flatHip * scale) / 2)
    const torsoH = Math.max(70, torsoCm * scale)
    const legH = Math.max(110, piernasCm * scale)

    const headR = Math.max(24, shoulderW * 0.45)
    const startY = H * 0.06
    const headY = startY + headR
    const shoulderY = headY + headR * 1.4
    const waistY = shoulderY + torsoH * 0.45
    const hipY = shoulderY + torsoH
    const ankleY = Math.min(H * 0.94, hipY + legH)

    // Halo background
    const halo = ctx.createRadialGradient(cx, H * 0.5, 20, cx, H * 0.5, W * 0.45)
    halo.addColorStop(0, 'rgba(201, 160, 180, 0.25)')
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, W, H)

    if (userBodyCutout) {
      const img = new Image()
      img.src = userBodyCutout
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
    ctx.beginPath()
    ctx.moveTo(cx - shoulderW, shoulderY)
    ctx.bezierCurveTo(cx - shoulderW - 4, waistY - torsoH * 0.15, cx - waistW, waistY, cx - hipW, hipY)
    ctx.lineTo(cx - hipW * 0.55, ankleY)
    ctx.lineTo(cx + hipW * 0.55, ankleY)
    ctx.lineTo(cx + hipW, hipY)
    ctx.bezierCurveTo(cx + waistW, waistY, cx + shoulderW + 4, waistY - torsoH * 0.15, cx + shoulderW, shoulderY)
    ctx.lineTo(cx + headR * 0.35, shoulderY - headR * 0.25)
    ctx.lineTo(cx - headR * 0.35, shoulderY - headR * 0.25)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    // Head
    ctx.beginPath()
    ctx.arc(cx, headY, headR, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    if (facePhotoUrl) {
      const faceImg = new Image()
      faceImg.src = facePhotoUrl
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
