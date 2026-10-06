// Paste into the browser console of a signed-in HOME Reviews tab.
// This is a MANUAL launcher, never imported by the application or a deployment.
// Reads the existing user's session; never reads a TypeSafe or OpenAI API key.
// Do not run twice after an ambiguous network outcome; inspect the benchmark table.
;(async () => {
  if (location.origin !== 'https://ngpcao-spec.github.io') throw new Error('Open the production HOME Reviews tab first.')
  const project = 'ihuztjkblywzjdruusdj'
  const session = JSON.parse(localStorage.getItem(`sb-${project}-auth-token`) || 'null')
  if (!session?.access_token) throw new Error('Sign in to HOME Reviews first.')
  const endpoint = `https://${project}.supabase.co/functions/v1/benchmark-jev-historical-analysis`
  const headers = { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
  const marker = 'jev-shabu-phase1-manual-benchmark'
  let id = sessionStorage.getItem(marker)
  if (id === 'launching') throw new Error('Previous launch outcome unknown. Inspect jev_benchmark_runs before any new POST.')
  if (!id) {
    sessionStorage.setItem(marker, 'launching')
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ source_generation_id: '1629f8d2-80da-42a7-92c7-af18ff04da32', repeat_count: 3, concurrency: 8, model: 'jev-latest' }) })
    const result = await response.json()
    if (response.status !== 202 || !result.benchmark_id) throw new Error(`Launch rejected: ${result.error || result.code || response.status}. No automatic retry.`)
    id = result.benchmark_id
    sessionStorage.setItem(marker, id)
    console.info('Benchmark launched once:', id)
  }
  for (let poll = 0; poll < 60; poll++) {
    const response = await fetch(endpoint + '?benchmark_id=' + encodeURIComponent(id), { headers })
    const result = await response.json()
    if (!response.ok) throw new Error(`Read failed: ${result.error || result.code || response.status}; benchmark_id=${id}`)
    if (result.status !== 'running') {
      console.info('Persisted Jev benchmark:', result)
      return result
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  console.info('Benchmark still running. Read with GET only; benchmark_id=', id)
})()
