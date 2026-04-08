## Keeping Everything in Sync

When making changes to the Anchor program (instructions, accounts, types):
1. **Anchor program** — implement the change in `anchor/programs/perps/src/`
2. **Build & IDL** — run `anchor build` to regenerate the IDL at `anchor/target/idl/perps.json`
3. **Generated types** — run `npx codama run js` to regenerate TypeScript types in `app/generated/perps/`
4. **Frontend hooks** — create or update the corresponding hook in `app/hooks/` (e.g. `useUpdatePosition.ts`)
5. **Tests** — update `anchor/tests/full-flow-test.ts` with test coverage for the new/changed instruction
6. **Frontend build** — run `npx next build` to verify the app compiles

Never edit files in `app/generated/` directly — they are overwritten by Codama.
