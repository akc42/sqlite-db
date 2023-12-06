# sqlite-db


sqlite-db iss a simple module to open a sqlite database using the better-sqlite3 package, (creating it if it doesn't yet exist from a `database.sql` file).

Import it into your project as so

import database from @akc42/sqlite.db;

database(<absolute path the database file>, <absolute path to the `database.sql` file if needed>);

You can omit the second parameter if you KNOW that the database file exists. It will throw an error if any problems are encounterd


