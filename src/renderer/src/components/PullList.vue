<template>
  <div class="pull-list">
    <div class="section-header">
      Pulls<span v-if="reportDate"> ({{ reportDate }})</span>
    </div>

    <div v-if="fights.length === 0" class="empty">No fights loaded</div>

    <div v-for="enc in encounterGroups" :key="enc.name" class="encounter-group">
      <!-- Encounter header -->
      <div class="encounter-name" @click="toggleGroup(enc.name)">
        <span class="chevron">{{ collapsedGroups.has(enc.name) ? '▶' : '▼' }}</span>
        {{ enc.name }}
      </div>

      <div v-if="!collapsedGroups.has(enc.name)">
        <!-- "Separate by phase" checkbox — only shown if this encounter has phases -->
        <div v-if="enc.hasPhases" class="phase-toggle">
          <input
            type="checkbox"
            :id="'sep-' + enc.name"
            v-model="separateByPhase"
          />
          <label :for="'sep-' + enc.name">Separate pulls by phase</label>
        </div>

        <!-- Phase sub-groups -->
        <template v-if="separateByPhase && enc.hasPhases">
          <div v-for="pg in enc.phaseGroups" :key="pg.phase" class="phase-section">
            <div class="phase-header" :style="{ borderLeftColor: phaseColor(pg.phase) }">
              {{ pg.label }}
            </div>
            <div class="pulls-grid">
              <button
                v-for="fight in pg.fights"
                :key="fight.id"
                class="pull-btn"
                :class="{ active: currentPull?.id === fight.id, 'is-kill': fight.kill }"
                :style="{ borderLeftColor: phaseColor(pg.phase) }"
                @click="$emit('selectPull', fight)"
                :title="`${fight.name} — Pull #${fight.pullNum} — ${formatDuration(fight.startTime, fight.endTime)}`"
              >
                <PullCell :fight="fight" :report-start="reportStart" />
              </button>
            </div>
          </div>
        </template>

        <!-- Flat grid (no phase separation) -->
        <template v-else>
          <div class="pulls-grid">
            <button
              v-for="fight in enc.fights"
              :key="fight.id"
              class="pull-btn"
              :class="{ active: currentPull?.id === fight.id, 'is-kill': fight.kill }"
              @click="$emit('selectPull', fight)"
              :title="`${fight.name} — Pull #${fight.pullNum} — ${formatDuration(fight.startTime, fight.endTime)}`"
            >
              <PullCell :fight="fight" :report-start="reportStart" />
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue'
import type { Fight, PhaseInfo } from '../types'
import PullCell from './PullCell.vue'

const props = defineProps<{
  fights: Fight[]
  currentPull: Fight | null
  reportStart: number
  phases: PhaseInfo[]
}>()

defineEmits<{ (e: 'selectPull', fight: Fight): void }>()

const collapsedGroups = ref(new Set<string>())
const separateByPhase = ref(true)

const PHASE_COLORS = [
  '#607d8b', // 0 – no phase / gray-blue
  '#607d8b', // 1 – gray-blue
  '#4caf50', // 2 – green
  '#00bcd4', // 3 – cyan
  '#9c27b0', // 4 – purple
  '#ff9800', // 5 – orange
  '#f44336', // 6 – red
  '#e91e63', // 7 – pink
]
function phaseColor(phase: number): string {
  return PHASE_COLORS[phase] ?? '#607d8b'
}

// Build a lookup: encounterID → { phaseId → phaseName }
const phaseMap = computed((): Map<number, Map<number, string>> => {
  const m = new Map<number, Map<number, string>>()
  for (const ep of props.phases) {
    const inner = new Map<number, string>()
    for (const p of ep.phases) {
      inner.set(p.id, p.name)
    }
    m.set(ep.encounterID, inner)
  }
  return m
})

// Which encounterIDs have separatesWipes = true
const separatingEncounters = computed((): Set<number> => {
  const s = new Set<number>()
  for (const ep of props.phases) {
    if (ep.separatesWipes) s.add(ep.encounterID)
  }
  return s
})

function getPhaseName(fight: Fight): string {
  if (!fight.lastPhase) return `Phase 0`
  const inner = phaseMap.value.get(fight.encounterID)
  return inner?.get(fight.lastPhase) ?? `Phase ${fight.lastPhase}`
}

interface PhaseGroup {
  phase: number
  label: string
  fights: Fight[]
}

interface EncounterGroup {
  name: string
  hasPhases: boolean
  fights: Fight[]
  phaseGroups: PhaseGroup[]
}

const encounterGroups = computed((): EncounterGroup[] => {
  // Group fights by encounter name
  const byName = new Map<string, Fight[]>()
  for (const f of props.fights) {
    if (!byName.has(f.name)) byName.set(f.name, [])
    byName.get(f.name)!.push(f)
  }

  return Array.from(byName.entries()).map(([name, fights]) => {
    const encId = fights[0]?.encounterID ?? -1
    const hasPhases = separatingEncounters.value.has(encId)

    // Build phase sub-groups sorted by phase number
    const byPhase = new Map<number, Fight[]>()
    for (const f of fights) {
      const key = f.lastPhase ?? 0
      if (!byPhase.has(key)) byPhase.set(key, [])
      byPhase.get(key)!.push(f)
    }

    const phaseGroups: PhaseGroup[] = Array.from(byPhase.entries())
      .sort(([a], [b]) => a - b)
      .map(([phase, pFights]) => ({
        phase,
        label: phase === 0 ? 'Phase 0' : getPhaseName(pFights[0]),
        fights: pFights
      }))

    return { name, hasPhases, fights, phaseGroups }
  })
})

const reportDate = computed(() =>
  props.reportStart ? new Date(props.reportStart).toLocaleDateString() : ''
)

function toggleGroup(name: string) {
  if (collapsedGroups.value.has(name)) collapsedGroups.value.delete(name)
  else collapsedGroups.value.add(name)
}

function formatDuration(startMs: number, endMs: number): string {
  const s = Math.floor((endMs - startMs) / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
</script>

<style scoped>
.pull-list {
  flex: 1;
  overflow-y: auto;
}

.section-header {
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  position: sticky;
  top: 0;
  background: var(--bg-secondary);
  z-index: 1;
  border-bottom: 1px solid var(--border);
}

.empty {
  padding: 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.encounter-group { border-bottom: 1px solid var(--border); }

.encounter-name {
  padding: 7px 10px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  background: var(--bg-card);
  user-select: none;
  display: flex;
  align-items: center;
  gap: 6px;
}
.encounter-name:hover { background: var(--bg-hover); }
.chevron { font-size: 10px; color: var(--text-muted); }

.phase-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
}
.phase-toggle input { cursor: pointer; accent-color: var(--accent-blue); }
.phase-toggle label { cursor: pointer; user-select: none; }

.phase-section { border-bottom: 1px solid #1e2e3e; }

.phase-header {
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: #111d2c;
  border-left: 3px solid;
  letter-spacing: 0.3px;
}

.pulls-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--bg-secondary);
}

.pull-btn {
  display: flex;
  flex-direction: column;
  padding: 5px 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-radius: 0;
  text-align: left;
  transition: background 0.1s;
  min-height: 62px;
  border-left: 2px solid transparent;
}
.pull-btn:hover { background: #1a2a3f; }
.pull-btn.active { background: #162c46; box-shadow: inset 0 0 0 1px var(--accent-blue); }
.pull-btn.is-kill { background: #0c1f0c; }
.pull-btn.is-kill.active { background: #0e2c0e; box-shadow: inset 0 0 0 1px var(--kill-green); }
</style>
