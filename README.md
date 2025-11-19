# sqlite-db

## Initial import and database opening

`sqlite-db` is wrapper around the new. `node:sqlite` package.  It provides a range of additional functions, including the ability to
run transactions, and more particularly in `async` mode (see below).

Before using ensure the package it is important that the following variables are set up in your environment
(particularly if you are using an `import` statement at the top of your file.)

  SQLITE_DB_DIR                             Directory (within Container if running in Docker) to find the database files.

  SQLITE_DB_INITDIR                         Directory (within Container if running in Docker) to find the database
                                            initiation files and the upgrade,downgrade files.

  SQLITE_DB_NAME                            Name of the initial database file minus a `.db` extension to be opened (others
                                            can be opened with `openDatabase` function). When opening the file, if it is empty (there are no user defined tables) it looks for file named `database-${SQLITE_DB_NAME}.sql` in the SQLITE_DB_INITDIR and executes it if found.

                                            For instance, this is the contents of that file.

  ```sql
CREATE TABLE Settings (
  name TEXT PRIMARY KEY,
  value INTEGER, --sqlite allows any type to be stored here but if possible we want it co-erced to an integer
  description TEXT,
  hidden BOOLEAN NOT NULL DEFAULT 0, --new column - don't show some values to user (although available for superuser)
  priority INTEGER NOT NULL DEFAULT 10000 --new columns - aid to sorting, lower priority at top, same priority in alphabetical order of name 
);

INSERT INTO Settings(name, value, description, hidden, priority) VALUES 
('db-version',1, 'Version of database schema used in this database',1, 0);
```
  
  SQLITE_DB_POOL_MIN_DB=2                   Put a connection in the pool instead of closing it if pool size is less than this 
  
  SQLITE_DB_POOL_MAX_DB=100                 Wait before opening any more connections if number of open connections matches or exceeds this 
  
  SQLITE_DB_VERSION.                        If the Database has a Settings Table, which it then assumes has  ***name***
  and                                          
                                            ***value*** columns, it reads the value of the `name = 'db-version'` record. If the SQLITE_DB_VERSION is higher, it then (in a loop) looks for enhancement scripts `upgrade-${SQLITE_DB_NAME}_${version}.sql` where version starts at the current version of the database and ends at SQLITE_DB_VERSION - 1. 

                                            For example if SQLITE_DB_VERSION = 2 and we just initialised the database with the script above.  We would be looking
                                            for the file `upgrade-${SQLITE_DB_NAME}_1.sql` to update from version 1 to version 2.  This script should include an update statement to change `'db-version'`

        

```sql
UPDATE Settings SET value = 2 WHERE name = 'db-version';
```

with these environment variables set, the first module to import the script will cause the scripts given above to run.  The modules import thusly:-

```javascript
import mydatabase from '@AKC42/sqlite-db';
```
this end up with a const variable ***mydatabase*** being a class instance of the database on which you can then make calls as described below.

NOTE: we will already have set up to close all connections for this database on process exit, so there is no need to explicity do so yourself.

All modules that do the import like above, even with a different variable name, end up with the same database connection, so can share user defined functions etc.

If any module wishes to work with another database in parallel, then instead they should import like this:-

```javascript
import {default as mydatabase, openDatabase} from '@AKC42/sqlite-db';
```
which then also provides the ***openDatabase*** function to open additional databases.  It is called so:-

```javascript
const myseconddatabase = await openDatabase(<name> [,<required version>]);
```

which does the same processesing as the initial database, initialisation script and upgrades (if the optional <required
version> is present), creating it if it doesn't yet exist from a `database.sql` file.  Note this is not an attachment to
the original connection.  If you want to attach do

```javascript
mydatabase.exec(`ATTACH ${path.resolve(process.env.SQLITE_DB_DIR, 'attach.db')}`);
```

## Database functions.

In this section wer are going to assume that you originally did the following

```javascript
import db from '@AKC42/sqlite-db';
```

It is likely that one of the first things you will want to do is set up any user defined functions, and if any of these
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
    //--- add the functions that we need to provide on the database
    db.function('digits',{deterministic: true}, (phone) => {
        if (typeof phone !== 'string') return null;
        return phone.replaceAll(/[^0-9]/g,'');
    });
 


    //------------------
    db.transaction((db) => {
        //we should now add the extra columns and indexes
        const preUpgrade =  path.resolve(process.env.SQLITE_DB_INITDIR, `pre-upgrade-${process.env.SQLITE_DB_NAME}.sql`);
        const upgrade = fs.readFileSync(preUpgrade,{ encoding: 'utf8' });
        db.exec(upgrade);
    });
    db.once('dbclose', db => {
        debugsql('Starting DownGrade to remove Indexes dependant on the digit function.')
        const postDowngrade = readFileSync(path.resolve(process.env.SQLITE_DB_INITDIR, `post-downgrade-${process.env.SQLITE_DB_NAME}.sql`),{ encoding: 'utf8' });
        db.exec(postDowngrade);
    });
  } catch(e) {
    logger('db', e.stack)
    db.close(); 
  }
}

```

This actually shows four separate things

***db.isOpen*** is a read only state set by the module showing the state of the database.  Normally it will be true, but
should any of the initialisation phases descibed above occur, then it will have been pre-closed.

***db.exec*** will take a string of sql commands and execute them.  An Error





Import it into your project as so

import database from @akc42/sqlite.db;

database(<absolute path the database file>, <absolute path to the `database.sql` file if needed>);

You can omit the second parameter if you KNOW that the database file exists. It will throw an error if any problems are encounterd


