export const onRequestPost = async ({ request, env }: any) => {
  try {
    const { pass } = await request.json().catch(() => ({ pass: '' }))

    const realPassword = (env.SITE_PASSWORD || '').trim()
    const passList = realPassword ? realPassword.split(',').map((s: string) => s.trim()) : []
    const ok = !realPassword || pass === realPassword || passList.includes(pass)

    return new Response(JSON.stringify({ code: ok ? 0 : -1 }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ code: -1, error: 'Bad Request' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
}
