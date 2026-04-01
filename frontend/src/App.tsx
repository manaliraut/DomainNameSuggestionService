import { useMemo, useState } from 'react'
import './App.css'

type AvailabilityRow = {
  domainName: string
  purchasable: boolean
  purchasePrice?: number | null
  premium?: boolean | null
  reason?: string | null
}

type SuggestionRow = {
  startupName: string
  tagline: string
  domain: string
  purchasable: boolean
  purchasePrice: number | null
  premium: boolean | null
  reason: string | null
  score: number
}

type ApiError = { error?: string; details?: unknown }

function parseDomainList(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
}

function parseTlds(raw: string): string[] | undefined {
  const parts = raw
    .split(/[\n,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('.') ? t : `.${t}`))
  return parts.length > 0 ? parts : undefined
}

async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as ApiError
    if (typeof j.error === 'string') return j.error
  } catch {
    /* ignore */
  }
  return res.statusText || `HTTP ${res.status}`
}

function App() {
  const [domainsInput, setDomainsInput] = useState('example.com, example.org')
  const [availabilityLoading, setAvailabilityLoading] = useState(false)
  const [availabilityRows, setAvailabilityRows] = useState<AvailabilityRow[] | null>(
    null,
  )
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)

  const [ideaInput, setIdeaInput] = useState('AI fitness coach app')
  const [nameCount, setNameCount] = useState(8)
  const [tldsInput, setTldsInput] = useState('.com, .io, .ai, .app')
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<{
    idea: string
    suggestions: SuggestionRow[]
  } | null>(null)
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null)

  const [availFilter, setAvailFilter] = useState<'all' | 'available'>('all')
  const [suggFilter, setSuggFilter] = useState<'all' | 'available'>('all')

  const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
// then: fetch(`${API_BASE}/api/domains/check-availability`, { ... })

  async function handleCheckAvailability() {
    const domainNames = parseDomainList(domainsInput)
    if (domainNames.length === 0) {
      setAvailabilityError('Enter at least one domain.')
      setAvailabilityRows(null)
      return
    }
    setAvailabilityLoading(true)
    setAvailabilityError(null)
    setAvailabilityRows(null)
    try {
      const res = await fetch(`${API_BASE}/api/domains/check-availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domainNames }),
      })
      if (!res.ok) {
        setAvailabilityError(await readError(res))
        return
      }
      const data = (await res.json()) as AvailabilityRow[]
      setAvailabilityRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setAvailabilityError(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setAvailabilityLoading(false)
    }
  }

  async function handleSuggestions() {
    const idea = ideaInput.trim()
    if (idea.length < 3) {
      setSuggestionsError('Idea must be at least 3 characters.')
      setSuggestions(null)
      return
    }
    setSuggestionsLoading(true)
    setSuggestionsError(null)
    setSuggestions(null)
    const tlds = parseTlds(tldsInput)
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea,
          nameCount: Math.min(20, Math.max(3, nameCount)),
          ...(tlds ? { tlds } : {}),
        }),
      })
      if (!res.ok) {
        setSuggestionsError(await readError(res))
        return
      }
      const data = (await res.json()) as {
        idea: string
        suggestions: SuggestionRow[]
      }
      setSuggestions(data)
    } catch (e) {
      setSuggestionsError(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setSuggestionsLoading(false)
    }
  }

  const filteredAvailability = useMemo(() => {
    if (!availabilityRows) return null
    if (availFilter === 'available') {
      return availabilityRows.filter((r) => r.purchasable)
    }
    return availabilityRows
  }, [availabilityRows, availFilter])

  const filteredSuggestions = useMemo(() => {
    if (!suggestions?.suggestions) return null
    if (suggFilter === 'available') {
      return suggestions.suggestions.filter((r) => r.purchasable)
    }
    return suggestions.suggestions
  }, [suggestions, suggFilter])

  return (
    <div className="app">
      <header className="app-header">
        <h1>Build your idea</h1>
      </header>

      <section className="panel" aria-labelledby="avail-heading">
        <h2 id="avail-heading">Check availability</h2>
        <p className="panel-hint">
          Enter domain name to verify
        </p>
        <label className="sr-only" htmlFor="domains-input">
          Domains
        </label>
        <textarea
          id="domains-input"
          className="input textarea"
          rows={4}
          value={domainsInput}
          onChange={(e) => setDomainsInput(e.target.value)}
          disabled={availabilityLoading}
        />
        <div className="panel-actions">
          <button
            type="button"
            className="btn"
            onClick={handleCheckAvailability}
            disabled={availabilityLoading}
          >
            {availabilityLoading ? 'Checking…' : 'Check availability'}
          </button>
          
        </div>
        {availabilityError && (
          <p className="message message-error" role="alert">
            {availabilityError}
          </p>
        )}
        {filteredAvailability && filteredAvailability.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Status</th>
                  <th>Price (USD)</th>
                </tr>
              </thead>
              <tbody>
                {filteredAvailability.map((r) => (
                  <tr key={r.domainName}>
                    <td className="mono">{r.domainName}</td>
                    <td>
                      {r.purchasable ? (
                        <span className="badge badge-ok">Available</span>
                      ) : (
                        <span className="badge badge-bad">Taken / unavailable</span>
                      )}
                    </td>
                    <td>
                      {r.purchasePrice != null && !Number.isNaN(r.purchasePrice)
                        ? `$${r.purchasePrice}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filteredAvailability && filteredAvailability.length === 0 && (
          <p className="message">No rows match this filter.</p>
        )}
      </section>

      <section className="panel" aria-labelledby="sugg-heading">
        <h2 id="sugg-heading">suggestions</h2>
        <p className="panel-hint">
          Possible cool names for your product
        </p>
        <label className="field-label" htmlFor="idea-input">
          Product idea
        </label>
        <textarea
          id="idea-input"
          className="input textarea"
          rows={3}
          value={ideaInput}
          onChange={(e) => setIdeaInput(e.target.value)}
          disabled={suggestionsLoading}
        />
        <div className="field-row">
          
          <div className="field field-grow">
            <label className="field-label" htmlFor="tlds-input">
              TLDs
            </label>
            <input
              id="tlds-input"
              type="text"
              className="input"
              placeholder=".com, .io, .ai"
              value={tldsInput}
              onChange={(e) => setTldsInput(e.target.value)}
              disabled={suggestionsLoading}
            />
          </div>
        </div>
        <div className="panel-actions">
          <button
            type="button"
            className="btn"
            onClick={handleSuggestions}
            disabled={suggestionsLoading}
          >
            {suggestionsLoading ? 'Generating…' : 'Generate suggestions'}
          </button>
          {suggestions && (
            <div className="filter">
              <span className="filter-label">Show:</span>
              <select
                value={suggFilter}
                onChange={(e) => setSuggFilter(e.target.value as 'all' | 'available')}
              >
                <option value="all">All</option>
                <option value="available">Available only</option>
              </select>
            </div>
          )}
        </div>
        {suggestionsError && (
          <p className="message message-error" role="alert">
            {suggestionsError}
          </p>
        )}
        {filteredSuggestions && filteredSuggestions.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Startup</th>
                  <th>Tagline</th>
                  <th>Status</th>
                  <th>Price</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuggestions.map((r) => (
                  <tr key={`${r.domain}-${r.startupName}`}>
                    <td className="mono">{r.domain}</td>
                    <td>{r.startupName}</td>
                    <td className="cell-tagline">{r.tagline}</td>
                    <td>
                      {r.purchasable ? (
                        <span className="badge badge-ok">Available</span>
                      ) : (
                        <span className="badge badge-bad">Taken</span>
                      )}
                    </td>
                    <td>
                      {r.purchasePrice != null ? `$${r.purchasePrice}` : '—'}
                    </td>
                    <td>{r.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filteredSuggestions && filteredSuggestions.length === 0 && (
          <p className="message">No rows match this filter.</p>
        )}
      </section>
    </div>
  )
}

export default App
