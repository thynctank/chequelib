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
  if(!options || !options.name || !options.checkbook)
    throw("Error. Minimum data for account (name, cheque) not present");
  else {
    this.name = options.name;
    this.checkbook = options.checkbook;
    this.id = options.id || null;
    this.type = options.type || "checking";
    this.balance = options.balance || 0;
    this.notes = options.notes;
    this.entries = [];
    
    var self = this;
    this.checkbook.storage.createTable("entries", {account_id: "number", type: "string", subject: "string", amount: "number", date: "string", memo: "string", transfer_account_id: "number", transfer_entry_id: "number", pending: "number", check_number: "string"});
  }
}

Account.prototype = {
  // if data exists, fill in entries, callback takes entries array
  loadEntries: function(callback) {
    var self = this;
    this.checkbook.storage.read("entries", {account_id: this.id}, null, function(rows) {
      self.entries = rows;
      self.balance = self.getBalance();
      if(callback)
        callback();
    });
  },
  // save balance for reporting purposes (as in dashboard)
  save: function() {
    if(this.entries.length === 0) {
      if(this.entries.length === 0 && this.balance > 0)
        this.credit({subject: "Opening Balance", amount: this.balance, calledFromSave: true});
      if(this.entries.length === 0 && this.balance < 0)
        this.debit({subject: "Opening Balance", amount: this.balance, calledFromSave: true});
    }
    this.balance = this.getBalance();
    this.checkbook.storage.write("accounts", {id: this.id, balance: this.balance});
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
  debit: function(options, success) {
    options = options ? options : {};
    options.type = "debit";
    this._writeEntry(options, success);
  },
  getBalanceString: function(options) {
    // return as string with 2 decimal places
    return (this.getBalance()/100).toFixed(2);
  },
  credit: function(options, success) {
    options = options ? options : {};
    options.type = "credit";
    this._writeEntry(options, success);
  },
  // takes regular options obj but also takes transferAccountName
  transfer: function(options) {
    // setup a debit on this acct and a credit on the other acct
    if(!options || !options.transferAccountName)
      throw("Error. Minimum data for transfer (transferAccountName) not present");
    else {
      var thatAccount = this.checkbook.getAccount(options.transferAccountName);
      if(!thatAccount)
        throw("Error. Transfer account does not exist");
      else {
        options.subject = options.subject ? options.subject : "Transfer: " + this.name + " to " + thatAccount.name;

        debugger;
        var theseOptions = options;
        var thoseOptions = options;
        theseOptions.transfer_account_id = thatAccount.id;
        thoseOptions.transfer_account_id = this.id;
        
        var self = this;
        
        self.debit(theseOptions, function(thisInsertId) {
          // set to ID obtained from first _writeEntry
          thoseOptions.transfer_entry_id = thisInsertId;
          // get second ID for third db hit
          thatAccount.credit(thoseOptions, function(thatInsertId) {
            theseOptions.transfer_entry_id = thatInsertId;
            theseOptions.id = thisInsertId;
            theseOptions.type = "debit";
            self._writeEntry(theseOptions);
          }, function() {
            // rollback if second transaction failed
            self.checkbook.storage.erase("entries", {id: thisInsertId}, function() {
              self.save();
            });
          });
        });
      }
    }
  },
  eraseEntry: function(index, success, failure) {
    var entry = this.entries[index];
    this.checkbook.storage.erase("entries", {id: entry.id});
    // erase both sides of a transfer
    if(entry.transfer_entry_id)
      this.checkbook.storage.erase("entries", {id: entry.transfer_entry_id});

    var thatAccount = this.checkbook.getAccountById(entry.transfer_account_id);
    // if entry is debit, other entry must be credit, so subtract balance to reverse
    if(entry.type == "debit")
      thatAccount.balance -= entry.amount;
    else
      thatAccount.balance += entry.amount;

    thatAccount.save();
    this.save();

    this.entries.splice(index, 1);

  },
  // utility functions
  // transact should be able to rollback if something goes wrong, save if all works
  _writeEntry: function(options, success) {
    if(!options || !options.type || !options.subject || !options.amount)
      throw("Error. Minimum data for entry (subject, amount) not present");
    else {
      // require minimum options of type, subject, amount
      options = {
        account_id: this.id,
        type: options.type,
        subject: options.subject,
        amount: options.amount,
        id: options.id || null,
        date: options.date || (new Date().getTime()),
        memo: options.memo || null,
        transfer_account_id: options.transfer_account_id || null,
        transfer_entry_id: options.transfer_entry_id || null,
        pending: options.pending || 1,
        check_number: options.check_number || null
      };

      var self = this;
      this.checkbook.storage.write("entries", options, function(insertId) {
        if(!options.id) {
          options.id = insertId;
          self.entries.push(options);
          self.sort();
        }
        
        if(success)
          success(insertId);
        if(!options.calledFromSave)
          self.save();
      });
    }
  },
  sort: function(column) {
    if(!column)
      column = "date";
    this.entries.sort(function(a, b) {
      if(a[column] < b[column])
        return -1;
      if(a[column] > b[column])
        return 1;
      return 0;
    });
  }
};

// tie into universal search?