<template>
  <div class="sync-controls">
    <div class="row">
      <span class="label">Offset (ms)</span>
      <button class="offset-btn" @click="$emit('decrease')" title="−500ms">−</button>
      <input
        type="number"
        class="offset-input"
        :value="videoOffset"
        @change="onOffsetInput"
        step="500"
      />
      <button class="offset-btn" @click="$emit('increase')" title="+500ms">+</button>
    </div>

    <div class="row">
      <span class="label">Pull time</span>
      <span class="pull-time" v-if="currentPull">{{ pullTime }} / {{ pullDuration }}</span>
      <span class="pull-time muted" v-else>—</span>
      <button
        class="sync-btn"
        :disabled="!currentPull"
        @click="syncHere"
        title="Set pull start = current video position. Seek to the moment the pull began, then click this."
      >Sync here</button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import type { Fight } from '../types'

const props = defineProps<{
  videoOffset: number
  currentPull: Fight | null
  currentVideoTime: number
}>()

const emit = defineEmits<{
  (e: 'decrease'): void
  (e: 'increase'): void
  (e: 'setOffset', v: number): void
}>()

function onOffsetInput(e: Event) {
  const v = parseInt((e.target as HTMLInputElement).value)
  if (!isNaN(v)) emit('setOffset', v)
}

// Seek video to the moment that matches a known event, then click Sync here.
// This sets videoOffset so that currentPull.startTime maps to currentVideoTime.
// Formula: (fightEntry.startTime + videoOffset) / 1000 = currentVideoTime
// => videoOffset = currentVideoTime * 1000 - fightEntry.startTime
function syncHere() {
  if (!props.currentPull) return
  const newOffset = Math.round(props.currentVideoTime * 1000) - props.currentPull.startTime
  emit('setOffset', newOffset)
}

const pullElapsed = computed(() => {
  if (!props.currentPull) return 0
  return props.currentVideoTime - (props.currentPull.startTime + props.videoOffset) / 1000
})

const pullDurationSec = computed(() => {
  if (!props.currentPull) return 0
  return (props.currentPull.endTime - props.currentPull.startTime) / 1000
})

function fmt(s: number): string {
  const clamped = Math.max(0, Math.min(s, pullDurationSec.value))
  const m = Math.floor(clamped / 60)
  const sec = Math.floor(clamped % 60)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const pullTime = computed(() => fmt(pullElapsed.value))
const pullDuration = computed(() => fmt(pullDurationSec.value))
</script>

<style scoped>
.sync-controls {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 10px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.label {
  font-size: 12px;
  color: var(--text-muted);
  min-width: 68px;
  flex-shrink: 0;
}

.offset-btn {
  background: var(--bg-card);
  color: var(--text-primary);
  width: 24px;
  height: 24px;
  font-size: 16px;
  line-height: 1;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  flex-shrink: 0;
}
.offset-btn:hover { background: var(--bg-hover); }

.offset-input {
  width: 80px;
  text-align: center;
  padding: 2px 4px;
  font-size: 12px;
  flex-shrink: 0;
}

.pull-time {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  flex: 1;
}
.pull-time.muted { color: var(--text-muted); }

.sync-btn {
  background: #2a4a2a;
  color: #90ee90;
  border: 1px solid #3a6a3a;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}
.sync-btn:hover:not(:disabled) { background: #3a6a3a; }
.sync-btn:disabled { opacity: 0.35; cursor: not-allowed; }
</style>
