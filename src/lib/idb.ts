import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'

interface VestidorDB extends DBSchema {
  wardrobe_state: {
    key: string
    value: {
      id: string
      selectedGarments: Record<string, string | null> // categoria → prenda_id
      activeCollection: string | null
      lastUpdated: number
    }
  }
  cached_garments: {
    key: string
    value: {
      id: string
      url_png: string | null
      url_original: string | null
      categoria: string
      color: string | null
      etiquetas: Record<string, unknown> | null
      variantes: Record<string, string> | null
      estado: string
      coleccion_id: string | null
      cachedAt: number
    }
    indexes: { 'by-collection': string; 'by-categoria': string }
  }
  mannequin_cache: {
    key: string
    value: {
      id: string
      measurements: {
        ancho_hombros: number | null
        cintura: number | null
        cadera: number | null
        largo_torso: number | null
        largo_piernas: number | null
        altura_estimada: number | null
      }
      svgData: string | null // cached mannequin SVG
      cachedAt: number
    }
  }
}

const DB_NAME = 'vestidor-db'
const DB_VERSION = 1

let dbInstance: IDBPDatabase<VestidorDB> | null = null

async function getDB(): Promise<IDBPDatabase<VestidorDB>> {
  if (dbInstance) return dbInstance
  dbInstance = await openDB<VestidorDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Wardrobe state
      if (!db.objectStoreNames.contains('wardrobe_state')) {
        db.createObjectStore('wardrobe_state', { keyPath: 'id' })
      }
      // Cached garments
      if (!db.objectStoreNames.contains('cached_garments')) {
        const store = db.createObjectStore('cached_garments', { keyPath: 'id' })
        store.createIndex('by-collection', 'coleccion_id')
        store.createIndex('by-categoria', 'categoria')
      }
      // Mannequin cache
      if (!db.objectStoreNames.contains('mannequin_cache')) {
        db.createObjectStore('mannequin_cache', { keyPath: 'id' })
      }
    },
  })
  return dbInstance
}

// Wardrobe state
export async function getWardrobeState() {
  const db = await getDB()
  return db.get('wardrobe_state', 'current')
}

export async function saveWardrobeState(state: Omit<VestidorDB['wardrobe_state']['value'], 'id'>) {
  const db = await getDB()
  return db.put('wardrobe_state', { id: 'current', ...state })
}

// Garment cache
export async function getCachedGarments() {
  const db = await getDB()
  return db.getAll('cached_garments')
}

export async function cacheGarment(garment: VestidorDB['cached_garments']['value']) {
  const db = await getDB()
  return db.put('cached_garments', { ...garment, cachedAt: Date.now() })
}

export async function removeCachedGarment(id: string) {
  const db = await getDB()
  return db.delete('cached_garments', id)
}

export async function getGarmentsByCollection(coleccionId: string) {
  const db = await getDB()
  return db.getAllFromIndex('cached_garments', 'by-collection', coleccionId)
}

// Mannequin cache
export async function getCachedMannequin() {
  const db = await getDB()
  return db.get('mannequin_cache', 'mannequin')
}

export async function cacheMannequin(data: Omit<VestidorDB['mannequin_cache']['value'], 'id' | 'cachedAt'>) {
  const db = await getDB()
  return db.put('mannequin_cache', { id: 'mannequin', ...data, cachedAt: Date.now() })
}
