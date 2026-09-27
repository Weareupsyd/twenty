-- Nested KYB - resolving corporate owners to natural persons.
--
-- A corporate shareholder is a hole in the ownership graph: until we know who
-- owns IT, we do not know who owns the company. This migration lets a business
-- session own child business sessions, so the chain can be walked to the
-- natural persons at the end of it.
--
-- Three columns carry the structure:
--   parent_session_id - who spawned this session (NULL for a root)
--   root_session_id   - the top of the tree, so the whole chain is one query
--   depth             - 0 for a root; guards against runaway nesting
--
-- Circular ownership is real (A owns B, B owns A is a common offshore
-- structure) so depth is enforced in the database as well as in code - a
-- recursion bug must not be able to write an unbounded chain.

-- CASCADE, matching how a session's documents and screenings are already tied
-- to it: deleting a company removes the child sessions that exist only to
-- resolve that company's ownership. Note this deletes the WHOLE subtree, which
-- is what a retention/erasure run should do - a subsidiary session has no
-- meaning once the company it was opened for is gone.
ALTER TABLE business_sessions
  ADD COLUMN IF NOT EXISTS parent_session_id UUID
    REFERENCES business_sessions(id) ON DELETE CASCADE;

ALTER TABLE business_sessions
  ADD COLUMN IF NOT EXISTS root_session_id UUID
    REFERENCES business_sessions(id) ON DELETE CASCADE;

ALTER TABLE business_sessions
  ADD COLUMN IF NOT EXISTS depth INTEGER NOT NULL DEFAULT 0;

-- The key person this session was spawned to resolve. Lets the parent link a
-- child session back to the specific corporate shareholder it represents.
ALTER TABLE business_sessions
  ADD COLUMN IF NOT EXISTS spawned_for_key_person_id UUID
    REFERENCES business_key_people(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_business_sessions_parent ON business_sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_business_sessions_root ON business_sessions(root_session_id);

DO $$
BEGIN
  -- Hard ceiling on nesting. Five layers is deeper than any legitimate
  -- structure we expect; beyond that something is wrong and an analyst should
  -- look rather than the system spawning sessions forever.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_sessions_depth_check') THEN
    ALTER TABLE business_sessions
      ADD CONSTRAINT business_sessions_depth_check CHECK (depth >= 0 AND depth <= 5);
  END IF;

  -- A session cannot be its own parent. Deeper cycles are caught in code
  -- (walkAncestry) because SQL cannot express them cheaply, but the trivial
  -- self-reference is worth blocking outright.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_sessions_no_self_parent') THEN
    ALTER TABLE business_sessions
      ADD CONSTRAINT business_sessions_no_self_parent CHECK (parent_session_id IS DISTINCT FROM id);
  END IF;
END $$;

-- Effective ownership: a natural person's stake THROUGH the chain.
--
-- If Amina owns 50% of Holdco and Holdco owns 20% of the company, Amina's
-- effective stake is 10%. FATF thresholds apply to the effective figure, not
-- the direct one, so it is stored rather than recomputed ad hoc.
ALTER TABLE business_key_people
  ADD COLUMN IF NOT EXISTS effective_ownership_percentage NUMERIC(9,6);

-- Where a person sits in the tree, for display: 'Acme > Holdco > Amina'.
ALTER TABLE business_key_people
  ADD COLUMN IF NOT EXISTS ownership_path TEXT;
