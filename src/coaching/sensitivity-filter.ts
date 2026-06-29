/**
 * Sensitivity Filter — intervention_override exclusion
 *
 * Factors with zero_reason === 'intervention_override' are decision levers,
 * not uncertainty drivers. They should not appear in sensitivity output sent
 * to the review prompt or the UI.
 *
 * This is a PLoT output filter only — ISL request/response is not mutated.
 *
 * The implementation lives in the import-free neutral leaf
 * `src/lib/intervention-override.ts` (single definition; A1b). This module
 * re-exports it so existing coaching-side importers are unaffected.
 */

export { isInterventionOverride, filterInterventionOverrides } from '../lib/intervention-override.js';
