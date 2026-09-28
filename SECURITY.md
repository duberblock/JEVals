# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| `main` (latest release line) | ✅ |
| anything older | ❌ |

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Please use GitHub's **private vulnerability reporting** on this repository
(Report a vulnerability → Security tab), or contact the maintainer directly
through the channels listed in [author.md](author.md). Include:

- a description of the issue and its impact,
- steps or a proof of concept to reproduce it,
- affected components (API, web, provider integrations),
- any suggested mitigation.

You will get an acknowledgment within a few days, and we will keep you
informed as the fix progresses. Coordinated disclosure is appreciated —
please give us a reasonable window before publishing details.

## Scope notes specific to this project

- JEVals handles **third-party API keys** (LLM and JEV providers). Keys
  configured through the app's Settings page are encrypted at rest with a
  Fernet key that never leaves the host. Vulnerabilities that could expose
  stored keys, decrypt them, or leak them into logs, snapshots, or responses
  are treated as high severity.
- Execution snapshots persist provider **evidence by design** (prompts, raw
  responses, run configuration). Reports that show credentials or
  authorization material reaching a persisted snapshot or an API response are
  in scope — the redaction pipeline is a security boundary.
- The e2e suites and scripts must never require live provider keys; a change
  that forces network calls or real credentials into the hermetic test path
  is a regression, not just a test smell.

## What is out of scope

- Issues in third-party provider services (OpenAI, z.ai, Ollama, Simple Jev,
  typesafe.ai) — report those to the provider.
- Volumetric attacks (DoS) against your own self-hosted instance without a
  concrete confidentiality or integrity impact.
