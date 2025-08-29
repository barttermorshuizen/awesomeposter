// Lightweight queue stub; replace with Upstash Q client later
export async function enqueue(topic: string, payload: Record<string, unknown>) {
	console.log(`enqueue → ${topic}`, payload)
	return { ok: true }
}


