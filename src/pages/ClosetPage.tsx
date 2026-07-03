import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Database } from '../lib/supabase'
import { useToast } from '../components/ui/Toast'

type Prenda = Database['public']['Tables']['prendas']['Row']
type Categoria = Prenda['categoria']

const CATEGORIA_LABELS: Record<Categoria, string> = {
  top: 'Tops', bottom: 'Pantalones', dress: 'Vestidos',
  outerwear: 'Abrigos', shoes: 'Zapatos', accessory: 'Accesorios',
}

const STATUS_LABELS: Record<string, { label: string; badge: string }> = {
  pendiente:       { label: 'En cola',      badge: 'badge-pending' },
  procesando:      { label: 'Procesando',   badge: 'badge-processing' },
  listo:           { label: 'Listo',        badge: 'badge-ready' },
  reintentar:      { label: 'Reintentando', badge: 'badge-retry' },
  fallo_permanente:{ label: 'Error',        badge: 'badge-error' },
}

interface ClosetPageProps {
  user: User
}

export default function ClosetPage({ user }: ClosetPageProps) {
  const [prendas, setPrendas] = useState<Prenda[]>([])
  const [collections, setCollections] = useState<{ id: string; nombre: string }[]>([])
  const [activeFilter, setActiveFilter] = useState<'all' | Categoria>('all')
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const { showToast } = useToast()

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  async function loadData() {
    setLoading(true)
    const [garmentsRes, collectionsRes] = await Promise.all([
      supabase.from('prendas').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('colecciones').select('*').eq('user_id', user.id).order('nombre'),
    ])
    if (garmentsRes.data) setPrendas(garmentsRes.data)
    if (collectionsRes.data) setCollections(collectionsRes.data)
    setLoading(false)
  }

  async function deleteGarment(prenda: Prenda) {
    if (!confirm(`¿Eliminar ${CATEGORIA_LABELS[prenda.categoria]} ${prenda.color ? `(${prenda.color})` : ''}?`)) return
    setDeletingId(prenda.id)

    try {
      // Delete from Storage
      const filesToDelete: string[] = []
      if (prenda.url_png) {
        const path = prenda.url_png.split('/prendas-png/')[1]
        if (path) filesToDelete.push(path)
      }
      if (prenda.url_original) {
        const path = prenda.url_original.split('/prendas-png/')[1]
        if (path) filesToDelete.push(path)
      }
      if (filesToDelete.length) {
        await supabase.storage.from('prendas-png').remove(filesToDelete)
      }

      // Delete from DB
      await supabase.from('prendas').delete().eq('id', prenda.id)
      setPrendas(prev => prev.filter(p => p.id !== prenda.id))
      showToast('Prenda eliminada', 'info')
    } catch (err) {
      console.error('Delete garment error:', err)
      showToast('Error al eliminar la prenda', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  async function retryGarment(prenda: Prenda) {
    try {
      await supabase.from('prendas').update({ estado: 'pendiente', intentos: 0, error_msg: null }).eq('id', prenda.id)
      await supabase.functions.invoke('process-garment', { body: { prenda_id: prenda.id } })
      setPrendas(prev => prev.map(p => p.id === prenda.id ? { ...p, estado: 'pendiente' } : p))
      showToast('Reintentando procesamiento…', 'info')
    } catch {
      showToast('Error al reintentar', 'error')
    }
  }

  const filtered = activeFilter === 'all'
    ? prendas
    : prendas.filter(p => p.categoria === activeFilter)

  const categories: Categoria[] = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory']
  const usedCategories = categories.filter(cat => prendas.some(p => p.categoria === cat))

  return (
    <div className="page" style={{ paddingTop: 'calc(var(--space-lg) + env(safe-area-inset-top))' }}>
      <div style={{ padding: '0 var(--space-md)', maxWidth: 600, margin: '0 auto', width: '100%' }}>

        {/* Header */}
        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-lg)' }}>
          <h1 className="font-display text-xl font-semibold text-primary">Mi Closet</h1>
          <span className="text-sm text-dimmed">{prendas.length} prendas</span>
        </div>

        {/* Category filter */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 'var(--space-md)' }}>
          <button
            className={`badge ${activeFilter === 'all' ? 'badge-ready' : 'badge-pending'}`}
            onClick={() => setActiveFilter('all')}
            style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Todas ({prendas.length})
          </button>
          {usedCategories.map(cat => (
            <button
              key={cat}
              className={`badge ${activeFilter === cat ? 'badge-ready' : 'badge-pending'}`}
              onClick={() => setActiveFilter(cat)}
              style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {CATEGORIA_LABELS[cat]} ({prendas.filter(p => p.categoria === cat).length})
            </button>
          ))}
        </div>

        {/* Garment list */}
        {loading ? (
          <div className="flex flex-col gap-sm">
            {[1, 2, 3].map(i => (
              <div key={i} className="skeleton" style={{ height: 88, borderRadius: 'var(--radius-md)' }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center" style={{ padding: 'var(--space-xl)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-md)' }}>👗</div>
            <p className="text-sm text-muted">No hay prendas en esta categoría todavía.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-sm animate-fade-in">
            {filtered.map(prenda => {
              const status = STATUS_LABELS[prenda.estado] ?? STATUS_LABELS['pendiente']
              const collection = collections.find(c => c.id === prenda.coleccion_id)

              return (
                <div
                  key={prenda.id}
                  className="glass"
                  style={{
                    display: 'flex',
                    gap: 'var(--space-md)',
                    padding: 'var(--space-sm) var(--space-md)',
                    alignItems: 'center',
                  }}
                >
                  {/* Thumbnail */}
                  <div style={{
                    width: 64,
                    height: 64,
                    borderRadius: 'var(--radius-sm)',
                    overflow: 'hidden',
                    background: 'var(--clr-surface-2)',
                    flexShrink: 0,
                    border: '1px solid var(--clr-border)',
                  }}>
                    {prenda.url_png || prenda.url_original ? (
                      <img
                        src={prenda.url_png ?? prenda.url_original ?? ''}
                        alt={prenda.categoria}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    ) : (
                      <div style={{
                        width: '100%', height: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.5rem',
                      }}>
                        {prenda.categoria === 'top' ? '👚' :
                          prenda.categoria === 'bottom' ? '👖' :
                          prenda.categoria === 'dress' ? '👗' :
                          prenda.categoria === 'outerwear' ? '🧥' :
                          prenda.categoria === 'shoes' ? '👠' : '👜'}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-xs" style={{ marginBottom: 2 }}>
                      <span className="text-sm font-medium">{CATEGORIA_LABELS[prenda.categoria]}</span>
                      {prenda.color && (
                        <span className="text-xs text-muted">· {prenda.color}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-xs" style={{ flexWrap: 'wrap', gap: 4 }}>
                      <span className={`badge ${status.badge}`}>{status.label}</span>
                      {collection && (
                        <span className="badge badge-pending">{collection.nombre}</span>
                      )}
                    </div>
                    {prenda.estado === 'fallo_permanente' && prenda.error_msg && (
                      <p className="text-xs" style={{ color: 'var(--clr-danger)', marginTop: 4, lineHeight: 1.4 }}>
                        {prenda.error_msg}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-xs">
                    {prenda.estado === 'fallo_permanente' && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => retryGarment(prenda)}
                        style={{ fontSize: '0.7rem' }}
                      >
                        Reintentar
                      </button>
                    )}
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => deleteGarment(prenda)}
                      disabled={deletingId === prenda.id}
                    >
                      {deletingId === prenda.id ? <div className="spinner" style={{ width: 14, height: 14 }} /> : '✕'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
