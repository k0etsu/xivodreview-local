<template>
  <div class="video-wrapper" tabindex="-1" ref="wrapper">
    <div class="video-container">
      <video
        ref="videoEl"
        :src="activeSrc ? 'file:///' + activeSrc.replace(/\\/g, '/') : undefined"
        @timeupdate="onTimeUpdate"
        @loadedmetadata="onMetadata"
        @play="playing = true"
        @pause="playing = false"
        @ended="playing = false"
        @click="togglePlay"
        class="video-el"
      />
      <div v-if="!src" class="video-placeholder" @click="$emit('openFile')">
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

    <!-- Scrub bar -->
    <div class="scrub-bar" v-if="pullDuration > 0" @click="onScrubClick" ref="scrubBar">
      <div class="scrub-track">
        <div class="scrub-fill" :style="{ width: scrubPercent + '%' }" />
        <!-- Death markers -->
        <div
          v-for="(d, i) in deathMarkers"
          :key="i"
          class="death-marker"
          :style="{ left: d + '%' }"
          :title="'Death at ' + d.toFixed(1) + '%'"
        />
        <div class="scrub-thumb" :style="{ left: scrubPercent + '%' }" />
      </div>
    </div>
    <!-- Normal progress bar when no pull selected -->
    <div class="scrub-bar" v-else-if="duration > 0" @click="onFullScrubClick" ref="scrubBar">
      <div class="scrub-track">
        <div class="scrub-fill" :style="{ width: fullScrubPercent + '%' }" />
        <div class="scrub-thumb" :style="{ left: fullScrubPercent + '%' }" />
      </div>
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

      <button class="ctrl-btn" @click="seek(-5)" title="Back 5s">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/>
        </svg>
      </button>
      <button class="ctrl-btn" @click="seek(5)" title="Forward 5s">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>
        </svg>
      </button>

      <span class="time-display">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>

      <div class="volume-group">
        <button class="ctrl-btn" @click="toggleMute" title="Mute">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path v-if="!muted && volume > 0" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
            <path v-else d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
          </svg>
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="muted ? 0 : volume"
          @input="onVolumeChange"
          class="volume-slider"
        />
      </div>

      <button
        v-if="audioTracks.length > 1"
        class="ctrl-btn audio-track-btn"
        @click="cycleAudioTrack"
        :disabled="audioTrackLoading"
        :title="audioTrackLoading ? 'Switching audio track…' : `Cycle audio track (A) — ${currentAudioTrackIndex + 1}/${audioTracks.length}`"
      >{{ audioTrackLoading ? '…' : `Audio ${currentAudioTrackIndex + 1}/${audioTracks.length}` }}</button>

      <div class="spacer" />

      <slot name="controls-right" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import type { DeathEvent, Fight } from '../types'

const props = defineProps<{
  src: string | null
  currentPull: Fight | null
  deaths: DeathEvent[]
  videoOffset: number  // ms: (fightEntry.startTime + videoOffset) / 1000 = seek target
}>()

const emit = defineEmits<{
  (e: 'openFile'): void
  (e: 'timeUpdate', time: number): void
}>()

const videoEl = ref<HTMLVideoElement | null>(null)
const wrapper = ref<HTMLDivElement | null>(null)
const scrubBar = ref<HTMLDivElement | null>(null)

const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(1)
const muted = ref(false)

// activeSrc is what the <video> element actually plays. Normally equals props.src,
// but switches to a temp-remuxed file when the user cycles audio tracks.
const activeSrc = ref<string | null>(props.src)

interface AudioTrack { index: number; title: string; language: string }
const audioTracks = ref<AudioTrack[]>([])
const currentAudioTrackIndex = ref(0)
const audioTrackLoading = ref(false)

// Pull-relative scrub
const pullStartSeconds = computed(() => {
  if (!props.currentPull) return 0
  return (props.currentPull.startTime + props.videoOffset) / 1000
})
const pullEndSeconds = computed(() => {
  if (!props.currentPull) return 0
  return (props.currentPull.endTime + props.videoOffset) / 1000
})
const pullDuration = computed(() => {
  if (!props.currentPull) return 0
  return props.currentPull.endTime - props.currentPull.startTime  // ms
})

const scrubPercent = computed(() => {
  if (!props.currentPull || pullDuration.value === 0) return 0
  const p = ((currentTime.value - pullStartSeconds.value) / (pullDuration.value / 1000)) * 100
  return Math.max(0, Math.min(100, p))
})

const fullScrubPercent = computed(() => {
  if (duration.value === 0) return 0
  return (currentTime.value / duration.value) * 100
})

const deathMarkers = computed(() => {
  if (!props.currentPull || pullDuration.value === 0) return []
  return props.deaths.map((d) => {
    const pct = ((d.timestamp - props.currentPull!.startTime) / pullDuration.value) * 100
    return Math.max(0, Math.min(100, pct))
  })
})

function onTimeUpdate() {
  if (!videoEl.value) return
  currentTime.value = videoEl.value.currentTime
  emit('timeUpdate', videoEl.value.currentTime)
}

function onMetadata() {
  if (!videoEl.value) return
  duration.value = videoEl.value.duration
}

async function loadAudioTracks(filePath: string) {
  try {
    const tracks = await window.api.getAudioTracks(filePath)
    console.log('[AudioTracks]', tracks.length, 'track(s):', tracks)
    audioTracks.value = tracks
  } catch (err) {
    console.error('[AudioTracks] probe failed:', err)
    audioTracks.value = []
  }
}

async function cycleAudioTrack() {
  if (!props.src || audioTracks.value.length <= 1 || audioTrackLoading.value) return
  const next = (currentAudioTrackIndex.value + 1) % audioTracks.value.length
  const savedTime = videoEl.value?.currentTime ?? 0
  audioTrackLoading.value = true
  try {
    const tmpPath = await window.api.remuxWithTrack(props.src, next)
    activeSrc.value = tmpPath
    currentAudioTrackIndex.value = next
    await nextTick()
    const onLoaded = () => {
      if (!videoEl.value) return
      videoEl.value.currentTime = savedTime
      videoEl.value.removeEventListener('loadedmetadata', onLoaded)
    }
    videoEl.value?.addEventListener('loadedmetadata', onLoaded)
    videoEl.value?.load()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[AudioTracks] switch failed:', msg)
    alert(`Audio track switch failed: ${msg}`)
  } finally {
    audioTrackLoading.value = false
  }
}

function togglePlay() {
  if (!videoEl.value || !props.src) return
  playing.value ? videoEl.value.pause() : videoEl.value.play()
}

function toggleMute() {
  if (!videoEl.value) return
  muted.value = !muted.value
  videoEl.value.muted = muted.value
}

function onVolumeChange(e: Event) {
  const v = parseFloat((e.target as HTMLInputElement).value)
  volume.value = v
  muted.value = v === 0
  if (videoEl.value) {
    videoEl.value.volume = v
    videoEl.value.muted = muted.value
  }
}

function seek(delta: number) {
  if (!videoEl.value) return
  videoEl.value.currentTime = Math.max(0, videoEl.value.currentTime + delta)
}

function seekTo(seconds: number) {
  if (!videoEl.value) return
  videoEl.value.currentTime = Math.max(0, seconds)
}

function onScrubClick(e: MouseEvent) {
  const bar = scrubBar.value
  if (!bar || !props.currentPull) return
  const rect = bar.getBoundingClientRect()
  const pct = (e.clientX - rect.left) / rect.width
  const targetTime =
    pullStartSeconds.value + pct * (pullDuration.value / 1000)
  seekTo(targetTime)
}

function onFullScrubClick(e: MouseEvent) {
  const bar = scrubBar.value
  if (!bar || !videoEl.value) return
  const rect = bar.getBoundingClientRect()
  const pct = (e.clientX - rect.left) / rect.width
  seekTo(pct * duration.value)
}


function formatTime(s: number): string {
  if (!isFinite(s)) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

// Reload the video file from disk (picks up new content if the file is still being written).
// Resets to the original file and default audio track. Always leaves the player paused.
async function reloadVideo() {
  if (!videoEl.value || !props.src) return
  const savedTime = videoEl.value.currentTime
  activeSrc.value = props.src
  currentAudioTrackIndex.value = 0
  await nextTick()
  const onLoaded = () => {
    if (!videoEl.value) return
    videoEl.value.currentTime = savedTime
    videoEl.value.removeEventListener('loadedmetadata', onLoaded)
  }
  videoEl.value.addEventListener('loadedmetadata', onLoaded)
  videoEl.value.load()
}

function seekBy(delta: number) {
  if (!videoEl.value) return
  videoEl.value.currentTime = Math.max(0, videoEl.value.currentTime + delta)
}

// Step one frame forward or backward.
// Pauses playback first (matching behavior of video editors).
// Frame duration is estimated at 1/fps; falls back to 1/60 if unavailable.
function stepFrame(direction: 1 | -1) {
  if (!videoEl.value) return
  videoEl.value.pause()
  // Chromium exposes getVideoPlaybackQuality() which doesn't give FPS directly.
  // Best available estimate: try the video's native frame rate via a heuristic,
  // otherwise assume 60fps (safe for most game recordings).
  const fps = (videoEl.value as HTMLVideoElement & { mozFrameDelay?: number }).mozFrameDelay
    ? 1 / (videoEl.value as HTMLVideoElement & { mozFrameDelay: number }).mozFrameDelay
    : 60
  const frameDuration = 1 / fps
  videoEl.value.currentTime = Math.max(0, videoEl.value.currentTime + direction * frameDuration)
}

function adjustVolume(delta: number) {
  if (!videoEl.value) return
  const next = Math.max(0, Math.min(1, volume.value + delta))
  volume.value = next
  muted.value = next === 0
  videoEl.value.volume = next
  videoEl.value.muted = muted.value
}

defineExpose({
  seekTo,
  seekBy,
  stepFrame,
  adjustVolume,
  togglePlay,
  toggleMute,
  cycleAudioTrack,
  getCurrentTime: () => videoEl.value?.currentTime ?? 0,
  reloadVideo
})

watch(() => props.src, async (newSrc) => {
  playing.value = false
  currentTime.value = 0
  duration.value = 0
  audioTracks.value = []
  currentAudioTrackIndex.value = 0
  activeSrc.value = newSrc
  if (!videoEl.value || !newSrc) return
  await nextTick()
  videoEl.value.load()
  loadAudioTracks(newSrc)
}, { immediate: true })

onMounted(() => {
  wrapper.value?.focus()
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

.video-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.video-el {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  cursor: pointer;
}

.video-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
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
  left: 0;
  top: 0;
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
  pointer-events: none;
}

.scrub-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 12px;
  height: 12px;
  background: #fff;
  border-radius: 50%;
  pointer-events: none;
  z-index: 2;
}

.death-marker {
  position: absolute;
  top: -3px;
  transform: translateX(-50%);
  width: 2px;
  height: 14px;
  background: var(--wipe-red);
  border-radius: 1px;
  z-index: 1;
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
}

.volume-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.volume-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 70px;
  height: 16px;       /* tall hit-area */
  background: transparent;
  cursor: pointer;
  padding: 0;
  margin: 0;
  outline: none;
}

/* Track */
.volume-slider::-webkit-slider-runnable-track {
  height: 4px;
  background: #555;
  border-radius: 2px;
}

/* Thumb */
.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #e0e0e0;
  margin-top: -4px;   /* center thumb on 4px track: -(12-4)/2 */
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
