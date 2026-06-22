/**
 * Native audio-track probe for MKV and MP4 containers.
 * Uses only Node.js built-ins — no ffprobe or external tools required.
 */

import { openSync, readSync, closeSync, fstatSync, existsSync } from 'fs'

export interface AudioTrackInfo {
  index: number   // 0-based index among audio streams (matches ffmpeg -map 0:a:<index>)
  title: string
  language: string
}

// ─── File I/O helpers ──────────────────────────────────────────────────────────

function readAt(filePath: string, offset: number, length: number): Buffer {
  const fd = openSync(filePath, 'r')
  const buf = Buffer.alloc(length)
  const n = readSync(fd, buf, 0, length, offset)
  closeSync(fd)
  return buf.slice(0, n)
}

function fileSize(filePath: string): number {
  const fd = openSync(filePath, 'r')
  const s = fstatSync(fd).size
  closeSync(fd)
  return s
}

// ─── EBML primitives (MKV / WebM) ─────────────────────────────────────────────

/** Read an EBML Variable-Length Integer (size encoding — leading width bits masked out). */
function readVint(buf: Buffer, pos: number): { value: number; n: number } | null {
  if (pos >= buf.length) return null
  const b = buf[pos]
  const widths = [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01]
  const masks  = [0x7F, 0x3F, 0x1F, 0x0F, 0x07, 0x03, 0x01, 0x00]
  for (let i = 0; i < 8; i++) {
    if (b & widths[i]) {
      const n = i + 1
      if (pos + n > buf.length) return null
      let v = b & masks[i]
      for (let j = 1; j < n; j++) v = v * 256 + buf[pos + j]
      return { value: v, n }
    }
  }
  return null
}

/** Read an EBML element ID (width bits are KEPT in the ID value). */
function readEbmlId(buf: Buffer, pos: number): { id: number; n: number } | null {
  if (pos >= buf.length) return null
  const b = buf[pos]
  const widths = [0x80, 0x40, 0x20, 0x10]
  for (let i = 0; i < 4; i++) {
    if (b & widths[i]) {
      const n = i + 1
      if (pos + n > buf.length) return null
      let id = 0
      for (let j = 0; j < n; j++) id = id * 256 + buf[pos + j]
      return { id, n }
    }
  }
  return null
}

// "Unknown" size sentinel per VINT length (all data bits set).
const VINT_UNKNOWN = [0, 0x7F, 0x3FFF, 0x1FFFFF, 0x0FFFFFFF]

interface EbmlEl { id: number; start: number; end: number }

function parseEbml(buf: Buffer, from = 0, to = buf.length): EbmlEl[] {
  const els: EbmlEl[] = []
  let pos = from
  while (pos < to) {
    const id = readEbmlId(buf, pos)
    if (!id) break
    pos += id.n
    const sz = readVint(buf, pos)
    if (!sz) break
    pos += sz.n
    // Treat as "rest of buffer" if unknown-size or would exceed buffer
    const elEnd = (sz.n <= 4 && sz.value === VINT_UNKNOWN[sz.n])
      ? to
      : Math.min(pos + sz.value, to)
    els.push({ id: id.id, start: pos, end: elEnd })
    pos = elEnd
  }
  return els
}

// ─── MKV / WebM probe ─────────────────────────────────────────────────────────

const MKV_ID = {
  EBML:       0x1A45DFA3,
  SEGMENT:    0x18538067,
  TRACKS:     0x1654AE6B,
  TRACK_ENTRY:   0xAE,
  TRACK_TYPE:    0x83,  // value 2 = audio
  NAME:          0x536E,
  LANGUAGE:      0x22B59C,
  LANGUAGE_IETF: 0x22B59D,
}

function probeMkv(filePath: string): AudioTrackInfo[] {
  // Tracks element is always in the first few hundred KB of a well-formed MKV.
  const buf = readAt(filePath, 0, 512 * 1024)
  if (buf.length < 4 || buf.readUInt32BE(0) !== MKV_ID.EBML) return []

  // Top level → Segment → Tracks
  const segEl = parseEbml(buf).find(e => e.id === MKV_ID.SEGMENT)
  if (!segEl) return []
  const tracksEl = parseEbml(buf, segEl.start, segEl.end).find(e => e.id === MKV_ID.TRACKS)
  if (!tracksEl) return []

  const tracks: AudioTrackInfo[] = []
  let audioIdx = 0

  for (const entry of parseEbml(buf, tracksEl.start, tracksEl.end)) {
    if (entry.id !== MKV_ID.TRACK_ENTRY) continue

    let trackType = 0
    let name = ''
    let lang = ''

    for (const f of parseEbml(buf, entry.start, entry.end)) {
      switch (f.id) {
        case MKV_ID.TRACK_TYPE:
          trackType = buf[f.start] ?? 0
          break
        case MKV_ID.NAME:
          name = buf.slice(f.start, f.end).toString('utf8').replace(/\0/g, '').trim()
          break
        case MKV_ID.LANGUAGE:
        case MKV_ID.LANGUAGE_IETF:
          if (!lang) lang = buf.slice(f.start, f.end).toString('utf8').replace(/\0/g, '').trim()
          break
      }
    }

    if (trackType === 2 /* audio */) {
      tracks.push({ index: audioIdx++, title: name || `Track ${audioIdx}`, language: lang })
    }
  }

  return tracks
}

// ─── MP4 / M4V / MOV probe ────────────────────────────────────────────────────

interface Mp4Box { type: string; start: number; end: number }

function parseMp4Boxes(buf: Buffer, from: number, to: number): Mp4Box[] {
  const boxes: Mp4Box[] = []
  let pos = from
  while (pos <= to - 8) {
    const size = buf.readUInt32BE(pos)
    if (size < 8) break
    const type = buf.slice(pos + 4, pos + 8).toString('latin1')
    const boxEnd = Math.min(pos + size, to)
    boxes.push({ type, start: pos + 8, end: boxEnd })
    pos = boxEnd
  }
  return boxes
}

function findBox(buf: Buffer, from: number, to: number, type: string): Mp4Box | undefined {
  return parseMp4Boxes(buf, from, to).find(b => b.type === type)
}

function probeMp4(filePath: string): AudioTrackInfo[] {
  const CHUNK = 4 * 1024 * 1024
  const size = fileSize(filePath)

  // Try head first (faststart MP4), then tail (typical recording where moov is at end)
  for (const offset of [0, Math.max(0, size - CHUNK)]) {
    const buf = readAt(filePath, offset, Math.min(CHUNK, size - offset))
    const moov = parseMp4Boxes(buf, 0, buf.length).find(b => b.type === 'moov')
    if (!moov) continue

    const tracks: AudioTrackInfo[] = []
    let audioIdx = 0

    for (const trak of parseMp4Boxes(buf, moov.start, moov.end).filter(b => b.type === 'trak')) {
      const mdia = findBox(buf, trak.start, trak.end, 'mdia')
      if (!mdia) continue

      const hdlr = findBox(buf, mdia.start, mdia.end, 'hdlr')
      if (!hdlr || hdlr.end - hdlr.start < 12) continue
      // hdlr payload: version(1) + flags(3) + pre_defined(4) + handler_type(4)
      if (buf.slice(hdlr.start + 8, hdlr.start + 12).toString('latin1') !== 'soun') continue

      // Handler name follows handler_type; may be prefixed with a null byte
      const rawName = buf.slice(hdlr.start + 12, hdlr.end).toString('utf8').replace(/\0/g, '').trim()

      // Language from mdhd (version 0: packed ISO-639-2/T 3×5-bit chars at byte 20)
      let lang = ''
      const mdhd = findBox(buf, mdia.start, mdia.end, 'mdhd')
      if (mdhd && mdhd.end - mdhd.start >= 22) {
        const lv = buf.readUInt16BE(mdhd.start + 20)
        const l = [10, 5, 0].map(s => String.fromCharCode(((lv >> s) & 0x1F) + 0x60)).join('')
        if (l !== 'und' && !/\0/.test(l)) lang = l
      }

      tracks.push({ index: audioIdx++, title: rawName || `Track ${audioIdx}`, language: lang })
    }

    if (tracks.length > 0) return tracks
  }

  return []
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function probeAudioTracks(filePath: string): AudioTrackInfo[] {
  if (!existsSync(filePath)) return []
  const ext = (filePath.match(/\.([^.]+)$/) ?? [])[1]?.toLowerCase() ?? ''
  try {
    if (ext === 'mkv' || ext === 'webm') return probeMkv(filePath)
    if (ext === 'mp4' || ext === 'm4v' || ext === 'mov') return probeMp4(filePath)
  } catch (e) {
    console.error('[mediaprobe] probe failed:', e)
  }
  return []
}
