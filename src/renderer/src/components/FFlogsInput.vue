<template>
  <div class="fflogs-input">
    <div class="section-header">Report</div>
    <div class="input-row">
      <input
        v-model="reportInput"
        placeholder="FFLogs report URL or code"
        @keydown.enter="submit"
        :disabled="loading"
      />
      <button class="submit-btn" @click="submit" :disabled="loading || !reportInput.trim()">
        {{ loading ? '…' : 'Load' }}
      </button>
      <button
        class="reload-btn"
        @click="$emit('reload')"
        :disabled="loading || !hasLoaded"
        title="Reload video from disk + re-fetch FFLogs report (useful when recording live)"
      >↻</button>
    </div>
    <div v-if="error" class="error-msg">{{ error }}</div>

    <!-- Saved encounters -->
    <div v-if="savedNames.length > 0" class="saved-section">
      <div class="saved-label">Saved</div>
      <div
        v-for="name in savedNames"
        :key="name"
        class="saved-row"
      >
        <button class="saved-btn" @click="$emit('loadSaved', name)">{{ name }}</button>
        <button class="del-btn" @click="$emit('deleteSaved', name)" title="Remove">✕</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue'

const props = defineProps<{
  loading: boolean
  error: string
  savedNames: string[]
  hasLoaded: boolean
}>()

const emit = defineEmits<{
  (e: 'submit', code: string): void
  (e: 'reload'): void
  (e: 'loadSaved', name: string): void
  (e: 'deleteSaved', name: string): void
}>()

const reportInput = ref('')

function extractCode(input: string): string {
  // Accept full URL like https://www.fflogs.com/reports/ABC123 or just the code
  const match = input.match(/reports\/([a-zA-Z0-9]+)/)
  return match ? match[1] : input.trim()
}

function submit() {
  const code = extractCode(reportInput.value)
  if (code) emit('submit', code)
}
</script>

<style scoped>
.fflogs-input {
  padding: 10px;
  border-bottom: 1px solid var(--border);
}

.section-header {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.input-row {
  display: flex;
  gap: 6px;
}

.input-row input {
  flex: 1;
  min-width: 0;
}

.submit-btn {
  background: var(--accent-blue);
  color: #fff;
  padding: 6px 14px;
  font-weight: 600;
  white-space: nowrap;
}
.submit-btn:hover:not(:disabled) { background: #5aa3e8; }

.reload-btn {
  background: var(--bg-card);
  color: var(--text-muted);
  padding: 6px 9px;
  font-size: 15px;
  line-height: 1;
  border: 1px solid var(--border);
  white-space: nowrap;
  flex-shrink: 0;
}
.reload-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }

.error-msg {
  margin-top: 6px;
  color: var(--wipe-red);
  font-size: 12px;
}

.saved-section {
  margin-top: 10px;
}

.saved-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.saved-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 3px;
}

.saved-btn {
  flex: 1;
  background: var(--bg-card);
  color: var(--text-primary);
  padding: 4px 8px;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.saved-btn:hover { background: var(--bg-hover); }

.del-btn {
  background: transparent;
  color: var(--text-muted);
  padding: 4px 6px;
  font-size: 11px;
}
.del-btn:hover { color: var(--wipe-red); }
</style>
