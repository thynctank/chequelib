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
    this.checkbook.storage.read("entries", {account_id: this.id}, {order: "date"}, function(rows) {
      self.entries = rows;
      self.balance = self.getBalance();
      if(callback)
        callback();
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
    if(this.entries.length === 0)
      this.loadEntries();
    // if still 0, must be new acct
    if(this.entries.length === 0) {
      if(this.balance > 0)
        this.credit({subject: "Current Balance", category: "Starting balance", cleared: 1, amount: this.balance, calledFromSave: true}, updateBalance);
      else if(this.balance < 0)
        this.debit({subject: "Current Balance", category: "Starting balance", cleared: 1, amount: Math.abs(this.balance), calledFromSave: true}, updateBalance);
      else
        updateBalance();
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
        options.category = options.subject = options.subject ? options.subject : "Transfer: " + this.name + " to " + thatAccount.name;
        var theseOptions = this.getEntryOptions(options);
        var thoseOptions = this.getEntryOptions(options);
        theseOptions.type = "debit";
        theseOptions.transfer_account_id = thatAccount.id;
        thoseOptions.type = "credit";
        thoseOptions.account_id = thatAccount.id;
        thoseOptions.transfer_account_id = this.id;
        
        var storage = this.checkbook.storage;
        var self = this;
        
        storage.transact(function(tx) {
          // write debit portion
          storage.write("entries", theseOptions, function(thisInsertId) {
            thoseOptions.transfer_entry_id = thisInsertId;
            // write credit portion w/ transfer_account_id and transfer_entry_id set appropriately
            storage.write("entries", thoseOptions, function(thatInsertId) {
              // update debit portion w/ second transfer_entry_id
              theseOptions.id = thisInsertId;
              theseOptions.transfer_entry_id = thatInsertId;
              storage.write("entries", theseOptions, null, null, tx);
            }, null, tx);
          }, null, tx);
        }, function() {
          // push entry on this acct, save
          self.entries.push(theseOptions);
          self.save();
          // push entry on that acct, save
          thatAccount.entries.push(thoseOptions);
          thatAccount.save();
          
          if(callback)
            callback();
        });
      }
    }
  },
  eraseEntry: function(index, callback) {
    var self = this;
    var entry = this.entries[index];
    
    this.checkbook.storage.erase("entries", {id: entry.id}, function() {
      self.entries.splice(index, 1);
      self.save(callback);
      // erase both sides of a transfer
      if(entry.transfer_entry_id) {
        self.checkbook.storage.erase("entries", {id: entry.transfer_entry_id}, function() {
          var thatAccount = self.checkbook.getAccountById(entry.transfer_account_id);
          thatAccount.save();
        });
      }
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