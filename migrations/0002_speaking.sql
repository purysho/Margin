-- Speaking: assignments and rubrics have a skill; submissions can be audio.

ALTER TABLE assignments ADD COLUMN skill TEXT NOT NULL DEFAULT 'writing';  -- writing | speaking
ALTER TABLE rubrics ADD COLUMN skill TEXT NOT NULL DEFAULT 'writing';

ALTER TABLE submissions ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';     -- text | audio
ALTER TABLE submissions ADD COLUMN duration_ms INTEGER;                   -- audio length
ALTER TABLE submissions ADD COLUMN speech TEXT;                           -- JSON: word timings, unsure segments, measures
ALTER TABLE submissions ADD COLUMN transcript_raw TEXT;                   -- speech recogniser output, before teacher corrections
ALTER TABLE submissions ADD COLUMN transcript_edited_at INTEGER;          -- drafts made before this are stale
ALTER TABLE submissions ADD COLUMN transcription_error TEXT;

-- Recordings live here only until feedback is released (or 30 days at most),
-- then they are deleted. Kept out of `submissions` so listing stays light.
CREATE TABLE audio_clips (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  mime          TEXT NOT NULL,
  bytes         BLOB NOT NULL,
  size          INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX audio_clips_created ON audio_clips(created_at);
