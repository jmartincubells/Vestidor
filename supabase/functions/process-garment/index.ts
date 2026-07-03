import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!
const GEMINI_MODEL_IMAGE = Deno.env.get('GEMINI_MODEL_IMAGE') ?? 'gemini-2.0-flash-preview-image-generation'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_IMMEDIATE_RETRIES = 3
const RETRY_DELAYS_MS = [1000, 3000, 8000]

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function callGeminiImageEdit(
  garmentBase64: string,
  categoria: string,
  measurements: Record<string, number | null>,
  hasVariants: boolean
): Promise<{ imageBase64: string; mimeType: string } | null> {
  const measurementsDesc = [
    measurements.ancho_hombros != null ? `ancho de hombros: ${(measurements.ancho_hombros * 100).toFixed(1)}%` : null,
    measurements.cintura != null ? `cintura: ${(measurements.cintura * 100).toFixed(1)}%` : null,
    measurements.cadera != null ? `cadera: ${(measurements.cadera * 100).toFixed(1)}%` : null,
    measurements.largo_torso != null ? `largo de torso: ${(measurements.largo_torso * 100).toFixed(1)}%` : null,
    measurements.largo_piernas != null ? `largo de piernas: ${(measurements.largo_piernas * 100).toFixed(1)}%` : null,
  ].filter(Boolean).join(', ')

  const prompt = `Tenés una imagen de una prenda de ropa (${categoria}) sin fondo.
Ajustá la prenda para que se vea correctamente puesta sobre un cuerpo con estas medidas (normalizadas 0-100): ${measurementsDesc}.
La prenda debe mantener su PNG transparente (sin fondo), solo ajustar la forma/perspectiva para que luzca natural sobre ese cuerpo.
${hasVariants ? 'Generá la prenda en su versión cerrada/formal.' : ''}
Mantené los colores y texturas originales. No agregues sombras externas ni fondo.
Devolvé SOLO la imagen PNG con fondo transparente.`

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_IMAGE}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/png', data: garmentBase64 } },
          ],
        }],
        generationConfig: {
          temperature: 0.2,
          responseModalities: ['IMAGE'],
        },
      }),
    }
  )

  if (!response.ok) {
    const status = response.status
    const body = await response.text()
    throw { status, body, isContentPolicy: body.includes('SAFETY') || body.includes('content_filter') }
  }

  const data = await response.json()
  const imagePart = data?.candidates?.[0]?.content?.parts?.find(
    (p: Record<string, unknown>) => p.inline_data
  )

  if (!imagePart?.inline_data) return null

  return {
    imageBase64: imagePart.inline_data.data,
    mimeType: imagePart.inline_data.mime_type ?? 'image/png',
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  try {
    const { prenda_id } = await req.json()
    if (!prenda_id) {
      return new Response(JSON.stringify({ error: 'prenda_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. Load prenda
    const { data: prenda, error: prendaErr } = await supabase
      .from('prendas')
      .select('*, maniqui:maniqui!inner(ancho_hombros, cintura, cadera, largo_torso, largo_piernas)')
      .eq('id', prenda_id)
      .single()

    if (prendaErr || !prenda) {
      return new Response(JSON.stringify({ error: 'Prenda not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Skip if already done
    if (prenda.estado === 'listo') {
      return new Response(JSON.stringify({ status: 'already_done' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Mark as processing
    await supabase.from('prendas').update({ estado: 'procesando', intentos: (prenda.intentos ?? 0) + 1 }).eq('id', prenda_id)

    // 2. Fetch original image from Storage
    const originalUrl = prenda.url_original
    if (!originalUrl) throw new Error('No url_original on prenda')

    const imgRes = await fetch(originalUrl)
    if (!imgRes.ok) throw new Error(`Failed to fetch original image: ${imgRes.status}`)
    const imgBuffer = await imgRes.arrayBuffer()
    const garmentBase64 = btoa(String.fromCharCode(...new Uint8Array(imgBuffer)))

    // 3. Get measurements from maniqui
    const measurements = prenda.maniqui ?? {}
    const hasVariants = prenda.etiquetas?.has_variants === true

    // 4. Call Gemini with retries for transient errors
    let imageResult: { imageBase64: string; mimeType: string } | null = null
    let lastError: { status?: number; body?: string; isContentPolicy?: boolean } | null = null

    for (let attempt = 0; attempt < MAX_IMMEDIATE_RETRIES; attempt++) {
      try {
        imageResult = await callGeminiImageEdit(garmentBase64, prenda.categoria, measurements, hasVariants)
        break
      } catch (err: unknown) {
        const e = err as { status?: number; isContentPolicy?: boolean }
        lastError = err as { status?: number; body?: string; isContentPolicy?: boolean }

        // Content policy → immediate permanent failure
        if (e.isContentPolicy) {
          await supabase.from('prendas').update({
            estado: 'fallo_permanente',
            error_msg: 'No pudimos procesar esta foto, probá sacarla de nuevo con mejor luz o un fondo más simple.',
          }).eq('id', prenda_id)
          return new Response(JSON.stringify({ status: 'content_policy_failure' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        // 429 rate limit → mark for retry later, stop retrying now
        if (e.status === 429) {
          await supabase.from('prendas').update({
            estado: 'reintentar',
            error_msg: 'Llegamos al límite de uso de hoy, tu prenda se va a procesar sola en las próximas horas.',
          }).eq('id', prenda_id)
          return new Response(JSON.stringify({ status: 'rate_limited' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        // Transient error → wait and retry
        if (attempt < MAX_IMMEDIATE_RETRIES - 1) {
          console.warn(`Attempt ${attempt + 1} failed, retrying in ${RETRY_DELAYS_MS[attempt]}ms`)
          await sleep(RETRY_DELAYS_MS[attempt])
        }
      }
    }

    if (!imageResult) {
      // All retries exhausted → mark for background retry
      console.error('All retries exhausted:', lastError)
      await supabase.from('prendas').update({
        estado: 'reintentar',
        error_msg: 'Error transitorio. Se reintentará automáticamente.',
      }).eq('id', prenda_id)
      return new Response(JSON.stringify({ status: 'will_retry' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 5. Upload result PNG to Storage
    const resultBuffer = Uint8Array.from(atob(imageResult.imageBase64), c => c.charCodeAt(0))
    const fileName = `${prenda.user_id}/${prenda_id}-processed.png`

    const { error: uploadErr } = await supabase.storage
      .from('prendas-png')
      .upload(fileName, resultBuffer, {
        contentType: 'image/png',
        upsert: true,
      })

    if (uploadErr) throw uploadErr

    const { data: { publicUrl } } = supabase.storage.from('prendas-png').getPublicUrl(fileName)

    // 6. Update prenda record
    const updates: Record<string, unknown> = {
      estado: 'listo',
      url_png: publicUrl,
      error_msg: null,
    }

    // If variants requested, we'd need a second call for the open variant
    // For now, stored as single PNG. Variant support can be extended.
    await supabase.from('prendas').update(updates).eq('id', prenda_id)

    console.log('process-garment success:', prenda_id)

    return new Response(JSON.stringify({ status: 'success', url_png: publicUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('process-garment unhandled error:', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
