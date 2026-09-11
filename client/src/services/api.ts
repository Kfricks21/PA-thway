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

export async function getHubState() {
  const response = await fetch(`${API_BASE}/api/hub/state`)

  if (!response.ok) {
    throw new Error('Failed to load student hub data')
  }

  return response.json()
}

export async function createHubNote(payload: Record<string, string>) {
  const response = await fetch(`${API_BASE}/api/hub/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'Failed to create note')
  }

  return response.json()
}

export async function createHubComment(payload: Record<string, string>) {
  const response = await fetch(`${API_BASE}/api/hub/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'Failed to create comment')
  }

  return response.json()
}

export async function createHubChallenge(payload: Record<string, string>) {
  const response = await fetch(`${API_BASE}/api/hub/challenges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'Failed to create challenge')
  }

  return response.json()
}

export async function createHubReply(payload: Record<string, string | number>) {
  const response = await fetch(`${API_BASE}/api/hub/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'Failed to create reply')
  }

  return response.json()
}

export async function likeHubItem(payload: Record<string, string | number>) {
  const response = await fetch(`${API_BASE}/api/hub/likes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'Failed to update likes')
  }

  return response.json()
}
