import { net } from 'electron'

interface TokenCache {
  token: string
  expiresAt: number
}

let tokenCache: TokenCache | null = null

export async function fetchFFLogsToken(clientId: string, clientSecret: string): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 5 * 60 * 1000) {
    return tokenCache.token
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const body = 'grant_type=client_credentials'

  const response = await fetch('https://www.fflogs.com/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })

  if (!response.ok) {
    throw new Error(`FFLogs token fetch failed: ${response.status} ${await response.text()}`)
  }

  const data = (await response.json()) as { access_token: string; expires_in: number }
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000
  }
  return tokenCache.token
}

export function invalidateToken(): void {
  tokenCache = null
}

export async function queryFFLogsReport(reportCode: string, token: string): Promise<unknown> {
  const query = `{
    reportData {
      report(code: "${reportCode}") {
        startTime
        endTime
        fights(killType: Encounters) {
          id startTime endTime encounterID difficulty name
          fightPercentage bossPercentage kill friendlyPlayers
          lastPhase lastPhaseAsAbsoluteIndex lastPhaseIsIntermission
        }
        masterData {
          abilities { gameID name type }
          players: actors(type: "Player") { gameID icon id name server subType }
          npcs: actors(type: "NPC") { gameID id name subType }
        }
        phases {
          encounterID separatesWipes
          phases { id name isIntermission }
        }
      }
    }
  }`

  return graphqlRequest(query, token)
}

export async function queryFFLogsDeaths(
  reportCode: string,
  startTime: number,
  endTime: number,
  token: string
): Promise<unknown> {
  const query = `{
    reportData {
      report(code: "${reportCode}") {
        startTime
        events(
          dataType: Deaths
          startTime: ${startTime}
          endTime: ${endTime}
          limit: 10000
        ) {
          data
          nextPageTimestamp
        }
      }
    }
  }`

  return graphqlRequest(query, token)
}

async function graphqlRequest(query: string, token: string): Promise<unknown> {
  const response = await fetch('https://www.fflogs.com/api/v2/client', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  })

  if (!response.ok) {
    throw new Error(`FFLogs GraphQL request failed: ${response.status}`)
  }

  const json = (await response.json()) as { errors?: unknown[]; data: unknown }
  if (json.errors) {
    throw new Error(`FFLogs GraphQL errors: ${JSON.stringify(json.errors)}`)
  }
  return json.data
}
