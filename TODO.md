1. Make sure transfers use transactions and roll back if one of the two fails, ensure balance maintained correctly in these situations
1. Add checkbox to entry list indicating cleared/not. Add check/uncheck all checkbox.
1. Add info button to account list for editing account info, notes (account details scene)
1. Add various entry transactionCodes mapped to debit/credit. New table: transaction_codes(id, name, type) - store name string on entry, but new entries lookup codes from this new table
  1. Swiped Card => debit
  1. Check => debit
  1. Withdrawal => debit
  1. Deposit => credit
  1. Transfer (later? Requires special case, addl dialog (or hidden field) for picking To account) => debit
1. Add icons (class based on transactionCode string)
1. Auto-complete subjects from previous subjects in same account
1. Only store the last X entries to conserve space. After 2 months combine previous two months' entries into single entry "<Month> balance", treat like "Current balance"