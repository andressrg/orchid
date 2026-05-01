# Risks & Mitigations

## Technical Risks

| Risk                                              | Severity | Mitigation                                                                |
| ------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| Claude Code hooks API changes                     | Medium   | Pin to specific version; hooks API has been stable since introduction     |
| Codex CLI changes storage format                  | Medium   | Abstract the parser; SQLite schema more stable than file layouts          |
| Git notes lost during squash/rebase               | High     | Implement note carry-over (git-memento's approach); add pre-rebase hook   |
| Large transcripts (multi-MB)                      | Low      | Compress before upload; summaries in DB, full transcripts in blob storage |
| Multi-tool sessions (Claude + Codex on same repo) | Medium   | Unified session-commit junction table; tool field distinguishes source    |

## Privacy & Security Risks

| Risk                                           | Severity     | Mitigation                                                                                               |
| ---------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| Secrets in conversations (API keys, passwords) | **Critical** | Scrubbing/redaction step before cloud sync; regex patterns for common secrets; allow per-session opt-out |
| Proprietary code in transcripts                | High         | Self-hosted option; encryption at rest; team-scoped access controls                                      |
| Conversation contains sensitive business logic | Medium       | Summarization mode that strips code blocks before syncing                                                |

## Product Risks

| Risk                                          | Severity | Mitigation                                                                       |
| --------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| Adoption friction (another tool to install)   | High     | Single `orchid init` command; GitHub Action for zero-install team visibility     |
| Conversation-to-commit mapping inaccuracy     | Medium   | Multiple correlation methods (hooks + timestamps + branch); manual correction UI |
| Information overload in PR review             | Medium   | Progressive disclosure; summaries by default, full transcript on demand          |
| GitHub changes DOM (breaks browser extension) | Medium   | Extension is Phase 2 enhancement, not core product; maintain selectors           |

## Business Risks

| Risk                                            | Severity   | Mitigation                                                             |
| ----------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| git-memento or SpecStory adds the same features | Medium     | Move fast; differentiation is the unified capture-to-review experience |
| GitHub adds native AI conversation support      | Low-Medium | Unlikely near-term; we'd pivot to be the cross-platform option         |
| Open-source commoditization                     | Low        | SaaS cloud sync + team features as moat                                |
