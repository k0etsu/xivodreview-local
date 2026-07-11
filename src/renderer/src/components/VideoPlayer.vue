<template>
  <div class="video-wrapper" tabindex="-1" ref="wrapper">

    <!-- Video area:
         mpv mode  — transparent click target; native child window sits on top.
         html5 mode — contains a real <video> element. -->
    <div class="video-container" ref="videoArea" @click="togglePlay">
      <canvas v-if="backend === 'mpv'" ref="videoCanvas" class="video-canvas" />
      <video
        v-if="backend === 'html5' && src"
        ref="videoEl"
        :src="src"
        class="html5-video"
        preload="auto"
        @timeupdate="onHtmlTime"
        @durationchange="onHtmlDuration"
        @play="playing = true"
        @pause="playing = false"
        @loadedmetadata="onHtmlFileLoaded"
      />
      <div v-if="!src" class="video-placeholder" @click.stop="$emit('openFile')">
        <div class="placeholder-inner">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
            <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p>Click to open video file</p>
          <p class="hint">or use the button in the sidebar</p>
        </div>
      </div>
    </div>

    <!-- Scrub bar — always rendered so its height is always reserved -->
    <div class="scrub-bar" @click="onScrubBarClick" @mousemove="onScrubHover" @mouseleave="scrubHoverX = null" ref="scrubBar">
      <div v-if="pullDuration > 0" class="scrub-track">
        <div class="scrub-fill" :style="{ width: scrubPercent + '%' }" />
        <div
          v-for="(d, i) in deathMarkers"
          :key="i"
          class="death-marker"
          :style="{ left: d + '%' }"
          :title="'Death at ' + d.toFixed(1) + '%'"
        />
        <div class="scrub-thumb" :style="{ left: scrubPercent + '%' }" />
      </div>
      <div v-else-if="duration > 0" class="scrub-track">
        <div class="scrub-fill" :style="{ width: fullScrubPercent + '%' }" />
        <div class="scrub-thumb" :style="{ left: fullScrubPercent + '%' }" />
      </div>
      <div v-else class="scrub-track" style="visibility: hidden" />
    </div>

    <!-- Controls -->
    <div class="controls">
      <button class="ctrl-btn" @click="togglePlay" :title="playing ? 'Pause' : 'Play'">
        <svg v-if="!playing" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z"/>
        </svg>
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
        </svg>
      </button>

      <button class="ctrl-btn" @click="seekBy(-5)" title="Back 5s">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/>
        </svg>
      </button>
      <button class="ctrl-btn" @click="seekBy(5)" title="Forward 5s">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>
        </svg>
      </button>

      <span class="time-display">
        <template v-if="scrubHoverX !== null">
          <span class="hover-time">{{ scrubHoverTime }}</span> / {{ formatTime(pullDuration > 0 ? pullDuration / 1000 : duration) }}
        </template>
        <template v-else-if="pullDuration > 0">{{ formatTime(Math.max(0, currentTime - pullStartSeconds)) }} / {{ formatTime(pullDuration / 1000) }}</template>
        <template v-else>{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</template>
      </span>

      <div class="volume-group">
        <button class="ctrl-btn" @click="toggleMute" title="Mute">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path v-if="!muted && volume > 0" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
            <path v-else d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
          </svg>
        </button>
        <input
          type="range" min="0" max="1" step="0.01"
          :value="muted ? 0 : volume"
          @input="onVolumeInput"
          class="volume-slider"
        />
      </div>

      <!-- Audio track selector — mpv only, shown when multiple tracks detected -->
      <button
        v-if="backend === 'mpv' && audioTracks.length > 1"
        class="ctrl-btn audio-track-btn"
        @click="cycleAudioTrack"
        :title="`Cycle audio track (A) — ${currentAudioTrackIndex + 1}/${audioTracks.length}`"
      >Audio {{ currentAudioTrackIndex + 1 }}/{{ audioTracks.length }}</button>

      <div class="spacer" />
      <slot name="controls-right" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { DeathEvent, Fight } from '../types'

const props = defineProps<{
  backend: 'mpv' | 'html5'
  src: string | null
  currentPull: Fight | null
  deaths: DeathEvent[]
  videoOffset: number
}>()

const emit = defineEmits<{
  (e: 'openFile'): void
  (e: 'timeUpdate', time: number): void
}>()

// ─── Refs ─────────────────────────────────────────────────────────────────────

const wrapper     = ref<HTMLDivElement | null>(null)
const videoArea   = ref<HTMLDivElement | null>(null)
const scrubBar    = ref<HTMLDivElement | null>(null)
const videoEl     = ref<HTMLVideoElement | null>(null)
const videoCanvas = ref<HTMLCanvasElement | null>(null)

const playing     = ref(false)
const currentTime = ref(0)
const duration    = ref(0)
const volume      = ref(1)
const muted       = ref(false)

interface AudioTrack { id: number; index: number; title: string; language: string; selected: boolean }
const audioTracks            = ref<AudioTrack[]>([])
const currentAudioTrackIndex = ref(0)

// Pending seek target (seconds) to apply after the next file-loaded event
let pendingSeek: number | null = null

// Scrub bar hover tooltip
const scrubHoverX    = ref<number | null>(null)
const scrubHoverTime = ref('')

// ─── Scrub / pull computeds ───────────────────────────────────────────────────

const pullStartSeconds = computed(() =>
  props.currentPull ? (props.currentPull.startTime + props.videoOffset) / 1000 : 0
)
const pullDuration = computed(() =>
  props.currentPull ? props.currentPull.endTime - props.currentPull.startTime : 0
)
const scrubPercent = computed(() => {
  if (!props.currentPull || pullDuration.value === 0) return 0
  const p = ((currentTime.value - pullStartSeconds.value) / (pullDuration.value / 1000)) * 100
  return Math.max(0, Math.min(100, p))
})
const fullScrubPercent = computed(() =>
  duration.value === 0 ? 0 : (currentTime.value / duration.value) * 100
)
const deathMarkers = computed(() => {
  if (!props.currentPull || pullDuration.value === 0) return []
  return props.deaths.map((d) => {
    const pct = ((d.timestamp - props.currentPull!.startTime) / pullDuration.value) * 100
    return Math.max(0, Math.min(100, pct))
  })
})

// ─── Bounds reporting ─────────────────────────────────────────────────────────

// Sends the video-container's viewport-relative rect to the main process.
// The main process combines this with window.getContentBounds() to position
// the mpv child window at the correct absolute screen coordinates.
function reportBounds() {
  if (!videoArea.value) return
  const r = videoArea.value.getBoundingClientRect()
  window.api.mpvSetViewportBounds({ left: r.left, top: r.top, width: r.width, height: r.height })
}

// ─── mpv event handlers ───────────────────────────────────────────────────────

function onMpvTime(t: number)     { currentTime.value = t; emit('timeUpdate', t) }
function onMpvDuration(d: number) { duration.value = d }
function onMpvPause(p: boolean)   { playing.value = !p }
function onMpvTracks(raw: unknown[]) {
  audioTracks.value = raw as AudioTrack[]
  const sel = audioTracks.value.findIndex(t => t.selected)
  currentAudioTrackIndex.value = sel >= 0 ? sel : 0
}
function onMpvFileLoaded() {
  // Always start paused; IPC is async so this runs after mpv's event drain completes
  window.api.mpvPause().catch(() => {})
  if (pendingSeek !== null) {
    window.api.mpvSeek(pendingSeek, 'absolute').catch(() => {})
    pendingSeek = null
  }
}

// ─── HTML5 event handlers ─────────────────────────────────────────────────────

function onHtmlTime() {
  const t = videoEl.value?.currentTime ?? 0
  currentTime.value = t
  emit('timeUpdate', t)
}
function onHtmlDuration() { duration.value = videoEl.value?.duration ?? 0 }
function onHtmlFileLoaded() {
  duration.value = videoEl.value?.duration ?? 0
  if (pendingSeek !== null) {
    if (videoEl.value) videoEl.value.currentTime = pendingSeek
    pendingSeek = null
  }
}

// ─── Controls ─────────────────────────────────────────────────────────────────

function togglePlay() {
  if (!props.src) return
  if (props.backend === 'html5') {
    const v = videoEl.value
    if (!v) return
    v.paused ? v.play() : v.pause()
  } else {
    window.api.mpvTogglePause().catch(() => {})
  }
}

function toggleMute() {
  muted.value = !muted.value
  if (props.backend === 'html5') {
    if (videoEl.value) videoEl.value.muted = muted.value
  } else {
    window.api.mpvSetMute(muted.value).catch(() => {})
  }
}

function onVolumeInput(e: Event) {
  const v = parseFloat((e.target as HTMLInputElement).value)
  volume.value = v
  muted.value = v === 0
  if (props.backend === 'html5') {
    if (videoEl.value) { videoEl.value.volume = v; videoEl.value.muted = muted.value }
  } else {
    window.api.mpvSetVolume(v).catch(() => {})
    if (!muted.value) window.api.mpvSetMute(false).catch(() => {})
  }
}

function seekTo(seconds: number) {
  if (props.backend === 'html5') {
    if (videoEl.value) videoEl.value.currentTime = Math.max(0, seconds)
  } else {
    window.api.mpvSeek(Math.max(0, seconds), 'absolute').catch(() => {})
  }
}

function seekBy(delta: number) {
  if (props.backend === 'html5') {
    if (videoEl.value) videoEl.value.currentTime = Math.max(0, videoEl.value.currentTime + delta)
  } else {
    window.api.mpvSeek(delta, 'relative').catch(() => {})
  }
}

function stepFrame(direction: 1 | -1) {
  // Frame stepping is mpv-only; no-op in HTML5 mode
  if (props.backend === 'mpv') {
    if (direction > 0) window.api.mpvFrameStep().catch(() => {})
    else               window.api.mpvFrameBackStep().catch(() => {})
  }
}

function adjustVolume(delta: number) {
  const next = Math.max(0, Math.min(1, volume.value + delta))
  volume.value = next
  muted.value = next === 0
  if (props.backend === 'html5') {
    if (videoEl.value) { videoEl.value.volume = next; videoEl.value.muted = muted.value }
  } else {
    window.api.mpvAddVolume(delta).catch(() => {})
  }
}

function cycleAudioTrack() {
  // mpv-only
  if (audioTracks.value.length <= 1) return
  const next = (currentAudioTrackIndex.value + 1) % audioTracks.value.length
  const track = audioTracks.value[next]
  if (!track) return
  currentAudioTrackIndex.value = next
  window.api.mpvSetAudioTrack(track.id).catch(() => {})
}

// Reload file from disk (picks up new content if still recording).
// Saves playhead position; restores it after file-loaded. Always stays paused.
function reloadVideo() {
  if (!props.src) return
  pendingSeek = currentTime.value
  if (props.backend === 'html5') {
    videoEl.value?.load()
  } else {
    window.api.mpvOpenFile(props.src).catch(() => {})
  }
}

// ─── Scrub bar interaction ────────────────────────────────────────────────────

function onScrubBarClick(e: MouseEvent) {
  const bar = scrubBar.value
  if (!bar) return
  const pct = (e.clientX - bar.getBoundingClientRect().left) / bar.getBoundingClientRect().width
  if (pullDuration.value > 0) {
    seekTo(pullStartSeconds.value + pct * (pullDuration.value / 1000))
  } else if (duration.value > 0) {
    seekTo(pct * duration.value)
  }
}

function onScrubHover(e: MouseEvent) {
  const bar = scrubBar.value
  if (!bar) return
  const rect = bar.getBoundingClientRect()
  if (pullDuration.value === 0 && duration.value === 0) { scrubHoverX.value = null; return }
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  // Position is relative to the scrub-track (8px padding each side inside the bar)
  const trackPad = 8
  const trackWidth = rect.width - trackPad * 2
  scrubHoverX.value = Math.max(0, Math.min(trackWidth, (e.clientX - rect.left) - trackPad))
  scrubHoverTime.value = pullDuration.value > 0
    ? formatTime(pct * (pullDuration.value / 1000))
    : formatTime(pct * duration.value)
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatTime(s: number): string {
  if (!isFinite(s)) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

// ─── src watcher ──────────────────────────────────────────────────────────────

watch(() => props.src, (newSrc) => {
  currentTime.value = 0
  duration.value = 0
  playing.value = false
  audioTracks.value = []
  currentAudioTrackIndex.value = 0
  // HTML5: :src binding on <video> triggers load automatically
  if (newSrc && props.backend === 'mpv') window.api.mpvOpenFile(newSrc).catch(() => {})
})

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  wrapper.value?.focus()

  if (props.backend === 'mpv') {
    let canvasCtx: CanvasRenderingContext2D | null = null
    window.api.mpvOnFrame(({ width, height, data }) => {
      const canvas = videoCanvas.value
      if (!canvas) { window.api.mpvFrameConsumed(); return }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        canvasCtx = null
      }
      if (!canvasCtx) canvasCtx = canvas.getContext('2d')
      if (!canvasCtx) { window.api.mpvFrameConsumed(); return }
      canvasCtx.putImageData(
        new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height),
        0, 0
      )
      window.api.mpvFrameConsumed()
    })
    window.api.mpvOnTimeUpdate(onMpvTime)
    window.api.mpvOnDuration(onMpvDuration)
    window.api.mpvOnPause(onMpvPause)
    window.api.mpvOnTracks(onMpvTracks as (t: unknown[]) => void)
    window.api.mpvOnFileLoaded(onMpvFileLoaded)

    reportBounds()
    resizeObserver = new ResizeObserver(reportBounds)
    if (videoArea.value) resizeObserver.observe(videoArea.value)
    window.addEventListener('resize', reportBounds)
  }
})

onUnmounted(() => {
  if (props.backend === 'mpv') {
    window.api.mpvOffAll()
    resizeObserver?.disconnect()
    window.removeEventListener('resize', reportBounds)
  }
})

// ─── Public API (called by App.vue) ──────────────────────────────────────────

defineExpose({
  seekTo,
  seekBy,
  stepFrame,
  adjustVolume,
  togglePlay,
  toggleMute,
  cycleAudioTrack,
  getCurrentTime: () => currentTime.value,
  reloadVideo
})
</script>

<style scoped>
.video-wrapper {
  display: flex;
  flex-direction: column;
  background: #000;
  outline: none;
  height: 100%;
}

.html5-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.video-canvas {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  display: block;
}

/* mpv mode: layout placeholder only — native window sits on top.
   html5 mode: contains the <video> element. */
.video-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  cursor: pointer;
}

.video-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.placeholder-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  opacity: 0.6;
  transition: opacity 0.2s;
}
.placeholder-inner:hover { opacity: 1; }
.placeholder-inner p { font-size: 16px; }
.placeholder-inner .hint { font-size: 12px; color: var(--text-muted); }

/* Scrub bar */
.scrub-bar {
  position: relative;
  height: 28px;
  padding: 10px 8px;
  cursor: pointer;
  background: #111;
}
.scrub-track {
  position: relative;
  height: 8px;
  background: #333;
  border-radius: 4px;
  overflow: visible;
}
.scrub-fill {
  position: absolute;
  left: 0; top: 0;
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
  pointer-events: none;
}
.scrub-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 12px; height: 12px;
  background: #fff;
  border-radius: 50%;
  pointer-events: none;
  z-index: 2;
}
.death-marker {
  position: absolute;
  top: -3px;
  transform: translateX(-50%);
  width: 2px; height: 14px;
  background: var(--wipe-red);
  border-radius: 1px;
  z-index: 1;
}
.hover-time {
  color: var(--text-primary);
  font-weight: 600;
}

/* Controls */
.controls {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background: #111;
  border-top: 1px solid #222;
  min-height: 40px;
}
.ctrl-btn {
  background: transparent;
  color: var(--text-primary);
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.ctrl-btn:hover { background: #333; }

.time-display {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  margin: 0 8px;
  font-variant-numeric: tabular-nums;
  display: inline-block;
  min-width: 90px;
  text-align: right;
}

.volume-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.volume-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 70px; height: 16px;
  background: transparent;
  cursor: pointer;
  padding: 0; margin: 0; outline: none;
}
.volume-slider::-webkit-slider-runnable-track {
  height: 4px;
  background: #555;
  border-radius: 2px;
}
.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: #e0e0e0;
  margin-top: -4px;
  cursor: pointer;
  transition: background 0.1s;
}
.volume-slider:hover::-webkit-slider-thumb { background: #fff; }
.volume-slider::-webkit-slider-thumb:active { background: var(--accent-blue); }

.audio-track-btn {
  font-size: 11px;
  padding: 2px 6px;
  color: var(--text-muted);
}
.audio-track-btn:hover { color: var(--text-primary); }

.spacer { flex: 1; }
</style>
