# sql-db

Is a module to open (creating it if it doesn't yet exist from a `database.sql` file).  It uses two environment 
variables to locate the database DATABASE_DB_DIR and DATABASE_DB are the directory and filename respectively of the sqlite3 
database. It also used DATABASE_DB_BUSY for the busy timeout.  DATABASE_DB_DIR can either be an absolute value, or relative 
from the project root (see npm module `app-root-path`). If the database file does not exist, it attempt to create it from the script
read from file named by DATABASE_INIT_FILE.  The path can be relative to project root or an absolute value.

