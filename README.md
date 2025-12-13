# sqlite-db

## Initial import and database opening

`sqlite-db` is wrapper around the new. `node:sqlite` package.  It provides a range of additional functions, including the ability to
run transactions, and more particularly in `async` mode (see below).

Before using ensure the package it is important that the following variables are set up in your environment
(particularly if you are using an `import` statement at the top of your file.)

  SQLITE_DB_DIR                             Directory (within Container if running in Docker) to find the database files.

  SQLITE_DB_NAME                            Name of the initial database file (which will have '.db' appended to it) to
                                            be opened (others can be opened with ***openDatabase*** function). 

The modules all import thus:-

```javascript
import mydatabase from '@AKC42/sqlite-db';
```
this end up with a const variable ***mydatabase*** being a class instance of the database on which you can then make calls as described below.

NOTE: we will already have set up to close all connections for this database on process exit, so there is no need to explicity do so yourself.

All modules that do the import like above, even with a different variable name, end up with the same database connection, so can share user defined functions etc.

## Database methods.

In this section we are going to assume that you originally did the following

```javascript
import db from '@AKC42/sqlite-db';
```

It is likely that one of the first things you will want to do is initialise the database if it empty, run any updates to
ensure the database schema is at the correct versions and set up any user defined functions, and if any of these
functions are used in GENERATED AS clauses in columns in your ultimate schema you will have to add them and indexes into
the database.  In addition you will want to remove them on exit.  This module has a helper for this as it emits a
`'dbclose'` event when a database is about to close.  So you might want to include something like this in your start up
phase.  

```javascript
import db from '@AKC42/sqlite-db';
import { readFileSync } from 'node:fs';
import path from 'node:path';

if (db.isOpen) {
  try {
    const {count} = db.get`SELECT COUNT(*) AS tables FROM pragma_table_list() WHERE schema = 'main' AND name NOT LIKE 'sqlite_%'`
    if (count  === 0) {
      // We are not yet initialised so time to run the initisation script
      const initialiseScriptP =  path.resolve(process.env.SQLITE_DB_INITDIR, `${process.env.SQLITE_DB_NAME}.sql`);
      const initialiseScript = readFileSync(initialiseScriptP,{ encoding: 'utf8' });
      db.transaction((db) => {
        db.exec(initialiseScript);
      });
      // Do we need to do a database upgrade as a result of a recent release?
      const {value: dbVersion} = db.get`SELECT value FROM Settings WHERE name = 'db-version'`;
      if (dbVersion < Number(process.env.DATABASE_VERSION)) {
        const upgradeP =  path.resolve(process.env.SQLITE_DB_INITDIR, `upgrade-${process.env.SQLITE_DB_NAME}.sql`);
        const upgrade = readFileSync(upgradeP,{ encoding: 'utf8' });
        db.transaction((db) => {
          db.exec(upgrade);
          db.run`UPDATE Settings SET value = ${process.env.DATABASE_VERSION} where name = 'db-version`;
        });
      }
      
    }

    //--- add the functions that we need to provide on the database
    db.function('digits',{deterministic: true}, (phone) => {
        if (typeof phone !== 'string') return null;
        return phone.replaceAll(/[^0-9]/g,'');
    });
 


    //------------------
    db.transaction((db) => {
      /*
          we should now add the extra columns and indexes,, but we have to be carefull because a shutdown may have
          failed and we therefore need to check columns for the tables before creating them
        */
       for(const table of ['Enquiry', 'Customer']) {
          const columns = db.all`SELECT name FROM pragma_table_info(${table})`;
          if (!columns.map(c => c.name).includes('digithome')) db.exec(`ALTER TABLE ${table} ADD COLUMN ${'digithome'} TEXT AS (digits(${'telnohome'})) VIRTUAL`);
          if (!ccolumns.map(c => c.name).includes('digitoffice')) db.exec(`ALTER TABLE ${table} ADD COLUMN ${'digitoffice'} TEXT AS (digits(${'telnooffice'})) VIRTUAL`);
          if (!columns.map(c => c.name).includes('digitmobile')) db.exec(`ALTER TABLE ${table} ADD COLUMN ${'digitmobile'} TEXT AS (digits(${'telnomobile'})) VIRTUAL`);
       }
       db.exec(`CREATE INDEX IF NOT EXISTS IX_Enquiry_home ON Enquiry(digithome);
              CREATE INDEX IF NOT EXISTS IX_Enquiry_office ON Enquiry(digitoffice);
              CREATE INDEX IF NOT EXISTS IX_Enquiry_mobile ON Enquiry(digitmobile);
              CREATE INDEX IF NOT EXISTS IX_Customer_home ON Customer(digithome);
              CREATE INDEX IF NOT EXISTS IX_Customer_office ON Customer(digitoffice);
              CREATE INDEX IF NOT EXISTS IX_Customer_mobile ON Customer(digitmobile);`);
    });
    db.once('dbclose', db => {
      db.transaction((db) => {
          /*
            we should now drop the extra columns and indexes,, but we have to be carefull because a startup failre may have
            not have left columns in place.  We need to be sure they are they before we drop them
          */
        db.exec(`DROP INDEX IF EXISTS IX_Enquiry_home;
                  DROP INDEX IF EXISTS IX_Enquiry_office;
                  DROP INDEX IF EXISTS IX_Enquiry_mobile;
                  DROP INDEX IF EXISTS IX_Customer_home;
                  DROP INDEX IF EXISTS IX_Customer_office;
                  DROP INDEX IF EXISTS IX_Customer_mobile;`)

        for(const table of ['Enquiry', 'Customer']) {
            const columns = db.all`SELECT name FROM pragma_table_info(${table})`;
            if (columns.map(c => c.name).includes('digithome')) db.exec(`ALTER TABLE ${table} DROP COLUMN ${'digithome'}`);
            if (columns.map(c => c.name).includes('digitoffice')) db.exec(`ALTER TABLE ${table} DROP COLUMN ${'digitoffice'}`);
            if (columns.map(c => c.name).includes('digitmobile')) db.exec(`ALTER TABLE ${table} DROP COLUMN ${'digitmobile'}`);
        }
          
      });    
    });
  } catch(e) {
    console.log(e.stack)
    db.close(); 
  }
}

```

This actually shows seven separate methods being used on the database object being returnd

***db.isOpen*** is a read only state set by the module showing the state of the database. It will of course normally be
                open after initialisation but can indicate to other modules that the database has been closed

***db.get***    takes a template string.  This is actually because internally we create a `tagStore`. We actually support
                ***db.all***, ***db.get***, ***db.iterate*** and ***db.run***

***db.exec***   will take a string of sql commands and execute them.  We also support (if you would prefer to use that
                approach rather than the tag store) ***db.prepare***.  This returns the `node:sqlite` ***statement***
                and therefore exposes all of that interface.

***db.function*** Allows a function with a callback to be provided to the attached database. The script surrounding that
                shows that we  

***db.transaction***  Performs a transaction with a callback.  It is called as shown.  Behind the scenes, before the
                callback a BEGIN TRANSACTION is called.  If the callback returns then COMMIT is called.  However if the
                callback throws an error then ROLLBACK is called and the database is closed before the error is
                repeated.
                
                In normal circumstances it is important with this transaction that all activity within it is **synchonous** because other work from other modules could get embroiled within this transaction, and also that the callback would appear complete when it is not.  However, this whole module is designed to work in an envirnoment that is primarily asynchonous, and so an alternative is provided, ***db.transactionAsync***.  It is called as follows:-

```javascript
import { setTimeout } from 'node:timers/promises';

const return = await db.transactionAsync(async (db) => {
  ...
  const result = await setTimeout(100, 'result');
  ...
  return result;
}); 

console.log('Return : ', return);
// Return : result
```
                Behind the scenes, this function gets a new (dedicated) connection to the database before calling BEGIN TRANSACTION and does a COMMIT or
                ROLLBACK dependant of whether the callback threw and error.  The callback itself is assumed to return a promise which is awaited.  Each
                database on which this `transactionAsync` has its own pool of open connections we can be used to start the transaction and will be returned
                when the transaction ends.  The size of that pool is controlled by by two more environment variables (shown with typical values):-

  SQLITE_DB_POOL_MIN_DB=4                   Put a connection in the pool instead of closing it if the individual <databasename> pool size is less than
                                            this value

  SQLITE_DB_POOL_MAX_DB=100                 Stop and wait before opening any more connections across *all* databases              

                Before handing a new connection to the transaction callback, any user defined functions, defined at the time the first connection that is returned was made, are copied over to this new connection.  NOTE: trying to create a new user defined function inside an async transaction will throw an error.





***dbclose**    Is an event emitted by this module when the database has been closed.  This is how we trigger the
                downgrade action. As well as manually closing the database, the module also detects `process.exit` and
                closes all the databases that are open.

***db.close***  Allows you to close the database. What that call doesn't show is that the close function automatically
                runs `db.exec('VACUUM')` unless you explicitly tell it not to by passing a `true` parameter to the call.

                The process exit shutdown tells it to skip Vacuum on close.

There are two additional methods so far not discussed.

***db.inTransaction***  This is set true if a transaction is currently active on the current connection (it does not
                know the state of other connections).

***db.backup*** This is an async method which backs up the database. It is called with two parameters thus:-

                ```javascript
                await db.backup(backupfilename, authkey);
                ```
                The `backupfilename` should be the name of the backup file to be produced, including directory information.  `authkey` is a special key
                that must be provided which is obtained by calling a separate function (see below).  This is just extra protection against performing it unintentially.

## Additional Functions.

If any module wishes to work with another database in parallel, then instead they should import this module like this:-

```javascript
import {default as mydatabase, openDatabase} from '@AKC42/sqlite-db';
```
which then also provides the ***openDatabase*** function to open additional databases.  It is called so:-

```javascript
const myseconddatabase = await openDatabase(<name>);
```
where <name> is the equivelent of the SQLITE_DB_NAME environment variable. Note this is not an attachment to the original connection.  If you want to attach do

```javascript
mydatabase.exec(`ATTACH ${path.resolve(process.env.SQLITE_DB_DIR, 'attach.db')}`);
```
The database returned by ***openDatabase*** is in `wal` mode.


The module extends the Error class with a ***DatabaseError*** type.  This is exported should it be needed.

As mentioned above, in order to backup a database an authorisation key is needed.  This is obtained by calling
***backupAuthRequest** without any parameters.  It returns the key that has to be used with the `db.backup` method
described above.

Lastly debug/logging information is controlled by another function, ***manage***.  By default only the point at
which a new "max connections" is reached, and when the database is actually closed (not just handed back to the pool)
the tagstore at that point.  Finally on final shutdown, the maximum size of any tagstore.  However, these messages can
be switched off, and independantly an output of all the requests with SQL in them can be output.  The `manage` function
is called with two parameters.  The first is `'debug'` or`'logger'` (case insensitive) saying which type of output to
control, and the second parameter is the `true` or `false` boolean value which says whether that class of logging should
be on or off.  Note it dynamically changes, so its perfectly easy to print the first request in the loop but not see any
of the others (with debug logging on, execute the call in the loop and immediately turn debug logging off.  On exit from
the loop turn it back on again). 


