import { useEffect, useState, useRef } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { removeImageBackground, blobToBase64 } from '../lib/backgroundRemoval'
import { useToast } from '../components/ui/Toast'
import type { Database } from '../lib/supabase'
import { cacheGarment } from '../lib/idb'

type Prenda = Database['public']['Tables']['prendas']['Row']
type Categoria = Prenda['categoria']

type AddStep =
  | 'capture'       // take/pick photo
  | 'removing-bg'   // background removal in progress
  | 'confirm-label' // Gemini classified, user confirms
  | 'variants'      // optional variant question
  | 'processing'    // Edge Function running
  | 'done'          // success

const CATEGORIAS: { value: Categoria; label: string; emoji: string }[] = [
  { value: 'top',       label: 'Top / Remera',    emoji: '👚' },
  { value: 'bottom',    label: 'Pantalón / Falda', emoji: '👖' },
  { value: 'dress',     label: 'Vestido',          emoji: '👗' },
  { value: 'outerwear', label: 'Abrigo / Campera', emoji: '🧥' },
  { value: 'shoes',     label: 'Zapatos',          emoji: '👠' },
  { value: 'accessory', label: 'Accesorio',        emoji: '👜' },
]

interface AddGarmentPageProps {
  user: User
}

export default function AddGarmentPage({ user }: AddGarmentPageProps) {
  const [step, setStep] = useState<AddStep>('capture')
  const [_originalFile, setOriginalFile] = useState<File | null>(null)
  const [noBgBlob, setNoBgBlob] = useState<Blob | null>(null)
  const [noBgUrl, setNoBgUrl] = useState<string | null>(null)
  const [bgProgress, setBgProgress] = useState(0)
  const [suggestedCategoria, setSuggestedCategoria] = useState<Categoria>('top')
  const [suggestedColor, setSuggestedColor] = useState('')
  const [selectedCategoria, setSelectedCategoria] = useState<Categoria>('top')
  const [selectedColor, setSelectedColor] = useState('')
  const [hasVariants, setHasVariants] = useState<boolean | null>(null)
  const [variantQuestion, setVariantQuestion] = useState('')
  const [collections, setCollections] = useState<{ id: string; nombre: string }[]>([])
  const [selectedCollection, setSelectedCollection] = useState<string>('')
  const [newCollectionName, setNewCollectionName] = useState('')
  const [processingMsg, setProcessingMsg] = useState('Enviando a procesar…')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const { showToast } = useToast()

  useEffect(() => {
    supabase.from('colecciones').select('*').eq('user_id', user.id).order('nombre').then(({ data }) => {
      if (data) setCollections(data)
    })
  }, [user.id])

  async function handleFileSelected(file: File) {
    setOriginalFile(file)
    setStep('removing-bg')
    setBgProgress(0)

    try {
      const result = await removeImageBackground(file, setBgProgress)
      setNoBgBlob(result.blob)
      setNoBgUrl(result.objectUrl)

      // Classify with Gemini via Edge Function
      const base64 = await blobToBase64(result.blob)
      const { data, error } = await supabase.functions.invoke('classify-garment', {
        body: { imageBase64: base64 },
      })

      if (error || !data) {
        // Fallback: let user classify manually
        setSuggestedCategoria('top')
        setSuggestedColor('')
      } else {
        setSuggestedCategoria(data.categoria ?? 'top')
        setSuggestedColor(data.color ?? '')
        if (data.variant_question) {
          setVariantQuestion(data.variant_question)
        }
      }

      setSelectedCategoria(data?.categoria ?? 'top')
      setSelectedColor(data?.color ?? '')
      setStep('confirm-label')
    } catch (err) {
      console.error('Background removal error:', err)
      showToast('Error al procesar la imagen. Intentá de nuevo.', 'error')
      setStep('capture')
    }
  }

  async function confirmLabel() {
    // If outerwear or dress, ask about variants
    if (selectedCategoria === 'outerwear' && !variantQuestion) {
      setVariantQuestion('¿La campera se puede usar abierta y cerrada?')
      setStep('variants')
    } else if (variantQuestion) {
      setStep('variants')
    } else {
      await submitGarment(false)
    }
  }

  async function submitGarment(withVariant: boolean) {
    if (!noBgBlob) return
    setStep('processing')

    try {
      // Resolve or create collection
      let coleccionId: string | null = null
      if (newCollectionName.trim()) {
        const { data } = await supabase
          .from('colecciones')
          .insert({ user_id: user.id, nombre: newCollectionName.trim() })
          .select()
          .single()
        if (data) coleccionId = data.id
      } else if (selectedCollection) {
        coleccionId = selectedCollection
      }

      // Upload original (no-bg) PNG to storage
      const fileName = `${user.id}/${Date.now()}-original.png`
      const { error: uploadError } = await supabase.storage
        .from('prendas-png')
        .upload(fileName, noBgBlob, { contentType: 'image/png', upsert: false })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('prendas-png')
        .getPublicUrl(fileName)

      // Create prenda record
      const { data: prenda, error: insertError } = await supabase
        .from('prendas')
        .insert({
          user_id: user.id,
          coleccion_id: coleccionId,
          categoria: selectedCategoria,
          color: selectedColor,
          url_original: publicUrl,
          estado: 'pendiente',
          etiquetas: { has_variants: withVariant },
          intentos: 0,
        })
        .select()
        .single()

      if (insertError || !prenda) throw insertError

      // Cache locally
      await cacheGarment({
        id: prenda.id,
        url_png: null,
        url_original: publicUrl,
        categoria: prenda.categoria,
        color: prenda.color,
        etiquetas: prenda.etiquetas,
        variantes: null,
        estado: 'pendiente',
        coleccion_id: coleccionId,
        cachedAt: Date.now(),
      })

      // Trigger async processing via Edge Function
      setProcessingMsg('Enviando a la IA para procesar…')
      supabase.functions.invoke('process-garment', { body: { prenda_id: prenda.id } })
        .catch(err => console.error('Trigger process-garment error:', err))

      setStep('done')
    } catch (err: unknown) {
      console.error('Submit garment error:', err)
      const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Error al guardar la prenda'
      showToast(`Error al guardar: ${message}`, 'error')
      setStep('confirm-label')
    }
  }

  function reset() {
    setStep('capture')
    setOriginalFile(null)
    setNoBgBlob(null)
    setNoBgUrl(null)
    setBgProgress(0)
    setSuggestedCategoria('top')
    setSuggestedColor('')
    setSelectedCategoria('top')
    setSelectedColor('')
    setHasVariants(null)
    setVariantQuestion('')
    setNewCollectionName('')
  }

  return (
    <div className="page" style={{ paddingTop: 'calc(var(--space-lg) + env(safe-area-inset-top))' }}>
      <div style={{ padding: 'var(--space-md)', maxWidth: 480, margin: '0 auto', width: '100%' }}>

        {/* Header */}
        <h1 className="font-display text-xl font-semibold text-primary" style={{ marginBottom: 'var(--space-lg)' }}>
          Agregar prenda
        </h1>

        {/* STEP: Capture */}
        {step === 'capture' && (
          <div className="animate-fade-in flex flex-col gap-md">
            <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>
              Sacá una foto de la prenda sobre fondo neutro o elegila de la galería.
              Vamos a eliminar el fondo automáticamente.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) handleFileSelected(file)
              }}
            />

            <div style={{
              border: '2px dashed var(--clr-border)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-xl)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-md)',
              cursor: 'pointer',
              transition: 'border-color 0.2s',
            }}
              onClick={() => fileInputRef.current?.click()}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--clr-primary-dim)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--clr-border)')}
            >
              <span style={{ fontSize: '3rem' }}>📸</span>
              <p className="text-sm text-muted text-center">Tocar para sacar foto o elegir de galería</p>
            </div>

            <div className="flex flex-col gap-sm">
              <button id="btn-take-garment-photo" className="btn btn-primary w-full" onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.setAttribute('capture', 'environment')
                  fileInputRef.current.click()
                }
              }}>
                📷 Sacar foto
              </button>
              <button id="btn-choose-garment-photo" className="btn btn-secondary w-full" onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.removeAttribute('capture')
                  fileInputRef.current.click()
                }
              }}>
                Elegir de galería
              </button>
            </div>
          </div>
        )}

        {/* STEP: Removing BG */}
        {step === 'removing-bg' && (
          <div className="animate-fade-in flex flex-col items-center gap-lg text-center">
            <div className="spinner spinner-lg" />
            <div>
              <h2 className="font-display text-lg font-semibold" style={{ marginBottom: 4 }}>
                Eliminando fondo…
              </h2>
              <p className="text-sm text-muted">Procesando en tu dispositivo</p>
            </div>
            <div style={{ width: '100%', height: 4, background: 'var(--clr-surface-3)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${bgProgress}%`,
                background: 'linear-gradient(90deg, var(--clr-primary-dim), var(--clr-primary))',
                borderRadius: 2,
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        )}

        {/* STEP: Confirm label */}
        {step === 'confirm-label' && noBgUrl && (
          <div className="animate-fade-in flex flex-col gap-lg">
            {/* Preview */}
            <div style={{
              background: 'var(--clr-surface-2)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-md)',
              display: 'flex',
              justifyContent: 'center',
              border: '1px solid var(--clr-border)',
            }}>
              <img src={noBgUrl} alt="Prenda sin fondo" style={{ maxHeight: 200, objectFit: 'contain' }} />
            </div>

            {/* Auto-detected label */}
            {suggestedCategoria && (
              <div className="glass-sm flex items-center gap-sm" style={{ padding: '10px 14px' }}>
                <span className="text-sm text-muted">La IA detectó:</span>
                <span className="badge badge-ready">
                  {CATEGORIAS.find(c => c.value === suggestedCategoria)?.emoji}{' '}
                  {CATEGORIAS.find(c => c.value === suggestedCategoria)?.label}
                  {suggestedColor ? ` · ${suggestedColor}` : ''}
                </span>
              </div>
            )}

            {/* Category selector */}
            <div>
              <label className="text-sm text-muted uppercase tracking-wide" style={{ display: 'block', marginBottom: 8 }}>
                Categoría
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {CATEGORIAS.map(cat => (
                  <button
                    key={cat.value}
                    className={`btn btn-sm ${selectedCategoria === cat.value ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setSelectedCategoria(cat.value)}
                    style={{ flexDirection: 'column', gap: 4, height: 64, fontSize: '0.75rem' }}
                  >
                    <span style={{ fontSize: '1.2rem' }}>{cat.emoji}</span>
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Color */}
            <div>
              <label className="text-sm text-muted uppercase tracking-wide" style={{ display: 'block', marginBottom: 8 }}>
                Color (opcional)
              </label>
              <input
                className="input"
                type="text"
                value={selectedColor}
                onChange={e => setSelectedColor(e.target.value)}
                placeholder="ej: negro, rojo vino…"
              />
            </div>

            {/* Collection */}
            <div>
              <label className="text-sm text-muted uppercase tracking-wide" style={{ display: 'block', marginBottom: 8 }}>
                Colección (opcional)
              </label>
              {collections.length > 0 && (
                <select
                  className="input"
                  value={selectedCollection}
                  onChange={e => setSelectedCollection(e.target.value)}
                  style={{ marginBottom: 8 }}
                >
                  <option value="">Sin colección</option>
                  {collections.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              )}
              <input
                className="input"
                type="text"
                value={newCollectionName}
                onChange={e => setNewCollectionName(e.target.value)}
                placeholder="O crear nueva colección…"
              />
            </div>

            <button id="btn-confirm-label" className="btn btn-primary w-full" onClick={confirmLabel}>
              Confirmar y procesar →
            </button>
          </div>
        )}

        {/* STEP: Variants */}
        {step === 'variants' && (
          <div className="animate-fade-in flex flex-col items-center gap-xl text-center">
            <div style={{ fontSize: '2.5rem' }}>🧥</div>
            <h2 className="font-display text-lg font-semibold">
              {variantQuestion}
            </h2>
            <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>
              Si es así, vamos a generar dos versiones para que puedas elegir en el vestidor.
            </p>
            <div className="flex flex-col gap-sm w-full">
              <button
                id="btn-variants-yes"
                className="btn btn-primary w-full"
                onClick={() => { setHasVariants(true); submitGarment(true) }}
              >
                Sí, tiene variantes
              </button>
              <button
                id="btn-variants-no"
                className="btn btn-secondary w-full"
                onClick={() => { setHasVariants(false); submitGarment(false) }}
              >
                No, es solo una forma
              </button>
            </div>
            {void hasVariants}
          </div>
        )}

        {/* STEP: Processing */}
        {step === 'processing' && (
          <div className="animate-fade-in flex flex-col items-center gap-lg text-center">
            <div className="spinner spinner-lg animate-pulse-glow" />
            <div>
              <h2 className="font-display text-lg font-semibold" style={{ marginBottom: 4 }}>
                Procesando prenda
              </h2>
              <p className="text-sm text-muted">{processingMsg}</p>
            </div>
            <div className="glass text-left" style={{ padding: 'var(--space-md)', width: '100%' }}>
              <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>
                La IA está ajustando la prenda a tu cuerpo. Esto puede tomar unos minutos.
                <strong className="text-primary"> No cierres la app</strong>, pero podés seguir usándola.
              </p>
            </div>
          </div>
        )}

        {/* STEP: Done */}
        {step === 'done' && (
          <div className="animate-fade-in flex flex-col items-center gap-lg text-center">
            <div style={{ fontSize: '3rem' }}>✅</div>
            <h2 className="font-display text-xl font-semibold text-primary">¡Prenda agregada!</h2>
            <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>
              Tu prenda está en cola para ser procesada por la IA.
              Aparecerá en tu vestidor cuando esté lista (generalmente en unos minutos).
            </p>
            <div className="flex flex-col gap-sm w-full">
              <button id="btn-add-another" className="btn btn-primary w-full" onClick={reset}>
                Agregar otra prenda
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
