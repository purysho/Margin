-- Margin schema v1. Times are unix milliseconds. IDs are random URL-safe strings.

CREATE TABLE teachers (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,           -- pbkdf2$<iterations>$<salt b64>$<hash b64>
  ai_provider   TEXT NOT NULL DEFAULT 'free',  -- free (Workers AI) | demo (rules) | anthropic | gemini
  ai_model      TEXT,                    -- null = provider default
  created_at    INTEGER NOT NULL
);

-- Only a SHA-256 hash of the session token is stored, so a database leak
-- does not leak usable sessions.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  teacher_id  TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_teacher ON sessions(teacher_id);

-- Bring-your-own-key: AES-GCM encrypted with KEY_ENCRYPTION_SECRET. Never returned to the client.
CREATE TABLE provider_keys (
  teacher_id  TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,
  ciphertext  TEXT NOT NULL,
  iv          TEXT NOT NULL,
  hint        TEXT NOT NULL,             -- last 4 chars, so the UI can show which key is saved
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (teacher_id, provider)
);

CREATE TABLE rubrics (
  id          TEXT PRIMARY KEY,
  teacher_id  TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE criteria (
  id           TEXT PRIMARY KEY,
  rubric_id    TEXT NOT NULL REFERENCES rubrics(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  max_score    INTEGER NOT NULL CHECK (max_score BETWEEN 1 AND 10),
  descriptors  TEXT NOT NULL             -- JSON array, index = score, value = what that band looks like
);
CREATE INDEX criteria_rubric ON criteria(rubric_id, position);

CREATE TABLE assignments (
  id          TEXT PRIMARY KEY,
  teacher_id  TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  rubric_id   TEXT NOT NULL REFERENCES rubrics(id),
  title       TEXT NOT NULL,
  task        TEXT NOT NULL,             -- the writing prompt students answer
  cefr_level  TEXT NOT NULL,             -- A1..C2, tunes feedback language
  join_code   TEXT NOT NULL UNIQUE,
  is_open     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);
CREATE INDEX assignments_teacher ON assignments(teacher_id, created_at);

-- Students have no accounts. They get a private receipt link; only its hash is stored.
CREATE TABLE submissions (
  id            TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_name  TEXT NOT NULL,
  body          TEXT NOT NULL,
  word_count    INTEGER NOT NULL,
  receipt_hash  TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'submitted', -- submitted | drafted | released
  created_at    INTEGER NOT NULL
);
CREATE INDEX submissions_assignment ON submissions(assignment_id, created_at);

-- Every AI call is kept, so quality can be compared across prompt versions and models.
CREATE TABLE ai_drafts (
  id             TEXT PRIMARY KEY,
  submission_id  TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  output         TEXT NOT NULL,          -- validated JSON (see shared/feedback.ts)
  dropped_quotes INTEGER NOT NULL,       -- annotations removed because the quote was not in the essay
  latency_ms     INTEGER NOT NULL,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  created_at     INTEGER NOT NULL
);
CREATE INDEX ai_drafts_submission ON ai_drafts(submission_id, created_at);

-- The teacher's decision on each criterion. ai_* columns are copied from the draft so
-- agreement metrics survive even if drafts are pruned.
CREATE TABLE review_scores (
  submission_id  TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  criterion_id   TEXT NOT NULL REFERENCES criteria(id),
  draft_id       TEXT NOT NULL REFERENCES ai_drafts(id),
  ai_score       INTEGER NOT NULL,
  teacher_score  INTEGER NOT NULL,
  ai_comment     TEXT NOT NULL,
  final_comment  TEXT NOT NULL,
  PRIMARY KEY (submission_id, criterion_id)
);

CREATE TABLE review_annotations (
  id             TEXT PRIMARY KEY,
  submission_id  TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  draft_id       TEXT REFERENCES ai_drafts(id),  -- null = added by the teacher
  quote          TEXT NOT NULL,
  start_offset   INTEGER NOT NULL,
  end_offset     INTEGER NOT NULL,
  category       TEXT NOT NULL,
  ai_comment     TEXT,
  final_comment  TEXT,
  decision       TEXT NOT NULL            -- accepted | edited | rejected | added
);
CREATE INDEX review_annotations_submission ON review_annotations(submission_id);

CREATE TABLE reviews (
  submission_id  TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  draft_id       TEXT NOT NULL REFERENCES ai_drafts(id),
  ai_summary     TEXT NOT NULL,
  final_summary  TEXT NOT NULL,
  released_at    INTEGER NOT NULL
);
