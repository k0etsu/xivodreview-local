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
  videoPath?: string
  fightName?: string
  reportStartTime?: number
}

declare global {
  interface Window {
    api: {
      openVideo: () => Promise<string | null>
      windowMinimize: () => Promise<void>
      windowMaximize: () => Promise<void>
      windowClose: () => Promise<void>
      testCredentials: (clientId: string, clientSecret: string) => Promise<{ ok: boolean; error?: string }>
      fileExists: (filePath: string) => Promise<boolean>
      fetchReport: (reportCode: string) => Promise<unknown>
      fetchDeaths: (reportCode: string, startTime: number, endTime: number) => Promise<unknown>
      storeGet: (key: string) => Promise<unknown>
      storeSet: (key: string, value: unknown) => Promise<void>
      storeDelete: (key: string) => Promise<void>
      getVersion: () => Promise<string>
      mpvOpenFile: (path: string) => Promise<void>
      mpvPlay: () => Promise<void>
      mpvPause: () => Promise<void>
      mpvTogglePause: () => Promise<void>
      mpvSeek: (s: number, type: 'absolute' | 'relative') => Promise<void>
      mpvFrameStep: () => Promise<void>
      mpvFrameBackStep: () => Promise<void>
      mpvSetVolume: (level: number) => Promise<void>
      mpvAddVolume: (delta: number) => Promise<void>
      mpvSetMute: (muted: boolean) => Promise<void>
      mpvSetAudioTrack: (id: number) => Promise<void>
      mpvCommand: (args: unknown[]) => Promise<unknown>
      mpvSetHidden: (hidden: boolean) => Promise<void>
      mpvSetViewportBounds: (bounds: { left: number; top: number; width: number; height: number }) => void
      mpvOnTimeUpdate: (cb: (t: number) => void) => void
      mpvOnDuration: (cb: (d: number) => void) => void
      mpvOnPause: (cb: (p: boolean) => void) => void
      mpvOnTracks: (cb: (t: unknown[]) => void) => void
      mpvOnFileLoaded: (cb: () => void) => void
      mpvOnFileEnded: (cb: () => void) => void
      mpvOnFrame: (cb: (frame: { width: number; height: number; data: Uint8Array }) => void) => void
      mpvFrameConsumed: () => void
      mpvOffAll: () => void
    }
  }
}
