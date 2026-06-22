<template>
  <div class="app-layout">
    <!-- Custom title bar -->
    <div class="titlebar">
      <div class="titlebar-left">
        <img src="/icon.png" class="titlebar-logo" alt="" />
        <span class="brand">xivodreview</span>
      </div>
      <div class="titlebar-actions">
        <button class="nav-btn" @click="showSettings = true" title="Settings">⚙ Settings</button>
        <button class="nav-btn" @click="openVideo" title="Open video file">📂 Open Video</button>
        <button
          v-if="reportData"
          class="nav-btn save-btn"
          @click="saveEncounter"
          title="Save this report + current offset so you can reload it quickly from the sidebar"
        >💾 Save</button>
      </div>
      <!-- Win32 window controls -->
      <div class="win-controls">
        <button class="wc-btn" @click="winMinimize" title="Minimize">&#x2212;</button>
        <button class="wc-btn" @click="winMaximize" title="Maximize">&#x25A1;</button>
        <button class="wc-btn wc-close" @click="winClose" title="Close">&#x2715;</button>
      </div>
    </div>

    <div class="main-area">
      <!-- Left: video -->
      <div class="video-panel">
        <VideoPlayer
          ref="player"
          :src="videoPath"
          :current-pull="currentPull"
          :deaths="currentDeaths"
          :video-offset="videoOffset"
          @open-file="openVideo"
          @time-update="onTimeUpdate"
        >
          <template #controls-right>
            <SyncControls
              :video-offset="videoOffset"
              :current-pull="currentPull"
              :current-video-time="currentVideoTime"
              @decrease="adjustOffset(-500)"
              @increase="adjustOffset(500)"
              @set-offset="setOffset"
            />
          </template>
        </VideoPlayer>
      </div>

      <!-- Right: sidebar -->
      <div class="sidebar">
        <FFlogsInput
          :loading="loadingReport"
          :error="reportError"
          :saved-entries="savedEntries"
          :has-loaded="!!reportCode"
          @submit="loadReport"
          @reload="reloadAll"
          @load-saved="loadSavedEncounter"
          @delete-saved="deleteSavedEncounter"
        />

        <PullList
          :fights="enrichedFights"
          :current-pull="currentPull"
          :report-start="reportData?.startTime ?? 0"
          :phases="reportData?.phases ?? []"
          @select-pull="selectPull"
        />

        <EventTable
          v-if="currentPull"
          :deaths="currentDeaths"
          :current-pull="currentPull"
          :video-offset="videoOffset"
          :report-code="reportCode"
          :loading="loadingDeaths"
          @seek-to="seekTo"
        />
      </div>
    </div>

    <SettingsPanel v-if="showSettings" @close="showSettings = false" />
    <HotkeyHelp v-if="showHotkeyHelp" @close="showHotkeyHelp = false" />

    <div v-if="missingVideoPath" class="modal-overlay" @click.self="missingVideoPath = null">
      <div class="modal-box">
        <div class="modal-title">Video not found</div>
        <div class="modal-body">
          <p>The saved video file could not be found:</p>
          <p class="modal-path">{{ missingVideoPath }}</p>
          <p>The report and offset have been restored. You can locate the video manually.</p>
        </div>
        <div class="modal-actions">
          <button class="modal-btn-primary" @click="() => { missingVideoPath = null; openVideo() }">Browse for video</button>
          <button class="modal-btn" @click="missingVideoPath = null">Continue without video</button>
        </div>
      </div>
    </div>

    <div class="hotkey-hint" @click="showHotkeyHelp = true">? · shortcuts</div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import VideoPlayer from './components/VideoPlayer.vue'
import SyncControls from './components/SyncControls.vue'
import FFlogsInput from './components/FFlogsInput.vue'
import PullList from './components/PullList.vue'
import EventTable from './components/EventTable.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import HotkeyHelp from './components/HotkeyHelp.vue'
import type { Fight, ReportData, DeathEvent, Actor, Ability, SavedEncounter } from './types'

// ─── State ────────────────────────────────────────────────────────────────────

const player = ref<InstanceType<typeof VideoPlayer> | null>(null)
const showSettings = ref(false)
const showHotkeyHelp = ref(false)
const missingVideoPath = ref<string | null>(null)

const videoPath = ref<string | null>(null)
const currentVideoTime = ref(0)

const reportCode = ref('')
const reportData = ref<ReportData | null>(null)
const loadingReport = ref(false)
const reportError = ref('')

const currentPull = ref<Fight | null>(null)
const currentDeaths = ref<DeathEvent[]>([])
const loadingDeaths = ref(false)

// videoOffset: (fightEntry.startTime + videoOffset) / 1000 = seek target (seconds)
// When no recording timestamp is known, starts at 0 and user adjusts.
const videoOffset = ref(0)

// Saved encounters from electron-store
const savedEncounters = ref<Record<string, SavedEncounter>>({})

// ─── Computed ─────────────────────────────────────────────────────────────────

function formatReportDate(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  })
}

const savedEntries = computed(() =>
  Object.entries(savedEncounters.value)
    .map(([key, enc]) => ({
      key,
      label: enc.fightName && enc.reportStartTime
        ? `${enc.fightName} · ${formatReportDate(enc.reportStartTime)}`
        : enc.name,
      reportStartTime: enc.reportStartTime ?? 0
    }))
    .sort((a, b) => b.reportStartTime - a.reportStartTime)
)

const enrichedFights = computed((): Fight[] => {
  if (!reportData.value) return []
  const fights = reportData.value.fights
  return fights.map((f, i) => ({
    ...f,
    pullNum: i + 1,
    rarity: getPullRarity(f)
  }))
})

// Maps keyed by id for quick lookup
const playerMap = computed((): Map<number, string> => {
  const m = new Map<number, string>()
  reportData.value?.masterData.players.forEach((p: Actor) => m.set(p.id, p.name))
  return m
})

const abilityMap = computed((): Map<number, string> => {
  const m = new Map<number, string>()
  reportData.value?.masterData.abilities.forEach((a: Ability) => m.set(a.gameID, a.name))
  return m
})

const npcMap = computed((): Map<number, string> => {
  const m = new Map<number, string>()
  reportData.value?.masterData.npcs.forEach((n: Actor) => m.set(n.id, n.name))
  return m
})

// ─── Methods ──────────────────────────────────────────────────────────────────

async function openVideo() {
  const path = await window.api.openVideo()
  if (path) videoPath.value = path
}

function winMinimize() { window.api.windowMinimize() }
function winMaximize() { window.api.windowMaximize() }
function winClose()    { window.api.windowClose() }

async function reloadAll() {
  // Reload video from disk (captures any new content if still recording)
  player.value?.reloadVideo()
  // Re-fetch FFLogs report to pick up new fights
  if (reportCode.value) await loadReport(reportCode.value)
}

async function loadReport(code: string) {
  reportCode.value = code
  loadingReport.value = true
  reportError.value = ''
  reportData.value = null
  currentPull.value = null
  currentDeaths.value = []

  try {
    const data = await window.api.fetchReport(code) as {
      reportData: { report: ReportData }
    }
    reportData.value = data.reportData.report
  } catch (err: unknown) {
    reportError.value = err instanceof Error ? err.message : String(err)
  } finally {
    loadingReport.value = false
  }
}

async function selectPull(fight: Fight) {
  currentPull.value = fight
  currentDeaths.value = []

  // Seek video
  const seekSec = (fight.startTime + videoOffset.value) / 1000
  player.value?.seekTo(seekSec)

  // Load deaths
  loadingDeaths.value = true
  try {
    const data = await window.api.fetchDeaths(
      reportCode.value,
      fight.startTime,
      fight.endTime
    ) as { reportData: { report: { events: { data: DeathEvent[] } } } }

    const rawDeaths: DeathEvent[] = data.reportData.report.events.data ?? []
    currentDeaths.value = rawDeaths.map((d) => ({
      ...d,
      player: playerMap.value.get(d.targetID),
      ability: abilityMap.value.get(d.killingAbilityGameID),
      source: d.sourceID ? npcMap.value.get(d.sourceID) : undefined
    }))
  } catch (err) {
    console.error('Failed to load deaths:', err)
  } finally {
    loadingDeaths.value = false
  }
}

function seekTo(seconds: number) {
  player.value?.seekTo(seconds)
}

function onTimeUpdate(time: number) {
  currentVideoTime.value = time
}

function adjustOffset(delta: number) {
  videoOffset.value += delta
  persistOffset()
}

function setOffset(v: number) {
  videoOffset.value = v
  persistOffset()
}

// Serialize the reactive proxy to a plain object before sending through IPC.
// contextBridge structured-clone can silently drop Proxy traps.
function plainEncounters() {
  return JSON.parse(JSON.stringify(savedEncounters.value)) as Record<string, SavedEncounter>
}

async function persistOffset() {
  const entry = Object.entries(savedEncounters.value).find(
    ([, v]) => v.reportCode === reportCode.value
  )
  if (entry) {
    savedEncounters.value[entry[0]].videoOffset = videoOffset.value
    await window.api.storeSet('savedEncounters', plainEncounters())
  }
}

async function saveEncounter() {
  if (!reportCode.value || !reportData.value) return
  const name = reportData.value.fights[0]?.name ?? reportCode.value
  const key = `${name} (${reportCode.value})`
  savedEncounters.value[key] = {
    reportCode: reportCode.value,
    videoOffset: videoOffset.value,
    name: key,
    videoPath: videoPath.value ?? undefined,
    fightName: reportData.value.fights[0]?.name ?? reportCode.value,
    reportStartTime: reportData.value.startTime
  }
  await window.api.storeSet('savedEncounters', plainEncounters())
}

async function loadSavedEncounter(name: string) {
  const enc = savedEncounters.value[name]
  if (!enc) return
  videoOffset.value = enc.videoOffset
  if (enc.videoPath) {
    const exists = await window.api.fileExists(enc.videoPath)
    if (exists) {
      videoPath.value = enc.videoPath
    } else {
      missingVideoPath.value = enc.videoPath
    }
  }
  await loadReport(enc.reportCode)
}

async function deleteSavedEncounter(name: string) {
  delete savedEncounters.value[name]
  await window.api.storeSet('savedEncounters', plainEncounters())
}

function getPullRarity(f: Fight): string {
  if (f.kill) return 'legendary'
  // fightPercentage: 100 = died at pull start, 0 = kill; lower = better progress
  const pct = f.fightPercentage ?? 100
  if (pct < 5)  return 'astounding'  // < 5% left — extremely close
  if (pct < 15) return 'epic'        // 5–15% left — very close
  if (pct < 30) return 'rare'        // 15–30% left — solid progress
  if (pct < 70) return 'uncommon'    // 30–70% left — made it somewhere
  return 'common'                     // ≥ 70% left — died early
}

// ─── Navigation helpers ───────────────────────────────────────────────────────

function nextPull() {
  if (!enrichedFights.value.length) return
  const idx = currentPull.value
    ? enrichedFights.value.findIndex(f => f.id === currentPull.value!.id)
    : -1
  const next = enrichedFights.value[idx + 1]
  if (next) selectPull(next)
}

function prevPull() {
  if (!enrichedFights.value.length) return
  const idx = currentPull.value
    ? enrichedFights.value.findIndex(f => f.id === currentPull.value!.id)
    : enrichedFights.value.length
  const prev = enrichedFights.value[idx - 1]
  if (prev) selectPull(prev)
}

function syncHereKey() {
  if (!currentPull.value) return
  setOffset(Math.round(currentVideoTime.value * 1000) - currentPull.value.startTime)
}

// ─── Global keyboard handler ──────────────────────────────────────────────────

function onGlobalKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return

  switch (e.code) {
    // ── Playback ──
    case 'Space':
      e.preventDefault()
      player.value?.togglePlay()
      break
    case 'ArrowLeft':
      e.preventDefault()
      if (e.ctrlKey) player.value?.stepFrame(-1)
      else player.value?.seekBy(e.shiftKey ? -30 : -5)
      break
    case 'ArrowRight':
      e.preventDefault()
      if (e.ctrlKey) player.value?.stepFrame(1)
      else player.value?.seekBy(e.shiftKey ? 30 : 5)
      break
    case 'ArrowUp':
      e.preventDefault()
      player.value?.adjustVolume(0.1)
      break
    case 'ArrowDown':
      e.preventDefault()
      player.value?.adjustVolume(-0.1)
      break
    case 'KeyM':
      player.value?.toggleMute()
      break
    case 'KeyA':
      player.value?.cycleAudioTrack()
      break

    // ── Sync ──
    case 'BracketLeft':   // [
      adjustOffset(-500)
      break
    case 'BracketRight':  // ]
      adjustOffset(500)
      break
    case 'KeyS':
      syncHereKey()
      break

    // ── Pull navigation ──
    case 'KeyN':
      nextPull()
      break
    case 'KeyP':
      prevPull()
      break

    // ── App ──
    case 'KeyR':
      if (!e.ctrlKey && !e.metaKey) reloadAll()
      break
    case 'KeyO':
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); openVideo() }
      break
    case 'Escape':
      if (showSettings.value) showSettings.value = false
      else if (showHotkeyHelp.value) showHotkeyHelp.value = false
      break
    case 'Slash':
      if (e.shiftKey) { e.preventDefault(); showHotkeyHelp.value = !showHotkeyHelp.value }
      break
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

onMounted(async () => {
  const stored = await window.api.storeGet('savedEncounters') as Record<string, SavedEncounter> | null
  if (stored) savedEncounters.value = stored
  document.addEventListener('keydown', onGlobalKey)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onGlobalKey)
})
</script>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.titlebar {
  display: flex;
  align-items: center;
  height: 38px;
  background: #0f0f0f;
  border-bottom: 1px solid #2a2a2a;
  flex-shrink: 0;
  -webkit-app-region: drag;
  user-select: none;
}

.titlebar-left {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
}

.titlebar-logo {
  width: 18px;
  height: 18px;
  object-fit: contain;
  flex-shrink: 0;
}

.brand {
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.3px;
  color: var(--text-primary);
  font-family: 'Segoe UI', sans-serif;
}

.titlebar-actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
  -webkit-app-region: no-drag;
}

.nav-btn {
  background: transparent;
  color: var(--text-muted);
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid transparent;
  border-radius: 3px;
}
.nav-btn:hover {
  background: var(--bg-card);
  color: var(--text-primary);
  border-color: var(--border);
}
.save-btn { color: #c9a227; }
.save-btn:hover { color: #ffd700; }

/* Win32 window controls */
.win-controls {
  display: flex;
  -webkit-app-region: no-drag;
  margin-left: 8px;
  height: 100%;
}

.wc-btn {
  width: 46px;
  height: 100%;
  background: transparent;
  color: #909090;
  font-size: 13px;
  border-radius: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.wc-btn:hover { background: #333; color: #fff; }
.wc-close:hover { background: #c42b1c; color: #fff; }

.main-area {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.video-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #000;
}

.sidebar {
  width: 320px;
  flex-shrink: 0;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.hotkey-hint {
  position: fixed;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.35;
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
  letter-spacing: 0.3px;
  transition: opacity 0.15s;
  z-index: 10;
}
.hotkey-hint:hover { opacity: 0.7; }

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 20px 24px;
  max-width: 480px;
  width: 90%;
}

.modal-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.modal-body {
  font-size: 13px;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.modal-path {
  font-family: monospace;
  font-size: 11px;
  color: var(--wipe-red);
  word-break: break-all;
  background: var(--bg-card);
  padding: 6px 8px;
  border-radius: 3px;
}

.modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  justify-content: flex-end;
}

.modal-btn-primary {
  background: var(--accent-blue);
  color: #fff;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 4px;
}
.modal-btn-primary:hover { background: #5aa3e8; }

.modal-btn {
  background: var(--bg-card);
  color: var(--text-muted);
  padding: 6px 14px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.modal-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
</style>
