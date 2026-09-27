-- Phase 1: schemas that keep the two runtimes from colliding.
--   public       - Kabila (subjects live in public.users)
--   aml          - AML Screening (staff live in aml.users)
--   compliance   - merged operator identities + new shared tables
CREATE SCHEMA IF NOT EXISTS aml;
CREATE SCHEMA IF NOT EXISTS compliance;
