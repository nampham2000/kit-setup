# Playable SDK AI Catalog

This `.github` folder is the shared home for Copilot prompts, skills, and custom agents that belong to `playable-shared-kit`.

## Structure

- `copilot-instructions.md`: always-on repo guidance for package-specific AI behaviors.
- `agents/`: custom agents for workflows that need their own role and guardrails.
- `prompts/`: one-shot prompts for common SDK tasks.
- `skills/`: reusable multi-step workflows with references and assets.

## Current SDK Coverage

- `analytics`
  - Agent: `agents/playable-sdk-analytics.agent.md`
  - Prompt: `prompts/setup-playable-sdk-analytics.prompt.md`
  - Skill: `skills/playable-sdk-analytics/SKILL.md`

## Add A New Playable SDK AI Package

1. Create one skill at `skills/playable-sdk-<name>/SKILL.md`.
2. Add at least one prompt in `prompts/` for the most common setup task.
3. Add a custom agent in `agents/` when the SDK needs its own implementation workflow.
4. Put checklists, templates, and references inside the skill folder.
5. Always spell out which project-specific values the user must still configure.

## Workspace Note

VS Code auto-discovers prompts, skills, and agents from the workspace-root `.github` folder.

If `playable-shared-kit` is opened as a submodule inside another game workspace, keep this folder here as the source of truth and mirror it to the consumer workspace root when you want Copilot to auto-discover the same customizations there.