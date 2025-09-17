#!/usr/bin/env node
import { ImapFlow } from 'imapflow'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { config as loadEnv } from 'dotenv'

loadEnv()

function parseInteger(name, rawValue, defaultValue, minimum) {
  const hasRaw = typeof rawValue === 'string' && rawValue.trim() !== ''
  const valueToParse = hasRaw ? rawValue : defaultValue !== null ? String(defaultValue) : null

  if (valueToParse === null) {
    throw new Error(`${name} environment variable is required`)
  }

  const parsed = Number.parseInt(valueToParse, 10)
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be an integer`)
  }

  if (parsed < minimum) {
    throw new Error(`${name} must be greater than or equal to ${minimum}`)
  }

  return parsed
}

function parseBoolean(name, rawValue, defaultValue) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return defaultValue
  }

  const normalized = String(rawValue).trim().toLowerCase()
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true
  }
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false
  }

  throw new Error(`${name} must be a boolean-like value (true/false)`) 
}

function requireString(name, rawValue) {
  if (!rawValue || rawValue.trim() === '') {
    throw new Error(`${name} environment variable is required`)
  }
  return rawValue.trim()
}

const authTypeRaw = (process.env.IMAP_AUTH_TYPE ?? 'password').trim().toLowerCase()
const authType = authTypeRaw === '' ? 'password' : authTypeRaw
const isOauthAuth = authType === 'oauth' || authType === 'xoauth2'

const pollIntervalSeconds = parseInteger(
  'IMAP_POLL_INTERVAL_SECONDS',
  process.env.IMAP_POLL_INTERVAL_SECONDS,
  30,
  1,
)

const initialLookbackMinutes = parseInteger(
  'IMAP_INITIAL_LOOKBACK_MINUTES',
  process.env.IMAP_INITIAL_LOOKBACK_MINUTES,
  5,
  0,
)

const maxResults = parseInteger(
  'IMAP_POLL_MAX_RESULTS',
  process.env.IMAP_POLL_MAX_RESULTS,
  25,
  1,
)

const recentMessageRetention = parseInteger(
  'IMAP_RECENT_MESSAGE_MEMORY',
  process.env.IMAP_RECENT_MESSAGE_MEMORY,
  50,
  1,
)

const resolvedHostEnv = process.env.IMAP_HOST ?? (isOauthAuth ? 'imap.gmail.com' : '')
const host = requireString('IMAP_HOST', resolvedHostEnv)
const port = parseInteger('IMAP_PORT', process.env.IMAP_PORT, isOauthAuth ? 993 : null, 1)
const user = requireString('IMAP_USER', process.env.IMAP_USER)
const mailbox = (process.env.IMAP_MAILBOX ?? (isOauthAuth ? 'awesomeposter' : 'INBOX')).trim() || 'INBOX'

const secure = parseBoolean('IMAP_SECURE', process.env.IMAP_SECURE, port === 993)
const requireUnseen = parseBoolean('IMAP_REQUIRE_UNSEEN', process.env.IMAP_REQUIRE_UNSEEN, false)
const rejectUnauthorized = parseBoolean(
  'IMAP_TLS_REJECT_UNAUTHORIZED',
  process.env.IMAP_TLS_REJECT_UNAUTHORIZED,
  true,
)

const DEFAULT_GMAIL_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

const repoRoot = process.cwd()
const tokensDir = path.resolve(repoRoot, 'tokens')
const stateFilePath = path.join(tokensDir, 'imap-poll-state.json')

function log(...args) {
  console.log('[imap-poller]', ...args)
}

function logError(message, error) {
  console.error('[imap-poller]', message, error)
}

async function fetchGmailAccessToken({ clientId, clientSecret, refreshToken, tokenEndpoint }) {
  const endpoint = tokenEndpoint && tokenEndpoint.trim() !== '' ? tokenEndpoint.trim() : DEFAULT_GMAIL_TOKEN_ENDPOINT

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params,
  })

  if (!response.ok) {
    let responseText = ''
    try {
      responseText = await response.text()
    } catch (responseError) {
      logError('Failed to read Gmail token error response', responseError)
    }

    const detail = responseText ? ` Response body: ${responseText}` : ''
    throw new Error(`Failed to refresh Gmail access token (status ${response.status}).${detail}`)
  }

  const payload = await response.json()
  if (!payload || typeof payload.access_token !== 'string' || payload.access_token.trim() === '') {
    throw new Error('Gmail token response did not include an access_token')
  }

  const expiresIn = typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
    ? Math.max(0, Math.trunc(payload.expires_in))
    : null

  return { accessToken: payload.access_token, expiresIn }
}

let authStrategy

if (isOauthAuth) {
  const gmailClientId = requireString('GMAIL_CLIENT_ID', process.env.GMAIL_CLIENT_ID)
  const gmailClientSecret = requireString('GMAIL_CLIENT_SECRET', process.env.GMAIL_CLIENT_SECRET)
  const gmailRefreshToken = requireString('GMAIL_REFRESH_TOKEN', process.env.GMAIL_REFRESH_TOKEN)
  const gmailTokenEndpoint = process.env.GMAIL_TOKEN_ENDPOINT ?? DEFAULT_GMAIL_TOKEN_ENDPOINT

  const oauthOptions = {
    clientId: gmailClientId,
    clientSecret: gmailClientSecret,
    refreshToken: gmailRefreshToken,
    tokenEndpoint: gmailTokenEndpoint,
  }

  authStrategy = {
    type: 'oauth',
    async resolveCredentials() {
      const { accessToken, expiresIn } = await fetchGmailAccessToken(oauthOptions)
      if (expiresIn && expiresIn > 0) {
        const minutes = Math.max(1, Math.round(expiresIn / 60))
        log(`Refreshed Gmail access token (valid for ~${minutes} minute${minutes === 1 ? '' : 's'})`)
      } else {
        log('Refreshed Gmail access token')
      }

      return { user, accessToken }
    },
  }
} else {
  const password = requireString('IMAP_PASSWORD', process.env.IMAP_PASSWORD)

  authStrategy = {
    type: 'password',
    async resolveCredentials() {
      return { user, pass: password }
    },
  }
}

async function ensureTokensDir() {
  await mkdir(tokensDir, { recursive: true })
}

async function loadJson(filePath, defaultValue) {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return defaultValue
    }

    throw error
  }
}

async function saveJson(filePath, data) {
  await ensureTokensDir()
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function formatAddress(address) {
  if (!address) {
    return '(unknown sender)'
  }

  const name = address.name ? address.name.trim() : ''
  const email = address.address ? address.address.trim() : ''

  if (name && email) {
    return `${name} <${email}>`
  }

  if (email) {
    return email
  }

  if (name) {
    return name
  }

  return '(unknown sender)'
}

async function processMessage(message) {
  log('processMessage stub invoked for UID', message.uid)
}

class ImapPoller {
  constructor(options) {
    this.options = options
    this.cursor = { lastUid: null, lastInternalDate: null, recentMessageUids: [] }
    this.intervalHandle = null
    this.isPolling = false
    this.mailboxOpened = false
    this.client = null
  }

  async ensureClient() {
    if (this.client) {
      return
    }

    const auth = await this.options.authStrategy.resolveCredentials()

    const client = new ImapFlow({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.secure,
      auth,
      tls: {
        rejectUnauthorized: this.options.rejectUnauthorized,
      },
    })

    client.on('error', (error) => {
      logError('IMAP client error', error)
      if (error && (error.authenticationFailed || error.responseStatus === 'NO')) {
        this.invalidateClient()
      }
    })

    client.on('close', () => {
      log('IMAP connection closed')
      this.mailboxOpened = false
      this.client = null
    })

    client.on('mailboxClose', () => {
      this.mailboxOpened = false
    })

    client.on('mailboxOpen', () => {
      this.mailboxOpened = true
    })

    this.client = client
  }

  invalidateClient() {
    if (!this.client) {
      return
    }

    try {
      this.client.close()
    } catch (error) {
      logError('Error closing IMAP client during invalidation', error)
    }

    this.client = null
    this.mailboxOpened = false
  }

  async initialize() {
    await ensureTokensDir()

    const persistedState = await loadJson(this.options.stateFilePath, null)
    if (persistedState && typeof persistedState === 'object') {
      const { lastUid, lastInternalDate, recentMessageUids } = persistedState

      if (typeof lastUid === 'number' && Number.isFinite(lastUid) && lastUid > 0) {
        this.cursor.lastUid = lastUid
      }

      if (typeof lastInternalDate === 'number' && Number.isFinite(lastInternalDate) && lastInternalDate >= 0) {
        this.cursor.lastInternalDate = lastInternalDate
      }

      if (Array.isArray(recentMessageUids)) {
        this.cursor.recentMessageUids = recentMessageUids
          .map((value) => {
            if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
              return value
            }
            return null
          })
          .filter((value) => value !== null)
      }
    }

    if (typeof this.cursor.lastInternalDate !== 'number') {
      const initialCursor = Date.now() - this.options.initialLookbackMs
      this.cursor.lastInternalDate = Math.max(0, initialCursor)
      log(`Initialized polling cursor to ${new Date(this.cursor.lastInternalDate).toISOString()}`)
    }

    if (!Array.isArray(this.cursor.recentMessageUids)) {
      this.cursor.recentMessageUids = []
    }

    await this.persistCursor()
    await this.ensureConnected()
  }

  async ensureConnected() {
    await this.ensureClient()

    if (!this.client) {
      throw new Error('IMAP client not initialized')
    }

    if (!this.client.usable) {
      try {
        await this.client.connect()
        log(`Connected to IMAP server ${this.options.host}:${this.options.port}`)
      } catch (error) {
        this.invalidateClient()
        throw error
      }
    }

    if (!this.mailboxOpened || !this.client.mailbox || this.client.mailbox.path !== this.options.mailbox) {
      try {
        await this.client.mailboxOpen(this.options.mailbox, { readOnly: true })
        log(`Opened mailbox ${this.options.mailbox}`)
      } catch (error) {
        if (error && error.code === 'MailboxDoesNotExist') {
          logError(`Mailbox ${this.options.mailbox} not found`, error)
        }

        if (error && error.authenticationFailed) {
          this.invalidateClient()
        }

        throw error
      }
    }
  }

  async start() {
    await this.initialize()
    await this.pollOnce()

    this.intervalHandle = setInterval(() => {
      this.pollOnce().catch((error) => {
        logError('Polling cycle failed', error)
      })
    }, this.options.pollIntervalMs)

    log(`Polling mailbox ${this.options.mailbox} every ${this.options.pollIntervalMs / 1000} seconds`)
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
  }

  async shutdown() {
    this.stop()

    try {
      const client = this.client
      this.client = null
      this.mailboxOpened = false

      if (client) {
        if (client.usable) {
          await client.logout()
        }
        try {
          client.close()
        } catch (error) {
          logError('Error closing IMAP client', error)
        }
      }
    } catch (error) {
      logError('Error closing IMAP connection', error)
    }
  }

  async pollOnce() {
    if (this.isPolling) {
      log('Skipping poll because previous cycle is still running')
      return
    }

    this.isPolling = true
    let lock

    try {
      await this.ensureConnected()
      if (!this.client) {
        throw new Error('IMAP client unavailable during polling')
      }

      lock = await this.client.getMailboxLock(this.options.mailbox, { readOnly: true })

      const searchCriteria = {}

      if (this.options.requireUnseen) {
        searchCriteria.seen = false
      }

      if (typeof this.cursor.lastUid === 'number' && this.cursor.lastUid > 0) {
        searchCriteria.uid = `${this.cursor.lastUid + 1}:*`
      } else if (typeof this.cursor.lastInternalDate === 'number' && this.cursor.lastInternalDate > 0) {
        searchCriteria.since = new Date(this.cursor.lastInternalDate)
      } else {
        searchCriteria.all = true
      }

      const searchResult = await this.client.search(searchCriteria, { uid: true })
      const uids = Array.isArray(searchResult) ? searchResult : []

      if (uids.length === 0) {
        log('No new messages detected')
        return
      }

      const limitedUids = uids.length > this.options.maxResults ? uids.slice(-this.options.maxResults) : uids

      const messages = []
      for await (const message of this.client.fetch(limitedUids, {
        uid: true,
        envelope: true,
        internalDate: true,
        flags: true,
      })) {
        const envelope = message.envelope ?? {}
        const fromAddress = formatAddress(envelope.from && envelope.from.length > 0 ? envelope.from[0] : null)
        const subject = envelope.subject && envelope.subject.trim() ? envelope.subject : '(no subject)'
        const internalDate = message.internalDate instanceof Date ? message.internalDate.getTime() : Date.now()
        const dateCandidate = envelope.date instanceof Date ? envelope.date : message.internalDate ?? new Date(internalDate)
        const normalizedDate = dateCandidate instanceof Date ? dateCandidate : new Date(internalDate)

        messages.push({
          uid: message.uid,
          messageId: envelope.messageId ?? null,
          from: fromAddress,
          subject,
          date: normalizedDate,
          internalDate,
          flags: message.flags ? Array.from(message.flags) : [],
        })
      }

      if (messages.length === 0) {
        log('No new messages detected')
        return
      }

      messages.sort((a, b) => {
        if (a.internalDate === b.internalDate) {
          return a.uid - b.uid
        }
        return a.internalDate - b.internalDate
      })

      const recentUids = new Set(this.cursor.recentMessageUids ?? [])

      for (const message of messages) {
        if (!Number.isFinite(message.uid)) {
          continue
        }

        if (recentUids.has(message.uid)) {
          continue
        }

        if (
          typeof this.cursor.lastInternalDate === 'number' &&
          this.cursor.lastInternalDate > 0 &&
          message.internalDate < this.cursor.lastInternalDate
        ) {
          continue
        }

        log(
          `New message UID ${message.uid} from ${message.from} | Subject: ${message.subject} | Date: ${message.date.toISOString()}`,
        )
        await processMessage(message)

        this.cursor.lastUid = typeof this.cursor.lastUid === 'number' && this.cursor.lastUid > 0
          ? Math.max(this.cursor.lastUid, message.uid)
          : message.uid
        this.cursor.lastInternalDate = Math.max(this.cursor.lastInternalDate ?? 0, message.internalDate)
        this.cursor.recentMessageUids = [...(this.cursor.recentMessageUids ?? []), message.uid]
        if (this.cursor.recentMessageUids.length > this.options.recentMessageRetention) {
          this.cursor.recentMessageUids = this.cursor.recentMessageUids.slice(-this.options.recentMessageRetention)
        }
        recentUids.add(message.uid)
        await this.persistCursor()
      }
    } catch (error) {
      logError('Encountered an error while polling IMAP', error)
      this.mailboxOpened = false
      if (error && error.authenticationFailed) {
        this.invalidateClient()
      }
    } finally {
      if (lock) {
        lock.release()
      }
      this.isPolling = false
    }
  }

  async persistCursor() {
    await saveJson(this.options.stateFilePath, this.cursor)
  }
}

async function main() {
  const options = {
    host,
    port,
    secure,
    user,
    mailbox,
    requireUnseen,
    rejectUnauthorized,
    pollIntervalMs: pollIntervalSeconds * 1000,
    initialLookbackMs: initialLookbackMinutes * 60 * 1000,
    stateFilePath,
    maxResults,
    recentMessageRetention,
    authStrategy,
  }

  const poller = new ImapPoller(options)
  await poller.start()

  const shutdown = () => {
    log('Shutting down IMAP poller')
    poller
      .shutdown()
      .catch((error) => {
        logError('Error during IMAP poller shutdown', error)
      })
      .finally(() => {
        process.exit(0)
      })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  logError('Failed to start IMAP poller', error)
  process.exitCode = 1
})
