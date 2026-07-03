import { useRef, useState, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { initPoseLandmarker, extractMeasurements, drawMannequin, type BodyMeasurements } from '../lib/poseDetection'
import { removeImageBackground } from '../lib/backgroundRemoval'
import { cacheMannequin } from '../lib/idb'
import { useToast } from '../components/ui/Toast'

type OnboardingStep = 'intro' | 'capture' | 'processing' | 'preview' | 'saving' | 'done'

interface OnboardingPageProps {
  user: User
  onComplete: () => void
}

export default function OnboardingPage({ user, onComplete }: OnboardingPageProps) {
  const [step, setStep] = useState<OnboardingStep>('intro')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [measurements, setMeasurements] = useState<BodyMeasurements | null>(null)
  const [capturedImageUrl, setCapturedImageUrl] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const { showToast } = useToast()

  const processPhoto = useCallback(async (file: File) => {
    setStep('processing')
    setProgress(0)

    try {
      // Step 1: Load the image
      setProgressLabel('Cargando imagen…')
      const imageUrl = URL.createObjectURL(file)
      setCapturedImageUrl(imageUrl)

      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = reject
        img.src = imageUrl
      })

      setProgress(15)
      setProgressLabel('Inicializando detección de pose…')
      await initPoseLandmarker()

      setProgress(40)
      setProgressLabel('Analizando tu cuerpo…')
      const bodyMeasurements = await extractMeasurements(img)

      if (!bodyMeasurements) {
        showToast('No pudimos detectar tu cuerpo. Asegurate de que se vea el cuerpo completo con buena luz.', 'error')
        setStep('capture')
        return
      }

      setMeasurements(bodyMeasurements)
      setProgress(70)

      // Step 2: Remove background (generate silhouette)
      setProgressLabel('Extrayendo silueta…')
      await removeImageBackground(file, (p) => {
        setProgress(70 + p * 0.25)
      })

      setProgress(95)
      setProgressLabel('Dibujando maniquí…')

      // Draw mannequin on canvas
      if (canvasRef.current && imageRef.current) {
        canvasRef.current.width = imageRef.current.naturalWidth || 400
        canvasRef.current.height = imageRef.current.naturalHeight || 700
        drawMannequin(canvasRef.current, bodyMeasurements, bodyMeasurements.landmarks)
      }

      setProgress(100)
      setStep('preview')
    } catch (err) {
      console.error('Onboarding processing error:', err)
      showToast('Ocurrió un error al procesar la foto. Intentá de nuevo.', 'error')
      setStep('capture')
    }
  }, [showToast])

  async function saveMannequin() {
    if (!measurements) return
    setStep('saving')

    try {
      // Save canvas as SVG data for mannequin rendering (store canvas as data URL)
      let svgData: string | null = null
      if (canvasRef.current) {
        svgData = canvasRef.current.toDataURL('image/png')
      }

      // Save measurements to Supabase
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

      // Cache mannequin locally
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
      setTimeout(onComplete, 1200)
    } catch (err) {
      console.error('Save mannequin error:', err)
      showToast('Error al guardar las medidas. Revisá tu conexión.', 'error')
      setStep('preview')
    }
  }

  return (
    <div className="page-centered" style={{ gap: 'var(--space-lg)', textAlign: 'center' }}>

      {/* Intro */}
      {step === 'intro' && (
        <div className="animate-fade-in flex flex-col items-center gap-lg" style={{ maxWidth: 360, width: '100%' }}>
          <div style={{ fontSize: '3.5rem' }}>👗</div>
          <div>
            <h1 className="font-display text-2xl font-semibold text-primary" style={{ marginBottom: 8 }}>
              Creemos tu maniquí
            </h1>
            <p className="text-sm text-muted" style={{ lineHeight: 1.7 }}>
              Vamos a usar una foto tuya para generar un maniquí personalizado.
              <strong className="text-accent"> Tu foto nunca sale del dispositivo</strong> — todo el análisis se hace localmente.
            </p>
          </div>

          <div className="glass flex flex-col gap-sm" style={{ padding: 'var(--space-md)', width: '100%', textAlign: 'left' }}>
            {[
              ['📏', 'Parate derecha frente a un espejo o pedile a alguien que te saque la foto'],
              ['💡', 'Buena iluminación, cuerpo completo visible (de cabeza a pies)'],
              ['👙', 'Ropa ajustada o de baño da mejores medidas'],
              ['🚫', 'Tu foto NO se sube a ningún servidor'],
            ].map(([icon, text]) => (
              <div key={text} className="flex items-center gap-sm">
                <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{icon}</span>
                <span className="text-sm text-muted">{text}</span>
              </div>
            ))}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="user"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) processPhoto(file)
            }}
          />

          <div className="flex flex-col gap-sm w-full">
            <button
              id="btn-take-photo"
              className="btn btn-primary w-full"
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.removeAttribute('capture')
                  fileInputRef.current.setAttribute('capture', 'user')
                  fileInputRef.current.click()
                }
              }}
            >
              📸 Sacarme una foto
            </button>
            <button
              id="btn-choose-photo"
              className="btn btn-secondary w-full"
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.removeAttribute('capture')
                  fileInputRef.current.click()
                }
              }}
            >
              Elegir de la galería
            </button>
          </div>
        </div>
      )}

      {/* Processing */}
      {step === 'processing' && (
        <div className="animate-fade-in flex flex-col items-center gap-lg" style={{ maxWidth: 320, width: '100%' }}>
          <div className="spinner spinner-lg animate-pulse-glow" />
          <div>
            <h2 className="font-display text-xl font-semibold" style={{ marginBottom: 8 }}>
              Analizando…
            </h2>
            <p className="text-sm text-muted">{progressLabel}</p>
          </div>

          {/* Progress bar */}
          <div style={{
            width: '100%',
            height: 4,
            background: 'var(--clr-surface-3)',
            borderRadius: 2,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${progress}%`,
              background: 'linear-gradient(90deg, var(--clr-primary-dim), var(--clr-primary))',
              borderRadius: 2,
              transition: 'width 0.4s var(--ease-out)',
            }} />
          </div>

          <p className="text-xs text-dimmed">
            Todo se procesa en tu dispositivo. Puede tardar unos segundos.
          </p>
        </div>
      )}

      {/* Preview */}
      {step === 'preview' && measurements && (
        <div className="animate-fade-in flex flex-col items-center gap-lg" style={{ maxWidth: 360, width: '100%' }}>
          <h2 className="font-display text-xl font-semibold text-primary">
            ¡Tu maniquí está listo!
          </h2>

          {/* Mannequin canvas preview */}
          <div style={{
            position: 'relative',
            width: 220,
            height: 380,
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
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  opacity: 0.1,
                }}
              />
            )}
            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
              }}
            />
          </div>

          {/* Measurement chips */}
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
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setStep('intro')
                setCapturedImageUrl(null)
                setMeasurements(null)
              }}
            >
              Sacar otra foto
            </button>
          </div>
        </div>
      )}

      {/* Saving */}
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
    </div>
  )
}
