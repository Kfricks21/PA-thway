import { useEffect, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import * as XLSX from 'xlsx'
import { checkHealth, generateQuiz } from './services/api'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

type ScheduleItem = {
  id: number
  day: string
  time: string
  title: string
  type: string
  isExam?: boolean
  score?: string
  comment?: string
}

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

const initialSchedule: ScheduleItem[] = [
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

const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const parseScheduleText = (text: string): ScheduleItem[] => {
  const lines = text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const items: ScheduleItem[] = []

  lines.forEach((line, index) => {
    const lowerLine = line.toLowerCase()
    const matchedDay = dayNames.find((day) => lowerLine.includes(day.toLowerCase()))

    if (!matchedDay) {
      return
    }

    const lineWithoutDay = line.replace(new RegExp(matchedDay, 'ig'), '').trim()
    const timeMatch = lineWithoutDay.match(/(\d{1,2}:\d{2}\s?(?:AM|PM))/i)
    const time = timeMatch ? timeMatch[1] : 'TBD'
    const title = lineWithoutDay.replace(time, '').replace(/^[\-•*\s]+/, '').trim() || `${matchedDay} session`
    const type = /exam|test|quiz|assessment/i.test(title)
      ? 'Exam'
      : inferScheduleType(title)
    const isExam = /exam|test|quiz|assessment/i.test(title)

    items.push({
      id: Date.now() + index,
      day: matchedDay,
      time,
      title,
      type,
      isExam,
    })
  })

  return items
}

const inferScheduleType = (title: string) => {
  const lower = title.toLowerCase()

  if (lower.includes('lab')) return 'Lab'
  if (lower.includes('assignment')) return 'Assignment'
  if (lower.includes('discussion')) return 'Discussion'
  if (lower.includes('challenge')) return 'Challenge'
  if (lower.includes('review')) return 'Review'

  return 'Session'
}

const extractWorkbookSchedule = (workbook: XLSX.WorkBook): ScheduleItem[] => {
  const firstSheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheetName]

  if (!sheet) {
    return []
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '', raw: false })

  return rows
    .map((row, index) => {
      const dayValue =
        row.Day ||
        row.day ||
        row.Date ||
        row.date ||
        row['Class Day'] ||
        row['Session Day'] ||
        Object.values(row)[0] ||
        ''

      const timeValue =
        row.Time ||
        row.time ||
        row['Class Time'] ||
        row['Session Time'] ||
        Object.values(row)[1] ||
        'TBD'

      const titleValue =
        row.Title ||
        row.title ||
        row.Event ||
        row.event ||
        row['Activity'] ||
        row['Assignment'] ||
        row['Course'] ||
        Object.values(row)[2] ||
        'Schedule item'

      const typeValue =
        row.Type ||
        row.type ||
        row.Category ||
        row.category ||
        inferScheduleType(String(titleValue))

      const title = String(titleValue).trim()
      const day = String(dayValue).trim()

      if (!title || !day) {
        return null
      }

      const isExam = /exam|test|quiz|assessment/i.test(title) || /exam|test|quiz|assessment/i.test(typeValue)

      return {
        id: Date.now() + index,
        day,
        time: String(timeValue).trim() || 'TBD',
        title,
        type: isExam ? 'Exam' : String(typeValue).trim() || inferScheduleType(title),
        isExam,
      }
    })
    .filter((item): item is ScheduleItem => item !== null)
}

const parseScheduleFile = async (file: File): Promise<ScheduleItem[]> => {
  const fileName = file.name.toLowerCase()

  if (fileName.endsWith('.csv') || fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const parsedSchedule = extractWorkbookSchedule(workbook)

    if (parsedSchedule.length > 0) {
      return parsedSchedule
    }
  }

  if (fileName.endsWith('.pdf')) {
    const pdfData = new Uint8Array(await file.arrayBuffer())
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise
    let extractedText = ''

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const pageText = await page.getTextContent()
      extractedText += pageText.items.map((item: any) => item.str || '').join(' ') + '\n'
    }

    const parsedSchedule = parseScheduleText(extractedText)

    if (parsedSchedule.length > 0) {
      return parsedSchedule
    }
  }

  return []
}

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
  const [scheduleFileName, setScheduleFileName] = useState('')
  const [scheduleInput, setScheduleInput] = useState('')

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

  const handleDeleteScheduleItem = (id: number) => {
    setSchedule((current) => current.filter((item) => item.id !== id))
  }

  const handleScheduleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0]

    if (!uploadedFile) {
      return
    }

    try {
      const parsedSchedule = await parseScheduleFile(uploadedFile)

      if (parsedSchedule.length === 0) {
        setStatus('Schedule file uploaded, but no schedule items were detected. Please use a CSV, Excel, or PDF file with clear day/time details.')
        return
      }

      setSchedule(parsedSchedule)
      setScheduleFileName(uploadedFile.name)
      setStatus(`Schedule imported from ${uploadedFile.name}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to read the schedule file.')
    }
  }

  const handleScheduleTextSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!scheduleInput.trim()) {
      return
    }

    const parsedSchedule = parseScheduleText(scheduleInput)

    if (parsedSchedule.length === 0) {
      setStatus('No schedule items were detected. Try adding lines with a day and time.')
      return
    }

    setSchedule(parsedSchedule)
    setScheduleInput('')
    setStatus('Schedule updated from pasted text.')
  }

  const handleExamFieldChange = (itemId: number, field: 'score' | 'comment', value: string) => {
    setSchedule((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              [field]: value,
              isExam: true,
              type: 'Exam',
            }
          : item,
      ),
    )
  }

  const handleSaveExamUpdate = (event: React.FormEvent<HTMLFormElement>, itemId: number) => {
    event.preventDefault()
    const item = schedule.find((entry) => entry.id === itemId)

    if (!item) {
      return
    }

    setStatus(`Exam notes saved for ${item.title}.`)
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
            <div className="hub-card schedule-card">
              <div className="hub-header">
                <h3>Editable schedule</h3>
                <button type="button" className="mini-button" onClick={handleAddScheduleItem}>Add session</button>
              </div>

              <div className="schedule-upload-row">
                <label className="file-input compact-file-input">
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls,.pdf"
                    onChange={handleScheduleUpload}
                  />
                  <span>{scheduleFileName || 'Upload schedule (.csv, .xlsx, .pdf)'}</span>
                </label>
              </div>

              <form className="inline-form" onSubmit={handleScheduleTextSubmit}>
                <textarea
                  value={scheduleInput}
                  placeholder="Paste a schedule here, one line per item with day and time (for example: Monday 9:00 AM Anatomy Lab)"
                  onChange={(event) => setScheduleInput(event.target.value)}
                />
                <button type="submit" className="mini-button">Load schedule text</button>
              </form>

              <div className="schedule-list">
                {schedule.map((item) => (
                  <div className={`schedule-item ${item.isExam ? 'exam-item' : ''}`} key={item.id}>
                    <div>
                      <strong>{item.day}</strong>
                      <span>{item.time}</span>
                    </div>
                    <div>
                      <p>{item.title}</p>
                      <small>{item.type}</small>
                      {item.isExam && (
                        <div className="exam-details">
                          <p>
                            <strong>Score:</strong> {item.score || 'Not added yet'}
                          </p>
                          <p>
                            <strong>What I missed:</strong> {item.comment || 'No notes yet'}
                          </p>
                        </div>
                      )}
                      <div className="schedule-actions">
                        <button type="button" className="mini-button secondary-mini-button" onClick={() => handleDeleteScheduleItem(item.id)}>
                          Delete
                        </button>
                      </div>
                    </div>

                    {item.isExam && (
                      <form className="exam-form" onSubmit={(event) => handleSaveExamUpdate(event, item.id)}>
                        <input
                          type="text"
                          value={item.score || ''}
                          placeholder="Add exam score"
                          onChange={(event) => handleExamFieldChange(item.id, 'score', event.target.value)}
                        />
                        <textarea
                          value={item.comment || ''}
                          placeholder="What did you miss or misunderstand?"
                          onChange={(event) => handleExamFieldChange(item.id, 'comment', event.target.value)}
                        />
                        <button type="submit" className="mini-button">Save exam notes</button>
                      </form>
                    )}
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
