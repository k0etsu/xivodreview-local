<template>
  <!-- top row: fight% + duration -->
  <div class="btn-top">
    <span v-if="fight.kill" class="kill-pct">KILL</span>
    <span v-else class="pct" :class="'rarity-' + fight.rarity">
      {{ (pullPctMode === 'boss' ? fight.bossPercentage : fight.fightPercentage)?.toFixed(1) ?? '?' }}%
    </span>
    <span class="duration">({{ formatDuration(fight.startTime, fight.endTime) }})</span>
  </div>
  <!-- middle row: pull # + phase -->
  <div class="btn-mid">
    <span class="pull-num">#{{ fight.pullNum }}</span>
    <span v-if="fight.lastPhase" class="phase">P{{ fight.lastPhase }}</span>
    <span v-if="fight.kill" class="kill-check">✓</span>
  </div>
  <!-- bottom: wall-clock time -->
  <div class="btn-bot">{{ wallTime }}</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import type { Fight } from '../types'

const props = defineProps<{
  fight: Fight
  reportStart: number
  pullPctMode: 'fight' | 'boss'
}>()

function formatDuration(startMs: number, endMs: number): string {
  const s = Math.floor((endMs - startMs) / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const wallTime = computed(() => {
  if (!props.reportStart) return ''
  return new Date(props.reportStart + props.fight.startTime)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
})
</script>

<style scoped>
.btn-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 2px;
  width: 100%;
}

.pct {
  font-weight: 700;
  font-size: 13px;
  line-height: 1;
}
.kill-pct {
  font-weight: 700;
  font-size: 11px;
  color: var(--kill-green);
  letter-spacing: 0.5px;
}

.duration {
  font-size: 10px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.btn-mid {
  display: flex;
  align-items: center;
  gap: 4px;
}
.pull-num {
  font-size: 11px;
  color: var(--text-muted);
}
.phase {
  font-size: 10px;
  color: #7ab3e0;
  font-weight: 600;
}
.kill-check {
  font-size: 12px;
  color: var(--kill-green);
  font-weight: 700;
  margin-left: auto;
}

.btn-bot {
  font-size: 9px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
}

/* Rarity colors */
.rarity-common     { color: #9e9e9e; }
.rarity-uncommon   { color: #66bb6a; }
.rarity-rare       { color: #42a5f5; }
.rarity-epic       { color: #ce93d8; }
.rarity-legendary  { color: #ffa726; }
.rarity-astounding { color: #ef5350; }
</style>
