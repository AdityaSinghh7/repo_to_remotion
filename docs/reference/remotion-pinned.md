# Remotion Pinned Notes (Phase 1)

This file is intentionally pinned for deterministic prompt context in workflow runs.

## Baseline Constraints
- Target output: MP4
- Resolution: 1920x1080
- FPS: 30
- Typical duration target: 60-90 seconds

## Composition Guidance
- Define a single composition for the generated demo.
- Use deterministic scene ordering.
- Keep transitions simple: fade, slide, none.
- Ensure all referenced screenshot assets exist under `screenshots/`.

## Implementation Expectations
- Export composition from an entry file.
- Keep code self-contained and renderable in Node-based Remotion CLI execution.
- Avoid dynamic network fetches during render.
