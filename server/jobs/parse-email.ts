// Placeholder worker that would fetch raw MIME from R2, parse, and create draft brief
export async function runParseEmailJob(payload: { storageUrl: string; providerEventId: string }) {
	console.log('parse-email started', payload)
	// TODO: implement parsing and draft brief creation
	return { ok: true }
}

