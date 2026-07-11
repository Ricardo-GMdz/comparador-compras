# Flujo de trabajo — PRs apilados (stacked PRs)

Convención del repo a partir de v2.1:

1. **Nada se mergea local a `main`**: todo cambio entra por Pull Request.
2. **Una rama por unidad de trabajo** (`feat/...`, `fix/...`, `docs/...`), chica
   y revisable. Los commits siguen conventional commits.
3. **Apilado**: si una feature depende de otra que aún no se mergeó, la rama
   nueva se crea SOBRE la rama anterior (no sobre main) y su PR usa esa rama
   como base. Al mergear la de abajo, GitHub re-apunta la de arriba a main.
   `stack: feat/a → feat/b (base: feat/a) → feat/c (base: feat/b)`
4. **Checks antes de pedir review**: typecheck + lint + test verdes (CI corre
   lo mismo). TDD en el desarrollo (test primero).
5. **Merge**: squash o fast-forward según el caso; borrar la rama al mergear.
