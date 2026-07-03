import { useRef, useState, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { initPoseLandmarker, extractMeasurements, drawMannequin, type BodyMeasurements } from '../lib/poseDetection'
import { removeImageBackground } from '../lib/backgroundRemoval'
import { cacheMannequin } from '../lib/idb'

type OnboardingStep = 'intro' | 'processing' | 'preview' | 'saving' | 'done' | 'error'

interface OnboardingPageProps {
  user: User
  onComplete: () => void
}

export default function OnboardingPage({ user, onComplete }: OnboardingPageProps) {
  const [step, setStep] = useState<OnboardingStep>('intro')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [measurements, setMeasurements] = useState<BodyMeasurements | null>(null)
  const [capturedImageUrl, setCapturedImageUrl] = useState<string | null>(null)

  // Two separate inputs: one with capture, one without
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  const processPhoto = useCallback(async (file: File) => {
    setStep('processing')
    setProgress(5)
    setErrorMsg('')

    try {
      // Step 1: Load the image into an HTMLImageElement
      setProgressLabel('Cargando imagen…')
      const imageUrl = URL.createObjectURL(file)
      setCapturedImageUrl(imageUrl)

      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('No se pudo cargar la imagen'))
        img.src = imageUrl
      })
      setProgress(15)

      // Step 2: MediaPipe pose detection
      setProgressLabel('Descargando modelo de poses… (primera vez puede tardar ~20 seg)')
      await initPoseLandmarker()
      setProgress(45)

      setProgressLabel('Analizando cuerpo…')
      let bodyMeasurements: BodyMeasurements | null = null
      try {
        bodyMeasurements = await extractMeasurements(img)
      } catch {
        // MediaPipe failed (GPU not available on this device) — use estimates
        bodyMeasurements = null
      }

      if (!bodyMeasurements) {
        // Fallback: use proportional estimates instead of blocking the user
        bodyMeasurements = {
          ancho_hombros: 0.22,
          cintura: 0.17,
          cadera: 0.24,
          largo_torso: 0.28,
          largo_piernas: 0.45,
          altura_estimada: 0.85,
          landmarks: [],
        }
      }

      setMeasurements(bodyMeasurements)
      setProgress(65)

      // Step 3: Background removal
      setProgressLabel('Extrayendo silueta… (descargando modelo ~20 MB)')
      try {
        await removeImageBackground(file, (p) => {
          setProgress(65 + Math.round(p * 0.25))
        })
      } catch {
        // If background removal fails, continue without it — we still have measurements
        console.warn('Background removal failed, continuing without it')
      }
      setProgress(92)

      // Step 4: Draw mannequin
      setProgressLabel('Dibujando maniquí…')
      if (canvasRef.current) {
        canvasRef.current.width = 400
        canvasRef.current.height = 700
        if (bodyMeasurements.landmarks.length > 0) {
          drawMannequin(canvasRef.current, bodyMeasurements, bodyMeasurements.landmarks)
        } else {
          drawFallbackMannequin(canvasRef.current)
        }
      }

      setProgress(100)
      setStep('preview')

    } catch (err) {
      console.error('Onboarding processing error:', err)
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setErrorMsg(msg)
      setStep('error')
    }
  }, [])

  async function saveMannequin() {
    if (!measurements) return
    setStep('saving')

    try {
      let svgData: string | null = null
      if (canvasRef.current) {
        svgData = canvasRef.current.toDataURL('image/png')
      }

      const { error } = await supabase
        .from('maniqui')
        .upsert({
          user_id: user.id,
          ancho_hombros: measurements.ancho_hombros,
          cintura: measurements.cintura,
          cadera: measurements.cadera,
          largo_torso: measurements.largo_torso,
          largo_piernas: measurements.largo_piernas,
          altura_estimada: measurements.altura_estimada,
          landmarks_json: { landmarks: measurements.landmarks },
        })
        .select()

      if (error) throw error

      await cacheMannequin({
        measurements: {
          ancho_hombros: measurements.ancho_hombros,
          cintura: measurements.cintura,
          cadera: measurements.cadera,
          largo_torso: measurements.largo_torso,
          largo_piernas: measurements.largo_piernas,
          altura_estimada: measurements.altura_estimada,
        },
        svgData,
      })

      setStep('done')
      setTimeout(onComplete, 1500)
    } catch (err) {
      console.error('Save mannequin error:', err)
      setErrorMsg('Error al guardar las medidas. Revisá tu conexión a internet.')
      setStep('error')
    }
  }

  function reset() {
    setStep('intro')
    setCapturedImageUrl(null)
    setMeasurements(null)
    setProgress(0)
    setProgressLabel('')
    setErrorMsg('')
    // Reset file inputs
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
  }

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processPhoto(file)
  }, [processPhoto])

  return (
    <div className="page-centered" style={{ gap: 'var(--space-lg)', textAlign: 'center' }}>

      {/* Hidden file inputs — static attributes for iOS Safari compatibility */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* ── INTRO ── */}
      {step === 'intro' && (
        <div className="animate-fade-in flex flex-col items-center gap-lg" style={{ maxWidth: 360, width: '100%' }}>
          <div style={{ fontSize: '3.5rem' }}>👗</div>

          <div>
            <h1 className="font-display text-2xl font-semibold text-primary" style={{ marginBottom: 8 }}>
              Creemos tu maniquí
            </h1>
            <p className="text-sm text-muted" style={{ lineHeight: 1.7 }}>
              Usamos una foto tuya para generar un maniquí personalizado.{' '}
              <strong className="text-accent">Tu foto nunca sale del dispositivo.</strong>
            </p>
          </div>

          <div className="glass flex flex-col gap-sm" style={{ padding: 'var(--space-md)', width: '100%', textAlign: 'left' }}>
            {[
              ['📏', 'Parate derecha, cuerpo completo visible de cabeza a pies'],
              ['💡', 'Buena iluminación, fondo claro si es posible'],
              ['👙', 'Ropa ajustada da mejores medidas'],
              ['⏱️', 'La primera vez tarda ~30 seg descargando modelos'],
            ].map(([icon, text]) => (
              <div key={text} className="flex items-center gap-sm">
                <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{icon}</span>
                <span className="text-sm text-muted">{text}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-sm w-full">
            <button
              id="btn-take-photo"
              className="btn btn-primary w-full"
              onClick={() => cameraInputRef.current?.click()}
            >
              📸 Sacarme una foto
            </button>
            <button
              id="btn-choose-photo"
              className="btn btn-secondary w-full"
              onClick={() => galleryInputRef.current?.click()}
            >
              Elegir de la galería
            </button>
          </div>
        </div>
      )}

      {/* ── PROCESSING ── */}
      {step === 'processing' && (
        <div className="animate-fade-in flex flex-col items-center gap-lg" style={{ maxWidth: 320, width: '100%' }}>
          <div className="spinner spinner-lg animate-pulse-glow" />

          <div>
            <h2 className="font-display text-xl font-semibold" style={{ marginBottom: 8 }}>
              Analizando…
            </h2>
            <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>{progressLabel}</p>
          </div>

          <div style={{ width: '100%', height: 6, background: 'var(--clr-surface-3)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${progress}%`,
              background: 'linear-gradient(90deg, var(--clr-primary-dim), var(--clr-primary))',
              borderRadius: 3,
              transition: 'width 0.5s var(--ease-out)',
            }} />
          </div>

          <p className="text-xs text-dimmed" style={{ lineHeight: 1.5 }}>
            Todo se procesa en tu dispositivo.<br />
            La primera vez descarga ~40 MB de modelos de IA.<br />
            <strong>No cierres la app.</strong>
          </p>
        </div>
      )}

      {/* ── PREVIEW ── */}
      {step === 'preview' && measurements && (
        <div className="animate-fade-in flex flex-col items-center gap-lg" style={{ maxWidth: 360, width: '100%' }}>
          <h2 className="font-display text-xl font-semibold text-primary">
            ¡Tu maniquí está listo!
          </h2>

          <div style={{
            position: 'relative',
            width: 200,
            height: 360,
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            border: '1px solid var(--clr-border)',
            background: 'var(--clr-surface-2)',
            boxShadow: 'var(--shadow-glow)',
          }}>
            {capturedImageUrl && (
              <img
                ref={imageRef}
                src={capturedImageUrl}
                alt="Foto"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.12 }}
              />
            )}
            <canvas
              ref={canvasRef}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>

          <div className="flex flex-col gap-xs w-full">
            {[
              ['Hombros', measurements.ancho_hombros],
              ['Cintura', measurements.cintura],
              ['Cadera', measurements.cadera],
            ].map(([label, val]) => (
              <div key={label as string} className="glass-sm flex justify-between items-center" style={{ padding: '8px 14px' }}>
                <span className="text-sm text-muted">{label as string}</span>
                <span className="text-sm font-medium text-primary">
                  {((val as number) * 100).toFixed(1)} <span className="text-dimmed text-xs">rel</span>
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-sm w-full">
            <button id="btn-save-mannequin" className="btn btn-primary w-full" onClick={saveMannequin}>
              Guardar y continuar ✨
            </button>
            <button className="btn btn-ghost btn-sm" onClick={reset}>
              Sacar otra foto
            </button>
          </div>
        </div>
      )}

      {/* ── SAVING / DONE ── */}
      {(step === 'saving' || step === 'done') && (
        <div className="animate-fade-in flex flex-col items-center gap-lg">
          {step === 'done' ? (
            <>
              <div style={{ fontSize: '3rem' }}>✅</div>
              <h2 className="font-display text-xl font-semibold text-primary">¡Listo! Empecemos.</h2>
            </>
          ) : (
            <>
              <div className="spinner spinner-lg" />
              <p className="text-sm text-muted">Guardando tu maniquí…</p>
            </>
          )}
        </div>
      )}

      {/* ── ERROR ── */}
      {step === 'error' && (
        <div className="animate-fade-in flex flex-col items-center gap-lg" style={{ maxWidth: 320, width: '100%' }}>
          <div style={{ fontSize: '2.5rem' }}>⚠️</div>
          <h2 className="font-display text-lg font-semibold" style={{ color: 'var(--clr-danger)' }}>
            Algo salió mal
          </h2>
          {errorMsg && (
            <div className="glass-sm" style={{ padding: 'var(--space-md)', width: '100%' }}>
              <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>{errorMsg}</p>
            </div>
          )}
          <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>
            Asegurate de tener buena conexión a internet y volvé a intentarlo.
          </p>
          <button id="btn-retry-photo" className="btn btn-primary w-full" onClick={reset}>
            Intentar de nuevo
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Fallback mannequin when MediaPipe landmarks aren't available
 */
function drawFallbackMannequin(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)

  const cx = W / 2
  const gradient = ctx.createLinearGradient(0, 0, 0, H)
  gradient.addColorStop(0, 'rgba(200, 175, 195, 0.95)')
  gradient.addColorStop(0.5, 'rgba(175, 148, 170, 0.95)')
  gradient.addColorStop(1, 'rgba(145, 115, 140, 0.90)')

  ctx.fillStyle = gradient
  ctx.strokeStyle = 'rgba(255, 220, 240, 0.3)'
  ctx.lineWidth = 1.5

  // Head
  ctx.beginPath()
  ctx.arc(cx, H * 0.1, W * 0.1, 0, Math.PI * 2)
  ctx.fill(); ctx.stroke()

  // Body silhouette (simplified hourglass)
  ctx.beginPath()
  ctx.moveTo(cx - W * 0.18, H * 0.18)           // left shoulder
  ctx.bezierCurveTo(
    cx - W * 0.22, H * 0.35,                     // waist left control
    cx - W * 0.20, H * 0.35,
    cx - W * 0.22, H * 0.48                       // left hip
  )
  ctx.lineTo(cx - W * 0.18, H * 0.78)            // left ankle
  ctx.lineTo(cx + W * 0.18, H * 0.78)            // right ankle
  ctx.lineTo(cx + W * 0.22, H * 0.48)            // right hip
  ctx.bezierCurveTo(
    cx + W * 0.20, H * 0.35,
    cx + W * 0.22, H * 0.35,                     // waist right control
    cx + W * 0.18, H * 0.18                       // right shoulder
  )
  ctx.lineTo(cx + W * 0.07, H * 0.16)            // neck right
  ctx.lineTo(cx - W * 0.07, H * 0.16)            // neck left
  ctx.closePath()
  ctx.fill(); ctx.stroke()
}
