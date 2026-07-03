import { useEffect, useState, useRef, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { fetchWeather, getWeatherInfo, type WeatherInfo } from '../lib/weatherCodes'
import { getWardrobeState, saveWardrobeState, getCachedGarments, cacheGarment, getCachedMannequin } from '../lib/idb'
import type { Database } from '../lib/supabase'
import { useToast } from '../components/ui/Toast'

type Prenda = Database['public']['Tables']['prendas']['Row']
type Categoria = Prenda['categoria']

const CATEGORIA_ORDEN: Categoria[] = ['outerwear', 'dress', 'top', 'bottom', 'shoes', 'accessory']

const CATEGORIA_ZINDEX: Record<Categoria, number> = {
  shoes: 21,
  bottom: 22,
  top: 23,
  dress: 24,
  outerwear: 25,
  accessory: 26,
}

interface WardrobePageProps {
  user: User
}

export default function WardrobePage({ user }: WardrobePageProps) {
  const [prendas, setPrendas] = useState<Prenda[]>([])
  const [selected, setSelected] = useState<Partial<Record<Categoria, string>>>({})
  const [activeVariant, setActiveVariant] = useState<Record<string, string>>({})
  const [activeCollection, setActiveCollection] = useState<string | null>(null)
  const [collections, setCollections] = useState<{ id: string; nombre: string }[]>([])
  const [weather, setWeather] = useState<WeatherInfo | null>(null)
  const [mannequinSvg, setMannequinSvg] = useState<string | null>(null)
  const [loadingOutfit, setLoadingOutfit] = useState(false)
  const [loadingWeather, setLoadingWeather] = useState(true)
  const [hasGarments, setHasGarments] = useState(true)
  const { showToast } = useToast()
  const containerRef = useRef<HTMLDivElement>(null)

  // Load everything on mount
  useEffect(() => {
    loadData()
    loadWeather()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  async function loadData() {
    // Load mannequin
    const cached = await getCachedMannequin()
    if (cached?.svgData) setMannequinSvg(cached.svgData)

    // Load garments from IndexedDB first (instant)
    const cachedGarments = await getCachedGarments()
    if (cachedGarments.length > 0) {
      setPrendas(cachedGarments as unknown as Prenda[])
    }

    // Then sync from Supabase
    const [garmentsRes, collectionsRes] = await Promise.all([
      supabase.from('prendas').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('colecciones').select('*').eq('user_id', user.id).order('nombre'),
    ])

    if (garmentsRes.data) {
      const garments = garmentsRes.data
      setPrendas(garments)
      setHasGarments(garments.some(g => g.estado === 'listo'))
      // Update cache
      for (const g of garments) {
        await cacheGarment({
          id: g.id,
          url_png: g.url_png,
          url_original: g.url_original,
          categoria: g.categoria,
          color: g.color,
          etiquetas: g.etiquetas,
          variantes: g.variantes,
          estado: g.estado,
          coleccion_id: g.coleccion_id,
          cachedAt: Date.now(),
        })
      }
    }

    if (collectionsRes.data) setCollections(collectionsRes.data)

    // Restore wardrobe state
    const savedState = await getWardrobeState()
    if (savedState) {
      setSelected(savedState.selectedGarments as Partial<Record<Categoria, string>>)
      setActiveCollection(savedState.activeCollection)
    }
  }

  async function loadWeather() {
    setLoadingWeather(true)
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
      })
      const data = await fetchWeather(pos.coords.latitude, pos.coords.longitude)
      setWeather(getWeatherInfo(data.current_weather.weathercode))
    } catch {
      // Default to sunny if geolocation denied
      setWeather(getWeatherInfo(0))
    } finally {
      setLoadingWeather(false)
    }
  }

  // Persist wardrobe state when selections change
  const persistState = useCallback(async (
    newSelected: Partial<Record<Categoria, string>>,
    newCollection: string | null
  ) => {
    await saveWardrobeState({
      selectedGarments: newSelected as Record<string, string | null>,
      activeCollection: newCollection,
      lastUpdated: Date.now(),
    })
  }, [])

  function selectGarment(prenda: Prenda) {
    setSelected(prev => {
      const next = { ...prev }

      if (prenda.categoria === 'dress') {
        // Dress replaces top + bottom
        next['dress'] = prenda.id
        delete next['top']
        delete next['bottom']
      } else {
        // Regular garment: toggle or replace
        if (next[prenda.categoria] === prenda.id) {
          delete next[prenda.categoria]
        } else {
          next[prenda.categoria] = prenda.id
          // If selecting top/bottom, clear dress
          if (prenda.categoria === 'top' || prenda.categoria === 'bottom') {
            delete next['dress']
          }
        }
      }

      persistState(next, activeCollection)
      return next
    })
  }

  function toggleVariant(prendaId: string, variantKey: string) {
    setActiveVariant(prev => ({ ...prev, [prendaId]: variantKey }))
  }

  async function requestOutfitSuggestion() {
    setLoadingOutfit(true)
    try {
      const readyGarments = prendas.filter(g => g.estado === 'listo')
      const collectionGarments = activeCollection
        ? readyGarments.filter(g => g.coleccion_id === activeCollection)
        : readyGarments

      const { data, error } = await supabase.functions.invoke('suggest-outfit', {
        body: {
          garments: collectionGarments.map(g => ({
            id: g.id,
            categoria: g.categoria,
            color: g.color,
            etiquetas: g.etiquetas,
          })),
          weather: weather
            ? { condition: weather.condition, label: weather.label }
            : null,
        },
      })

      if (error) throw error

      // Apply suggestion
      if (data?.suggested_ids?.length) {
        const newSelected: Partial<Record<Categoria, string>> = {}
        for (const id of data.suggested_ids) {
          const prenda = prendas.find(p => p.id === id)
          if (prenda) newSelected[prenda.categoria] = prenda.id
        }
        setSelected(newSelected)
        await persistState(newSelected, activeCollection)
        showToast('Outfit sugerido aplicado ✨', 'success')
      }
    } catch (err) {
      console.error('Outfit suggestion error:', err)
      showToast('No se pudo obtener la sugerencia. Intentá de nuevo.', 'error')
    } finally {
      setLoadingOutfit(false)
    }
  }

  // Filtered garments for the panel
  const filteredGarments = prendas.filter(g =>
    !activeCollection || g.coleccion_id === activeCollection
  )

  // Currently selected garment PNGs
  const selectedGarments = CATEGORIA_ORDEN
    .map(cat => {
      const id = selected[cat]
      if (!id) return null
      const prenda = prendas.find(p => p.id === id)
      if (!prenda || prenda.estado !== 'listo') return null

      // Resolve variant URL
      const variantKey = activeVariant[id]
      let url = prenda.url_png
      if (variantKey && prenda.variantes && prenda.variantes[variantKey]) {
        url = prenda.variantes[variantKey]
      }

      return { ...prenda, resolvedUrl: url, zIndex: CATEGORIA_ZINDEX[cat] }
    })
    .filter(Boolean) as (Prenda & { resolvedUrl: string | null; zIndex: number })[]

  return (
    <div className="page" style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Weather background */}
      {weather && (
        <div
          className="weather-bg"
          style={{ backgroundImage: `url(${weather.bgImage})` }}
          aria-hidden="true"
        />
      )}

      {/* Header */}
      <div style={{
        position: 'relative',
        zIndex: 50,
        padding: 'calc(var(--space-md) + env(safe-area-inset-top)) var(--space-md) var(--space-sm)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <h1 className="font-display text-xl font-semibold text-primary">Vestidor</h1>
          {weather && !loadingWeather && (
            <p className="text-xs text-muted">
              {weather.emoji} {weather.label} · {weather.description}
            </p>
          )}
        </div>

        {/* Magic outfit button */}
        <button
          id="btn-magic-outfit"
          className="btn btn-gold btn-sm"
          onClick={requestOutfitSuggestion}
          disabled={loadingOutfit || !prendas.some(g => g.estado === 'listo')}
          style={{ gap: 6 }}
        >
          {loadingOutfit ? <div className="spinner" /> : '✨'}
          Sugerir
        </button>
      </div>

      {/* Dressing room canvas */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          zIndex: 10,
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 400,
        }}
      >
        {!hasGarments ? (
          <ModestyBlock />
        ) : (
          <div style={{
            position: 'relative',
            width: 220,
            height: 420,
          }}>
            {/* Mannequin base layer */}
            {mannequinSvg && (
              <img
                src={mannequinSvg}
                alt="Maniquí"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  zIndex: 'var(--z-mannequin)' as string,
                }}
              />
            )}

            {/* Garment layers */}
            {selectedGarments.map(g => g.resolvedUrl && (
              <img
                key={g.id}
                src={g.resolvedUrl}
                alt={g.categoria}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  zIndex: g.zIndex,
                  pointerEvents: 'none',
                }}
              />
            ))}
          </div>
        )}

        {/* Variant toggles for selected garments */}
        {selectedGarments
          .filter(g => g.variantes && Object.keys(g.variantes).length > 1)
          .map(g => (
            <div
              key={g.id}
              className="glass-sm"
              style={{
                position: 'absolute',
                bottom: 16,
                right: 16,
                zIndex: 30,
                padding: '6px 10px',
                display: 'flex',
                gap: 6,
              }}
            >
              {Object.keys(g.variantes!).map(key => (
                <button
                  key={key}
                  className={`btn btn-sm ${activeVariant[g.id] === key ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => toggleVariant(g.id, key)}
                  style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                >
                  {key}
                </button>
              ))}
            </div>
          ))}
      </div>

      {/* Garment picker panel */}
      <div style={{
        position: 'relative',
        zIndex: 50,
        background: 'rgba(15, 11, 14, 0.88)',
        backdropFilter: 'blur(20px)',
        borderTop: '1px solid var(--clr-border)',
        padding: 'var(--space-sm) var(--space-md)',
        paddingBottom: 'calc(80px + env(safe-area-inset-bottom))',
      }}>
        {/* Collection filter tabs */}
        {collections.length > 0 && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8 }}>
            <button
              className={`badge ${!activeCollection ? 'badge-ready' : 'badge-pending'}`}
              onClick={() => {
                setActiveCollection(null)
                persistState(selected, null)
              }}
              style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Todas
            </button>
            {collections.map(col => (
              <button
                key={col.id}
                className={`badge ${activeCollection === col.id ? 'badge-ready' : 'badge-pending'}`}
                onClick={() => {
                  setActiveCollection(col.id)
                  persistState(selected, col.id)
                }}
                style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {col.nombre}
              </button>
            ))}
          </div>
        )}

        {/* Horizontal garment scroll by category */}
        {CATEGORIA_ORDEN.map(cat => {
          const catGarments = filteredGarments.filter(g => g.categoria === cat && g.estado === 'listo')
          if (catGarments.length === 0) return null

          return (
            <div key={cat} style={{ marginBottom: 'var(--space-sm)' }}>
              <p className="text-xs text-dimmed uppercase tracking-wide" style={{ marginBottom: 4 }}>
                {CATEGORIA_LABELS[cat]}
              </p>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                {catGarments.map(g => (
                  <button
                    key={g.id}
                    onClick={() => selectGarment(g)}
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 'var(--radius-md)',
                      border: `2px solid ${selected[cat] === g.id ? 'var(--clr-primary)' : 'var(--clr-border)'}`,
                      overflow: 'hidden',
                      background: 'var(--clr-surface-2)',
                      flexShrink: 0,
                      transition: 'border-color 0.15s, transform 0.15s',
                      transform: selected[cat] === g.id ? 'scale(1.08)' : 'scale(1)',
                      boxShadow: selected[cat] === g.id ? 'var(--shadow-glow)' : 'none',
                    }}
                  >
                    {g.url_png && (
                      <img
                        src={g.url_png}
                        alt={g.color || g.categoria}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const CATEGORIA_LABELS: Record<Categoria, string> = {
  top: 'Tops',
  bottom: 'Pantalones',
  dress: 'Vestidos',
  outerwear: 'Abrigos',
  shoes: 'Zapatos',
  accessory: 'Accesorios',
}

function ModestyBlock() {
  return (
    <div className="glass animate-fade-in flex flex-col items-center gap-md text-center" style={{ padding: 'var(--space-xl)', maxWidth: 280, margin: 'auto' }}>
      <div style={{ fontSize: '2.5rem' }}>👗</div>
      <h2 className="font-display text-lg font-semibold" style={{ marginBottom: 4 }}>
        Cargá tus primeras prendas
      </h2>
      <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>
        Necesitás al menos un top o un vestido para empezar a vestirte.
        Tocá <strong className="text-primary">+ Agregar</strong> en la barra de abajo.
      </p>
    </div>
  )
}
