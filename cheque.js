// accounts table:
// 
// id
// name
// balance
// type
// notes

function Cheque() {
  var self = this;
  this.accounts = new Hash();
  this.storage = new Storage();
  this.storage.createTable("accounts", {name: "string", balance: "number", type: "string", notes: "text"}, function() {
    // in reality, query accounts table for names/balances
    self.storage.read("accounts", null, null, function(rows) {
      for(var i = 0, j = rows.length; i < j; i++) {
        var data = rows[i];
        data.cheque = self;
        var acct = new Account(data);
        self.accounts.set(acct.name, acct);
      }
    });
  });
}

Cheque.prototype = {
  addAccount: function(options) {
    var self = this;
    var name = options.name;
    
    if(this.accounts.has(name))
      return;
    else {
      this.storage.count("accounts", {name: options.name}, function(rowCount) {
        if(rowCount === 0) {
          self.storage.write("accounts", options, function(insertId) {
            options.cheque = self;
            options.id = insertId;
            var acct = new Account(options);
            self.accounts.set(name, acct);
            console.log(acct);
          });
        }
      });
    }
  },
  removeAccount: function(name) {
    // wipe out all entries for this account number first
    var acct = this.getAccount(name);
    this.storage.erase("entries", {account_id: acct.id});
    this.storage.erase("accounts", {id: acct.id});
    this.accounts.remove(name);
  },
  getAccount: function(name) {
    return this.accounts.get(name);
  },
  getAccountById: function(id) {
    var foundAccount = null;
    this.accounts.each(function(acct) {
      if(acct.id === id)
        foundAccount = acct;
    });
    return foundAccount;
  }
};