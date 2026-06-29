<template>
  <div class="event-table">
    <div class="table-header">
      <span>Pull {{ currentPull?.pullNum }}</span>
      <a
        v-if="reportCode && currentPull"
        :href="`https://www.fflogs.com/reports/${reportCode}/#fight=${currentPull.id}&type=deaths`"
        target="_blank"
        class="fflogs-link"
        title="Open in FFLogs"
      >↗ FFLogs</a>
    </div>

    <div v-if="loading && deaths.length === 0" class="state-msg">Loading deaths…</div>
    <div v-else-if="!loading && deaths.length === 0" class="state-msg muted">No deaths recorded</div>

    <table v-if="deaths.length > 0">
      <colgroup>
        <col style="width: 30%" />
        <col style="width: 28%" />
        <col style="width: 28%" />
        <col style="width: 14%" />
      </colgroup>
      <thead>
        <tr>
          <th>Player</th>
          <th>Source</th>
          <th>Ability</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(d, i) in deaths"
          :key="i"
          class="death-row"
          @click="$emit('seekTo', (d.timestamp + videoOffset) / 1000)"
          title="Jump to death"
        >
          <td class="cell">{{ d.player ?? '?' }}</td>
          <td class="cell muted">{{ d.source ?? '—' }}</td>
          <td class="cell">{{ d.ability ?? '?' }}</td>
          <td class="cell mono">{{ formatRelative(d.timestamp) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script lang="ts" setup>
import type { DeathEvent, Fight } from '../types'

const props = defineProps<{
  deaths: DeathEvent[]
  currentPull: Fight | null
  videoOffset: number
  reportCode: string
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'seekTo', seconds: number): void
}>()

function formatRelative(timestamp: number): string {
  if (!props.currentPull) return '?'
  const ms = timestamp - props.currentPull.startTime
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}
</script>

<style scoped>
.event-table {
  border-top: 1px solid var(--border);
  overflow-y: auto;
  overflow-x: hidden;
  height: 300px;
  flex-shrink: 0;
}

.table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  background: var(--bg-card);
  position: sticky;
  top: 0;
  z-index: 1;
}

.fflogs-link {
  color: var(--accent-blue);
  font-size: 11px;
  text-decoration: none;
  font-weight: 400;
}
.fflogs-link:hover { text-decoration: underline; }

.state-msg {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-primary);
}
.state-msg.muted { color: var(--text-muted); }

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  table-layout: fixed;
}

thead th {
  padding: 4px 6px;
  text-align: left;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 11px;
  background: var(--bg-secondary);
  position: sticky;
  top: 32px;
  overflow: hidden;
  white-space: nowrap;
}

.death-row {
  cursor: pointer;
  transition: background 0.1s;
}
.death-row:hover { background: var(--bg-hover); }
.death-row:hover .cell { color: #fff; }

.cell {
  padding: 5px 6px;
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 0;
}

.muted { color: var(--text-muted); }
.mono { font-variant-numeric: tabular-nums; }
</style>
