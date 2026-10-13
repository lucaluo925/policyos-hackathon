/**
 * What a deep item is allowed to assert.
 *
 * The index-level path has always refused to let a proposal change a policy's
 * status:
 *
 *   const applyStatusChange =
 *     cls.classification !== 'proposal_only' &&
 *     cls.classification !== 'uncertain' &&
 *     cls.classification !== 'no_material_change';
 *
 * The deep-item path had no equivalent. It wrote every item with a hardcoded
 * `changeType: 'guidance_update'`, `approvedState: 'active'` and
 * `setAsCurrent: true`, and let the V7 evidence tier move country scores. So
 * an EU trade *proposal* -- which eu-trade.ts explicitly types as a proposal --
 * became the current, active version of a policy, and a proposed number with
 * a direction moved the score as if it were in force. The run summary for the
 * same page said "proposal / consultation text changed. Does not modify active
 * policy." while the items underneath it did exactly that.
 *
 * One place for the rule, so the two paths cannot drift again.
 */

import type { DeepItem } from '../framework';

export interface DeepItemDisposition {
  changeType: 'proposal_only' | 'guidance_update';
  /** Whether this version becomes the policy's current state. */
  setAsCurrent: boolean;
  approvedState: 'active' | null;
  /** Whether V7 evidence from this item may move country scores. */
  mayMoveScores: boolean;
}

/**
 * A proposal is a proposal whichever field says so: eu-trade sets
 * guidanceType, and a pipeline may instead type it through policyType.
 */
export function isProposalItem(item: Pick<DeepItem, 'guidanceType' | 'policyType'>): boolean {
  return item.guidanceType === 'proposal' || item.policyType === 'proposal';
}

export function deepItemDisposition(
  item: Pick<DeepItem, 'guidanceType' | 'policyType'>,
): DeepItemDisposition {
  if (isProposalItem(item)) {
    return {
      changeType: 'proposal_only',
      setAsCurrent: false,
      approvedState: null,
      mayMoveScores: false,
    };
  }
  return {
    changeType: 'guidance_update',
    setAsCurrent: true,
    approvedState: 'active',
    mayMoveScores: true,
  };
}
