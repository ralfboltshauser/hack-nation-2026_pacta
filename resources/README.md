# Resources

This directory preserves the materials supplied at project kickoff on 2026-07-18.

## Source-of-truth policy

- `originals/` contains byte-for-byte copies of supplied attachments under stable, descriptive names. Treat these as immutable.
- `notes/` contains user-authored working notes. Their wording is preserved and their claims are not assumed to be verified.
- `extracted/` contains mechanically generated convenience material. It may contain layout or OCR/text-extraction errors; consult the original PDF when exact wording or visual context matters.
- `checksums.sha256` records the current artifact hashes so accidental changes can be detected with `sha256sum -c resources/checksums.sha256` from the repository root.

## Artifact manifest

| Stable path | Supplied filename | Description |
| --- | --- | --- |
| `originals/elevenlabs-the-negotiator-challenge-brief.pdf` | `1784382172163-01-ElevenLabs-The-Negotiator.docx.pdf` | Six-page official challenge brief |
| `originals/conversation-requirement.png` | `codex-clipboard-a5e36981-0eb9-43f5-8d33-924c0b8913da.png` | Screenshot of “The Conversation Requirement” |
| `originals/success-criteria.png` | `codex-clipboard-186e712d-26b5-49a7-b4de-79f3f2d3c7f8.png` | Screenshot of “Success Criteria” |
| `notes/initial-project-notes.md` | User message | Verbatim kickoff ideas and checklist |
| `extracted/elevenlabs-the-negotiator-challenge-brief.txt` | Derived from the PDF with `pdftotext -layout` | Searchable convenience extraction |

## Quick links

- [Challenge brief](originals/elevenlabs-the-negotiator-challenge-brief.pdf)
- [Conversation requirement](originals/conversation-requirement.png)
- [Success criteria](originals/success-criteria.png)
- [Initial project notes](notes/initial-project-notes.md)
- [Extracted challenge text](extracted/elevenlabs-the-negotiator-challenge-brief.txt)
