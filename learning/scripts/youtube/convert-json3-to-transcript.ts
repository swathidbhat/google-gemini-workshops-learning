/**
 * Convert yt-dlp json3 subtitle format to audio-transcript.json format
 * compatible with extract-concepts.ts, enrich-concepts.ts, etc.
 *
 * Usage:
 *   npx tsx scripts/youtube/convert-json3-to-transcript.ts <video-id>
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, readdirSync } from 'fs';

interface Json3Seg {
  utf8: string;
  tOffsetMs?: number;
  acAsrConf?: number;
}

interface Json3Event {
  tStartMs: number;
  dDurationMs?: number;
  wWinId?: number;
  segs?: Json3Seg[];
}

interface Json3 {
  events: Json3Event[];
}

interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  confidence: number;
}

interface AudioTranscript {
  audio_file: string;
  total_duration: number;
  segments: TranscriptSegment[];
  full_transcript: string;
  transcribed_at: string;
}

function findJson3File(videoDir: string): string {
  const files = readdirSync(videoDir);
  const json3 = files.find(f => f.endsWith('.json3'));
  if (!json3) throw new Error(`No .json3 file found in ${videoDir}`);
  return path.join(videoDir, json3);
}

// Group raw caption events into sentence-like segments of ~10 seconds max
function buildSegments(events: Json3Event[], chunkSeconds = 10): TranscriptSegment[] {
  // Only process events that have subtitle segs and a window ID (actual captions)
  const captionEvents = events.filter(e => e.segs && e.wWinId);

  const segments: TranscriptSegment[] = [];
  let currentText = '';
  let currentStart = 0;
  let chunkStart = -1;

  for (const event of captionEvents) {
    if (!event.segs) continue;

    const eventStartSec = event.tStartMs / 1000;
    const eventDurSec = (event.dDurationMs ?? 2000) / 1000;
    const eventEndSec = eventStartSec + eventDurSec;

    // Build full text for this event by joining word segs
    const text = event.segs
      .map(s => s.utf8)
      .join('')
      .replace(/\n/g, ' ')
      .trim();

    if (!text) continue;

    if (chunkStart < 0) {
      chunkStart = eventStartSec;
      currentStart = eventStartSec;
    }

    currentText += (currentText ? ' ' : '') + text;

    // Flush chunk when it exceeds chunkSeconds or ends with sentence-ending punctuation
    const endsWithPunct = /[.!?]$/.test(currentText.trim());
    const chunkDur = eventEndSec - chunkStart;

    if (chunkDur >= chunkSeconds || (endsWithPunct && chunkDur >= 3)) {
      segments.push({
        text: currentText.trim(),
        start: chunkStart,
        end: eventEndSec,
        confidence: 0.9,
      });
      currentText = '';
      chunkStart = -1;
    }
  }

  // Flush any remaining text
  if (currentText.trim() && chunkStart >= 0) {
    const lastEvent = captionEvents[captionEvents.length - 1];
    const endSec = (lastEvent.tStartMs + (lastEvent.dDurationMs ?? 2000)) / 1000;
    segments.push({
      text: currentText.trim(),
      start: chunkStart,
      end: endSec,
      confidence: 0.9,
    });
  }

  return segments;
}

async function convert(videoId: string): Promise<void> {
  const videoDir = path.join(process.cwd(), 'youtube', videoId);

  if (!existsSync(videoDir)) {
    throw new Error(`Video directory not found: ${videoDir}`);
  }

  const json3Path = findJson3File(videoDir);
  console.log(`📖 Reading: ${json3Path}`);

  const raw: Json3 = JSON.parse(await fs.readFile(json3Path, 'utf-8'));

  const segments = buildSegments(raw.events);
  console.log(`✅ Built ${segments.length} segments`);

  const totalDuration = segments.length > 0 ? segments[segments.length - 1].end : 0;
  const fullTranscript = segments.map(s => s.text).join(' ');

  const output: AudioTranscript = {
    audio_file: json3Path,
    total_duration: totalDuration,
    segments,
    full_transcript: fullTranscript,
    transcribed_at: new Date().toISOString(),
  };

  const outPath = path.join(videoDir, 'audio-transcript.json');
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));

  const hours = Math.floor(totalDuration / 3600);
  const mins = Math.floor((totalDuration % 3600) / 60);
  console.log(`⏱️  Duration: ${hours}h ${mins}m`);
  console.log(`📝 Full transcript length: ${fullTranscript.length.toLocaleString()} chars`);
  console.log(`💾 Saved to: ${outPath}`);
}

const videoId = process.argv[2];
if (!videoId) {
  console.error('Usage: npx tsx scripts/youtube/convert-json3-to-transcript.ts <video-id>');
  process.exit(1);
}

convert(videoId).catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
