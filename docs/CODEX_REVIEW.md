# Codex Review

_Written by Claude from Codex's verbatim output (scripts/codex-review.ps1; Codex sandbox was read-only). Validation: 1478 tests, lint and build pass._

Status: PASS_WITH_NOTES

Task: In-game recipe book

Summary: The recipe book derives entries and crafting instructions from the recipe registry, shows ingredient icons and availability, and integrates with the inventory and crafting screens.

Critical:
- None

Important:
- None

Minor:
- `RecipeBook` creates elements through the global `document` and positions tooltips using the global `window`, even though it receives an overlay with an `ownerDocument`. This can limit use in embedded or alternate-document contexts.

Required fixes:
- None

Tests:
- The added tests cover registry ordering, generated patterns and instructions, ingredient counts, craftability, ranking, and hint storage behavior. I reviewed the tests but did not run them.

Architecture:
- Recipe data and UI are separated; the book uses the registry rather than hard-coding recipes.

Performance:
- Entries are built once, and refresh avoids reordering the list when craftability is unchanged.

Reviewed files:
- `CLAUDE.md`
- `docs/ROADMAP.md`
- `docs/PROGRESS.md`
- `src/config/constants.ts`
- `src/crafting/RecipeRegistry.ts`
- `src/crafting/recipeBook.ts`
- `src/ui/InventoryScreen.ts`
- `src/ui/RecipeBook.ts`
- `src/ui/recipeHint.ts`
- `tests/recipeBook.test.ts`

Recommendation:
- Continue.
