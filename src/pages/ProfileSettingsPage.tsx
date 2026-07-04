import { useEffect, useState, useRef, useMemo } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { getCachedMannequin, cacheMannequin } from '../lib/idb'
import { useToast } from '../components/ui/Toast'

interface ProfileSettingsPageProps {
  user: User
}

export interface RealMeasurements {
  altura_cm: number
  hombros_cm: number
  cintura_cm: number
  cadera_cm: number
  largo_torso_cm: number
  largo_piernas_cm: number
}

const DEFAULT_MEASUREMENTS: RealMeasurements = {
  altura_cm: 165,
  hombros_cm: 38,
  cintura_cm: 70,
  cadera_cm: 95,
  largo_torso_cm: 45,
  largo_piernas_cm: 80,
}

export default function ProfileSettingsPage({ user }: ProfileSettingsPageProps) {
  const [measurements, setMeasurements] = useState<RealMeasurements>(DEFAULT_MEASUREMENTS)
  const [facePhotoUrl, setFacePhotoUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Synchronous mannequin body preview - recomputes instantly on every measurement change
  const mannequinBodyUrl = useMemo(() => drawMannequinBodySync(measurements), [measurements])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const faceInputRef = useRef<HTMLInputElement>(null)
  const { showToast } = useToast()

  useEffect(() => {
    loadMannequinData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  async function loadMannequinData() {
    setLoading(true)
    try {
      // Try DB first
      const { data } = await supabase
        .from('maniqui')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      if (data?.landmarks_json) {
        const json = data.landmarks_json as Record<string, unknown>
        if (json.real_cm) {
          setMeasurements(json.real_cm as RealMeasurements)
        }
        if (json.face_photo_base64) {
          setFacePhotoUrl(json.face_photo_base64 as string)
        }
      } else {
        // Fallback to local cache
        const cached = await getCachedMannequin()
        if (cached?.measurements?.altura_estimada) {
          const h = cached.measurements.altura_estimada
          setMeasurements({
            altura_cm: h,
            hombros_cm: Math.round((cached.measurements.ancho_hombros ?? 0.23) * h),
            cintura_cm: Math.round((cached.measurements.cintura ?? 0.42) * h),
            cadera_cm: Math.round((cached.measurements.cadera ?? 0.57) * h),
            largo_torso_cm: Math.round((cached.measurements.largo_torso ?? 0.27) * h),
            largo_piernas_cm: Math.round((cached.measurements.largo_piernas ?? 0.48) * h),
          })
        }
      }
    } catch (err) {
      console.error('Failed to load mannequin data:', err)
    } finally {
      setLoading(false)
    }
  }

  const updateMeasurement = (key: keyof RealMeasurements, val: number) => {
    setMeasurements(prev => ({
      ...prev,
      [key]: Math.max(1, val || 0),
    }))
  }

  const handleFacePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setFacePhotoUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function handleSave() {
    setSaving(true)
    try {
      // Use the synchronously generated body as the cached preview
      const svgData = mannequinBodyUrl

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

      showToast('Medidas y rostro actualizados ✨', 'success')
    } catch (err) {
      console.error('Save profile error:', err)
      showToast('Error al guardar los cambios', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  return (
    <div className="page" style={{ paddingTop: 'calc(var(--space-lg) + env(safe-area-inset-top))' }}>
      <input ref={faceInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFacePhotoSelect} />

      <div style={{ padding: '0 var(--space-md)', maxWidth: 500, margin: '0 auto', width: '100%' }}>
        
        {/* Header */}
        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-lg)' }}>
          <div>
            <h1 className="font-display text-xl font-semibold text-primary">Ajustes de Perfil</h1>
            <p className="text-xs text-muted">Personalizá las medidas de tu maniquí y rostro</p>
          </div>
          <button className="btn btn-danger btn-sm" onClick={handleLogout}>
            Cerrar Sesión
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col gap-md items-center" style={{ padding: 'var(--space-xl)' }}>
            <div className="spinner spinner-lg" />
            <p className="text-sm text-muted">Cargando tus datos…</p>
          </div>
        ) : (
          <div className="animate-fade-in flex flex-col gap-lg">
            
            {/* Editor Grid: Canvas Left, Form Right */}
            {/* Hidden canvas used only for save export */}
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 'var(--space-md)', width: '100%', alignItems: 'start' }}>
              
              {/* Mannequin Preview - renders instantly via useMemo */}
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
                  {/* Mannequin body - drawn synchronously */}
                  <img
                    src={mannequinBodyUrl}
                    alt="Vista previa del maniquí"
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                  />
                  {/* Face photo overlay - circular positioned at head */}
                  {facePhotoUrl && (
                    <img
                      src={facePhotoUrl}
                      alt="Rostro"
                      style={{
                        position: 'absolute',
                        top: '11%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        objectFit: 'cover',
                        border: '2px solid var(--clr-primary)',
                        boxShadow: '0 0 8px var(--clr-primary-glow)',
                      }}
                    />
                  )}
                </div>

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

            {/* Save Button */}
            <button
              className="btn btn-primary w-full"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? <div className="spinner" /> : 'Guardar Cambios ✨'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Draws the mannequin body SYNCHRONOUSLY onto an offscreen canvas.
 * Returns a PNG dataURL immediately — no async/promises needed.
 * Face photo is handled separately as a CSS overlay in the JSX.
 */
function drawMannequinBodySync(m: RealMeasurements): string {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 700
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''

    const W = canvas.width
    const H = canvas.height
    const cx = W / 2

    const availableH = H * 0.82
    const heightCm = m.altura_cm || 165
    const scale = availableH / heightCm

    const flatShoulder = m.hombros_cm
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

    // Glowing halo background
    const halo = ctx.createRadialGradient(cx, H * 0.5, 20, cx, H * 0.5, W * 0.45)
    halo.addColorStop(0, 'rgba(201, 160, 180, 0.25)')
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, W, H)

    // Body gradient
    const grad = ctx.createLinearGradient(0, headY, 0, ankleY)
    grad.addColorStop(0,   'rgba(225, 195, 215, 0.95)')
    grad.addColorStop(0.4, 'rgba(195, 160, 185, 0.95)')
    grad.addColorStop(1,   'rgba(160, 125, 152, 0.90)')
    ctx.fillStyle = grad
    ctx.strokeStyle = 'rgba(255, 230, 248, 0.8)'
    ctx.lineWidth = 2.5

    // Body silhouette
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

    // Head circle (face photo is overlaid via CSS in JSX)
    ctx.beginPath()
    ctx.arc(cx, headY, headR, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}
