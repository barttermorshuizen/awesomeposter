#!/usr/bin/env node
import { google } from 'googleapis'
import http from 'node:http'
import { config as loadEnv } from 'dotenv'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import open from 'open'

loadEnv()

const clientId = process.env.GMAIL_CLIENT_ID
const clientSecret = process.env.GMAIL_CLIENT_SECRET
const redirectUri = process.env.GMAIL_OAUTH_REDIRECT_URI || 'http://localhost:5555/oauth2callback'

if (!clientId || !clientId.trim()) {
  console.error('Missing GMAIL_CLIENT_ID in environment variables')
  process.exit(1)
}

if (!clientSecret || !clientSecret.trim()) {
  console.error('Missing GMAIL_CLIENT_SECRET in environment variables')
  process.exit(1)
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://mail.google.com/'],
  prompt: 'consent',
})

console.log('\nVisit this URL to authorize Gmail access:\n')
console.log(authUrl)
console.log('\nWaiting for authorization...')

try {
  await open(authUrl)
} catch (error) {
  console.warn('Unable to open browser automatically. Copy the URL above into your browser.')
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400)
    res.end('Missing URL')
    return
  }

  const url = new URL(req.url, redirectUri)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (!code && !error) {
    // Ignore unrelated pings like favicon requests
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('Awaiting OAuth callback...')
    return
  }

  if (error) {
    res.writeHead(400, { 'content-type': 'text/plain' })
    res.end(`Authorization error: ${error}`)
    console.error(`Authorization failed: ${error}`)
    server.close()
    process.exit(1)
    return
  }

  if (!code) {
    res.writeHead(400, { 'content-type': 'text/plain' })
    res.end('Missing authorization code in the callback.')
    console.error('Missing authorization code in the callback')
    server.close()
    process.exit(1)
    return
  }

  res.writeHead(200, { 'content-type': 'text/html' })
  res.end('<html><body><h2>Authorization complete</h2><p>You may close this window.</p></body></html>')

  try {
    const { tokens } = await oauth2Client.getToken(code)
    if (!tokens.refresh_token) {
      console.error('No refresh token returned. Ensure you requested access with prompt=consent and have not revoked the app.')
      process.exit(1)
    }

    console.log('\nRefresh token obtained:\n')
    console.log(tokens.refresh_token)

    if (tokens.access_token) {
      console.log('\nAccess token (short-lived):\n')
      console.log(tokens.access_token)
    }
  } catch (tokenError) {
    console.error('Failed to exchange authorization code for tokens:', tokenError)
    process.exit(1)
  } finally {
    server.close(() => {
      process.exit(0)
    })
  }
})

const { hostname, port, pathname } = new URL(redirectUri)

server.listen(port, hostname, () => {
  console.log(`Listening for OAuth callback on ${redirectUri}`)
})

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  server.close(() => {
    process.exit(0)
  })
})
