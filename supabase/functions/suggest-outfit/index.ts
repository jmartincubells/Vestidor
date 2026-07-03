import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!
const GEMINI_MODEL_TEXT = Deno.env.get('GEMINI_MODEL_TEXT') ?? 'gemini-2.0-flash'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface GarmentInfo {
  id: string
  categoria: string
  color: string | null
  etiquetas: Record<string, unknown> | null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  try {
    const { garments, weather } = await req.json() as {
      garments: GarmentInfo[]
      weather: { condition: string; label: string } | null
    }

    if (!garments?.length) {
      return new Response(JSON.stringify({ error: 'garments array is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Build garment descriptions for Gemini
    const garmentDescriptions = garments.map(g =>
      `- ID: ${g.id} | Tipo: ${g.categoria} | Color: ${g.color ?? 'desconocido'} | Detalles: ${JSON.stringify(g.etiquetas ?? {})}`
    ).join('\n')

    const weatherContext = weather
      ? `El clima actual es: ${weather.label} (${weather.condition}).`
      : 'No hay información del clima disponible.'

    const prompt = `Sos una estilista de moda personal con mucho gusto.
${weatherContext}

Estas son las prendas disponibles:
${garmentDescriptions}

Tu tarea:
1. Seleccioná la combinación más elegante y apropiada para el clima actual.
2. Seguí las reglas: no combinés dress + top/bottom al mismo tiempo.
3. Priorizá combinaciones coherentes de color.
4. Respondé SOLO con un JSON válido con esta estructura:
{
  "suggested_ids": ["id1", "id2", ...],
  "reasoning": "Explicación corta en español de por qué elegiste esta combinación (máx 2 oraciones)"
}
No incluyas texto fuera del JSON.`

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_TEXT}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
        }),
      }
    )

    if (!response.ok) {
      throw new Error(`Gemini error: ${response.status}`)
    }

    const data = await response.json()
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'
    const cleaned = rawText.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)

    // Validate that suggested IDs are real
    const validIds = garments.map(g => g.id)
    parsed.suggested_ids = (parsed.suggested_ids ?? []).filter((id: string) => validIds.includes(id))

    // Log suggestion (no PII)
    console.log('Outfit suggestion:', { count: parsed.suggested_ids.length, reasoning: parsed.reasoning })
    void supabase

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('suggest-outfit error:', err)
    return new Response(JSON.stringify({ error: 'Failed to generate suggestion' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
