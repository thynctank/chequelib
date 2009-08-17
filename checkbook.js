// accounts table:
// 
// id
// name
// balance
// type
// notes

function Checkbook(dbName, success, failure) {
  dbName = (dbName) ? dbName : "Cheque";
  var self = this;
  this.accounts = new ChequeHash();
  this.storage = new Storage(dbName);
  this.storage.createTable("accounts", {name: "string", balance: "number", type: "string", notes: "text"}, function() {
    // in reality, query accounts table for names/balances
    self.storage.read("accounts", null, {order: "name"}, function(rows) {
      for(var i = 0, j = rows.length; i < j; i++) {
        var data = rows[i];
        data.checkbook = self;
        var acct = new Account(data);
        self.accounts.set(acct.name, acct);
      }
      if(success)
        success(self);
    }, function() {
      if(failure)
        failure();
    });
  });
}

Checkbook.prototype = {
  accountsByName: function() {
    return this.accounts.getValues().sort(function(a, b) {
      if(a.name > b.name)
        return 1;
      else if(a.name < b.name)
        return -1;
      return 0;
    });
  },
  addOrAccessAccount: function(options, callback) {
    var self = this;
    var name = options.name;
    
    if(this.accounts.has(name)) {
      if(callback) {
        var acct = this.getAccount(name);
        callback(acct);
      }
    }
    else {
      this.storage.count("accounts", {name: options.name}, function(rowCount) {
        if(rowCount === 0) {
          self.storage.write("accounts", options, function(insertId) {
            options.checkbook = self;
            options.id = insertId;
            var acct = new Account(options);
            self.accounts.set(name, acct);
            acct.save(callback);
          });
        }
      });
    }
  },
  removeAccount: function(name, success) {
    // wipe out all entries for this account number first
    var acct = this.getAccount(name);
    this.storage.erase("entries", {account_id: acct.id});
    this.storage.erase("accounts", {id: acct.id}, success);
    this.accounts.remove(name);
  },
  removeAccountById: function(id, success) {
    // wipe out all entries for this account number first
    var acct = this.getAccountById(id);
    this.storage.erase("entries", {account_id: id});
    this.storage.erase("accounts", {id: id}, success);
    this.accounts.remove(acct.name);
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