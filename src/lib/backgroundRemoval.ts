import { removeBackground } from '@imgly/background-removal'

export interface BackgroundRemovalResult {
  blob: Blob
  objectUrl: string
}

let isInitialized = false

/**
 * Removes background from an image file using @imgly/background-removal (WASM, fully client-side).
 * The first call downloads the WASM model (~20MB), subsequent calls are instant.
 */
export async function removeImageBackground(
  imageSource: File | Blob | string,
  onProgress?: (progress: number) => void
): Promise<BackgroundRemovalResult> {
  try {
    const blob = await removeBackground(imageSource, {
      output: {
        format: 'image/png',
        quality: 0.9,
      },
      progress: (key, current, total) => {
        if (onProgress && total > 0) {
          onProgress(Math.round((current / total) * 100))
        }
        if (!isInitialized && key === 'fetch:model') {
          isInitialized = true
        }
      },
    })

    const objectUrl = URL.createObjectURL(blob)
    return { blob, objectUrl }
  } catch (error) {
    throw new Error(`Background removal failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Convert a Blob to base64 string for API calls
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip the data URL prefix (data:image/png;base64,)
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Convert a canvas to a PNG Blob
 */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas to Blob conversion failed'))
      },
      'image/png',
      1.0
    )
  })
}
