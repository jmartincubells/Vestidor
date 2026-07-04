import { useRef, useState, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { initPoseLandmarker, extractMeasurements, type BodyMeasurements } from '../lib/poseDetection'
import { removeImageBackground, blobToBase64 } from '../lib/backgroundRemoval'
import { cacheMannequin } from '../lib/idb'
import { MannequinPreview, exportMannequinToDataUrl } from '../components/MannequinPreview'

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
  
  // Real body cutout base64 PNG from user's full-body photo
  const [userBodyCutout, setUserBodyCutout] = useState<string | null>(null)


  // Processing state
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [processingBody, setProcessingBody] = useState(false)
  const [showOverlay, setShowOverlay] = useState(true)

  // File input refs
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const faceInputRef = useRef<HTMLInputElement>(null)
  const bodyInputRef = useRef<HTMLInputElement>(null)


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
        const hScale = heightCm / bm.altura_estimada
        estimated = {
          altura_cm: heightCm,
          hombros_cm: Math.round(Math.max(28, Math.min(65, bm.ancho_hombros * hScale))),
          cintura_cm: Math.round(Math.max(45, Math.min(130, bm.cintura * hScale * 2.2))),
          cadera_cm:  Math.round(Math.max(60, Math.min(150, bm.cadera * hScale * 2.5))),
          largo_torso_cm: Math.round(Math.max(30, Math.min(70, bm.largo_torso * hScale))),
          largo_piernas_cm: Math.round(Math.max(50, Math.min(115, bm.largo_piernas * hScale))),
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

      // Background removal on user's body photo
      setProgressLabel('Extrayendo silueta de tu cuerpo real…')
      try {
        const bgResult = await removeImageBackground(file, (p) => setProgress(50 + Math.round(p * 0.4)))
        const b64 = await blobToBase64(bgResult.blob)
        setUserBodyCutout(b64)
      } catch {
        console.warn('Body background removal skipped')
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

  // Body photo handler (for background cutout overlay alignment)
  const handleBodyPhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setProcessingBody(true)
    try {
      const result = await removeImageBackground(file)
      const b64 = await blobToBase64(result.blob)
      setUserBodyCutout(`data:image/png;base64,${b64}`)
      setShowOverlay(true)
    } catch (err) {
      console.error('Error processing body photo:', err)
    } finally {
      setProcessingBody(false)
    }
  }

  // Save to DB and Local Cache
  async function saveMannequin() {
    setStep('saving')

    try {
      const svgData = exportMannequinToDataUrl(measurements, facePhotoUrl, userBodyCutout)

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
            body_cutout_base64: userBodyCutout,
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
          <input ref={faceInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFacePhotoSelect} />
          <input ref={bodyInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBodyPhotoSelect} />

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

            {/* Mannequin Preview Container */}
            <div className="flex flex-col items-center gap-xs">
              <div style={{
                position: 'relative',
                width: 160,
                height: 320,
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                border: '1px solid var(--clr-primary-glow)',
                background: 'linear-gradient(180deg, var(--clr-surface-2) 0%, var(--clr-surface-3) 100%)',
                boxShadow: 'var(--shadow-glow)',
              }}>
                <MannequinPreview
                  measurements={measurements}
                  facePhotoUrl={facePhotoUrl}
                  userBodyCutout={userBodyCutout}
                  showOverlay={showOverlay}
                />
                {processingBody && (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0,0,0,0.6)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    zIndex: 10,
                  }}>
                    <div className="spinner" />
                    <span style={{ fontSize: '0.65rem', color: '#fff', textAlign: 'center' }}>Procesando foto…</span>
                  </div>
                )}
              </div>

              {/* Face photo button */}
              <button
                className="btn btn-secondary btn-sm w-full"
                onClick={() => faceInputRef.current?.click()}
                style={{ fontSize: '0.72rem', padding: '5px 8px' }}
              >
                {facePhotoUrl ? '👤 Cambiar rostro' : '📷 Agregar rostro'}
              </button>

              {/* Body photo button (background overlay) */}
              <button
                className="btn btn-secondary btn-sm w-full"
                onClick={() => bodyInputRef.current?.click()}
                disabled={processingBody}
                style={{ fontSize: '0.72rem', padding: '5px 8px' }}
              >
                {userBodyCutout ? '📸 Cambiar foto cuerpo' : '📸 Foto cuerpo (fondo)'}
              </button>

              {userBodyCutout && (
                <div className="flex items-center gap-xs w-full justify-between" style={{ marginTop: 2 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowOverlay(!showOverlay)}
                    style={{ fontSize: '0.65rem', padding: 2 }}
                  >
                    {showOverlay ? '👁️ Ocultar foto' : '👁️ Mostrar foto'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setUserBodyCutout(null)}
                    style={{ fontSize: '0.65rem', color: 'var(--clr-danger)', padding: 2 }}
                  >
                    Quitar
                  </button>
                </div>
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

