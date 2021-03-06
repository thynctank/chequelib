// entries table:
// 
// id
// account_id (required)
// type (debit/credit, required)
// category (default subject line, determines icon, required)
// subject (required)
// amount (required)
// date
// memo
// transfer_account_id (for lookup of entry when deleting)
// transfer_entry_id (for lookup of entry when deleting)
// cleared
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
  }
}

Account.prototype = {
  // if data exists, fill in entries, callback takes entries array
  loadEntries: function(callback) {
    var self = this;
    var doAfter = function(rows) {
      self.entries = rows;
      self.balance = self.getBalance();
      if(callback)
        callback();
    };
    this.checkbook.storage.read("entries", {account_id: this.id}, {order: "date"}, doAfter, function() {
      var rows = [];
      doAfter(rows);
    });
  },
  // save balance for reporting purposes (as in dashboard)
  save: function(callback) {
    var self = this;
    var updateBalance = function() {
      self.balance = self.getBalance();
      self.checkbook.storage.write("accounts", {id: self.id, balance: self.balance}, function() {
        if(callback)
          callback(self);
      });
    };
    if(this.entries.length === 0) {
      var originalBalance = this.balance;
      this.loadEntries(function() {
        // if still 0, must be new acct
        if(self.entries.length === 0) {
          if(originalBalance > 0)
            self.credit({subject: "Starting Balance", category: "Deposit", cleared: 1, amount: originalBalance, calledFromSave: true}, updateBalance);
          else if(originalBalance < 0)
            self.debit({subject: "Starting Balance", category: "Withdrawal", cleared: 1, amount: Math.abs(originalBalance), calledFromSave: true}, updateBalance);
          else
            updateBalance();
        }
        else
          updateBalance();
      });
    }
    else
      updateBalance();
  },
  // options for getBalance allow for filtering by type, actual vs cleared
  getBalance: function(options) {
    var balance = 0;
    for(var i = 0, j = this.entries.length; i < j; i++) {
      var entry = this.entries[i];
      switch(entry.type) {
        case "credit":
          balance += entry.amount;
          break;
        case "debit":
          balance -= entry.amount;
          break;
      }
    }
    return balance;
  },
  // all three functions call transact
  debit: function(options, success) {
    options = options ? options : {};
    options.type = "debit";
    this.writeEntry(options, success);
  },
  getBalanceString: function(options) {
    // return as string with 2 decimal places
    return (this.getBalance()/100).toFixed(2);
  },
  credit: function(options, success) {
    options = options ? options : {};
    options.type = "credit";
    this.writeEntry(options, success);
  },
  // takes regular options obj but also takes transferAccountName
  transfer: function(options, callback) {
    // setup a debit on this acct and a credit on the other acct
    if(!options || !options.transferAccountName)
      throw("Error. Minimum data for transfer (transferAccountName) not present");
    else {
      var thatAccount = this.checkbook.getAccount(options.transferAccountName);
      if(!thatAccount)
        throw("Error. Transfer account does not exist");
      else {
        options.category = "Transfer";
        options.subject = options.subject || "Transfer: " + this.name + " to " + thatAccount.name;
        options.transfer_entry_id = null;
        
        var theseOptions = this.getEntryOptions(options);
        theseOptions.type = "debit";
        theseOptions.transfer_account_id = thatAccount.id;

        var thoseOptions = this.getEntryOptions(options);
        thoseOptions.type = "credit";
        thoseOptions.account_id = thatAccount.id;
        thoseOptions.transfer_account_id = this.id;
        
        var storage = this.checkbook.storage;
        var self = this;
        
        storage.transact(function(tx) {
          // write debit portion
          
          storage.write("entries", theseOptions, function(thisInsertId) {
            theseOptions.id = thisInsertId;
            thoseOptions.transfer_entry_id = thisInsertId;
            // write credit portion w/ transfer_account_id and transfer_entry_id set appropriately
            storage.write("entries", thoseOptions, function(thatInsertId) {
              // update debit portion w/ second transfer_entry_id
              theseOptions.transfer_entry_id = thatInsertId;
              storage.write("entries", theseOptions, null, null, tx);
            }, null, tx);
          }, null, tx);
        }, function() {
          // push entry on this acct, save
          self.loadEntries(function() {
            self.save(function() {
              // push entry on that acct, save
              thatAccount.loadEntries(function() {
                thatAccount.save(callback);
              });
            });
          });
        });
      }
    }
  },
  eraseEntry: function(entryId, callback) {
    var self = this;

    this.checkbook.storage.erase("entries", {id: entryId}, function() {
      self.loadEntries(function() {
        // erase both sides of a transfer
        self.save(function() {
          if(callback)
            callback();
        });
      });
    });
  },
  // utility functions
  // transact should be able to rollback if something goes wrong, save if all works
  getEntryOptions: function(options) {
    options = {
      account_id: this.id,
      type: options.type,
      category: options.category,
      subject: options.subject || options.category,
      amount: options.amount,
      id: options.id || null,
      date: options.date || (new Date().getTime()),
      memo: options.memo || null,
      transfer_account_id: options.transfer_account_id || null,
      transfer_entry_id: options.transfer_entry_id || null,
      cleared: options.cleared || 0,
      check_number: options.check_number || null
    };
    return options;
  },
  writeEntry: function(options, callback) {
    // require minimum options of type, category, amount
    if(!options || !options.category || !options.type || !options.amount)
      throw("Error. Minimum data for entry not present");
    else {
      options = this.getEntryOptions(options);

      var self = this;
      var storage = self.checkbook.storage;
      storage.createTable("entries", {account_id: "number", type: "string", category: "string", subject: "string", amount: "number", date: "string", memo: "string", transfer_account_id: "number", transfer_entry_id: "number", cleared: "number", check_number: "string"},
        function() {
          storage.createIndex("entries", "account_id");
          storage.createIndex("entries", "transfer_entry_id");
          storage.createIndex("entries", "subject");
          
          storage.write("entries", options, function(insertId) {
            if(!options.id) {
              options.id = insertId;
              self.entries.push(options);
              self.sort();
            }

            if(callback)
              callback(insertId);
            if(!options.calledFromSave)
              self.save();
          });
        }
      );      
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