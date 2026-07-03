// Weather code → background mapping (Open-Meteo WMO codes)
// https://open-meteo.com/en/docs#weathervariables

export type WeatherCondition = 'sunny' | 'cloudy' | 'rain' | 'storm'

export interface WeatherInfo {
  condition: WeatherCondition
  label: string
  description: string
  bgImage: string
  emoji: string
}

const WEATHER_MAP: Record<number, WeatherInfo> = {
  // Clear sky
  0: { condition: 'sunny', label: 'Despejado', description: 'Cielo despejado', bgImage: '/bg-sunny.png', emoji: '☀️' },
  // Mainly clear, partly cloudy, overcast
  1: { condition: 'sunny', label: 'Mayormente despejado', description: 'Mayormente despejado', bgImage: '/bg-sunny.png', emoji: '🌤️' },
  2: { condition: 'cloudy', label: 'Parcialmente nublado', description: 'Parcialmente nublado', bgImage: '/bg-cloudy.png', emoji: '⛅' },
  3: { condition: 'cloudy', label: 'Nublado', description: 'Cubierto', bgImage: '/bg-cloudy.png', emoji: '☁️' },
  // Fog
  45: { condition: 'cloudy', label: 'Neblina', description: 'Niebla', bgImage: '/bg-cloudy.png', emoji: '🌫️' },
  48: { condition: 'cloudy', label: 'Neblina con escarcha', description: 'Niebla con escarcha', bgImage: '/bg-cloudy.png', emoji: '🌫️' },
  // Drizzle
  51: { condition: 'rain', label: 'Llovizna leve', description: 'Llovizna leve', bgImage: '/bg-rain.png', emoji: '🌦️' },
  53: { condition: 'rain', label: 'Llovizna', description: 'Llovizna moderada', bgImage: '/bg-rain.png', emoji: '🌦️' },
  55: { condition: 'rain', label: 'Llovizna intensa', description: 'Llovizna densa', bgImage: '/bg-rain.png', emoji: '🌧️' },
  // Rain
  61: { condition: 'rain', label: 'Lluvia leve', description: 'Lluvia leve', bgImage: '/bg-rain.png', emoji: '🌧️' },
  63: { condition: 'rain', label: 'Lluvia', description: 'Lluvia moderada', bgImage: '/bg-rain.png', emoji: '🌧️' },
  65: { condition: 'rain', label: 'Lluvia intensa', description: 'Lluvia fuerte', bgImage: '/bg-rain.png', emoji: '🌧️' },
  // Snow
  71: { condition: 'cloudy', label: 'Nieve leve', description: 'Nieve leve', bgImage: '/bg-cloudy.png', emoji: '🌨️' },
  73: { condition: 'cloudy', label: 'Nieve', description: 'Nieve moderada', bgImage: '/bg-cloudy.png', emoji: '❄️' },
  75: { condition: 'cloudy', label: 'Nevada intensa', description: 'Nevada fuerte', bgImage: '/bg-cloudy.png', emoji: '❄️' },
  // Showers
  80: { condition: 'rain', label: 'Chaparrones leves', description: 'Chaparrones leves', bgImage: '/bg-rain.png', emoji: '🌦️' },
  81: { condition: 'rain', label: 'Chaparrones', description: 'Chaparrones moderados', bgImage: '/bg-rain.png', emoji: '🌧️' },
  82: { condition: 'storm', label: 'Chaparrones fuertes', description: 'Chaparrones violentos', bgImage: '/bg-storm.png', emoji: '⛈️' },
  // Thunderstorm
  95: { condition: 'storm', label: 'Tormenta', description: 'Tormenta eléctrica', bgImage: '/bg-storm.png', emoji: '⛈️' },
  96: { condition: 'storm', label: 'Tormenta con granizo', description: 'Tormenta con granizo', bgImage: '/bg-storm.png', emoji: '⛈️' },
  99: { condition: 'storm', label: 'Tormenta fuerte', description: 'Tormenta con granizo fuerte', bgImage: '/bg-storm.png', emoji: '🌩️' },
}

export function getWeatherInfo(code: number): WeatherInfo {
  return WEATHER_MAP[code] ?? WEATHER_MAP[0]
}

export interface OpenMeteoResponse {
  current_weather: {
    weathercode: number
    temperature: number
    windspeed: number
  }
}

export async function fetchWeather(lat: number, lon: number): Promise<OpenMeteoResponse> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Weather fetch failed')
  return res.json()
}
