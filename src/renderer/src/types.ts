export interface Fight {
  id: number
  startTime: number
  endTime: number
  encounterID: number
  difficulty: number
  name: string
  fightPercentage: number
  bossPercentage: number
  kill: boolean
  friendlyPlayers: number
  lastPhase: number
  lastPhaseAsAbsoluteIndex: number
  lastPhaseIsIntermission: boolean
  // enriched
  pullNum?: number
  rarity?: string
  phaseName?: string
}

export interface Actor {
  gameID: number
  id: number
  name: string
  server?: string
  icon?: string
  subType?: string
}

export interface Ability {
  gameID: number
  name: string
  type: number
}

export interface PhaseInfo {
  encounterID: number
  separatesWipes: boolean
  phases: { id: number; name: string; isIntermission: boolean }[]
}

export interface ReportData {
  startTime: number
  endTime: number
  fights: Fight[]
  masterData: {
    abilities: Ability[]
    players: Actor[]
    npcs: Actor[]
  }
  phases: PhaseInfo[]
}

export interface DeathEvent {
  targetID: number
  killingAbilityGameID: number
  sourceID: number
  killerID?: number
  timestamp: number
  fight: number
  // enriched
  player?: string
  ability?: string
  source?: string
}

export interface SavedEncounter {
  reportCode: string
  videoOffset: number
  name: string
}

declare global {
  interface Window {
    api: {
      openVideo: () => Promise<string | null>
      windowMinimize: () => Promise<void>
      windowMaximize: () => Promise<void>
      windowClose: () => Promise<void>
      testCredentials: (clientId: string, clientSecret: string) => Promise<{ ok: boolean; error?: string }>
      fetchReport: (reportCode: string) => Promise<unknown>
      fetchDeaths: (reportCode: string, startTime: number, endTime: number) => Promise<unknown>
      storeGet: (key: string) => Promise<unknown>
      storeSet: (key: string, value: unknown) => Promise<void>
      storeDelete: (key: string) => Promise<void>
    }
  }
}
