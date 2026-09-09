import { useEffect, useState } from 'react'
import { checkHealth, generateQuiz } from './services/api'

const sampleQuestions = [
  {
    id: 1,
    prompt: 'What is the main idea of this presentation?',
    options: ['A key concept from the slides', 'An unrelated statistic', 'A blank answer', 'A copied image label'],
    answer: 'A key concept from the slides',
  },
  {
    id: 2,
    prompt: 'Which part of the learning experience is improved by PA-thway?',
    options: ['Student engagement', 'Document formatting', 'Printer setup', 'System shutdown'],
    answer: 'Student engagement',
  },
  {
    id: 3,
    prompt: 'Why is uploading a presentation useful in this app?',
    options: ['It gives the app content to turn into a quiz', 'It changes the app theme', 'It sends an email', 'It deletes the file'],
    answer: 'It gives the app content to turn into a quiz',
  },
]

const initialSchedule = [
  { id: 1, day: 'Monday', time: '9:00 AM', title: 'Orientation + upload demo', type: 'Live' },
  { id: 2, day: 'Tuesday', time: '1:00 PM', title: 'Lab 1: slide review', type: 'Hands-on' },
  { id: 3, day: 'Wednesday', time: '11:00 AM', title: 'Cohort challenge round', type: 'Contest' },
  { id: 4, day: 'Friday', time: '2:30 PM', title: 'Share notes + feedback', type: 'Discussion' },
]

const initialLabs = [
  { id: 1, title: 'Lab 1: Extract key ideas', completed: true },
  { id: 2, title: 'Lab 2: Build a mini quiz', completed: false },
  { id: 3, title: 'Lab 3: Compare cohort answers', completed: false },
  { id: 4, title: 'Lab 4: Share findings', completed: false },
]

const initialChallenges = [
  { id: 1, cohort: 'Cohort A', prompt: 'Create a 3-question follow-up quiz from this week’s slides.' },
  { id: 2, cohort: 'Cohort B', prompt: 'Identify the strongest question style for student review.' },
  { id: 3, cohort: 'Cohort C', prompt: 'Turn one topic into a challenge activity for peers.' },
]

const initialComments = [
  { id: 1, author: 'Jordan', message: 'The upload flow is really easy to use during class.' },
  { id: 2, author: 'Alicia', message: 'I like the idea of using the slide content to generate review material.' },
]

const initialNotes = [
  { id: 1, title: 'Course recap', text: 'Focus on active recall and fast review cards after every lesson.' },
  { id: 2, title: 'Student tips', text: 'Keep notes short so learners can browse quickly on mobile.' },
]

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any | null>(null)
  const [status, setStatus] = useState('Checking server...')
  const [schedule, setSchedule] = useState(initialSchedule)
  const [labs, setLabs] = useState(initialLabs)
  const [challenges, setChallenges] = useState(initialChallenges)
  const [comments, setComments] = useState(initialComments)
  const [notes, setNotes] = useState(initialNotes)
  const [newComment, setNewComment] = useState('')
  const [newNoteTitle, setNewNoteTitle] = useState('')
  const [newNoteText, setNewNoteText] = useState('')
  const [newChallengePrompt, setNewChallengePrompt] = useState('')

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

  const handleAddScheduleItem = () => {
    setSchedule((current) => [
      ...current,
      {
        id: Date.now(),
        day: 'New session',
        time: 'TBD',
        title: 'Open review block',
        type: 'Flexible',
      },
    ])
  }

  const handleToggleLab = (id: number) => {
    setLabs((current) =>
      current.map((lab) => (lab.id === id ? { ...lab, completed: !lab.completed } : lab)),
    )
  }

  const handleAddChallenge = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!newChallengePrompt.trim()) {
      return
    }

    setChallenges((current) => [
      ...current,
      {
        id: Date.now(),
        cohort: 'New cohort',
        prompt: newChallengePrompt.trim(),
      },
    ])
    setNewChallengePrompt('')
  }

  const handleAddComment = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!newComment.trim()) {
      return
    }

    setComments((current) => [
      ...current,
      {
        id: Date.now(),
        author: 'You',
        message: newComment.trim(),
      },
    ])
    setNewComment('')
  }

  const handleAddNote = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!newNoteTitle.trim() && !newNoteText.trim()) {
      return
    }

    setNotes((current) => [
      ...current,
      {
        id: Date.now(),
        title: newNoteTitle.trim() || 'Shared note',
        text: newNoteText.trim() || 'Shared note content',
      },
    ])
    setNewNoteTitle('')
    setNewNoteText('')
  }

  const displayQuestions = result?.questions ?? sampleQuestions
  const displayFilename = result?.filename ?? 'Sample presentation deck'

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">PA</span>
          <span>PA-thway</span>
        </div>

        <nav className="nav">
          <a href="#features">Features</a>
          <a href="#hub">Student hub</a>
          <a href="#how-it-works">How it works</a>
          <a href="#demo">Demo</a>
        </nav>

        <a className="nav-button" href="#demo">
          Try the demo
        </a>
      </header>

      <main className="page">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Classroom-ready learning platform</p>
            <h1>Turn slides into interactive student experiences.</h1>
            <p className="subtitle">
              PA-thway helps instructors and students turn presentations into quick quizzes, easy review
              activities, collaborative discussion spaces, and accessible classroom tools outside the classroom network.
            </p>

            <div className="hero-actions">
              <a className="primary-button" href="#demo">
                Launch demo
              </a>
              <a className="secondary-button" href="#features">
                Explore features
              </a>
            </div>

            <div className="hero-stats">
              <div className="stat-card">
                <strong>Fast</strong>
                <span>Upload slides and generate questions in seconds</span>
              </div>
              <div className="stat-card">
                <strong>Collaborative</strong>
                <span>Share notes, challenge ideas, and class updates</span>
              </div>
              <div className="stat-card">
                <strong>Accessible</strong>
                <span>Browse on mobile, tablet, or laptop</span>
              </div>
            </div>
          </div>

          <div className="hero-panel">
            <div className="mini-status">
              <span className="status-dot" />
              <span>{status}</span>
            </div>

            <ul className="mini-feature-list">
              <li>PowerPoint and PDF upload</li>
              <li>Instant quiz generation</li>
              <li>Editable student schedule</li>
              <li>Challenge prompts and shared notes</li>
            </ul>
          </div>
        </section>

        <section className="feature-section" id="features">
          <div className="section-heading">
            <p className="eyebrow">Features</p>
            <h2>Everything students and instructors need in one place</h2>
          </div>

          <div className="feature-grid">
            <article className="feature-card">
              <div className="feature-icon">📁</div>
              <h3>Easy uploads</h3>
              <p>Upload a presentation file and let the app extract slide content for review or quiz creation.</p>
            </article>

            <article className="feature-card">
              <div className="feature-icon">🧠</div>
              <h3>Smart quiz generation</h3>
              <p>Generate questions from uploaded PowerPoints or PDFs using the content already in the deck.</p>
            </article>

            <article className="feature-card">
              <div className="feature-icon">📆</div>
              <h3>Editable schedule</h3>
              <p>Track what is happening each day and keep the class plan organized and visible.</p>
            </article>

            <article className="feature-card">
              <div className="feature-icon">💬</div>
              <h3>Comments and notes</h3>
              <p>Highlight discussion points, leave feedback, and share notes with classmates or cohorts.</p>
            </article>
          </div>
        </section>

        <section className="hub-section" id="hub">
          <div className="section-heading">
            <p className="eyebrow">Student hub</p>
            <h2>More than a quiz generator</h2>
          </div>

          <div className="hub-grid">
            <div className="hub-card">
              <div className="hub-header">
                <h3>Editable schedule</h3>
                <button type="button" className="mini-button" onClick={handleAddScheduleItem}>Add session</button>
              </div>

              <div className="schedule-list">
                {schedule.map((item) => (
                  <div className="schedule-item" key={item.id}>
                    <div>
                      <strong>{item.day}</strong>
                      <span>{item.time}</span>
                    </div>
                    <div>
                      <p>{item.title}</p>
                      <small>{item.type}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="hub-card">
              <h3>Labs</h3>
              <div className="checklist">
                {labs.map((lab) => (
                  <label className="check-item" key={lab.id}>
                    <input
                      type="checkbox"
                      checked={lab.completed}
                      onChange={() => handleToggleLab(lab.id)}
                    />
                    <span>{lab.title}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="hub-card">
              <h3>Cohort challenges</h3>
              <form className="inline-form" onSubmit={handleAddChallenge}>
                <input
                  type="text"
                  value={newChallengePrompt}
                  placeholder="Add a challenge prompt"
                  onChange={(event) => setNewChallengePrompt(event.target.value)}
                />
                <button type="submit" className="mini-button">Post</button>
              </form>

              <div className="challenge-list">
                {challenges.map((challenge) => (
                  <div className="challenge-item" key={challenge.id}>
                    <strong>{challenge.cohort}</strong>
                    <p>{challenge.prompt}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="hub-card">
              <h3>Comments</h3>
              <form className="inline-form" onSubmit={handleAddComment}>
                <input
                  type="text"
                  value={newComment}
                  placeholder="Leave a comment"
                  onChange={(event) => setNewComment(event.target.value)}
                />
                <button type="submit" className="mini-button">Send</button>
              </form>

              <div className="comment-list">
                {comments.map((comment) => (
                  <div className="comment-item" key={comment.id}>
                    <strong>{comment.author}</strong>
                    <p>{comment.message}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="hub-card note-card">
              <h3>Shareable notes</h3>
              <form className="notes-form" onSubmit={handleAddNote}>
                <input
                  type="text"
                  value={newNoteTitle}
                  placeholder="Note title"
                  onChange={(event) => setNewNoteTitle(event.target.value)}
                />
                <textarea
                  value={newNoteText}
                  placeholder="Write a note to share"
                  onChange={(event) => setNewNoteText(event.target.value)}
                />
                <button type="submit" className="mini-button">Save note</button>
              </form>

              <div className="notes-list">
                {notes.map((note) => (
                  <div className="note-item" key={note.id}>
                    <strong>{note.title}</strong>
                    <p>{note.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="workflow-section" id="how-it-works">
          <div className="section-heading">
            <p className="eyebrow">How it works</p>
            <h2>A simple flow for learning and review</h2>
          </div>

          <div className="workflow-grid">
            <div className="workflow-step">
              <span>01</span>
              <h3>Upload a file</h3>
              <p>Choose a PowerPoint or PDF file that you want the app to analyze and turn into review content.</p>
            </div>
            <div className="workflow-step">
              <span>02</span>
              <h3>Generate questions</h3>
              <p>The app reads the uploaded deck and returns quiz questions based on extracted slide text.</p>
            </div>
            <div className="workflow-step">
              <span>03</span>
              <h3>Browse and interact</h3>
              <p>Students can use the hub to review schedules, labs, notes, and race each other with study challenges.</p>
            </div>
          </div>
        </section>

        <section className="demo-section" id="demo">
          <div className="section-heading">
            <p className="eyebrow">Demo</p>
            <h2>Try the interactive features</h2>
          </div>

          <div className="demo-layout">
            <div className="demo-card">
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

              <div className="info-box">
                <strong>Deployment status</strong>
                <span>{status}</span>
              </div>
            </div>

            <div className="preview-card">
              <h3>{result ? 'Generated quiz' : 'Sample preview'}</h3>
              <p>
                <strong>File:</strong> {displayFilename}
              </p>

              <ol className="question-list">
                {displayQuestions.map((question: any) => (
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
          </div>
        </section>

        <section className="use-cases-section" id="use-cases">
          <div className="section-heading">
            <p className="eyebrow">Built for many uses</p>
            <h2>Perfect for student browsing and classroom exploration</h2>
          </div>

          <div className="use-case-grid">
            <div className="use-case-card">
              <h3>Instructional review</h3>
              <p>Use uploaded slides to create a quick review activity after a lesson.</p>
            </div>
            <div className="use-case-card">
              <h3>Student practice</h3>
              <p>Give students an easy way to explore course content through interactive questions.</p>
            </div>
            <div className="use-case-card">
              <h3>Powerful showcase</h3>
              <p>Show classmates and viewers the app as a public, collaborative learning platform.</p>
            </div>
          </div>
        </section>

        <section className="cta-section">
          <div className="cta-card">
            <div>
              <p className="eyebrow">Ready to explore</p>
              <h2>PA-thway is now ready for public browsing.</h2>
            </div>
            <a className="primary-button" href="#demo">
              Open the live demo
            </a>
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>PA-thway</span>
        <span>Built for classroom and public browsing.</span>
      </footer>
    </div>
  )
}

export default App
