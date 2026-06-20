<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Keyboard Shortcuts</span>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      <div class="modal-body">

        <div class="section-label">Playback</div>
        <div class="row"><div class="keys"><kbd>Space</kbd></div><span>Play / Pause</span></div>
        <div class="row"><div class="keys"><kbd>←</kbd><kbd>→</kbd></div><span>Seek ±5 s</span></div>
        <div class="row"><div class="keys"><kbd>Shift</kbd><span class="plus">+</span><kbd>←</kbd><kbd>→</kbd></div><span>Seek ±30 s</span></div>
        <div class="row"><div class="keys"><kbd>Ctrl</kbd><span class="plus">+</span><kbd>←</kbd><kbd>→</kbd></div><span>Step one frame</span></div>
        <div class="row"><div class="keys"><kbd>↑</kbd><kbd>↓</kbd></div><span>Volume ±10%</span></div>
        <div class="row"><div class="keys"><kbd>M</kbd></div><span>Toggle mute</span></div>

        <div class="section-label">Sync</div>
        <div class="row"><div class="keys"><kbd>[</kbd><kbd>]</kbd></div><span>Offset ±500 ms</span></div>
        <div class="row"><div class="keys"><kbd>S</kbd></div><span>Sync offset to current video position</span></div>

        <div class="section-label">Navigation</div>
        <div class="row"><div class="keys"><kbd>N</kbd></div><span>Next pull</span></div>
        <div class="row"><div class="keys"><kbd>P</kbd></div><span>Previous pull</span></div>

        <div class="section-label">App</div>
        <div class="row"><div class="keys"><kbd>R</kbd></div><span>Reload video + report</span></div>
        <div class="row"><div class="keys"><kbd>Ctrl</kbd><span class="plus">+</span><kbd>O</kbd></div><span>Open video file</span></div>
        <div class="row"><div class="keys"><kbd>?</kbd></div><span>Toggle this panel</span></div>
        <div class="row"><div class="keys"><kbd>Esc</kbd></div><span>Close modal</span></div>

      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
defineEmits<{ (e: 'close'): void }>()
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  width: 420px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.modal-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 3px;
}
.close-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

.modal-body {
  overflow-y: auto;
  padding: 14px 16px;
}

.section-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-muted);
  margin: 14px 0 6px;
}
.section-label:first-child { margin-top: 0; }

.row {
  display: grid;
  grid-template-columns: 160px 1fr;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  min-height: 22px;
}

.keys {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-wrap: nowrap;
}

.plus {
  font-size: 11px;
  color: var(--text-muted);
  padding: 0 1px;
}

kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-card);
  border: 1px solid #555;
  border-bottom-width: 2px;
  border-radius: 3px;
  padding: 1px 6px;
  font-family: inherit;
  font-size: 11px;
  color: var(--text-primary);
  white-space: nowrap;
  line-height: 1.4;
}
</style>
