const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

export async function generateQuiz(formData: FormData) {
  const response = await fetch(`${API_BASE}/api/generate`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'Failed to generate quiz')
  }

  return response.json()
}

export async function checkHealth() {
  const response = await fetch(`${API_BASE}/api/health`)

  if (!response.ok) {
    throw new Error('Health check failed')
  }

  return response.json()
}
