<template>
  <div class="settings-overlay" @click.self="$emit('close')">
    <div class="settings-panel">
      <div class="panel-header">
        <span>Settings</span>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>

      <div class="panel-body">
        <div class="section">
          <div class="section-label">Player backend</div>
          <div class="radio-group">
            <label class="radio-label">
              <input type="radio" value="mpv" :checked="playerBackend === 'mpv'" @change="setBackend('mpv')" />
              mpv <span class="radio-hint">(recommended — frame stepping, fast audio track switching)</span>
            </label>
            <label class="radio-label">
              <input type="radio" value="html5" :checked="playerBackend === 'html5'" @change="setBackend('html5')" />
              HTML5 <span class="radio-hint">(built-in, no mpv required)</span>
            </label>
          </div>
          <div v-if="backendChanged" class="restart-note">Restart required to apply.</div>
        </div>

        <div class="divider" />

        <div class="section">
          <div class="section-label">Pull percentage display</div>
          <div class="radio-group">
            <label class="radio-label">
              <input type="radio" value="fight" :checked="pullPctMode === 'fight'" @change="setPullPctMode('fight')" />
              Fight% <span class="radio-hint">(% of fight remaining overall)</span>
            </label>
            <label class="radio-label">
              <input type="radio" value="boss" :checked="pullPctMode === 'boss'" @change="setPullPctMode('boss')" />
              Boss% <span class="radio-hint">(% of boss HP remaining in current phase)</span>
            </label>
          </div>
        </div>

        <div class="divider" />

        <p class="help-text">
          FFLogs API credentials are required to load reports.
          Get yours at
          <a href="https://www.fflogs.com/api/clients/" target="_blank">fflogs.com/api/clients</a>.
        </p>

        <label class="field">
          <span>Client ID</span>
          <input v-model="clientId" type="text" placeholder="FFLogs client ID" autocomplete="off" />
        </label>

        <label class="field">
          <span>Client Secret</span>
          <input v-model="clientSecret" type="password" placeholder="FFLogs client secret" autocomplete="off" />
        </label>

        <div class="actions">
          <button class="save-btn" @click="save">Save</button>
          <button class="test-btn" @click="test" :disabled="testing || !clientId || !clientSecret">
            {{ testing ? 'Testing…' : 'Test connection' }}
          </button>
        </div>
        <div v-if="testResult" class="test-result" :class="testResult.ok ? 'ok' : 'fail'">
          {{ testResult.ok ? '✓ Connected successfully' : '✗ ' + testResult.error }}
        </div>
        <span v-if="saved" class="saved-msg">Saved!</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted } from 'vue'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pullPctModeChange', mode: 'fight' | 'boss'): void
}>()

const clientId = ref('')
const clientSecret = ref('')
const saved = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; error?: string } | null>(null)
const playerBackend = ref<'mpv' | 'html5'>('mpv')
const backendChanged = ref(false)
const pullPctMode = ref<'fight' | 'boss'>('fight')

onMounted(async () => {
  clientId.value = (await window.api.storeGet('fflogsClientId') as string) ?? ''
  clientSecret.value = (await window.api.storeGet('fflogsClientSecret') as string) ?? ''
  playerBackend.value = ((await window.api.storeGet('playerBackend')) as 'mpv' | 'html5') ?? 'mpv'
  pullPctMode.value = ((await window.api.storeGet('pullPctMode')) as 'fight' | 'boss') ?? 'fight'
})

async function setBackend(val: 'mpv' | 'html5') {
  playerBackend.value = val
  await window.api.storeSet('playerBackend', val)
  backendChanged.value = true
}

async function setPullPctMode(val: 'fight' | 'boss') {
  pullPctMode.value = val
  await window.api.storeSet('pullPctMode', val)
  emit('pullPctModeChange', val)
}

async function save() {
  await window.api.storeSet('fflogsClientId', clientId.value.trim())
  await window.api.storeSet('fflogsClientSecret', clientSecret.value.trim())
  saved.value = true
  setTimeout(() => { saved.value = false }, 2000)
}

async function test() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await window.api.testCredentials(clientId.value.trim(), clientSecret.value.trim())
  } finally {
    testing.value = false
  }
}
</script>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.settings-panel {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 400px;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-card);
  font-weight: 600;
  font-size: 14px;
}

.close-btn {
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  padding: 2px 6px;
}
.close-btn:hover { color: var(--text-primary); }

.panel-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.help-text {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.help-text a {
  color: var(--accent-blue);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.field input {
  width: 100%;
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.save-btn {
  background: var(--accent-blue);
  color: #fff;
  padding: 7px 20px;
  font-weight: 600;
}
.save-btn:hover { background: #5aa3e8; }

.test-btn {
  background: var(--bg-card);
  color: var(--text-primary);
  padding: 7px 14px;
  border: 1px solid var(--border);
}
.test-btn:hover:not(:disabled) { background: var(--bg-hover); }

.test-result {
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.4;
  word-break: break-word;
}
.test-result.ok { background: #0d2e0d; color: #90ee90; border: 1px solid #2a6a2a; }
.test-result.fail { background: #2e0d0d; color: #ff8a80; border: 1px solid #6a2a2a; }

.saved-msg {
  color: var(--kill-green);
  font-size: 13px;
}

.section { display: flex; flex-direction: column; gap: 8px; }
.section-label { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.radio-group { display: flex; flex-direction: column; gap: 6px; }
.radio-label {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}
.radio-hint { font-size: 11px; color: var(--text-muted); }
.restart-note { font-size: 11px; color: #e8a040; }
.divider { border: none; border-top: 1px solid var(--border); margin: 0; }
</style>
