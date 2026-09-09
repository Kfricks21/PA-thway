import { useEffect, useState } from 'react'
import { checkHealth, generateQuiz } from './services/api'

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any | null>(null)
  const [status, setStatus] = useState('Checking server...')

  useEffect(() => {
    checkHealth()
      .then(() => setStatus('Server is available'))
      .catch(() => setStatus('Server is unavailable. Build the frontend and start the backend.'))
  }, [])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!file) {
      setStatus('Please select a file first.')
      return
    }

    setLoading(true)
    setStatus('Generating quiz...')

    const formData = new FormData()
    formData.append('file', file)
    formData.append('questionCount', '5')

    try {
      const data = await generateQuiz(formData)
      setResult(data)
      setStatus('Quiz generated successfully.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="card">
        <p className="eyebrow">PA-thway</p>
        <h1>Quiz Generator</h1>

        <p className="subtitle">
          Upload a PowerPoint or presentation file to generate a sample quiz. This app is now set up for
          deployment outside the classroom network.
        </p>

        <div className="info-box">
          <strong>Deployment status</strong>
          <span>{status}</span>
        </div>

        <form onSubmit={handleSubmit} className="upload-form">
          <label className="file-input">
            <input
              type="file"
              accept=".ppt,.pptx,.pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <span>{file ? file.name : 'Choose presentation file'}</span>
          </label>

          <button type="submit" disabled={loading || !file}>
            {loading ? 'Generating...' : 'Generate Quiz'}
          </button>
        </form>

        {result && (
          <div className="result-panel">
            <h2>Generated quiz</h2>
            <p>
              <strong>File:</strong> {result.filename}
            </p>
            <ol>
              {result.questions.map((question: any) => (
                <li key={question.id}>
                  <p>{question.prompt}</p>
                  <ul>
                    {question.options.map((option: string, index: number) => (
                      <li key={`${question.id}-${index}`}>{option}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
