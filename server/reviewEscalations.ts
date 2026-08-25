export type EscalationRecipientRule = {
  userId: number;
  escalationRecipientUserId: number | null;
  active: boolean;
};

/** A rule not explicitly delegated remains visible to the original assignee. */
export function shouldNotifyEscalationRecipient(rule: EscalationRecipientRule, recipientUserId: number) {
  if (!rule.active) return false;
  return rule.escalationRecipientUserId === recipientUserId
    || (rule.escalationRecipientUserId === null && rule.userId === recipientUserId);
}

export function selectEscalationRulesForRecipient<T extends EscalationRecipientRule>(rules: T[], recipientUserId: number): T[] {
  return rules.filter(rule => shouldNotifyEscalationRecipient(rule, recipientUserId));
}
