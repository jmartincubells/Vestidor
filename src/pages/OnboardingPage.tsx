import { useRef, useState, useCallback, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { initPoseLandmarker, extractMeasurements, type BodyMeasurements } from '../lib/poseDetection'
import { removeImageBackground } from '../lib/backgroundRemoval'
import { cacheMannequin } from '../lib/idb'

type OnboardingStep = 'choose_mode' | 'manual_form' | 'photo_height' | 'photo_capture' | 'processing' | 'editor' | 'saving' | 'done' | 'error'

interface OnboardingPageProps {
  user: User
  onComplete: () => void
}

export interface RealMeasurements {
  altura_cm: number
  hombros_cm: number
  cintura_cm: number
  cadera_cm: number
  largo_torso_cm: number
  largo_piernas_cm: number
}

// Default proportional averages for 165 cm height
const DEFAULT_MEASUREMENTS: RealMeasurements = {
  altura_cm: 165,
  hombros_cm: 38,
  cintura_cm: 70,
  cadera_cm: 95,
  largo_torso_cm: 45,
  largo_piernas_cm: 80,
}

export default function OnboardingPage({ user, onComplete }: OnboardingPageProps) {
  const [step, setStep] = useState<OnboardingStep>('choose_mode')
  
  // Real measurements in cm (editable by user)
  const [measurements, setMeasurements] = useState<RealMeasurements>(DEFAULT_MEASUREMENTS)
  
  // Optional face photo (base64 or object URL)
  const [facePhotoUrl, setFacePhotoUrl] = useState<string | null>(null)
  
  // Processing state
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  // File input refs
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const faceInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Redraw mannequin whenever measurements or face photo change in editor
  useEffect(() => {
    if (step === 'editor') {
      const timer = setTimeout(() => {
        if (canvasRef.current) {
          drawMannequinWithFace(canvasRef.current, measurements, facePhotoUrl)
        }
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [step, measurements, facePhotoUrl])

  // Handle measurement changes with validation
  const updateMeasurement = (key: keyof RealMeasurements, val: number) => {
    setMeasurements(prev => ({
      ...prev,
      [key]: Math.max(1, val || 0),
    }))
  }

  // Auto-recalculate proportional defaults when height changes
  const handleHeightChange = (newHeight: number) => {
    if (!newHeight || newHeight < 120 || newHeight > 220) {
      updateMeasurement('altura_cm', newHeight)
      return
    }
    const ratio = newHeight / 165
    setMeasurements({
      altura_cm: newHeight,
      hombros_cm: Math.round(38 * ratio),
      cintura_cm: Math.round(70 * ratio),
      cadera_cm: Math.round(95 * ratio),
      largo_torso_cm: Math.round(45 * ratio),
      largo_piernas_cm: Math.round(80 * ratio),
    })
  }

  // Photo processing
  const processPhoto = useCallback(async (file: File, heightCm: number) => {
    setStep('processing')
    setProgress(5)
    setErrorMsg('')

    try {
      setProgressLabel('Cargando imagen…')
      const imageUrl = URL.createObjectURL(file)
      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('No se pudo cargar la imagen'))
        img.src = imageUrl
      })
      setProgress(20)

      setProgressLabel('Analizando cuerpo… (primera vez ~20 seg)')
      await initPoseLandmarker()
      setProgress(50)

      let bm: BodyMeasurements | null = null
      try {
        bm = await extractMeasurements(img)
      } catch {
        bm = null
      }

      // Convert or estimate
      let estimated: RealMeasurements
      if (bm && bm.altura_estimada > 0) {
        const scale = heightCm / bm.altura_estimada
        estimated = {
          altura_cm: heightCm,
          hombros_cm: Math.round(bm.ancho_hombros * scale * 100),
          cintura_cm: Math.round(bm.cintura * scale * 100),
          cadera_cm: Math.round(bm.cadera * scale * 100),
          largo_torso_cm: Math.round(bm.largo_torso * scale * 100),
          largo_piernas_cm: Math.round(bm.largo_piernas * scale * 100),
        }
      } else {
        const ratio = heightCm / 165
        estimated = {
          altura_cm: heightCm,
          hombros_cm: Math.round(38 * ratio),
          cintura_cm: Math.round(70 * ratio),
          cadera_cm: Math.round(95 * ratio),
          largo_torso_cm: Math.round(45 * ratio),
          largo_piernas_cm: Math.round(80 * ratio),
        }
      }

      // Background removal attempt
      setProgressLabel('Extrayendo silueta…')
      try {
        await removeImageBackground(file, (p) => setProgress(50 + Math.round(p * 0.4)))
      } catch {
        console.warn('Background removal skipped')
      }

      setMeasurements(estimated)
      setProgress(100)
      setStep('editor')

    } catch (err) {
      console.error('Photo processing error:', err)
      setErrorMsg(err instanceof Error ? err.message : 'Error al procesar la foto')
      setStep('error')
    }
  }, [])

  // Face photo handler
  const handleFacePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setFacePhotoUrl(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  // Save to DB and Local Cache
  async function saveMannequin() {
    setStep('saving')

    try {
      let svgData: string | null = null
      if (canvasRef.current) {
        svgData = canvasRef.current.toDataURL('image/png')
      }

      // Normalized relative values for Edge Functions / VTON rendering
      const scale = measurements.altura_cm
      const ancho_hombros = measurements.hombros_cm / scale
      const cintura = measurements.cintura_cm / scale
      const cadera = measurements.cadera_cm / scale
      const largo_torso = measurements.largo_torso_cm / scale
      const largo_piernas = measurements.largo_piernas_cm / scale

      const { error } = await supabase
        .from('maniqui')
        .upsert({
          user_id: user.id,
          ancho_hombros,
          cintura,
          cadera,
          largo_torso,
          largo_piernas,
          altura_estimada: measurements.altura_cm,
          landmarks_json: {
            real_cm: measurements,
            face_photo_base64: facePhotoUrl,
          },
        })
        .select()

      if (error) throw error

      await cacheMannequin({
        measurements: {
          ancho_hombros,
          cintura,
          cadera,
          largo_torso,
          largo_piernas,
          altura_estimada: measurements.altura_cm,
        },
        svgData,
      })

      setStep('done')
      setTimeout(onComplete, 1400)
    } catch (err) {
      console.error('Save error:', err)
      setErrorMsg('Error al guardar las medidas. Revisá tu conexión.')
      setStep('error')
    }
  }

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && measurements.altura_cm >= 120) {
      processPhoto(file, measurements.altura_cm)
    }
  }, [processPhoto, measurements.altura_cm])

  return (
    <div className="page-centered" style={{ gap: 'var(--space-md)', padding: 'var(--space-md)' }}>

      {/* Hidden inputs */}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFileChange} />
      <input ref={galleryInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
      <input ref={faceInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFacePhotoSelect} />

      {/* ── PASO 0: ELEGIR MODO ── */}
      {step === 'choose_mode' && (
        <div className="animate-fade-in flex flex-col items-center gap-lg" style={{ maxWidth: 380, width: '100%' }}>
          <div style={{ fontSize: '3.5rem' }}>✨</div>

          <div>
            <h1 className="font-display text-2xl font-semibold text-primary" style={{ marginBottom: 6 }}>
              Creemos tu maniquí
            </h1>
            <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>
              Elegí la forma que te resulte más cómoda para registrar tus medidas:
            </p>
          </div>

          <div className="glass-sm" style={{ padding: '10px 14px', width: '100%', textAlign: 'left', borderColor: 'var(--clr-primary-glow)' }}>
            <p className="text-xs text-muted" style={{ lineHeight: 1.5 }}>
              💡 <strong className="text-primary">No te preocupes por la precisión exacta ahora.</strong> Podés modificar tus medidas y tu foto de rostro en cualquier momento desde la sección <strong>Perfil / Ajustes</strong>.
            </p>
          </div>

          <div className="flex flex-col gap-md w-full">
            {/* Option A: Fast with photo */}
            <div
              className="glass"
              style={{
                padding: 'var(--space-md)',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                gap: 'var(--space-md)',
                alignItems: 'center',
                transition: 'transform 0.2s, border-color 0.2s',
              }}
              onClick={() => setStep('photo_height')}
            >
              <div style={{ fontSize: '2.2rem' }}>📸</div>
              <div style={{ flex: 1 }}>
                <h3 className="font-semibold text-primary text-base" style={{ marginBottom: 2 }}>
                  Modo Rápido (Foto + Altura)
                </h3>
                <p className="text-xs text-muted" style={{ lineHeight: 1.5 }}>
                  Sacás una foto de cuerpo completo y la IA estimará tus medidas. Podés corregirlas después.
                </p>
              </div>
              <span className="text-muted">→</span>
            </div>

            {/* Option B: Manual Precise */}
            <div
              className="glass"
              style={{
                padding: 'var(--space-md)',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                gap: 'var(--space-md)',
                alignItems: 'center',
                transition: 'transform 0.2s, border-color 0.2s',
              }}
              onClick={() => {
                setMeasurements(DEFAULT_MEASUREMENTS)
                setStep('editor')
              }}
            >
              <div style={{ fontSize: '2.2rem' }}>📏</div>
              <div style={{ flex: 1 }}>
                <h3 className="font-semibold text-primary text-base" style={{ marginBottom: 2 }}>
                  Modo Preciso (Carga Manual)
                </h3>
                <p className="text-xs text-muted" style={{ lineHeight: 1.5 }}>
                  Cargás manualmente tu altura, hombros, cintura, cadera y largos. 100% exacto a tu gusto.
                </p>
              </div>
              <span className="text-muted">→</span>
            </div>
          </div>
        </div>
      )}

      {/* ── PASO FOTO 1: PEDIR ALTURA PRIMERO ── */}
      {step === 'photo_height' && (
        <div className="animate-fade-in flex flex-col items-center gap-lg" style={{ maxWidth: 360, width: '100%' }}>
          <div style={{ fontSize: '3rem' }}>📏</div>
          <div>
            <h1 className="font-display text-xl font-semibold text-primary" style={{ marginBottom: 6 }}>
              Ingresá tu altura
            </h1>
            <p className="text-sm text-muted">
              Necesaria para convertir la foto en centímetros reales.
            </p>
          </div>

          <div className="glass flex flex-col gap-sm" style={{ padding: 'var(--space-lg)', width: '100%' }}>
            <label className="text-xs text-muted uppercase tracking-wide text-left">
              Altura (cm)
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="number"
                inputMode="numeric"
                className="input"
                value={measurements.altura_cm || ''}
                onChange={e => handleHeightChange(parseInt(e.target.value, 10))}
                placeholder="165"
              />
              <span style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--clr-text-3)' }}>cm</span>
            </div>
          </div>

          <div className="flex flex-col gap-sm w-full">
            <button
              className="btn btn-primary w-full"
              disabled={!measurements.altura_cm || measurements.altura_cm < 120 || measurements.altura_cm > 220}
              onClick={() => setStep('photo_capture')}
            >
              Siguiente → Tomar Foto
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setStep('choose_mode')}>
              ← Cambiar modo
            </button>
          </div>
        </div>
      )}

      {/* ── PASO FOTO 2: TOMAR O SELECCIONAR FOTO ── */}
      {step === 'photo_capture' && (
        <div className="animate-fade-in flex flex-col items-center gap-lg" style={{ maxWidth: 360, width: '100%' }}>
          <div style={{ fontSize: '3rem' }}>📸</div>
          <div>
            <h1 className="font-display text-xl font-semibold text-primary" style={{ marginBottom: 6 }}>
              Sacate una foto
            </h1>
            <p className="text-sm text-muted">
              Altura: <strong className="text-primary">{measurements.altura_cm} cm</strong>
            </p>
          </div>

          <div className="glass flex flex-col gap-xs" style={{ padding: 'var(--space-md)', width: '100%', textAlign: 'left' }}>
            <p className="text-xs text-muted">💡 Parate recta, cuerpo completo visible de cabeza a pies.</p>
            <p className="text-xs text-muted">🔒 Tu foto nunca sale del dispositivo.</p>
          </div>

          <div className="flex flex-col gap-sm w-full">
            <button className="btn btn-primary w-full" onClick={() => cameraInputRef.current?.click()}>
              📸 Sacar foto ahora
            </button>
            <button className="btn btn-secondary w-full" onClick={() => galleryInputRef.current?.click()}>
              🖼️ Elegir de la galería
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setStep('photo_height')}>
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
            <h2 className="font-display text-xl font-semibold" style={{ marginBottom: 6 }}>Procesando…</h2>
            <p className="text-sm text-muted">{progressLabel}</p>
          </div>
          <div style={{ width: '100%', height: 6, background: 'var(--clr-surface-3)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--clr-primary)', transition: 'width 0.4s' }} />
          </div>
        </div>
      )}

      {/* ── EDITOR Y PREVIEW DE MANIQUÍ (EDITABLE) ── */}
      {step === 'editor' && (
        <div className="animate-fade-in flex flex-col items-center gap-md" style={{ maxWidth: 440, width: '100%' }}>
          <div className="flex justify-between items-center w-full">
            <h2 className="font-display text-lg font-semibold text-primary">
              Personalizá tu maniquí
            </h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setStep('choose_mode')}>
              Reempezar
            </button>
          </div>

          {/* Grid Layout: Canvas Left, Sliders Right */}
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 'var(--space-md)', width: '100%', alignItems: 'start' }}>

            {/* Mannequin Canvas Container */}
            <div className="flex flex-col items-center gap-xs">
              <div style={{
                position: 'relative',
                width: 160,
                height: 320,
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                border: '1px solid var(--clr-border)',
                background: 'linear-gradient(180deg, var(--clr-surface-2) 0%, var(--clr-surface-3) 100%)',
                boxShadow: 'var(--shadow-glow)',
              }}>
                <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              </div>

              {/* Face photo button below canvas */}
              <button
                className="btn btn-secondary btn-sm w-full"
                onClick={() => faceInputRef.current?.click()}
                style={{ fontSize: '0.75rem', padding: '6px 8px' }}
              >
                {facePhotoUrl ? '👤 Cambiar rostro' : '📷 Agregar rostro'}
              </button>
              {facePhotoUrl && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFacePhotoUrl(null)}
                  style={{ fontSize: '0.7rem', color: 'var(--clr-danger)' }}
                >
                  Quitar rostro
                </button>
              )}
            </div>

            {/* Controls / Form with direct numeric inputs */}
            <div className="glass flex flex-col gap-xs" style={{ padding: 'var(--space-sm) var(--space-md)', width: '100%' }}>
              {[
                { label: 'Altura (cm)', key: 'altura_cm' as const },
                { label: 'Hombros (cm)', key: 'hombros_cm' as const },
                { label: 'Cintura (cm)', key: 'cintura_cm' as const },
                { label: 'Cadera (cm)', key: 'cadera_cm' as const },
                { label: 'Torso (cm)', key: 'largo_torso_cm' as const },
                { label: 'Piernas (cm)', key: 'largo_piernas_cm' as const },
              ].map(item => (
                <div key={item.key} className="flex justify-between items-center" style={{ padding: '3px 0' }}>
                  <span className="text-xs text-muted font-medium" style={{ minWidth: 80 }}>{item.label}</span>
                  
                  <div className="flex items-center gap-xs">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => updateMeasurement(item.key, (measurements[item.key] || 0) - 1)}
                      style={{ padding: '2px 8px', fontSize: '0.9rem', lineHeight: 1, height: 28, minWidth: 28 }}
                    >
                      -
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      className="input text-center font-semibold text-primary"
                      value={measurements[item.key] || ''}
                      onChange={e => updateMeasurement(item.key, parseInt(e.target.value, 10) || 0)}
                      style={{ width: 68, padding: '4px 6px', height: 28, fontSize: '0.85rem' }}
                    />
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => updateMeasurement(item.key, (measurements[item.key] || 0) + 1)}
                      style={{ padding: '2px 8px', fontSize: '0.9rem', lineHeight: 1, height: 28, minWidth: 28 }}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-xs w-full" style={{ marginTop: 'var(--space-xs)' }}>
            <button id="btn-save-mannequin" className="btn btn-primary w-full" onClick={saveMannequin}>
              Guardar maniquí ✨
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
              <h2 className="font-display text-xl font-semibold text-primary">¡Maniquí guardado!</h2>
            </>
          ) : (
            <>
              <div className="spinner spinner-lg" />
              <p className="text-sm text-muted">Guardando tu maniquí y rostro…</p>
            </>
          )}
        </div>
      )}

      {/* ── ERROR ── */}
      {step === 'error' && (
        <div className="animate-fade-in flex flex-col items-center gap-lg" style={{ maxWidth: 320, width: '100%' }}>
          <div style={{ fontSize: '2.5rem' }}>⚠️</div>
          <h2 className="font-display text-lg font-semibold" style={{ color: 'var(--clr-danger)' }}>Algo salió mal</h2>
          <div className="glass-sm" style={{ padding: 'var(--space-md)', width: '100%' }}>
            <p className="text-sm text-muted">{errorMsg}</p>
          </div>
          <button className="btn btn-primary w-full" onClick={() => setStep('choose_mode')}>
            Volver al inicio
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Draws the stylized mannequin onto canvas with real cm parameters + optional face avatar overlay
 */
function drawMannequinWithFace(
  canvas: HTMLCanvasElement,
  m: RealMeasurements,
  facePhotoUrl: string | null
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  canvas.width = 400
  canvas.height = 700
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)

  const cx = W / 2

  // Total available vertical space for mannequin (82% of height)
  const availableH = H * 0.82
  const heightCm = m.altura_cm || 165
  const scale = availableH / heightCm

  // Convert circumferences to flat front-view width (~0.32 factor)
  const flatShoulder = m.hombros_cm // hombros is already flat width
  const flatWaist = m.cintura_cm * 0.32
  const flatHip = m.cadera_cm * 0.32

  const shoulderW = Math.max(35, (flatShoulder * scale) / 2)
  const waistW    = Math.max(25, (flatWaist * scale) / 2)
  const hipW      = Math.max(35, (flatHip * scale) / 2)
  const torsoH    = Math.max(70, m.largo_torso_cm * scale)
  const legH      = Math.max(110, m.largo_piernas_cm * scale)

  const headR     = Math.max(24, shoulderW * 0.45)
  const startY    = H * 0.06
  const headY     = startY + headR
  const shoulderY = headY + headR * 1.4
  const waistY    = shoulderY + torsoH * 0.45
  const hipY      = shoulderY + torsoH
  const ankleY    = Math.min(H * 0.94, hipY + legH)

  // Glowing background halo behind mannequin
  const halo = ctx.createRadialGradient(cx, H * 0.5, 20, cx, H * 0.5, W * 0.45)
  halo.addColorStop(0, 'rgba(201, 160, 180, 0.18)')
  halo.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, W, H)

  // Body gradient fill
  const grad = ctx.createLinearGradient(0, headY, 0, ankleY)
  grad.addColorStop(0,   'rgba(225, 195, 215, 0.95)')
  grad.addColorStop(0.4, 'rgba(195, 160, 185, 0.95)')
  grad.addColorStop(1,   'rgba(160, 125, 152, 0.90)')
  ctx.fillStyle = grad
  ctx.strokeStyle = 'rgba(255, 230, 248, 0.7)'
  ctx.lineWidth = 2.5

  // 1. Draw Body Silhouette
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

  // 2. Draw Head (Face photo if uploaded, otherwise stylized head)
  if (facePhotoUrl) {
    const faceImg = new Image()
    faceImg.crossOrigin = 'anonymous'
    faceImg.onload = () => {
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, headY, headR, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(faceImg, cx - headR, headY - headR, headR * 2, headR * 2)
      ctx.restore()

      // Border around face avatar
      ctx.beginPath()
      ctx.arc(cx, headY, headR, 0, Math.PI * 2)
      ctx.strokeStyle = '#c9a0b4'
      ctx.lineWidth = 3
      ctx.stroke()
    }
    faceImg.src = facePhotoUrl
  } else {
    ctx.beginPath()
    ctx.arc(cx, headY, headR, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
}
