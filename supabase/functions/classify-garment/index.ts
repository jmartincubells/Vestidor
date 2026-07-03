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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { imageBase64 } = await req.json()

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'imageBase64 is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const prompt = `Analizá esta imagen de una prenda de ropa y respondé SOLO con un JSON válido con los siguientes campos:
{
  "categoria": uno de ["top", "bottom", "dress", "outerwear", "shoes", "accessory"],
  "color": el color principal en español (ej: "negro", "azul marino", "rojo vino"),
  "tipo": descripción breve del tipo (ej: "remera manga corta", "jean recto", "vestido midi"),
  "variant_question": si la prenda puede tener más de una forma de uso (ej: campera abierta/cerrada), escribí la pregunta a hacerle a la usuaria en español. Si no tiene variantes, dejá null.
}
No incluyas texto fuera del JSON.`

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_TEXT}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: 'image/png',
                  data: imageBase64,
                },
              },
            ],
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 256,
          },
        }),
      }
    )

    if (!response.ok) {
      const errText = await response.text()
      console.error('Gemini classify error:', errText)
      return new Response(JSON.stringify({ categoria: 'top', color: '', variant_question: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const geminiData = await response.json()
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'

    // Parse JSON from response (strip markdown code fences if present)
    const cleaned = rawText.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)

    // Validate categoria
    const validCats = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory']
    if (!validCats.includes(parsed.categoria)) parsed.categoria = 'top'

    // Log for debugging (no user data logged, only classification result)
    console.log('Classified:', { categoria: parsed.categoria, color: parsed.color })

    // We use service role only for logging purposes here — classification doesn't need DB
    void createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('classify-garment error:', err)
    // Return safe default on any error — user can correct manually
    return new Response(JSON.stringify({ categoria: 'top', color: '', variant_question: null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
