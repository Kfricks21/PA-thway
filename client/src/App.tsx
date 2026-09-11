import { useEffect, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import * as XLSX from 'xlsx'
import {
  checkHealth,
  createHubChallenge,
  createHubComment,
  createHubNote,
  createHubReply,
  generateQuiz,
  getHubState,
  likeHubItem,
} from './services/api'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

type ScheduleItem = {
  id: number
  day: string
  time: string
  title: string
  type: string
  isExam?: boolean
  wearPTGear?: boolean
  score?: string
  comment?: string
}

type InteractiveModule = {
  id: string
  title: string
  type: string
  description: string
  context: string
  starterPotential: number
  ions: Array<{
    label: string
    effect: number
    description: string
  }>
}

const sampleQuestions: any[] = []

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

const initialChallenges: Array<{ id: number; cohort: string; targetCohort?: string; prompt: string }> = []

const initialComments: Array<{
  id: number
  author: string
  cohort: string
  message: string
  likes: number
  replies: Array<{ id: number; author: string; message: string }>
}> = []

const initialNotes: Array<{
  id: number
  title: string
  cohort: string
  text: string
  likes: number
  replies: Array<{ id: number; author: string; message: string }>
}> = []

const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const getStartOfWeek = (date: Date = new Date()) => {
  const normalizedDate = new Date(date)
  normalizedDate.setHours(0, 0, 0, 0)

  const dayNumber = normalizedDate.getDay()
  const diff = dayNumber === 0 ? -6 : 1 - dayNumber

  normalizedDate.setDate(normalizedDate.getDate() + diff)

  return normalizedDate
}

const formatWeekRange = (weekStart: Date) => {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)

  const startLabel = weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const endLabel = weekEnd.toLocaleDateString([], { month: 'short', day: 'numeric' })

  return `${startLabel} - ${endLabel}`
}

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
    const wearPTGear = /pt gear|physical training|wear pt|pt all day/i.test(title)

    items.push({
      id: Date.now() + index,
      day: matchedDay,
      time,
      title,
      type,
      isExam,
      wearPTGear,
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
      const wearPTGear = /pt gear|physical training|wear pt|pt all day/i.test(title) || /pt gear|physical training|wear pt|pt all day/i.test(typeValue)

      return {
        id: Date.now() + index,
        day,
        time: String(timeValue).trim() || 'TBD',
        title,
        type: isExam ? 'Exam' : String(typeValue).trim() || inferScheduleType(title),
        isExam,
        wearPTGear,
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
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({})
  const [cohortCode, setCohortCode] = useState('PA-101')
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({})
  const [revealedAnswers, setRevealedAnswers] = useState<Record<number, boolean>>({})
  const [activeBoardFilter, setActiveBoardFilter] = useState('All cohorts')
  const [composerTab, setComposerTab] = useState<'note' | 'comment' | 'challenge'>('note')
  const [scheduleFileName, setScheduleFileName] = useState('')
  const [scheduleInput, setScheduleInput] = useState('')
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() => getStartOfWeek())
  const [moduleInputs, setModuleInputs] = useState<Record<string, Record<string, number>>>({})

  useEffect(() => {
    checkHealth()
      .then(() => setStatus('Server is available'))
      .catch(() => setStatus('Server is unavailable. Build the frontend and start the backend.'))
  }, [])

  useEffect(() => {
    const loadHubState = async () => {
      try {
        const state = await getHubState()
        setComments(state.comments ?? initialComments)
        setNotes(state.notes ?? initialNotes)
        setChallenges(state.challenges ?? initialChallenges)
        setCohortCode(state.cohortCode || 'PA-101')
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Failed to load student hub data.')
      }
    }

    loadHubState()
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

  const calendarDays = dayNames.map((day, index) => {
    const date = new Date(currentWeekStart)
    date.setDate(currentWeekStart.getDate() + index)

    return {
      day,
      date,
      items: schedule.filter((item) => item.day.toLowerCase() === day.toLowerCase()),
    }
  })

  const handleWeekShift = (direction: number) => {
    setCurrentWeekStart((current) => {
      const nextWeek = new Date(current)
      nextWeek.setDate(current.getDate() + direction * 7)
      return nextWeek
    })
  }

  const getModuleInputValues = (module: InteractiveModule) => {
    const currentValues = moduleInputs[module.id] ?? {}

    return module.ions.reduce<Record<string, number>>((accumulator, ion) => {
      accumulator[ion.label] = currentValues[ion.label] ?? 0
      return accumulator
    }, {})
  }

  const getModulePotential = (module: InteractiveModule) => {
    const inputValues = getModuleInputValues(module)

    return module.ions.reduce((total, ion) => {
      const sliderValue = inputValues[ion.label] ?? 0
      return total + ion.effect * (sliderValue / 100)
    }, module.starterPotential)
  }

  const handleModuleIonChange = (moduleId: string, ionLabel: string, value: number) => {
    setModuleInputs((current) => ({
      ...current,
      [moduleId]: {
        ...(current[moduleId] ?? {}),
        [ionLabel]: value,
      },
    }))
  }

  const handleToggleLab = (id: number) => {
    setLabs((current) =>
      current.map((lab) => (lab.id === id ? { ...lab, completed: !lab.completed } : lab)),
    )
  }

  const handleAddChallenge = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!newChallengePrompt.trim()) {
      return
    }

    const targetCohort = (challengeTarget || cohortCode).trim() || 'General'

    try {
      const response = await createHubChallenge({
        cohort: cohortCode.trim() || 'General',
        targetCohort,
        prompt: newChallengePrompt.trim(),
      })

      setChallenges((current) => [response.challenge, ...current])
      setNewChallengePrompt('')
      setStatus(`Challenge posted to ${targetCohort}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to post challenge.')
    }
  }

  const handleAddComment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!newComment.trim()) {
      return
    }

    try {
      const response = await createHubComment({
        author: 'You',
        cohort: cohortCode.trim() || 'General',
        message: newComment.trim(),
      })

      setComments((current) => [response.comment, ...current])
      setNewComment('')
      setStatus('Comment posted.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to post comment.')
    }
  }

  const handleAddNote = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!newNoteTitle.trim() && !newNoteText.trim()) {
      return
    }

    try {
      const response = await createHubNote({
        title: newNoteTitle.trim() || 'Shared note',
        cohort: cohortCode.trim() || 'General',
        text: newNoteText.trim() || 'Shared note content',
      })

      setNotes((current) => [response.note, ...current])
      setNewNoteTitle('')
      setNewNoteText('')
      setStatus('Note saved.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save note.')
    }
  }

  const handleLikeNote = async (noteId: number) => {
    try {
      const response = await likeHubItem({ type: 'note', targetId: noteId })
      setNotes((current) =>
        current.map((note) =>
          note.id === noteId ? { ...note, likes: response.likes ?? (note.likes ?? 0) } : note,
        ),
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to like note.')
    }
  }

  const handleLikeComment = async (commentId: number) => {
    try {
      const response = await likeHubItem({ type: 'comment', targetId: commentId })
      setComments((current) =>
        current.map((comment) =>
          comment.id === commentId ? { ...comment, likes: response.likes ?? (comment.likes ?? 0) } : comment,
        ),
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to like comment.')
    }
  }

  const handleAddReply = async (targetType: 'note' | 'comment', targetId: number) => {
    const replyMessage = (replyDrafts[targetId] ?? '').trim()

    if (!replyMessage) {
      return
    }

    try {
      const response = await createHubReply({
        type: targetType,
        targetId,
        author: 'You',
        message: replyMessage,
      })

      if (targetType === 'note') {
        setNotes((current) =>
          current.map((note) =>
            note.id === targetId
              ? {
                  ...note,
                  replies: [...(note.replies ?? []), response.reply],
                }
              : note,
          ),
        )
      } else {
        setComments((current) =>
          current.map((comment) =>
            comment.id === targetId
              ? {
                  ...comment,
                  replies: [...(comment.replies ?? []), response.reply],
                }
              : comment,
          ),
        )
      }

      setReplyDrafts((current) => ({ ...current, [targetId]: '' }))
      setStatus('Reply posted.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to post reply.')
    }
  }

  const interactiveModules = result?.interactiveModules ?? []
  const displayQuestions = result?.questions ?? []
  const displayFilename = result?.filename ?? 'No uploaded presentation yet'

  const handleSelectAnswer = (questionId: number, option: string) => {
    setSelectedAnswers((current) => ({
      ...current,
      [questionId]: option,
    }))
    setRevealedAnswers((current) => ({
      ...current,
      [questionId]: true,
    }))
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">PA</span>
          <span>PA-thway</span>
        </div>

        <nav className="nav">
          <a href="#features">Features</a>
          <a href="#cohort-board">Cohort board</a>
          <a href="#schedule">Schedule</a>
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

        <section className="hub-section" id="cohort-board">
          <div className="section-heading">
            <p className="eyebrow">Cohort board</p>
            <h2>Class collaboration</h2>
          </div>

          <div className="hub-card cohort-card">
            <div className="hub-header cohort-header">
              <div>
                <h3>Community feed</h3>
                <p className="community-summary">
                  Everyone in the same cohort code can see each other’s notes, comments, and challenge posts.
                </p>
              </div>
              <div className="cohort-code-group">
                <label htmlFor="cohort-code">Cohort code</label>
                <input
                  id="cohort-code"
                  type="text"
                  value={cohortCode}
                  onChange={(event) => setCohortCode(event.target.value)}
                  placeholder="PA-101"
                />
              </div>
            </div>

            <div className="board-toolbar">
              <div className="board-filters">
                {['All cohorts', 'My cohort'].map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={`filter-button ${activeBoardFilter === filter ? 'filter-button-active' : ''}`}
                    onClick={() => setActiveBoardFilter(filter)}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="hub-card composer-card">
            <div className="composer-tabs">
              {(['note', 'comment', 'challenge'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`composer-tab ${composerTab === tab ? 'composer-tab-active' : ''}`}
                  onClick={() => setComposerTab(tab)}
                >
                  {tab === 'note' ? 'Notes' : tab === 'comment' ? 'Comments' : 'Challenges'}
                </button>
              ))}
            </div>

            {composerTab === 'note' && (
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
            )}

            {composerTab === 'comment' && (
              <form className="inline-form" onSubmit={handleAddComment}>
                <input
                  type="text"
                  value={newComment}
                  placeholder="Leave a comment"
                  onChange={(event) => setNewComment(event.target.value)}
                />
                <button type="submit" className="mini-button">Send</button>
              </form>
            )}

            {composerTab === 'challenge' && (
              <form className="inline-form" onSubmit={handleAddChallenge}>
                <input
                  type="text"
                  value={newChallengePrompt}
                  placeholder="Add a challenge prompt"
                  onChange={(event) => setNewChallengePrompt(event.target.value)}
                />
                <button type="submit" className="mini-button">Post</button>
              </form>
            )}
          </div>

          <div className="hub-grid">

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
                {challenges
                  .filter((challenge) => {
                    if (activeBoardFilter === 'My cohort') {
                      return (challenge.targetCohort ?? challenge.cohort) === (cohortCode.trim() || 'General')
                    }
                    return true
                  })
                  .map((challenge) => (
                    <div className="challenge-item" key={challenge.id}>
                      <strong>{challenge.cohort}</strong>
                      <p>{challenge.prompt}</p>
                      <small>Sent to cohort: {(challenge.targetCohort ?? challenge.cohort) || 'General'}</small>
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
                {comments
                  .filter((comment) => {
                    if (activeBoardFilter === 'My cohort') {
                      return comment.cohort === (cohortCode.trim() || 'General')
                    }
                    return true
                  })
                  .map((comment) => (
                    <div className="comment-item" key={comment.id}>
                      <strong>{comment.author}</strong>
                      <span className="cohort-pill">{comment.cohort}</span>
                      <p>{comment.message}</p>

                      <div className="post-actions">
                        <button type="button" className="text-button" onClick={() => handleLikeComment(comment.id)}>
                          👍 Like ({comment.likes ?? 0})
                        </button>
                        <button type="button" className="text-button" onClick={() => handleAddReply('comment', comment.id)}>
                          Reply ({comment.replies?.length ?? 0})
                        </button>
                      </div>

                      {comment.replies && comment.replies.length > 0 && (
                        <div className="reply-list">
                          {comment.replies.map((reply) => (
                            <div key={reply.id} className="reply-item">
                              <strong>{reply.author}</strong>
                              <p>{reply.message}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="reply-box">
                        <input
                          type="text"
                          value={replyDrafts[comment.id] ?? ''}
                          placeholder="Write a reply"
                          onChange={(event) => setReplyDrafts((current) => ({ ...current, [comment.id]: event.target.value }))}
                        />
                      </div>
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
                {notes
                  .filter((note) => {
                    if (activeBoardFilter === 'My cohort') {
                      return note.cohort === (cohortCode.trim() || 'General')
                    }
                    return true
                  })
                  .map((note) => (
                    <div className="note-item" key={note.id}>
                      <strong>{note.title}</strong>
                      <span className="cohort-pill">{note.cohort}</span>
                      <p>{note.text}</p>

                      <div className="post-actions">
                        <button type="button" className="text-button" onClick={() => handleLikeNote(note.id)}>
                          👍 Like ({note.likes ?? 0})
                        </button>
                        <button type="button" className="text-button" onClick={() => handleAddReply('note', note.id)}>
                          Reply ({note.replies?.length ?? 0})
                        </button>
                      </div>

                      {note.replies && note.replies.length > 0 && (
                        <div className="reply-list">
                          {note.replies.map((reply) => (
                            <div key={reply.id} className="reply-item">
                              <strong>{reply.author}</strong>
                              <p>{reply.message}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="reply-box">
                        <input
                          type="text"
                          value={replyDrafts[note.id] ?? ''}
                          placeholder="Write a reply"
                          onChange={(event) => setReplyDrafts((current) => ({ ...current, [note.id]: event.target.value }))}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </section>

        <section className="schedule-section" id="schedule">
          <div className="section-heading">
            <p className="eyebrow">Schedule</p>
            <h2>Weekly calendar</h2>
          </div>

          <div className="hub-card schedule-card">
            <div className="hub-header schedule-header">
              <div>
                <h3>Weekly schedule</h3>
                <p className="schedule-range">{formatWeekRange(currentWeekStart)}</p>
              </div>
              <button type="button" className="mini-button" onClick={handleAddScheduleItem}>Add session</button>
            </div>

            <div className="schedule-toolbar">
              <div className="week-nav-buttons">
                <button type="button" className="secondary-button schedule-nav-button" onClick={() => handleWeekShift(-1)}>
                  Previous week
                </button>
                <button type="button" className="secondary-button schedule-nav-button" onClick={() => handleWeekShift(1)}>
                  Next week
                </button>
              </div>
              <button type="button" className="mini-button" onClick={() => setCurrentWeekStart(getStartOfWeek())}>
                This week
              </button>
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

            <div className="week-calendar">
              {calendarDays.map(({ day, date, items }) => (
                <div
                  key={`${day}-${date.toISOString()}`}
                  className={`calendar-day ${items.some((item) => item.isExam) ? 'calendar-day-exam' : ''} ${items.some((item) => item.wearPTGear) ? 'calendar-day-pt' : ''}`}
                >
                  <div className="calendar-day-header">
                    <div>
                      <strong>{day}</strong>
                      <div className="calendar-date">{date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
                    </div>
                    {items.some((item) => item.isExam) && <span className="calendar-badge exam-badge">Exam</span>}
                    {items.some((item) => item.wearPTGear) && <span className="calendar-badge pt-badge">PT gear</span>}
                  </div>

                  {items.length > 0 ? (
                    <div className="calendar-items">
                      {items.map((item) => (
                        <div className={`calendar-item ${item.isExam ? 'calendar-item-exam' : ''} ${item.wearPTGear ? 'calendar-item-pt' : ''}`} key={item.id}>
                          <div className="calendar-item-head">
                            <span>{item.time}</span>
                            {item.isExam && <span className="mini-tag">Exam</span>}
                            {item.wearPTGear && <span className="mini-tag pt-tag">PT gear</span>}
                          </div>
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
                  ) : (
                    <div className="calendar-empty">No events</div>
                  )}
                </div>
              ))}
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

        <section className="interactive-section">
          <div className="section-heading">
            <p className="eyebrow">Interactive models</p>
            <h2>Slide-driven learning tools</h2>
          </div>

          <div className="interactive-grid">
            {interactiveModules.length > 0 ? (
              interactiveModules.map((module) => {
                const inputValues = getModuleInputValues(module)
                const currentPotential = getModulePotential(module)

                const wavePoints = Array.from({ length: 28 }, (_, index) => {
                  const progress = index / 27
                  const stage = progress < 0.25
                    ? progress / 0.25
                    : progress < 0.45
                      ? 1
                      : progress < 0.68
                        ? 1 - (progress - 0.45) / 0.23
                        : progress < 0.86
                          ? (progress - 0.68) / 0.18
                          : 1 - (progress - 0.86) / 0.14

                  const normalizedStage = Math.max(0, stage)
                  const peak = Math.max(-70, Math.min(55, currentPotential))
                  const y = 148 - (normalizedStage * (peak + 70) * 1.2 + 10)

                  return `${index * 18 + 8},${y}`
                }).join(' ')

                return (
                  <div className="interactive-card" key={module.id}>
                    <div className="interactive-head">
                      <div>
                        <p className="eyebrow">Module</p>
                        <h3>{module.title}</h3>
                      </div>
                      <span className="module-badge">{module.type}</span>
                    </div>

                    <p className="interactive-description">{module.description}</p>
                    <p className="interactive-context">{module.context}</p>

                    <div className="potential-panel">
                      <div className="potential-readout">
                        <span>Membrane potential</span>
                        <strong>{currentPotential.toFixed(0)} mV</strong>
                      </div>

                      <svg viewBox="0 0 520 180" className="potential-graph" role="img" aria-label={module.title}>
                        <line x1="8" x2="512" y1="148" y2="148" stroke="rgba(148,163,184,0.5)" strokeWidth="1" />
                        <line x1="8" y1="20" x2="8" y2="148" stroke="rgba(148,163,184,0.5)" strokeWidth="1" />
                        <polyline
                          fill="none"
                          stroke="#7dd3fc"
                          strokeWidth="4"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          points={wavePoints}
                        />
                        <circle cx="8" cy={148 - ((currentPotential + 70) / 125) * 120} r="6" fill="#fbbf24" />
                      </svg>
                    </div>

                    <div className="ion-controls">
                      {module.ions.map((ion) => (
                        <label className="ion-control" key={ion.label}>
                          <div className="ion-label-row">
                            <span>{ion.label}</span>
                            <strong>{inputValues[ion.label] ?? 0}%</strong>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={inputValues[ion.label] ?? 0}
                            onChange={(event) => handleModuleIonChange(module.id, ion.label, Number(event.target.value))}
                          />
                          <small>{ion.description}</small>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="interactive-empty">
                Upload a PowerPoint or PDF with action-potential or membrane-potential content to unlock the interactive model.
              </div>
            )}
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
                {displayQuestions.map((question: any) => {
                  const selectedValue = selectedAnswers[question.id]
                  const isRevealed = revealedAnswers[question.id]
                  const isCorrect = selectedValue === question.answer

                  return (
                    <li key={question.id}>
                      <p>{question.prompt}</p>
                      <div className="answer-options">
                        {question.options.map((option: string, index: number) => {
                          const isSelected = selectedValue === option

                          return (
                            <button
                              key={`${question.id}-${index}`}
                              type="button"
                              className={`answer-option ${isSelected ? 'answer-option-selected' : ''} ${isRevealed && option === question.answer ? 'answer-option-correct' : ''}`}
                              onClick={() => handleSelectAnswer(question.id, option)}
                            >
                              {option}
                            </button>
                          )
                        })}
                      </div>

                      {isRevealed && (
                        <div className={`answer-feedback ${isCorrect ? 'answer-feedback-correct' : 'answer-feedback-incorrect'}`}>
                          {isCorrect ? 'Correct — great job.' : `Incorrect — the correct answer is: ${question.answer}`}
                        </div>
                      )}

                      {question.source && (
                        <div className="question-source">
                          <strong>Source:</strong> {question.source.type === 'slide' ? `Slide ${question.source.number}` : question.source.type === 'page' ? `Page ${question.source.number}` : `Section ${question.source.number}`} — {question.source.text}
                        </div>
                      )}
                    </li>
                  )
                })}
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
