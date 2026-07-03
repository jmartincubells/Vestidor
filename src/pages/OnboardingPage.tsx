import { useRef, useState, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { initPoseLandmarker, extractMeasurements, drawMannequin, type BodyMeasurements } from '../lib/poseDetection'
import { removeImageBackground } from '../lib/backgroundRemoval'
import { cacheMannequin } from '../lib/idb'

type OnboardingStep = 'height' | 'photo' | 'processing' | 'preview' | 'saving' | 'done' | 'error'

interface OnboardingPageProps {
  user: User
  onComplete: () => void
}

interface RealMeasurements {
  hombros_cm: number
  cintura_cm: number
  cadera_cm: number
  largo_torso_cm: number
  largo_piernas_cm: number
  altura_cm: number
}

export default function OnboardingPage({ user, onComplete }: OnboardingPageProps) {
  const [step, setStep] = useState<OnboardingStep>('height')
  const [alturaInput, setAlturaInput] = useState('')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [measurements, setMeasurements] = useState<BodyMeasurements | null>(null)
  const [realMeasurements, setRealMeasurements] = useState<RealMeasurements | null>(null)
  const [_capturedImageUrl, setCapturedImageUrl] = useState<string | null>(null)

  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Convert relative MediaPipe measurements to real cm using known height
  function toRealMeasurements(bm: BodyMeasurements, heightCm: number): RealMeasurements {
    // altura_estimada is a normalized value (0–1) representing full body proportion in the frame
    // We use it as the scale factor to convert to cm
    const scale = heightCm / (bm.altura_estimada > 0 ? bm.altura_estimada : 0.85)

    return {
      hombros_cm:      Math.round(bm.ancho_hombros * scale),
      cintura_cm:      Math.round(bm.cintura * scale),
      cadera_cm:       Math.round(bm.cadera * scale),
      largo_torso_cm:  Math.round(bm.largo_torso * scale),
      largo_piernas_cm:Math.round(bm.largo_piernas * scale),
      altura_cm:       heightCm,
    }
  }

  const processPhoto = useCallback(async (file: File, heightCm: number) => {
    setStep('processing')
    setProgress(5)
    setErrorMsg('')

    try {
      // Load image
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

      // MediaPipe pose detection
      setProgressLabel('Descargando modelo de poses… (primera vez ~20 seg)')
      await initPoseLandmarker()
      setProgress(45)

      setProgressLabel('Detectando cuerpo…')
      let bodyMeasurements: BodyMeasurements | null = null
      try {
        bodyMeasurements = await extractMeasurements(img)
      } catch {
        bodyMeasurements = null
      }

      // Fallback proportions if detection fails
      if (!bodyMeasurements || bodyMeasurements.landmarks.length === 0) {
        bodyMeasurements = {
          ancho_hombros: 0.235,
          cintura: 0.18,
          cadera: 0.245,
          largo_torso: 0.29,
          largo_piernas: 0.46,
          altura_estimada: 0.85,
          landmarks: [],
        }
      }

      setMeasurements(bodyMeasurements)
      const real = toRealMeasurements(bodyMeasurements, heightCm)
      setRealMeasurements(real)
      setProgress(65)

      // Background removal (non-blocking — failures are ok)
      setProgressLabel('Extrayendo silueta…')
      try {
        await removeImageBackground(file, (p) => {
          setProgress(65 + Math.round(p * 0.25))
        })
      } catch {
        console.warn('Background removal skipped')
      }
      setProgress(92)

      // Draw mannequin on canvas
      setProgressLabel('Generando maniquí…')
      if (canvasRef.current) {
        canvasRef.current.width = 400
        canvasRef.current.height = 700

        if (bodyMeasurements.landmarks.length > 0) {
          drawMannequin(canvasRef.current, bodyMeasurements, bodyMeasurements.landmarks)
        } else {
          drawFallbackMannequin(canvasRef.current, real)
        }
      }

      setProgress(100)
      setStep('preview')

    } catch (err) {
      console.error('Onboarding processing error:', err)
      setErrorMsg(err instanceof Error ? err.message : 'Error desconocido al procesar la foto')
      setStep('error')
    }
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const heightCm = parseInt(alturaInput, 10)
    if (file && heightCm >= 130 && heightCm <= 220) {
      processPhoto(file, heightCm)
    }
  }, [processPhoto, alturaInput])

  async function saveMannequin() {
    if (!measurements || !realMeasurements) return
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
          ancho_hombros:   measurements.ancho_hombros,
          cintura:         measurements.cintura,
          cadera:          measurements.cadera,
          largo_torso:     measurements.largo_torso,
          largo_piernas:   measurements.largo_piernas,
          altura_estimada: realMeasurements.altura_cm,
          landmarks_json: {
            landmarks: measurements.landmarks,
            real_cm: realMeasurements,
          },
        })
        .select()

      if (error) throw error

      await cacheMannequin({
        measurements: {
          ancho_hombros:   measurements.ancho_hombros,
          cintura:         measurements.cintura,
          cadera:          measurements.cadera,
          largo_torso:     measurements.largo_torso,
          largo_piernas:   measurements.largo_piernas,
          altura_estimada: realMeasurements.altura_cm,
        },
        svgData,
      })

      setStep('done')
      setTimeout(onComplete, 1500)
    } catch (err) {
      console.error('Save error:', err)
      setErrorMsg('Error al guardar. Revisá tu conexión a internet.')
      setStep('error')
    }
  }

  function reset() {
    setStep('height')
    setCapturedImageUrl(null)
    setMeasurements(null)
    setRealMeasurements(null)
    setProgress(0)
    setProgressLabel('')
    setErrorMsg('')
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
  }

  const heightCm = parseInt(alturaInput, 10)
  const heightValid = heightCm >= 130 && heightCm <= 220

  return (
    <div className="page-centered" style={{ gap: 'var(--space-lg)', textAlign: 'center' }}>

      {/* File inputs — static attributes for Safari/Chrome compatibility */}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} onChange={handleFileChange} />
      <input ref={galleryInputRef} type="file" accept="image/*"
        style={{ display: 'none' }} onChange={handleFileChange} />

      {/* ── PASO 1: ALTURA ── */}
      {step === 'height' && (
        <div className="animate-fade-in flex flex-col items-center gap-lg" style={{ maxWidth: 360, width: '100%' }}>
          <div style={{ fontSize: '3.5rem' }}>📏</div>
          <div>
            <h1 className="font-display text-2xl font-semibold text-primary" style={{ marginBottom: 8 }}>
              Primero, tu altura
            </h1>
            <p className="text-sm text-muted" style={{ lineHeight: 1.7 }}>
              Con tu altura podemos calcular las medidas reales en centímetros desde la foto.
            </p>
          </div>

          <div className="glass flex flex-col gap-md" style={{ padding: 'var(--space-lg)', width: '100%' }}>
            <label className="text-sm text-muted uppercase tracking-wide text-left" style={{ display: 'block', marginBottom: 4 }}>
              Tu altura en centímetros
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="input-altura"
                type="number"
                inputMode="numeric"
                placeholder="Ej: 165"
                value={alturaInput}
                onChange={e => setAlturaInput(e.target.value)}
                className="input"
                min={130}
                max={220}
                style={{ paddingRight: 48 }}
              />
              <span style={{
                position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--clr-text-3)', fontSize: '0.875rem',
              }}>cm</span>
            </div>

            {alturaInput && !heightValid && (
              <p className="text-xs" style={{ color: 'var(--clr-danger)', textAlign: 'left' }}>
                Ingresá una altura válida (entre 130 y 220 cm)
              </p>
            )}

            {heightValid && (
              <div className="flex items-center gap-sm" style={{ color: 'var(--clr-success)', fontSize: '0.875rem' }}>
                <span>✓</span>
                <span>{heightCm} cm registrado</span>
              </div>
            )}
          </div>

          <button
            id="btn-continue-to-photo"
            className="btn btn-primary w-full"
            disabled={!heightValid}
            onClick={() => setStep('photo')}
          >
            Siguiente → Sacar foto
          </button>
        </div>
      )}

      {/* ── PASO 2: FOTO ── */}
      {step === 'photo' && (
        <div className="animate-fade-in flex flex-col items-center gap-lg" style={{ maxWidth: 360, width: '100%' }}>
          <div style={{ fontSize: '3.5rem' }}>📸</div>
          <div>
            <h1 className="font-display text-xl font-semibold text-primary" style={{ marginBottom: 8 }}>
              Ahora la foto
            </h1>
            <p className="text-sm text-muted" style={{ lineHeight: 1.7 }}>
              Altura registrada: <strong className="text-primary">{alturaInput} cm</strong>
            </p>
          </div>

          <div className="glass flex flex-col gap-sm" style={{ padding: 'var(--space-md)', width: '100%', textAlign: 'left' }}>
            {[
              ['📐', 'Parate derecha, cuerpo entero visible de cabeza a pies'],
              ['💡', 'Buena iluminación, fondo claro si podés'],
              ['👙', 'Ropa ajustada da mejores medidas'],
              ['⏱️', 'Primera vez tarda ~30 seg descargando modelos'],
            ].map(([icon, text]) => (
              <div key={text} className="flex items-center gap-sm">
                <span style={{ fontSize: '1rem', flexShrink: 0 }}>{icon}</span>
                <span className="text-sm text-muted">{text}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-sm w-full">
            <button id="btn-take-photo" className="btn btn-primary w-full"
              onClick={() => cameraInputRef.current?.click()}>
              📸 Sacarme una foto
            </button>
            <button id="btn-choose-photo" className="btn btn-secondary w-full"
              onClick={() => galleryInputRef.current?.click()}>
              Elegir de la galería
            </button>
            <button className="btn btn-ghost btn-sm"
              onClick={() => setStep('height')}>
              ← Cambiar altura
            </button>
          </div>
        </div>
      )}

      {/* ── PROCESSING ── */}
      {step === 'processing' && (
        <div className="animate-fade-in flex flex-col items-center gap-lg" style={{ maxWidth: 320, width: '100%' }}>
          <div className="spinner spinner-lg animate-pulse-glow" />
          <div>
            <h2 className="font-display text-xl font-semibold" style={{ marginBottom: 8 }}>Analizando…</h2>
            <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>{progressLabel}</p>
          </div>
          <div style={{ width: '100%', height: 6, background: 'var(--clr-surface-3)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${progress}%`,
              background: 'linear-gradient(90deg, var(--clr-primary-dim), var(--clr-primary))',
              borderRadius: 3, transition: 'width 0.5s var(--ease-out)',
            }} />
          </div>
          <p className="text-xs text-dimmed" style={{ lineHeight: 1.6 }}>
            Todo se procesa en tu dispositivo.<br />La primera vez descarga ~40 MB de modelos de IA.<br /><strong>No cierres la app.</strong>
          </p>
        </div>
      )}

      {/* ── PREVIEW ── */}
      {step === 'preview' && measurements && realMeasurements && (
        <div className="animate-fade-in flex flex-col items-center gap-lg" style={{ maxWidth: 360, width: '100%' }}>
          <h2 className="font-display text-xl font-semibold text-primary">¡Tu maniquí está listo!</h2>

          {/* Canvas mannequin */}
          <div style={{
            position: 'relative', width: 200, height: 360,
            borderRadius: 'var(--radius-lg)', overflow: 'hidden',
            border: '1px solid var(--clr-border)',
            background: 'linear-gradient(180deg, var(--clr-surface-2) 0%, var(--clr-surface-3) 100%)',
            boxShadow: 'var(--shadow-glow)',
          }}>
            <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>

          {/* Real measurements in cm */}
          <div className="glass" style={{ padding: 'var(--space-md)', width: '100%' }}>
            <p className="text-xs text-dimmed uppercase tracking-wide" style={{ marginBottom: 12 }}>
              Medidas estimadas
            </p>
            <div className="flex flex-col gap-xs">
              {[
                ['📏 Altura',   realMeasurements.altura_cm],
                ['↔️ Hombros',  realMeasurements.hombros_cm],
                ['〰️ Cintura',  realMeasurements.cintura_cm],
                ['〰️ Cadera',   realMeasurements.cadera_cm],
              ].map(([label, val]) => (
                <div key={label as string} className="flex justify-between items-center" style={{ padding: '6px 0', borderBottom: '1px solid var(--clr-border)' }}>
                  <span className="text-sm text-muted">{label as string}</span>
                  <span className="text-sm font-semibold text-primary">{val} cm</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-dimmed" style={{ marginTop: 10, lineHeight: 1.5 }}>
              Las medidas son estimaciones basadas en la foto + tu altura de {realMeasurements.altura_cm} cm.
              Se usan para ajustar la ropa al vestidor.
            </p>
          </div>

          <div className="flex flex-col gap-sm w-full">
            <button id="btn-save-mannequin" className="btn btn-primary w-full" onClick={saveMannequin}>
              Guardar y continuar ✨
            </button>
            <button className="btn btn-ghost btn-sm" onClick={reset}>
              Volver a empezar
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
          <div className="glass-sm" style={{ padding: 'var(--space-md)', width: '100%' }}>
            <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>{errorMsg}</p>
          </div>
          <button id="btn-retry" className="btn btn-primary w-full" onClick={reset}>
            Intentar de nuevo
          </button>
        </div>
      )}
    </div>
  )
}

/** Fallback mannequin drawing when MediaPipe landmarks are unavailable */
function drawFallbackMannequin(canvas: HTMLCanvasElement, real: RealMeasurements) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)
  const cx = W / 2

  // Scale based on real measurements
  const scale = H / (real.altura_cm || 165)
  const shoulderW = (real.hombros_cm * scale) / 2
  const waistW    = (real.cintura_cm  * scale) / 2
  const hipW      = (real.cadera_cm   * scale) / 2
  const torsoH    = real.largo_torso_cm  * scale
  const legH      = real.largo_piernas_cm * scale

  const headR     = shoulderW * 0.5
  const headY     = H * 0.08 + headR
  const shoulderY = headY + headR * 1.6
  const waistY    = shoulderY + torsoH * 0.45
  const hipY      = shoulderY + torsoH
  const ankleY    = hipY + legH

  const grad = ctx.createLinearGradient(0, headY, 0, ankleY)
  grad.addColorStop(0,   'rgba(210, 185, 205, 0.95)')
  grad.addColorStop(0.5, 'rgba(185, 155, 178, 0.95)')
  grad.addColorStop(1,   'rgba(155, 120, 148, 0.90)')
  ctx.fillStyle = grad
  ctx.strokeStyle = 'rgba(255, 210, 240, 0.5)'
  ctx.lineWidth = 2

  // Head
  ctx.beginPath(); ctx.arc(cx, headY, headR, 0, Math.PI * 2); ctx.fill(); ctx.stroke()

  // Body
  ctx.beginPath()
  ctx.moveTo(cx - shoulderW, shoulderY)
  ctx.bezierCurveTo(cx - shoulderW - 8, waistY - torsoH * 0.1, cx - waistW, waistY, cx - hipW, hipY)
  ctx.lineTo(cx - hipW * 0.55, ankleY)
  ctx.lineTo(cx + hipW * 0.55, ankleY)
  ctx.lineTo(cx + hipW, hipY)
  ctx.bezierCurveTo(cx + waistW, waistY, cx + shoulderW + 8, waistY - torsoH * 0.1, cx + shoulderW, shoulderY)
  ctx.lineTo(cx + headR * 0.35, shoulderY - headR * 0.4)
  ctx.lineTo(cx - headR * 0.35, shoulderY - headR * 0.4)
  ctx.closePath(); ctx.fill(); ctx.stroke()

  // Highlight
  const hl = ctx.createRadialGradient(cx - shoulderW * 0.3, shoulderY + torsoH * 0.2, 2, cx, waistY, shoulderW * 2)
  hl.addColorStop(0, 'rgba(255,240,255,0.18)')
  hl.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = hl
  ctx.beginPath()
  ctx.moveTo(cx - shoulderW, shoulderY)
  ctx.bezierCurveTo(cx - shoulderW - 8, waistY - torsoH * 0.1, cx - waistW, waistY, cx - hipW, hipY)
  ctx.lineTo(cx + hipW, hipY)
  ctx.bezierCurveTo(cx + waistW, waistY, cx + shoulderW + 8, waistY - torsoH * 0.1, cx + shoulderW, shoulderY)
  ctx.closePath(); ctx.fill()
}
