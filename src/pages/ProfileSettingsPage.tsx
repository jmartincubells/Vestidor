import { useEffect, useState, useRef } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { getCachedMannequin, cacheMannequin } from '../lib/idb'
import { useToast } from '../components/ui/Toast'
import { MannequinPreview, exportMannequinToDataUrl } from '../components/MannequinPreview'

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
      const { data } = await supabase
        .from('maniqui')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      if (data && data.altura_estimada) {
        const real = (data.landmarks_json as { real_cm?: RealMeasurements })?.real_cm
        if (real) {
          setMeasurements({
            altura_cm: real.altura_cm || data.altura_estimada || 165,
            hombros_cm: real.hombros_cm || 38,
            cintura_cm: real.cintura_cm || 70,
            cadera_cm: real.cadera_cm || 95,
            largo_torso_cm: real.largo_torso_cm || 45,
            largo_piernas_cm: real.largo_piernas_cm || 80,
          })
        }
        const face = (data.landmarks_json as { face_photo_base64?: string })?.face_photo_base64
        if (face) setFacePhotoUrl(face)
      } else {
        // Fallback to cache
        const cached = await getCachedMannequin()
        if (cached?.measurements) {
          const m = cached.measurements
          const scale = m.altura_estimada || 165
          setMeasurements({
            altura_cm: scale,
            hombros_cm: Math.round((m.ancho_hombros || 0.23) * scale),
            cintura_cm: Math.round((m.cintura || 0.42) * scale),
            cadera_cm: Math.round((m.cadera || 0.57) * scale),
            largo_torso_cm: Math.round((m.largo_torso || 0.27) * scale),
            largo_piernas_cm: Math.round((m.largo_piernas || 0.48) * scale),
          })
        }
      }
    } catch (err) {
      console.error('Error loading mannequin data:', err)
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
      const svgData = exportMannequinToDataUrl(measurements, facePhotoUrl)

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

      showToast('¡Maniquí guardado exitosamente! ✨', 'success')
    } catch (err) {
      console.error('Error saving mannequin:', err)
      showToast('Error al guardar el maniquí', 'error')
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

      <div style={{ padding: 'var(--space-md)', maxWidth: 640, margin: '0 auto', width: '100%' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
          <h1 className="font-display text-xl font-semibold text-primary">
            Modificar Maniquí y Rostro
          </h1>
          <button className="btn btn-secondary btn-sm" onClick={handleLogout} style={{ color: 'var(--clr-danger)' }}>
            🚪 Cerrar Sesión
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col gap-md items-center" style={{ padding: 'var(--space-xl)' }}>
            <div className="spinner spinner-lg" />
            <p className="text-sm text-muted">Cargando tus datos…</p>
          </div>
        ) : (
          <div className="animate-fade-in flex flex-col gap-lg">
            {/* Hidden canvas for face photo picker */}
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 'var(--space-md)', width: '100%', alignItems: 'start' }}>
              
              {/* Mannequin Preview */}
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
                  />
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

