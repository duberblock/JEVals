# Playground Architecture

BOUNDARY RULE

The jevals Playground is a self-contained child project.

All Playground-specific:
- source code
- dependencies
- configuration
- prompts
- database migrations
- containers
- tests
- scripts
- documentation
- generated artifacts

MUST live under /playground.

No Playground implementation file may be created
in the parent project root or in sibling directories.

## Source of truth

Parent planning documents and ADRs remain the canonical product and architectural source of truth.
Implementation artifacts live only in this child project.
