// entries table:
// 
// id
// account_id
// type
// subject (required)
// amount (required)
// date
// memo
// transfer_account_id (for lookup of entry when deleting)
// transfer_entry_id (for lookup of entry when deleting)
// pending
// check_number

// entries is an array of obj literals with properties matching entries table cols

function Account(options) {
  if(!options || !options.name || !options.cheque)
    throw("Error. Minimum data for account (name, cheque) not present");
  else {
    this.name = options.name;
    this.cheque = options.cheque;
    this.id = options.id || null;
    this.type = options.type || "checking";
    this.balance = options.balance || 0;
    this.notes = options.notes;
    this.entries = [];
    
    var self = this;
    this.cheque.storage.createTable("entries", {account_id: "number", type: "string", subject: "string", amount: "number", date: "string", memo: "string", transfer_account_id: "number", transfer_entry_id: "number", pending: "number", check_number: "string"}, function() {
      self.loadEntries(function() {
        self.save();
      });
    });
  }
}

Account.prototype = {
  // if data exists, fill in entries, callback takes entries array
  loadEntries: function(callback) {
    var self = this;
    this.cheque.storage.read("entries", {account_id: this.id}, function(rows) {
      self.entries = rows;
      if(callback)
        callback();
    });
  },
  // save balance for reporting purposes (as in dashboard)
  save: function() {
    if(this.entries.length === 0 && this.balance > 0)
      this.credit({subject: "Opening Balance", amount: this.balance, calledFromSave: true});
    if(this.entries.length === 0 && this.balance < 0)
      this.debit({subject: "Opening Balance", amount: this.balance, calledFromSave: true});

    this.balance = this.getBalance();
    this.cheque.storage.write("accounts", {id: this.id, balance: this.balance});
  },
  // options for getBalance allow for filtering by type, actual vs cleared
  getBalance: function(options) {
    var balance = 0;
    for(var i = 0, j = this.entries.length; i < j; i++) {
      if(this.entries[i].type == "credit")
        balance += this.entries[i].amount;
      else
        balance -= this.entries[i].amount;
    }
    return balance;
  },
  // all three functions call transact
  debit: function(options) {
    options = options ? options : {};
    options.type = "debit";
    this._writeEntry(options);
  },
  getBalanceString: function(options) {
    // return as string with 2 decimal places
    return (this.getBalance()/100).toFixed(2);
  },
  credit: function(options) {
    options = options ? options : {};
    options.type = "credit";
    this._writeEntry(options);
  },
  // takes regular options obj but also takes transferAccountName
  transfer: function(options) {
    // setup a debit on this acct and a credit on the other acct
    if(!options || !options.transferAccountName)
      throw("Error. Minimum data for transfer (transferAccountName) not present");
    else {
      var thatAccount = this.cheque.getAccount(options.transferAccountName);
      if(!thatAccount)
        throw("Error. Transfer account does not exist");
      else {
        options.subject = options.subject ? options.subject : "Transfer: " + this.name + " to " + thatAccount.name;

        var theseOptions = options;
        theseOptions.transfer_account_id = thatAccount.id;
        // get ID from this _writeEntry call, index
        this.debit(theseOptions);

        var thoseOptions = options;
        
        thoseOptions.transfer_account_id = this.id;
        // set to ID obtained from first _writeEntry
        thoseOptions.transfer_entry_id = null;
        
        // get this ID for third db hit
        thatAccount.credit(thoseOptions);
        
        // use second obtained ID
        theseOptions.transfer_entry_id = null;
        // this.credit(theseOptions, index);
      }
    }
  },
  eraseEntry: function(index, success, failure) {
    this.entries.splice(index, 1);
    
    // build sql
    // this.cheque.storage.erase(sql, success, failure);
    this.save();
  },
  // utility functions
  // transact should be able to rollback if something goes wrong, save if all works
  _writeEntry: function(options, index) {
    if(!options || !options.type || !options.subject || !options.amount)
      throw("Error. Minimum data for entry (subject, amount) not present");
    else {
      if(index) {
        this.entries[index] = options;
      }
      else {
        // require minimum options of type, subject, amount
        options = {
          account_id: this.id,
          type: options.type,
          subject: options.subject,
          amount: options.amount,
          date: options.date || (new Date().getTime()),
          memo: options.memo || null,
          transfer_account_id: options.transfer_account_id || null,
          transfer_entry_id: options.transfer_entry_id || null,
          pending: options.pending || 1,
          check_number: options.check_number || null
        };
        this.entries.push(options);
      }

      // build appropriate sql
      this.cheque.storage.write("entries", options);
      
      if(options.calledFromSave)
        return;
      else
        this.save();
    }
  },
  sort: function(column) {}
};

// tie into universal search?